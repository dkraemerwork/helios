/**
 * Distributed ReplicatedMap service — all-member replication (not partition-owned).
 *
 * Every node holds a complete replica. Mutations are broadcast to all peers and
 * applied locally. Version-vector conflict resolution: last-writer-wins per key
 * using a monotone version number.
 *
 * Anti-entropy: periodic sync pushes the full local state to all peers so that
 * stale replicas eventually converge even if messages were dropped.
 *
 * Port of com.hazelcast.replicatedmap.impl.ReplicatedMapService.
 */
import type {
  ClusterMessage,
  ReplicatedMapStateAckMsg,
  ReplicatedMapStateSyncMsg,
} from "@zenystx/helios-core/cluster/tcp/ClusterMessage";
import {
  decodeData,
  encodeData,
} from "@zenystx/helios-core/cluster/tcp/DataWireCodec";
import { TcpClusterTransport } from "@zenystx/helios-core/cluster/tcp/TcpClusterTransport";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import type { HeliosClusterCoordinator } from "@zenystx/helios-core/instance/impl/HeliosClusterCoordinator";
import type { Data } from "@zenystx/helios-core/internal/serialization/Data";

export type ReplicatedMapEventType = "ADDED" | "UPDATED" | "REMOVED" | "CLEARED";

export interface ReplicatedMapEntryEvent {
  name: string;
  key: Data | null;
  value: Data | null;
  oldValue: Data | null;
  eventType: ReplicatedMapEventType;
  numberOfAffectedEntries: number;
}

export interface ReplicatedMapEntryListener {
  entryAdded?(event: ReplicatedMapEntryEvent): void;
  entryUpdated?(event: ReplicatedMapEntryEvent): void;
  entryRemoved?(event: ReplicatedMapEntryEvent): void;
  mapCleared?(event: ReplicatedMapEntryEvent): void;
}

const ANTI_ENTROPY_INTERVAL_MS = 10_000;

function dataFp(d: Data): string {
  const buf = d.toByteArray();
  return buf === null ? "" : buf.toString("base64");
}

interface ReplicatedEntry {
  key: Data;
  value: Data;
  version: number;
  /** -1 means removed (tombstone). */
  tombstone: boolean;
}

interface ReplicatedMapContainer {
  /** fingerprint(key) → entry (includes tombstones for version tracking) */
  entries: Map<string, ReplicatedEntry>;
  /** monotone counter for this node's writes to this map */
  localVersion: number;
}

