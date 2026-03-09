/**
 * Distributed MultiMap service — partition-owned with sync-backup replication.
 *
 * Port of com.hazelcast.multimap.impl.MultiMapService (distributed subset).
 */
import type {
  ClusterMessage,
  MultiMapEventMsg,
  MultiMapResponseMsg,
  MultiMapStateAckMsg,
  MultiMapStateSyncMsg,
} from "@zenystx/helios-core/cluster/tcp/ClusterMessage";
import type { EncodedData } from "@zenystx/helios-core/cluster/tcp/DataWireCodec";
import {
  decodeData,
  encodeData,
} from "@zenystx/helios-core/cluster/tcp/DataWireCodec";
import { TcpClusterTransport } from "@zenystx/helios-core/cluster/tcp/TcpClusterTransport";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import type { HeliosClusterCoordinator } from "@zenystx/helios-core/instance/impl/HeliosClusterCoordinator";
import type { Data } from "@zenystx/helios-core/internal/serialization/Data";
import type { SerializationService } from "@zenystx/helios-core/internal/serialization/SerializationService";
import { EntryEventImpl } from "@zenystx/helios-core/map/EntryListener";
import { ValueCollectionType } from "@zenystx/helios-core/multimap/MultiMapConfig";

// ── Container helpers ─────────────────────────────────────────────────

function dataFp(d: Data): string {
  const buf = d.toByteArray();
  return buf === null ? "" : buf.toString("base64");
}

/** Per-key value collection with SET or LIST semantics. */
class ValueCollection {
  private readonly _items: Data[] = [];

  constructor(private readonly _type: ValueCollectionType) {}

  add(value: Data): boolean {
    if (this._type === ValueCollectionType.SET) {
      const fp = dataFp(value);
      if (this._items.some((v) => dataFp(v) === fp)) return false;
    }
    this._items.push(value);
    return true;
  }

  removeOne(value: Data): boolean {
    const fp = dataFp(value);
    const idx = this._items.findIndex((v) => dataFp(v) === fp);
    if (idx === -1) return false;
    this._items.splice(idx, 1);
    return true;
  }

  has(value: Data): boolean {
    const fp = dataFp(value);
    return this._items.some((v) => dataFp(v) === fp);
  }

  get size(): number {
    return this._items.length;
  }

  toArray(): Data[] {
    return [...this._items];
  }
}

interface MultiMapContainer {
  /** fingerprint(key) → ValueCollection */
  entries: Map<string, { key: Data; col: ValueCollection }>;
  version: number;
  operationChain: Promise<void>;
  valueCollectionType: ValueCollectionType;
}

