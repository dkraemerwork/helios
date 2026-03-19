/**
 * Distributed ICache service — partition-owned with sync-backup replication.
 *
 * Implements the JCache (JSR-107) compatible API over a partitioned in-memory
 * store with backup replication following the same pattern as
 * DistributedQueueService.
 *
 * Port of com.hazelcast.cache.impl.CacheService (distributed subset).
 */
import type {
  ClusterMessage,
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
import { LocalCacheStatsImpl } from "@zenystx/helios-core/cache/impl/LocalCacheStats";

// ── Cache entry ───────────────────────────────────────────────────────

interface CacheEntry {
  value: Data;
  /** Absolute epoch-ms expiry, or -1 for no expiry. */
  expiresAt: number;
  createdAt: number;
  lastAccessedAt: number;
  hits: number;
}

function isExpired(entry: CacheEntry): boolean {
  return entry.expiresAt !== -1 && Date.now() >= entry.expiresAt;
}

function dataFp(d: Data): string {
  const buf = d.toByteArray();
  return buf === null ? "" : buf.toString("base64");
}

// ── Container ─────────────────────────────────────────────────────────

interface CacheContainer {
  /** fingerprint(key) → entry */
  entries: Map<string, { key: Data; entry: CacheEntry }>;
  version: number;
  operationChain: Promise<void>;
  /** Cache-level TTL in ms (-1 = eternal). */
  defaultTtlMs: number;
  closed: boolean;
}

// ── Wire message types (inline, since cache messages are not in ClusterMessage yet) ──

interface CacheRequestMsg {
  type: "CACHE_REQUEST";
  requestId: string;
  sourceNodeId: string;
  cacheName: string;
  operation: string;
  keyData?: EncodedData;
  valueData?: EncodedData;
  keyDataList?: EncodedData[];
  ttlMs?: number;
}

interface CacheResponseMsg {
  type: "CACHE_RESPONSE";
  requestId: string;
  success: boolean;
  resultType: "none" | "boolean" | "number" | "data" | "data-array";
  booleanResult?: boolean;
  numberResult?: number;
  data?: EncodedData;
  dataList?: EncodedData[];
  error?: string;
}

interface CacheStateSyncMsg {
  type: "CACHE_STATE_SYNC";
  requestId: string | null;
  sourceNodeId: string;
  cacheName: string;
  version: number;
  entries: Array<{ key: EncodedData; value: EncodedData; expiresAt: number }>;
}

interface CacheStateAckMsg {
  type: "CACHE_STATE_ACK";
  requestId: string;
  cacheName: string;
  version: number;
}

interface PendingRemoteRequest {
  resolve: (msg: CacheResponseMsg | CacheStateAckMsg) => void;
  reject: (err: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

type CacheOperation =
  | "get"
  | "put"
  | "putIfAbsent"
  | "getAndPut"
  | "getAndRemove"
  | "getAndReplace"
  | "remove"
  | "replace"
  | "containsKey"
  | "size"
  | "clear";

export interface CacheMutationEvent {
  cacheName: string;
  operation: CacheOperation;
  keyData?: Data;
  valueData?: Data;
  keyDataList?: Data[];
}

export interface DistributedCacheServiceOptions {
  onMutation?: (event: CacheMutationEvent) => void;
}

// ── Service ───────────────────────────────────────────────────────────

export class DistributedCacheService {
  private readonly _caches = new Map<string, CacheContainer>();
  private readonly _pendingRemoteRequests = new Map<
    string,
    PendingRemoteRequest
  >();
  private readonly _stats = new Map<string, LocalCacheStatsImpl>();

  constructor(
    private readonly _instanceName: string,
    private readonly _config: HeliosConfig,
    private readonly _ss: SerializationService,
    private readonly _transport: TcpClusterTransport | null,
    private readonly _coordinator: HeliosClusterCoordinator | null,
    private readonly _options: DistributedCacheServiceOptions = {},
  ) {
    this._coordinator?.onMembershipChanged(() => {
      this._resyncAll();
    });
  }

  // ── Message dispatcher ───────────────────────────────────────────────

  handleMessage(message: ClusterMessage): boolean {
    // Cache messages are not in the main ClusterMessage discriminated union yet;
    // we check via the type field cast for forward compatibility.
    const msg = message as unknown as Record<string, unknown>;
    switch (msg["type"]) {
      case "CACHE_REQUEST":
        this._handleCacheRequest(msg as unknown as CacheRequestMsg);
        return true;
      case "CACHE_RESPONSE":
      case "CACHE_STATE_ACK":
        this._handlePendingRequest(msg as unknown as CacheResponseMsg | CacheStateAckMsg);
        return true;
      case "CACHE_STATE_SYNC":
        this._handleStateSync(msg as unknown as CacheStateSyncMsg);
        return true;
      default:
        return false;
    }
  }

  // ── Public API ───────────────────────────────────────────────────────

  async get(name: string, keyData: Data): Promise<Data | null> {
    const start = Date.now();
    const r = await this._invoke(name, "get", { keyData });
    const elapsed = Date.now() - start;
    const stats = this._getStats(name);
    if (r.data !== undefined) {
      stats.incrementHit(elapsed);
    } else {
      stats.incrementMiss(elapsed);
    }
    return r.data !== undefined ? decodeData(r.data) : null;
  }

  async put(
    name: string,
    keyData: Data,
    valueData: Data,
    ttlMs = -1,
  ): Promise<void> {
    const start = Date.now();
    await this._invoke(name, "put", { keyData, valueData, ttlMs });
    this._getStats(name).incrementPut(Date.now() - start);
  }

  async putIfAbsent(
    name: string,
    keyData: Data,
    valueData: Data,
    ttlMs = -1,
  ): Promise<boolean> {
    const start = Date.now();
    const r = await this._invoke(name, "putIfAbsent", {
      keyData,
      valueData,
      ttlMs,
    });
    if (r.booleanResult) {
      this._getStats(name).incrementPut(Date.now() - start);
    }
    return r.booleanResult ?? false;
  }

  async getAndPut(
    name: string,
    keyData: Data,
    valueData: Data,
    ttlMs = -1,
  ): Promise<Data | null> {
    const start = Date.now();
    const r = await this._invoke(name, "getAndPut", {
      keyData,
      valueData,
      ttlMs,
    });
    this._getStats(name).incrementPut(Date.now() - start);
    return r.data !== undefined ? decodeData(r.data) : null;
  }

  async getAndRemove(name: string, keyData: Data): Promise<Data | null> {
    const start = Date.now();
    const r = await this._invoke(name, "getAndRemove", { keyData });
    this._getStats(name).incrementRemoval(Date.now() - start);
    return r.data !== undefined ? decodeData(r.data) : null;
  }

  async getAndReplace(
    name: string,
    keyData: Data,
    valueData: Data,
    ttlMs = -1,
  ): Promise<Data | null> {
    const start = Date.now();
    const r = await this._invoke(name, "getAndReplace", {
      keyData,
      valueData,
      ttlMs,
    });
    this._getStats(name).incrementPut(Date.now() - start);
    return r.data !== undefined ? decodeData(r.data) : null;
  }

  async remove(name: string, keyData: Data): Promise<boolean> {
    const start = Date.now();
    const r = await this._invoke(name, "remove", { keyData });
    if (r.booleanResult) {
      this._getStats(name).incrementRemoval(Date.now() - start);
    }
    return r.booleanResult ?? false;
  }

  async replace(
    name: string,
    keyData: Data,
    valueData: Data,
    ttlMs = -1,
  ): Promise<boolean> {
    const start = Date.now();
    const r = await this._invoke(name, "replace", { keyData, valueData, ttlMs });
    if (r.booleanResult) {
      this._getStats(name).incrementPut(Date.now() - start);
    }
    return r.booleanResult ?? false;
  }

  async containsKey(name: string, keyData: Data): Promise<boolean> {
    const r = await this._invoke(name, "containsKey", { keyData });
    return r.booleanResult ?? false;
  }

  async size(name: string): Promise<number> {
    const r = await this._invoke(name, "size");
    return r.numberResult ?? 0;
  }

  async clear(name: string): Promise<void> {
    await this._invoke(name, "clear");
  }

  /** Returns the local stats for a named cache. Creates a zero-state if not present. */
  getLocalCacheStats(name: string): LocalCacheStatsImpl {
    return this._getStats(name);
  }

  /** Returns stats snapshots for all known caches. */
  getAllCacheStats(): Map<string, LocalCacheStatsImpl> {
    return new Map(this._stats);
  }

  async removeAll(name: string, keyDataList?: Data[]): Promise<void> {
    if (keyDataList !== undefined && keyDataList.length > 0) {
      for (const k of keyDataList) {
        await this._invoke(name, "remove", { keyData: k });
      }
    } else {
      await this._invoke(name, "clear");
    }
  }

  async getAll(name: string, keyDataList: Data[]): Promise<[Data, Data][]> {
    const result: [Data, Data][] = [];
    for (const k of keyDataList) {
      const val = await this.get(name, k);
      if (val !== null) result.push([k, val]);
    }
    return result;
  }

  async putAll(name: string, pairs: [Data, Data][], ttlMs = -1): Promise<void> {
    for (const [k, v] of pairs) {
      await this.put(name, k, v, ttlMs);
    }
  }

  close(name: string): void {
    const container = this._caches.get(name);
    if (container !== undefined) {
      container.closed = true;
    }
  }

  destroy(name: string): void {
    this._caches.delete(name);
    this._notifyMutation({ cacheName: name, operation: "clear" });
  }

  // ── Routing ──────────────────────────────────────────────────────────

  private async _invoke(
    name: string,
    operation: CacheOperation,
    options?: {
      keyData?: Data;
      valueData?: Data;
      keyDataList?: Data[];
      ttlMs?: number;
    },
  ): Promise<CacheResponseMsg> {
    const ownerId = this._resolveOwnerId(name);
    if (ownerId === this._instanceName || this._transport === null) {
      return this._invokeLocally(name, operation, options);
    }

    const requestId = crypto.randomUUID();
    const response = new Promise<CacheResponseMsg>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this._pendingRemoteRequests.delete(requestId);
        reject(
          new Error(`Cache request timed out for '${name}' (${operation})`),
        );
      }, 120_000);
      this._pendingRemoteRequests.set(requestId, {
        resolve: (msg) => resolve(msg as CacheResponseMsg),
        reject,
        timeoutHandle,
      });
    });

    const msg: CacheRequestMsg = {
      type: "CACHE_REQUEST",
      requestId,
      sourceNodeId: this._instanceName,
      cacheName: name,
      operation,
      keyData: options?.keyData ? encodeData(options.keyData) : undefined,
      valueData: options?.valueData ? encodeData(options.valueData) : undefined,
      keyDataList: options?.keyDataList?.map(encodeData),
      ttlMs: options?.ttlMs,
    };
    (this._transport as unknown as { send(id: string, msg: unknown): void }).send(ownerId, msg);

    return response;
  }

  private async _invokeLocally(
    name: string,
    operation: CacheOperation,
    options?: {
      keyData?: Data;
      valueData?: Data;
      keyDataList?: Data[];
      ttlMs?: number;
    },
  ): Promise<CacheResponseMsg> {
    return this._enqueueOperation(name, async (container) => {
      if (container.closed) {
        throw new Error(`Cache '${name}' is closed`);
      }

      const ttlMs =
        options?.ttlMs !== undefined && options.ttlMs >= 0
          ? options.ttlMs
          : container.defaultTtlMs;

      const expiresAt = ttlMs >= 0 ? Date.now() + ttlMs : -1;

      switch (operation) {
        case "get": {
          const key = options?.keyData;
          if (key === undefined) throw new Error("NullPointerException");
          const e = this._getEntry(container, key);
          return e === null
            ? this._voidResponse()
            : { type: "CACHE_RESPONSE", requestId: "local", success: true, resultType: "data", data: encodeData(e.value) };
        }
        case "put": {
          const key = options?.keyData;
          const val = options?.valueData;
          if (key === undefined || val === undefined) {
            throw new Error("NullPointerException");
          }
          this._putEntry(container, key, val, expiresAt);
          container.version++;
          await this._replicateState(name, container);
          this._notifyMutation({ cacheName: name, operation, keyData: key, valueData: val });
          return this._voidResponse();
        }
        case "putIfAbsent": {
          const key = options?.keyData;
          const val = options?.valueData;
          if (key === undefined || val === undefined) {
            throw new Error("NullPointerException");
          }
          const exists = this._getEntry(container, key) !== null;
          if (!exists) {
            this._putEntry(container, key, val, expiresAt);
            container.version++;
            await this._replicateState(name, container);
            this._notifyMutation({ cacheName: name, operation, keyData: key, valueData: val });
          }
          return this._boolResponse(!exists);
        }
        case "getAndPut": {
          const key = options?.keyData;
          const val = options?.valueData;
          if (key === undefined || val === undefined) {
            throw new Error("NullPointerException");
          }
          const old = this._getEntry(container, key);
          this._putEntry(container, key, val, expiresAt);
          container.version++;
          await this._replicateState(name, container);
          this._notifyMutation({ cacheName: name, operation, keyData: key, valueData: val });
          return old === null
            ? this._voidResponse()
            : { type: "CACHE_RESPONSE", requestId: "local", success: true, resultType: "data", data: encodeData(old.value) };
        }
        case "getAndRemove": {
          const key = options?.keyData;
          if (key === undefined) throw new Error("NullPointerException");
          const old = this._getEntry(container, key);
          if (old !== null) {
            container.entries.delete(dataFp(key));
            container.version++;
            await this._replicateState(name, container);
            this._notifyMutation({ cacheName: name, operation, keyData: key });
          }
          return old === null
            ? this._voidResponse()
            : { type: "CACHE_RESPONSE", requestId: "local", success: true, resultType: "data", data: encodeData(old.value) };
        }
        case "getAndReplace": {
          const key = options?.keyData;
          const val = options?.valueData;
          if (key === undefined || val === undefined) {
            throw new Error("NullPointerException");
          }
          const old = this._getEntry(container, key);
          if (old !== null) {
            this._putEntry(container, key, val, expiresAt);
            container.version++;
            await this._replicateState(name, container);
            this._notifyMutation({ cacheName: name, operation, keyData: key, valueData: val });
            return { type: "CACHE_RESPONSE", requestId: "local", success: true, resultType: "data", data: encodeData(old.value) };
          }
          return this._voidResponse();
        }
        case "remove": {
          const key = options?.keyData;
          if (key === undefined) throw new Error("NullPointerException");
          const existed = container.entries.has(dataFp(key));
          if (existed) {
            container.entries.delete(dataFp(key));
            container.version++;
            await this._replicateState(name, container);
            this._notifyMutation({ cacheName: name, operation, keyData: key });
          }
          return this._boolResponse(existed);
        }
        case "replace": {
          const key = options?.keyData;
          const val = options?.valueData;
          if (key === undefined || val === undefined) {
            throw new Error("NullPointerException");
          }
          const existing = this._getEntry(container, key);
          if (existing !== null) {
            this._putEntry(container, key, val, expiresAt);
            container.version++;
            await this._replicateState(name, container);
            this._notifyMutation({ cacheName: name, operation, keyData: key, valueData: val });
          }
          return this._boolResponse(existing !== null);
        }
        case "containsKey": {
          const key = options?.keyData;
          if (key === undefined) throw new Error("NullPointerException");
          return this._boolResponse(this._getEntry(container, key) !== null);
        }
        case "size": {
          let count = 0;
          for (const { entry } of Array.from(container.entries.values())) {
            if (!isExpired(entry)) count++;
          }
          return this._numberResponse(count);
        }
        case "clear":
          container.entries.clear();
          container.version++;
          await this._replicateState(name, container);
          this._notifyMutation({ cacheName: name, operation });
          return this._voidResponse();
      }
    });
  }

  private _notifyMutation(event: CacheMutationEvent): void {
    this._options.onMutation?.(event);
  }

  // ── Remote message handlers ──────────────────────────────────────────

  private _handleCacheRequest(message: CacheRequestMsg): void {
    void this._invokeLocally(
      message.cacheName,
      message.operation as CacheOperation,
      {
        keyData: message.keyData ? decodeData(message.keyData) : undefined,
        valueData: message.valueData ? decodeData(message.valueData) : undefined,
        keyDataList: message.keyDataList?.map(decodeData),
        ttlMs: message.ttlMs,
      },
    )
      .then((response) => {
        const resp = { ...response, requestId: message.requestId };
        (this._transport as unknown as { send(id: string, msg: unknown): void })?.send(
          message.sourceNodeId,
          resp,
        );
      })
      .catch((error: Error) => {
        (this._transport as unknown as { send(id: string, msg: unknown): void })?.send(
          message.sourceNodeId,
          {
            type: "CACHE_RESPONSE",
            requestId: message.requestId,
            success: false,
            resultType: "none",
            error: error.message,
          },
        );
      });
  }

  private _handlePendingRequest(
    message: CacheResponseMsg | CacheStateAckMsg,
  ): void {
    const pending = this._pendingRemoteRequests.get(message.requestId);
    if (pending === undefined) return;
    this._pendingRemoteRequests.delete(message.requestId);
    if (pending.timeoutHandle !== null) clearTimeout(pending.timeoutHandle);

    if ("success" in message && !message.success) {
      pending.reject(new Error(message.error ?? "Cache operation failed"));
      return;
    }
    pending.resolve(message);
  }

  private _handleStateSync(message: CacheStateSyncMsg): void {
    const container = this._getOrCreate(message.cacheName);
    if (message.version < container.version) return;

    container.entries.clear();
    for (const { key: encodedKey, value: encodedValue, expiresAt } of message.entries) {
      const key = decodeData(encodedKey);
      const value = decodeData(encodedValue);
      const now = Date.now();
      if (expiresAt !== -1 && expiresAt <= now) continue; // Skip expired entries
      container.entries.set(dataFp(key), {
        key,
        entry: {
          value,
          expiresAt,
          createdAt: now,
          lastAccessedAt: now,
          hits: 0,
        },
      });
    }
    container.version = message.version;

    if (message.requestId !== null) {
      (this._transport as unknown as { send(id: string, msg: unknown): void })?.send(
        message.sourceNodeId,
        {
          type: "CACHE_STATE_ACK",
          requestId: message.requestId,
          cacheName: message.cacheName,
          version: message.version,
        },
      );
    }
  }

  // ── Replication ──────────────────────────────────────────────────────

  private async _replicateState(
    name: string,
    container: CacheContainer,
  ): Promise<void> {
    if (this._transport === null || this._coordinator === null) return;

    const partitionId = this._getPartitionId(name);
    // Use cache-specific backup counts. HeliosConfig has no dedicated CacheConfig
    // type yet, so we fall back to a default sync-backup count of 1 (matching the
    // Hazelcast ICache default) when no explicit configuration is present.
    const cacheConfig = this._config.getMapConfig(name);
    const backupCount = cacheConfig?.getBackupCount() ?? 1;
    const asyncBackupCount = cacheConfig?.getAsyncBackupCount() ?? 0;
    const totalCount = backupCount + asyncBackupCount;
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
    container: CacheContainer,
    waitForAck: boolean,
  ): Promise<void> {
    if (backupId === this._instanceName || this._transport === null) return;

    const requestId = waitForAck ? crypto.randomUUID() : null;
    let ackPromise: Promise<CacheStateAckMsg> | null = null;

    if (requestId !== null) {
      ackPromise = new Promise<CacheStateAckMsg>((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          this._pendingRemoteRequests.delete(requestId);
          reject(new Error(`Cache backup sync timed out for '${name}'`));
        }, 10_000);
        this._pendingRemoteRequests.set(requestId, {
          resolve: (msg) => resolve(msg as CacheStateAckMsg),
          reject,
          timeoutHandle,
        });
      });
    }

    const entries = Array.from(container.entries.values())
      .filter(({ entry }) => !isExpired(entry))
      .map(({ key, entry }) => ({
        key: encodeData(key),
        value: encodeData(entry.value),
        expiresAt: entry.expiresAt,
      }));

    const msg: CacheStateSyncMsg = {
      type: "CACHE_STATE_SYNC",
      requestId,
      sourceNodeId: this._instanceName,
      cacheName: name,
      version: container.version,
      entries,
    };
    (this._transport as unknown as { send(id: string, msg: unknown): void }).send(backupId, msg);

    if (ackPromise !== null) await ackPromise;
  }

  private _resyncAll(): void {
    for (const [name, container] of Array.from(this._caches.entries())) {
      void this._replicateState(name, container);
    }
  }

  // ── Container helpers ────────────────────────────────────────────────

  private _getEntry(
    container: CacheContainer,
    key: Data,
  ): CacheEntry | null {
    const rec = container.entries.get(dataFp(key));
    if (rec === undefined) return null;
    if (isExpired(rec.entry)) {
      container.entries.delete(dataFp(key));
      return null;
    }
    rec.entry.lastAccessedAt = Date.now();
    rec.entry.hits++;
    return rec.entry;
  }

  private _putEntry(
    container: CacheContainer,
    key: Data,
    value: Data,
    expiresAt: number,
  ): void {
    const now = Date.now();
    container.entries.set(dataFp(key), {
      key,
      entry: {
        value,
        expiresAt,
        createdAt: now,
        lastAccessedAt: now,
        hits: 0,
      },
    });
  }

  private _getOrCreate(name: string): CacheContainer {
    let container = this._caches.get(name);
    if (container === undefined) {
      container = {
        entries: new Map(),
        version: 0,
        operationChain: Promise.resolve(),
        defaultTtlMs: -1,
        closed: false,
      };
      this._caches.set(name, container);
    }
    return container;
  }

  private _enqueueOperation<T>(
    name: string,
    fn: (container: CacheContainer) => Promise<T>,
  ): Promise<T> {
    const container = this._getOrCreate(name);
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

  private _boolResponse(value: boolean): CacheResponseMsg {
    return {
      type: "CACHE_RESPONSE",
      requestId: "local",
      success: true,
      resultType: "boolean",
      booleanResult: value,
    };
  }

  private _numberResponse(value: number): CacheResponseMsg {
    return {
      type: "CACHE_RESPONSE",
      requestId: "local",
      success: true,
      resultType: "number",
      numberResult: value,
    };
  }

  private _voidResponse(): CacheResponseMsg {
    return {
      type: "CACHE_RESPONSE",
      requestId: "local",
      success: true,
      resultType: "none",
    };
  }

  private _getStats(name: string): LocalCacheStatsImpl {
    let stats = this._stats.get(name);
    if (stats === undefined) {
      stats = new LocalCacheStatsImpl();
      this._stats.set(name, stats);
    }
    return stats;
  }
}