interface PendingRemoteRequest {
  resolve: (msg: ReplicatedMapStateAckMsg) => void;
  reject: (err: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

export class DistributedReplicatedMapService {
  private readonly _maps = new Map<string, ReplicatedMapContainer>();
  private readonly _pendingRemoteRequests = new Map<
    string,
    PendingRemoteRequest
  >();
  private readonly _listeners = new Map<string, Map<string, ReplicatedMapEntryListener>>();
  private readonly _listenerCounters = new Map<string, number>();
  private _antiEntropyHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly _instanceName: string,
    private readonly _config: HeliosConfig,
    private readonly _transport: TcpClusterTransport | null,
    private readonly _coordinator: HeliosClusterCoordinator | null,
  ) {
    if (this._transport !== null) {
      this._antiEntropyHandle = setInterval(() => {
        this._runAntiEntropy();
      }, ANTI_ENTROPY_INTERVAL_MS);
    }
  }

  shutdown(): void {
    if (this._antiEntropyHandle !== null) {
      clearInterval(this._antiEntropyHandle);
      this._antiEntropyHandle = null;
    }
  }

  // ── Message dispatcher ───────────────────────────────────────────────

  handleMessage(message: ClusterMessage): boolean {
    switch (message.type) {
      case "REPLICATED_MAP_PUT":
        this._handleRemotePut(message);
        return true;
      case "REPLICATED_MAP_REMOVE":
        this._handleRemoteRemove(message);
        return true;
      case "REPLICATED_MAP_CLEAR":
        this._handleRemoteClear(message);
        return true;
      case "REPLICATED_MAP_STATE_SYNC":
        this._handleStateSync(message);
        return true;
      case "REPLICATED_MAP_STATE_ACK":
        this._handleStateAck(message);
        return true;
      default:
        return false;
    }
  }

  // ── Public API ───────────────────────────────────────────────────────

  put(name: string, keyData: Data, valueData: Data): Data | null {
    const container = this._getOrCreate(name);
    const fp = dataFp(keyData);
    const existing = container.entries.get(fp);
    const old = existing && !existing.tombstone ? existing.value : null;

    const version = ++container.localVersion;
    container.entries.set(fp, {
      key: keyData,
      value: valueData,
      version,
      tombstone: false,
    });

    this._broadcastPut(name, keyData, valueData, version);
    this._dispatchEntryEvent(
      name,
      old === null ? "ADDED" : "UPDATED",
      keyData,
      valueData,
      old,
    );
    return old;
  }

  get(name: string, keyData: Data): Data | null {
    const container = this._getOrCreate(name);
    const entry = container.entries.get(dataFp(keyData));
    if (entry === undefined || entry.tombstone) return null;
    return entry.value;
  }

  remove(name: string, keyData: Data): Data | null {
    const container = this._getOrCreate(name);
    const fp = dataFp(keyData);
    const existing = container.entries.get(fp);
    if (existing === undefined || existing.tombstone) return null;

    const old = existing.value;
    const version = ++container.localVersion;
    // Tombstone: keep the entry to win conflicts against older versions
    existing.tombstone = true;
    existing.version = version;

    this._broadcastRemove(name, keyData, version);
    this._dispatchEntryEvent(name, "REMOVED", keyData, null, old);
    return old;
  }

  containsKey(name: string, keyData: Data): boolean {
    const entry = this._getOrCreate(name).entries.get(dataFp(keyData));
    return entry !== undefined && !entry.tombstone;
  }

  containsValue(name: string, valueData: Data): boolean {
    const vFp = dataFp(valueData);
    for (const entry of Array.from(this._getOrCreate(name).entries.values())) {
      if (!entry.tombstone && dataFp(entry.value) === vFp) return true;
    }
    return false;
  }

  size(name: string): number {
    let count = 0;
    for (const entry of Array.from(this._getOrCreate(name).entries.values())) {
      if (!entry.tombstone) count++;
    }
    return count;
  }

  isEmpty(name: string): boolean {
    return this.size(name) === 0;
  }

  clear(name: string): void {
    const container = this._getOrCreate(name);
    const affectedEntries = this.size(name);
    const version = ++container.localVersion;
    for (const entry of Array.from(container.entries.values())) {
      entry.tombstone = true;
      entry.version = version;
    }
    this._broadcastClear(name, version);
    if (affectedEntries > 0) {
      this._dispatchEntryEvent(name, "CLEARED", null, null, null, affectedEntries);
    }
  }

  keySet(name: string): Data[] {
    const result: Data[] = [];
    for (const entry of Array.from(this._getOrCreate(name).entries.values())) {
      if (!entry.tombstone) result.push(entry.key);
    }
    return result;
  }

  values(name: string): Data[] {
    const result: Data[] = [];
    for (const entry of Array.from(this._getOrCreate(name).entries.values())) {
      if (!entry.tombstone) result.push(entry.value);
    }
    return result;
  }

  entrySet(name: string): [Data, Data][] {
    const result: [Data, Data][] = [];
    for (const entry of Array.from(this._getOrCreate(name).entries.values())) {
      if (!entry.tombstone) result.push([entry.key, entry.value]);
    }
    return result;
  }

  putAll(name: string, pairs: [Data, Data][]): void {
    for (const [k, v] of pairs) {
      this.put(name, k, v);
    }
  }

  addEntryListener(name: string, listener: ReplicatedMapEntryListener): string {
    if (listener === null || listener === undefined) {
      throw new Error("NullPointerException: listener is null");
    }
    const registrations = this._listeners.get(name) ?? new Map<string, ReplicatedMapEntryListener>();
    this._listeners.set(name, registrations);
    const nextCounter = (this._listenerCounters.get(name) ?? 0) + 1;
    this._listenerCounters.set(name, nextCounter);
    const id = `listener-${nextCounter}`;
    registrations.set(id, listener);
    return id;
  }

  removeEntryListener(name: string, registrationId: string): boolean {
    return this._listeners.get(name)?.delete(registrationId) ?? false;
  }

  // ── Remote broadcast helpers ──────────────────────────────────────────

  private _broadcastPut(
    name: string,
    keyData: Data,
    valueData: Data,
    version: number,
  ): void {
    this._transport?.broadcast({
      type: "REPLICATED_MAP_PUT",
      mapName: name,
      version,
      sourceNodeId: this._instanceName,
      keyData: encodeData(keyData),
      valueData: encodeData(valueData),
    });
  }

  private _broadcastRemove(
    name: string,
    keyData: Data,
    version: number,
  ): void {
    this._transport?.broadcast({
      type: "REPLICATED_MAP_REMOVE",
      mapName: name,
      version,
      sourceNodeId: this._instanceName,
      keyData: encodeData(keyData),
    });
  }

  private _broadcastClear(name: string, version: number): void {
    this._transport?.broadcast({
      type: "REPLICATED_MAP_CLEAR",
      mapName: name,
      version,
      sourceNodeId: this._instanceName,
    });
  }

  // ── Remote message handlers ──────────────────────────────────────────

  private _handleRemotePut(
    message: Extract<ClusterMessage, { type: "REPLICATED_MAP_PUT" }>,
  ): void {
    const container = this._getOrCreate(message.mapName);
    const key = decodeData(message.keyData);
    const value = decodeData(message.valueData);
    const fp = dataFp(key);
    const existing = container.entries.get(fp);

    // Last-writer-wins: only apply if incoming version is newer
    if (existing !== undefined && existing.version >= message.version) return;

    container.entries.set(fp, {
      key,
      value,
      version: message.version,
      tombstone: false,
    });
    this._dispatchEntryEvent(
      message.mapName,
      existing === undefined || existing.tombstone ? "ADDED" : "UPDATED",
      key,
      value,
      existing === undefined || existing.tombstone ? null : existing.value,
    );
    // Update local version to be at least as high as the remote version
    if (message.version > container.localVersion) {
      container.localVersion = message.version;
    }
  }

  private _handleRemoteRemove(
    message: Extract<ClusterMessage, { type: "REPLICATED_MAP_REMOVE" }>,
  ): void {
    const container = this._getOrCreate(message.mapName);
    const key = decodeData(message.keyData);
    const fp = dataFp(key);
    const existing = container.entries.get(fp);

    if (existing !== undefined && existing.version >= message.version) return;

    const entry = existing ?? { key, value: key, version: 0, tombstone: false };
    const oldValue = existing !== undefined && !existing.tombstone ? existing.value : null;
    entry.tombstone = true;
    entry.version = message.version;
    container.entries.set(fp, entry);
    if (oldValue !== null) {
      this._dispatchEntryEvent(message.mapName, "REMOVED", key, null, oldValue);
    }

    if (message.version > container.localVersion) {
      container.localVersion = message.version;
    }
  }

  private _handleRemoteClear(
    message: Extract<ClusterMessage, { type: "REPLICATED_MAP_CLEAR" }>,
  ): void {
    const container = this._getOrCreate(message.mapName);
    let affectedEntries = 0;
    for (const entry of Array.from(container.entries.values())) {
      if (entry.version < message.version) {
        if (!entry.tombstone) {
          affectedEntries++;
        }
        entry.tombstone = true;
        entry.version = message.version;
      }
    }
    if (affectedEntries > 0) {
      this._dispatchEntryEvent(message.mapName, "CLEARED", null, null, null, affectedEntries);
    }
    if (message.version > container.localVersion) {
      container.localVersion = message.version;
    }
  }

  private _dispatchEntryEvent(
    name: string,
    eventType: ReplicatedMapEventType,
    key: Data | null,
    value: Data | null,
    oldValue: Data | null,
    numberOfAffectedEntries = 1,
  ): void {
    const listeners = this._listeners.get(name);
    if (listeners === undefined) {
      return;
    }
    const event: ReplicatedMapEntryEvent = {
      name,
      key,
      value,
      oldValue,
      eventType,
      numberOfAffectedEntries,
    };
    for (const listener of listeners.values()) {
      if (eventType === "ADDED") {
        listener.entryAdded?.(event);
        continue;
      }
      if (eventType === "UPDATED") {
        listener.entryUpdated?.(event);
        continue;
      }
      if (eventType === "REMOVED") {
        listener.entryRemoved?.(event);
        continue;
      }
      listener.mapCleared?.(event);
    }
  }

  private _handleStateSync(
    message: Extract<ClusterMessage, { type: "REPLICATED_MAP_STATE_SYNC" }>,
  ): void {
    const container = this._getOrCreate(message.mapName);

    for (const [encodedKey, encodedValue] of message.entries) {
      const key = decodeData(encodedKey);
      const value = decodeData(encodedValue);
      const fp = dataFp(key);
      const existing = container.entries.get(fp);
      // Accept state only if it's newer
      if (existing === undefined || existing.version < message.version) {
        container.entries.set(fp, {
          key,
          value,
          version: message.version,
          tombstone: false,
        });
      }
    }
    if (message.version > container.localVersion) {
      container.localVersion = message.version;
    }

    if (message.requestId !== null) {
      this._transport?.send(message.sourceNodeId, {
        type: "REPLICATED_MAP_STATE_ACK",
        requestId: message.requestId,
        mapName: message.mapName,
        version: message.version,
      });
    }
  }

  private _handleStateAck(
    message: Extract<ClusterMessage, { type: "REPLICATED_MAP_STATE_ACK" }>,
  ): void {
    const pending = this._pendingRemoteRequests.get(message.requestId);
    if (pending === undefined) return;
    this._pendingRemoteRequests.delete(message.requestId);
    if (pending.timeoutHandle !== null) clearTimeout(pending.timeoutHandle);
    pending.resolve(message);
  }

  // ── Anti-entropy ─────────────────────────────────────────────────────

  private _runAntiEntropy(): void {
    if (this._transport === null || this._coordinator === null) return;
    const memberIds = this._coordinator
      .getCluster()
      .getMembers()
      .map((m) => m.getUuid())
      .filter((id) => id !== this._instanceName);

    for (const [name, container] of Array.from(this._maps.entries())) {
      const liveEntries: Array<[import("@zenystx/helios-core/cluster/tcp/DataWireCodec").EncodedData, import("@zenystx/helios-core/cluster/tcp/DataWireCodec").EncodedData]> = Array.from(
        container.entries.values(),
      )
        .filter((e) => !e.tombstone)
        .map((e) => [encodeData(e.key), encodeData(e.value)]);

      if (liveEntries.length === 0) continue;

      const msg: ReplicatedMapStateSyncMsg = {
        type: "REPLICATED_MAP_STATE_SYNC",
        requestId: null,
        sourceNodeId: this._instanceName,
        mapName: name,
        version: container.localVersion,
        entries: liveEntries,
      };

      for (const memberId of memberIds) {
        this._transport.send(memberId, msg);
      }
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private _getOrCreate(name: string): ReplicatedMapContainer {
    let container = this._maps.get(name);
    if (container === undefined) {
      container = { entries: new Map(), localVersion: 0 };
      this._maps.set(name, container);
    }
    return container;
  }
}