interface PendingRemoteRequest {
  resolve: (msg: MultiMapResponseMsg | MultiMapStateAckMsg) => void;
  reject: (err: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

interface MultiMapClearEvent {
  name: string;
  sourceNodeId: string;
  numberOfAffectedEntries: number;
}

interface MultiMapEntryListener<K = unknown, V = unknown> {
  entryAdded?(event: EntryEventImpl<K, V>): void;
  entryRemoved?(event: EntryEventImpl<K, V>): void;
  mapCleared?(event: MultiMapClearEvent): void;
}

interface MultiMapListenerRegistration<K = unknown, V = unknown> {
  listener: MultiMapEntryListener<K, V>;
  includeValue: boolean;
}

type MultiMapOperation =
  | "put"
  | "get"
  | "remove"
  | "removeAll"
  | "containsKey"
  | "containsValue"
  | "containsEntry"
  | "keySet"
  | "values"
  | "entrySet"
  | "size"
  | "valueCount"
  | "clear";

// ── Service ───────────────────────────────────────────────────────────

export class DistributedMultiMapService {
  private readonly _containers = new Map<string, MultiMapContainer>();
  private readonly _pendingRemoteRequests = new Map<
    string,
    PendingRemoteRequest
  >();
  private readonly _listeners = new Map<
    string,
    Map<string, MultiMapListenerRegistration>
  >();
  private readonly _listenerCounters = new Map<string, number>();

  constructor(
    private readonly _instanceName: string,
    private readonly _config: HeliosConfig,
    private readonly _serializationService: SerializationService,
    private readonly _transport: TcpClusterTransport | null,
    private readonly _coordinator: HeliosClusterCoordinator | null,
  ) {
    this._coordinator?.onMembershipChanged(() => {
      this._resyncAll();
    });
  }

  // ── Message dispatcher ───────────────────────────────────────────────

  handleMessage(message: ClusterMessage): boolean {
    switch (message.type) {
      case "MULTIMAP_REQUEST":
        this._handleMultiMapRequest(message);
        return true;
      case "MULTIMAP_RESPONSE":
      case "MULTIMAP_STATE_ACK":
        this._handlePendingRequest(message);
        return true;
      case "MULTIMAP_STATE_SYNC":
        this._handleStateSync(message);
        return true;
      case "MULTIMAP_EVENT":
        this._dispatchMultiMapEvent(message);
        return true;
      default:
        return false;
    }
  }

  // ── Public API ───────────────────────────────────────────────────────

  async put(
    name: string,
    keyData: Data,
    valueData: Data,
    type = ValueCollectionType.LIST,
  ): Promise<boolean> {
    const r = await this._invoke(name, "put", { keyData, valueData }, type);
    return r.booleanResult ?? false;
  }

  async get(name: string, keyData: Data): Promise<Data[]> {
    const r = await this._invoke(name, "get", { keyData });
    return (r.dataList ?? []).map(decodeData);
  }

  async remove(name: string, keyData: Data, valueData: Data): Promise<boolean> {
    const r = await this._invoke(name, "remove", { keyData, valueData });
    return r.booleanResult ?? false;
  }

  async removeAll(name: string, keyData: Data): Promise<Data[]> {
    const r = await this._invoke(name, "removeAll", { keyData });
    return (r.dataList ?? []).map(decodeData);
  }

  async containsKey(name: string, keyData: Data): Promise<boolean> {
    const r = await this._invoke(name, "containsKey", { keyData });
    return r.booleanResult ?? false;
  }

  async containsValue(name: string, valueData: Data): Promise<boolean> {
    const r = await this._invoke(name, "containsValue", { valueData });
    return r.booleanResult ?? false;
  }

  async containsEntry(
    name: string,
    keyData: Data,
    valueData: Data,
  ): Promise<boolean> {
    const r = await this._invoke(name, "containsEntry", { keyData, valueData });
    return r.booleanResult ?? false;
  }

  async keySet(name: string): Promise<Data[]> {
    const r = await this._invoke(name, "keySet");
    return (r.dataList ?? []).map(decodeData);
  }

  async values(name: string): Promise<Data[]> {
    const r = await this._invoke(name, "values");
    return (r.dataList ?? []).map(decodeData);
  }

  async entrySet(name: string): Promise<[Data, Data][]> {
    const r = await this._invoke(name, "entrySet");
    return (r.entrySet ?? []).map(([k, v]) => [decodeData(k), decodeData(v)]);
  }

  async size(name: string): Promise<number> {
    const r = await this._invoke(name, "size");
    return r.numberResult ?? 0;
  }

  async valueCount(name: string, keyData: Data): Promise<number> {
    const r = await this._invoke(name, "valueCount", { keyData });
    return r.numberResult ?? 0;
  }

  async clear(name: string): Promise<void> {
    await this._invoke(name, "clear");
  }

  addEntryListener<K, V>(
    name: string,
    listener: MultiMapEntryListener<K, V>,
    includeValue = true,
  ): string {
    if (listener === null || listener === undefined) {
      throw new Error("NullPointerException: listener is null");
    }
    const registrations =
      this._listeners.get(name) ??
      new Map<string, MultiMapListenerRegistration>();
    this._listeners.set(name, registrations);
    const nextCounter = (this._listenerCounters.get(name) ?? 0) + 1;
    this._listenerCounters.set(name, nextCounter);
    const id = `listener-${nextCounter}`;
    registrations.set(id, { listener, includeValue });
    return id;
  }

  removeEntryListener(name: string, registrationId: string): boolean {
    return this._listeners.get(name)?.delete(registrationId) ?? false;
  }

  // ── Routing ──────────────────────────────────────────────────────────

  private async _invoke(
    name: string,
    operation: MultiMapOperation,
    options?: { keyData?: Data; valueData?: Data; dataList?: Data[] },
    valueCollectionType = ValueCollectionType.LIST,
  ): Promise<MultiMapResponseMsg> {
    const ownerId = this._resolveOwnerId(name);
    if (ownerId === this._instanceName || this._transport === null) {
      return this._invokeLocally(name, operation, options, valueCollectionType);
    }

    const requestId = crypto.randomUUID();
    const response = new Promise<MultiMapResponseMsg>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this._pendingRemoteRequests.delete(requestId);
        reject(
          new Error(
            `MultiMap request timed out for '${name}' (${operation})`,
          ),
        );
      }, 120_000);
      this._pendingRemoteRequests.set(requestId, {
        resolve: (msg) => resolve(msg as MultiMapResponseMsg),
        reject,
        timeoutHandle,
      });
    });

    this._transport.send(ownerId, {
      type: "MULTIMAP_REQUEST",
      requestId,
      sourceNodeId: this._instanceName,
      mapName: name,
      operation,
      keyData: options?.keyData ? encodeData(options.keyData) : undefined,
      valueData: options?.valueData ? encodeData(options.valueData) : undefined,
      dataList: options?.dataList?.map(encodeData),
    });

    return response;
  }

  private async _invokeLocally(
    name: string,
    operation: MultiMapOperation,
    options?: { keyData?: Data; valueData?: Data; dataList?: Data[] },
    valueCollectionType = ValueCollectionType.LIST,
  ): Promise<MultiMapResponseMsg> {
    return this._enqueueOperation(
      name,
      async (container) => {
        switch (operation) {
          case "put": {
            const key = options?.keyData;
            const val = options?.valueData;
            if (key === undefined || val === undefined) {
              throw new Error("NullPointerException");
            }
            const fp = dataFp(key);
            let entry = container.entries.get(fp);
            if (entry === undefined) {
              entry = { key, col: new ValueCollection(container.valueCollectionType) };
              container.entries.set(fp, entry);
            }
            const changed = entry.col.add(val);
            if (changed) {
              container.version++;
              await this._replicateState(name, container);
              this._broadcastEvent(name, "ADDED", key, val, null, 1);
            }
            return this._boolResponse(changed);
          }
          case "get": {
            const key = options?.keyData;
            if (key === undefined) throw new Error("NullPointerException");
            const entry = container.entries.get(dataFp(key));
            return {
              type: "MULTIMAP_RESPONSE",
              requestId: "local",
              success: true,
              resultType: "data-array",
              dataList: entry?.col.toArray().map(encodeData) ?? [],
            };
          }
          case "remove": {
            const key = options?.keyData;
            const val = options?.valueData;
            if (key === undefined || val === undefined) {
              throw new Error("NullPointerException");
            }
            const fp = dataFp(key);
            const entry = container.entries.get(fp);
            if (entry === undefined) return this._boolResponse(false);
            const removed = entry.col.removeOne(val);
            if (removed) {
              if (entry.col.size === 0) container.entries.delete(fp);
              container.version++;
              await this._replicateState(name, container);
              this._broadcastEvent(name, "REMOVED", key, null, val, 1);
            }
            return this._boolResponse(removed);
          }
          case "removeAll": {
            const key = options?.keyData;
            if (key === undefined) throw new Error("NullPointerException");
            const fp = dataFp(key);
            const entry = container.entries.get(fp);
            if (entry === undefined) {
              return {
                type: "MULTIMAP_RESPONSE",
                requestId: "local",
                success: true,
                resultType: "data-array",
                dataList: [],
              };
            }
            const oldValues = entry.col.toArray();
            container.entries.delete(fp);
            container.version++;
            await this._replicateState(name, container);
            for (const oldValue of oldValues) {
              this._broadcastEvent(name, "REMOVED", key, null, oldValue, 1);
            }
            return {
              type: "MULTIMAP_RESPONSE",
              requestId: "local",
              success: true,
              resultType: "data-array",
              dataList: oldValues.map(encodeData),
            };
          }
          case "containsKey": {
            const key = options?.keyData;
            if (key === undefined) throw new Error("NullPointerException");
            const entry = container.entries.get(dataFp(key));
            return this._boolResponse(
              entry !== undefined && entry.col.size > 0,
            );
          }
          case "containsValue": {
            const val = options?.valueData;
            if (val === undefined) throw new Error("NullPointerException");
            let found = false;
            for (const { col } of Array.from(container.entries.values())) {
              if (col.has(val)) { found = true; break; }
            }
            return this._boolResponse(found);
          }
          case "containsEntry": {
            const key = options?.keyData;
            const val = options?.valueData;
            if (key === undefined || val === undefined) {
              throw new Error("NullPointerException");
            }
            const entry = container.entries.get(dataFp(key));
            return this._boolResponse(entry?.col.has(val) ?? false);
          }
          case "keySet":
            return {
              type: "MULTIMAP_RESPONSE",
              requestId: "local",
              success: true,
              resultType: "data-array",
              dataList: Array.from(container.entries.values()).map(({ key }) =>
                encodeData(key),
              ),
            };
          case "values": {
            const all: EncodedData[] = [];
            for (const { col } of Array.from(container.entries.values())) {
              for (const v of col.toArray()) all.push(encodeData(v));
            }
            return {
              type: "MULTIMAP_RESPONSE",
              requestId: "local",
              success: true,
              resultType: "data-array",
              dataList: all,
            };
          }
          case "entrySet": {
            const pairs: Array<[EncodedData, EncodedData]> = [];
            for (const { key, col } of Array.from(container.entries.values())) {
              for (const v of col.toArray()) {
                pairs.push([encodeData(key), encodeData(v)]);
              }
            }
            return {
              type: "MULTIMAP_RESPONSE",
              requestId: "local",
              success: true,
              resultType: "entry-set",
              entrySet: pairs,
            };
          }
          case "size": {
            let total = 0;
            for (const { col } of Array.from(container.entries.values())) {
              total += col.size;
            }
            return this._numberResponse(total);
          }
          case "valueCount": {
            const key = options?.keyData;
            if (key === undefined) throw new Error("NullPointerException");
            return this._numberResponse(
              container.entries.get(dataFp(key))?.col.size ?? 0,
            );
          }
          case "clear":
            if (container.entries.size > 0) {
              let numberOfAffectedEntries = 0;
              for (const { col } of Array.from(container.entries.values())) {
                numberOfAffectedEntries += col.size;
              }
              container.entries.clear();
              container.version++;
              await this._replicateState(name, container);
              this._broadcastEvent(
                name,
                "CLEARED",
                null,
                null,
                null,
                numberOfAffectedEntries,
              );
            }
            return this._voidResponse();
        }
      },
      valueCollectionType,
    );
  }

  // ── Remote message handlers ──────────────────────────────────────────

  private _handleMultiMapRequest(
    message: Extract<ClusterMessage, { type: "MULTIMAP_REQUEST" }>,
  ): void {
    void this._invokeLocally(
      message.mapName,
      message.operation as MultiMapOperation,
      {
        keyData: message.keyData ? decodeData(message.keyData) : undefined,
        valueData: message.valueData
          ? decodeData(message.valueData)
          : undefined,
        dataList: message.dataList?.map(decodeData),
      },
    )
      .then((response) => {
        this._transport?.send(message.sourceNodeId, {
          ...response,
          requestId: message.requestId,
        });
      })
      .catch((error: Error) => {
        this._transport?.send(message.sourceNodeId, {
          type: "MULTIMAP_RESPONSE",
          requestId: message.requestId,
          success: false,
          resultType: "none",
          error: error.message,
        });
      });
  }

  private _handlePendingRequest(
    message: MultiMapResponseMsg | MultiMapStateAckMsg,
  ): void {
    const pending = this._pendingRemoteRequests.get(message.requestId);
    if (pending === undefined) return;
    this._pendingRemoteRequests.delete(message.requestId);
    if (pending.timeoutHandle !== null) clearTimeout(pending.timeoutHandle);

    if ("success" in message && !message.success) {
      pending.reject(new Error(message.error ?? "MultiMap operation failed"));
      return;
    }
    pending.resolve(message);
  }

  private _handleStateSync(
    message: Extract<ClusterMessage, { type: "MULTIMAP_STATE_SYNC" }>,
  ): void {
    const container = this._getOrCreate(
      message.mapName,
      message.valueCollectionType === "SET"
        ? ValueCollectionType.SET
        : ValueCollectionType.LIST,
    );
    if (message.version < container.version) return;

    container.entries.clear();
    for (const [encodedKey, encodedValues] of message.entries) {
      const key = decodeData(encodedKey);
      const col = new ValueCollection(container.valueCollectionType);
      for (const ev of encodedValues) col.add(decodeData(ev));
      container.entries.set(dataFp(key), { key, col });
    }
    container.version = message.version;

    if (message.requestId !== null) {
      this._transport?.send(message.sourceNodeId, {
        type: "MULTIMAP_STATE_ACK",
        requestId: message.requestId,
        mapName: message.mapName,
        version: message.version,
      });
    }
  }

  private _dispatchMultiMapEvent(message: MultiMapEventMsg): void {
    const registrations = this._listeners.get(message.mapName);
    if (registrations === undefined) {
      return;
    }

    for (const registration of Array.from(registrations.values())) {
      if (message.eventType === "CLEARED") {
        registration.listener.mapCleared?.({
          name: message.mapName,
          sourceNodeId: message.sourceNodeId,
          numberOfAffectedEntries: message.numberOfAffectedEntries,
        });
        continue;
      }
      const key =
        message.keyData === null
          ? null
          : this._serializationService.toObject(decodeData(message.keyData));
      const value =
        registration.includeValue && message.valueData !== null
          ? this._serializationService.toObject(decodeData(message.valueData))
          : null;
      const oldValue =
        registration.includeValue && message.oldValueData !== null
          ? this._serializationService.toObject(decodeData(message.oldValueData))
          : null;
      const event = new EntryEventImpl(
        message.mapName,
        key,
        value,
        oldValue,
        message.eventType,
      );
      if (message.eventType === "ADDED") {
        registration.listener.entryAdded?.(event);
      } else {
        registration.listener.entryRemoved?.(event);
      }
    }
  }

  // ── Replication ──────────────────────────────────────────────────────

  private async _replicateState(
    name: string,
    container: MultiMapContainer,
  ): Promise<void> {
    if (this._transport === null || this._coordinator === null) return;

    const partitionId = this._getPartitionId(name);
    const backupCount = this._config.getQueueConfig(name).getBackupCount();
    const totalCount = this._config.getQueueConfig(name).getTotalBackupCount();
    const syncIds = this._coordinator.getBackupIds(partitionId, backupCount);
    const asyncIds = this._coordinator
      .getBackupIds(partitionId, totalCount)
      .slice(syncIds.length);

    await Promise.all([
      ...syncIds.map((id) => this._sendStateSync(id, name, container, true)),
      ...asyncIds.map((id) =>
        this._sendStateSync(id, name, container, false),
      ),
    ]);
  }

  private async _sendStateSync(
    backupId: string,
    name: string,
    container: MultiMapContainer,
    waitForAck: boolean,
  ): Promise<void> {
    if (backupId === this._instanceName || this._transport === null) return;

    const requestId = waitForAck ? crypto.randomUUID() : null;
    let ackPromise: Promise<MultiMapStateAckMsg> | null = null;

    if (requestId !== null) {
      ackPromise = new Promise<MultiMapStateAckMsg>((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          this._pendingRemoteRequests.delete(requestId);
          reject(new Error(`MultiMap backup sync timed out for '${name}'`));
        }, 10_000);
        this._pendingRemoteRequests.set(requestId, {
          resolve: (msg) => resolve(msg as MultiMapStateAckMsg),
          reject,
          timeoutHandle,
        });
      });
    }

    const entries: Array<[EncodedData, EncodedData[]]> = Array.from(
      container.entries.values(),
    ).map(({ key, col }) => [encodeData(key), col.toArray().map(encodeData)]);

    const msg: MultiMapStateSyncMsg = {
      type: "MULTIMAP_STATE_SYNC",
      requestId,
      sourceNodeId: this._instanceName,
      mapName: name,
      version: container.version,
      entries,
      valueCollectionType:
        container.valueCollectionType === ValueCollectionType.SET
          ? "SET"
          : "LIST",
    };
    this._transport.send(backupId, msg);

    if (ackPromise !== null) await ackPromise;
  }

  private _broadcastEvent(
    name: string,
    eventType: "ADDED" | "REMOVED" | "CLEARED",
    key: Data | null,
    value: Data | null,
    oldValue: Data | null,
    numberOfAffectedEntries: number,
  ): void {
    const message: MultiMapEventMsg = {
      type: "MULTIMAP_EVENT",
      mapName: name,
      eventType,
      sourceNodeId: this._instanceName,
      keyData: key === null ? null : encodeData(key),
      valueData: value === null ? null : encodeData(value),
      oldValueData: oldValue === null ? null : encodeData(oldValue),
      numberOfAffectedEntries,
    };
    this._dispatchMultiMapEvent(message);
    this._transport?.broadcast(message);
  }

  private _resyncAll(): void {
    for (const [name, container] of Array.from(this._containers.entries())) {
      void this._replicateState(name, container);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private _getOrCreate(
    name: string,
    type = ValueCollectionType.LIST,
  ): MultiMapContainer {
    let container = this._containers.get(name);
    if (container === undefined) {
      container = {
        entries: new Map(),
        version: 0,
        operationChain: Promise.resolve(),
        valueCollectionType: type,
      };
      this._containers.set(name, container);
    }
    return container;
  }

  private _enqueueOperation<T>(
    name: string,
    fn: (container: MultiMapContainer) => Promise<T>,
    type = ValueCollectionType.LIST,
  ): Promise<T> {
    const container = this._getOrCreate(name, type);
    const next = container.operationChain.then(
      () => fn(container),
      () => fn(container),
    );
    container.operationChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private _resolveOwnerId(name: string): string {
    return (
      this._coordinator?.getOwnerId(this._getPartitionId(name)) ??
      this._instanceName
    );
  }

  private _getPartitionId(name: string): number {
    return this._coordinator?.getPartitionId(name) ?? 0;
  }

  private _boolResponse(value: boolean): MultiMapResponseMsg {
    return {
      type: "MULTIMAP_RESPONSE",
      requestId: "local",
      success: true,
      resultType: "boolean",
      booleanResult: value,
    };
  }

  private _numberResponse(value: number): MultiMapResponseMsg {
    return {
      type: "MULTIMAP_RESPONSE",
      requestId: "local",
      success: true,
      resultType: "number",
      numberResult: value,
    };
  }

  private _voidResponse(): MultiMapResponseMsg {
    return {
      type: "MULTIMAP_RESPONSE",
      requestId: "local",
      success: true,
      resultType: "none",
    };
  }
}
