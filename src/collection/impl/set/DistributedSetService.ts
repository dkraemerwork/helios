/**
 * Distributed ISet service — partition-owned with sync-backup replication.
 *
 * Port of com.hazelcast.collection.impl.set.SetService (distributed subset).
 */
import type {
  ClusterMessage,
  SetResponseMsg,
  SetStateAckMsg,
  SetStateSyncMsg,
} from "@zenystx/helios-core/cluster/tcp/ClusterMessage";
import {
  decodeData,
  encodeData,
} from "@zenystx/helios-core/cluster/tcp/DataWireCodec";
import { TcpClusterTransport } from "@zenystx/helios-core/cluster/tcp/TcpClusterTransport";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import type { HeliosClusterCoordinator } from "@zenystx/helios-core/instance/impl/HeliosClusterCoordinator";
import type { Data } from "@zenystx/helios-core/internal/serialization/Data";

// ── Container ─────────────────────────────────────────────────────────

/** Stringified Data key used for the internal Map (byte-level equality). */
function dataFingerprint(d: Data): string {
  const buf = d.toByteArray();
  return buf === null ? "" : buf.toString("base64");
}

interface SetContainer {
  /** Fingerprint → Data for O(1) contains/remove. */
  items: Map<string, Data>;
  version: number;
  operationChain: Promise<void>;
}

interface PendingRemoteRequest {
  resolve: (msg: SetResponseMsg | SetStateAckMsg) => void;
  reject: (err: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

type SetOperation =
  | "add"
  | "addAll"
  | "remove"
  | "removeAll"
  | "retainAll"
  | "contains"
  | "containsAll"
  | "size"
  | "isEmpty"
  | "toArray"
  | "clear";

// ── Service ───────────────────────────────────────────────────────────

export class DistributedSetService {
  private readonly _containers = new Map<string, SetContainer>();
  private readonly _pendingRemoteRequests = new Map<
    string,
    PendingRemoteRequest
  >();

  constructor(
    private readonly _instanceName: string,
    private readonly _config: HeliosConfig,
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
      case "SET_REQUEST":
        this._handleSetRequest(message);
        return true;
      case "SET_RESPONSE":
      case "SET_STATE_ACK":
        this._handlePendingRequest(message);
        return true;
      case "SET_STATE_SYNC":
        this._handleStateSync(message);
        return true;
      default:
        return false;
    }
  }

  // ── Public API ───────────────────────────────────────────────────────

  async add(name: string, data: Data): Promise<boolean> {
    const r = await this._invoke(name, "add", { data });
    return r.booleanResult ?? false;
  }

  async addAll(name: string, dataList: Data[]): Promise<boolean> {
    const r = await this._invoke(name, "addAll", { dataList });
    return r.booleanResult ?? false;
  }

  async remove(name: string, data: Data): Promise<boolean> {
    const r = await this._invoke(name, "remove", { data });
    return r.booleanResult ?? false;
  }

  async removeAll(name: string, dataList: Data[]): Promise<boolean> {
    const r = await this._invoke(name, "removeAll", { dataList });
    return r.booleanResult ?? false;
  }

  async retainAll(name: string, dataList: Data[]): Promise<boolean> {
    const r = await this._invoke(name, "retainAll", { dataList });
    return r.booleanResult ?? false;
  }

  async contains(name: string, data: Data): Promise<boolean> {
    const r = await this._invoke(name, "contains", { data });
    return r.booleanResult ?? false;
  }

  async containsAll(name: string, dataList: Data[]): Promise<boolean> {
    const r = await this._invoke(name, "containsAll", { dataList });
    return r.booleanResult ?? false;
  }

  async size(name: string): Promise<number> {
    const r = await this._invoke(name, "size");
    return r.numberResult ?? 0;
  }

  async isEmpty(name: string): Promise<boolean> {
    const r = await this._invoke(name, "isEmpty");
    return r.booleanResult ?? true;
  }

  async toArray(name: string): Promise<Data[]> {
    const r = await this._invoke(name, "toArray");
    return (r.dataList ?? []).map(decodeData);
  }

  async clear(name: string): Promise<void> {
    await this._invoke(name, "clear");
  }

  // ── Routing ──────────────────────────────────────────────────────────

  private async _invoke(
    name: string,
    operation: SetOperation,
    options?: { data?: Data; dataList?: Data[] },
  ): Promise<SetResponseMsg> {
    const ownerId = this._resolveOwnerId(name);
    if (ownerId === this._instanceName || this._transport === null) {
      return this._invokeLocally(name, operation, options);
    }

    const requestId = crypto.randomUUID();
    const response = new Promise<SetResponseMsg>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this._pendingRemoteRequests.delete(requestId);
        reject(
          new Error(`Set request timed out for '${name}' (${operation})`),
        );
      }, 120_000);
      this._pendingRemoteRequests.set(requestId, {
        resolve: (msg) => resolve(msg as SetResponseMsg),
        reject,
        timeoutHandle,
      });
    });

    this._transport.send(ownerId, {
      type: "SET_REQUEST",
      requestId,
      sourceNodeId: this._instanceName,
      setName: name,
      operation,
      data: options?.data ? encodeData(options.data) : undefined,
      dataList: options?.dataList?.map(encodeData),
    });

    return response;
  }

  private async _invokeLocally(
    name: string,
    operation: SetOperation,
    options?: { data?: Data; dataList?: Data[] },
  ): Promise<SetResponseMsg> {
    return this._enqueueOperation(name, async (container) => {
      switch (operation) {
        case "add": {
          const d = options?.data;
          if (d === undefined) throw new Error("NullPointerException");
          const fp = dataFingerprint(d);
          if (container.items.has(fp)) return this._boolResponse(false);
          container.items.set(fp, d);
          container.version++;
          await this._replicateState(name, container);
          return this._boolResponse(true);
        }
        case "addAll": {
          const list = options?.dataList ?? [];
          if (list.length === 0) return this._boolResponse(false);
          let changed = false;
          for (const d of list) {
            const fp = dataFingerprint(d);
            if (!container.items.has(fp)) {
              container.items.set(fp, d);
              changed = true;
            }
          }
          if (changed) {
            container.version++;
            await this._replicateState(name, container);
          }
          return this._boolResponse(changed);
        }
        case "remove": {
          const d = options?.data;
          if (d === undefined) throw new Error("NullPointerException");
          const fp = dataFingerprint(d);
          if (!container.items.has(fp)) return this._boolResponse(false);
          container.items.delete(fp);
          container.version++;
          await this._replicateState(name, container);
          return this._boolResponse(true);
        }
        case "removeAll": {
          const list = options?.dataList ?? [];
          let changed = false;
          for (const d of list) {
            if (container.items.delete(dataFingerprint(d))) changed = true;
          }
          if (changed) {
            container.version++;
            await this._replicateState(name, container);
          }
          return this._boolResponse(changed);
        }
        case "retainAll": {
          const retain = new Set<string>(
            (options?.dataList ?? []).map(dataFingerprint),
          );
          let changed = false;
          for (const fp of Array.from(container.items.keys())) {
            if (!retain.has(fp)) {
              container.items.delete(fp);
              changed = true;
            }
          }
          if (changed) {
            container.version++;
            await this._replicateState(name, container);
          }
          return this._boolResponse(changed);
        }
        case "contains": {
          const d = options?.data;
          if (d === undefined) throw new Error("NullPointerException");
          return this._boolResponse(container.items.has(dataFingerprint(d)));
        }
        case "containsAll": {
          const list = options?.dataList ?? [];
          const has = list.every((d) =>
            container.items.has(dataFingerprint(d)),
          );
          return this._boolResponse(has);
        }
        case "size":
          return this._numberResponse(container.items.size);
        case "isEmpty":
          return this._boolResponse(container.items.size === 0);
        case "toArray":
          return {
            type: "SET_RESPONSE",
            requestId: "local",
            success: true,
            resultType: "data-array",
            dataList: Array.from(container.items.values()).map(encodeData),
          };
        case "clear":
          if (container.items.size > 0) {
            container.items.clear();
            container.version++;
            await this._replicateState(name, container);
          }
          return this._voidResponse();
      }
    });
  }

  // ── Remote message handlers ──────────────────────────────────────────

  private _handleSetRequest(
    message: Extract<ClusterMessage, { type: "SET_REQUEST" }>,
  ): void {
    void this._invokeLocally(
      message.setName,
      message.operation as SetOperation,
      {
        data: message.data ? decodeData(message.data) : undefined,
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
          type: "SET_RESPONSE",
          requestId: message.requestId,
          success: false,
          resultType: "none",
          error: error.message,
        });
      });
  }

  private _handlePendingRequest(
    message: SetResponseMsg | SetStateAckMsg,
  ): void {
    const pending = this._pendingRemoteRequests.get(message.requestId);
    if (pending === undefined) return;
    this._pendingRemoteRequests.delete(message.requestId);
    if (pending.timeoutHandle !== null) clearTimeout(pending.timeoutHandle);

    if ("success" in message && !message.success) {
      pending.reject(new Error(message.error ?? "Set operation failed"));
      return;
    }
    pending.resolve(message);
  }

  private _handleStateSync(
    message: Extract<ClusterMessage, { type: "SET_STATE_SYNC" }>,
  ): void {
    const container = this._getOrCreate(message.setName);
    if (message.version < container.version) return;

    container.items = new Map(
      message.items.map((encoded) => {
        const d = decodeData(encoded);
        return [dataFingerprint(d), d];
      }),
    );
    container.version = message.version;

    if (message.requestId !== null) {
      this._transport?.send(message.sourceNodeId, {
        type: "SET_STATE_ACK",
        requestId: message.requestId,
        setName: message.setName,
        version: message.version,
      });
    }
  }

  // ── Replication ──────────────────────────────────────────────────────

  private async _replicateState(
    name: string,
    container: SetContainer,
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
      ...asyncIds.map((id) => this._sendStateSync(id, name, container, false)),
    ]);
  }

  private async _sendStateSync(
    backupId: string,
    name: string,
    container: SetContainer,
    waitForAck: boolean,
  ): Promise<void> {
    if (backupId === this._instanceName || this._transport === null) return;

    const requestId = waitForAck ? crypto.randomUUID() : null;
    let ackPromise: Promise<SetStateAckMsg> | null = null;

    if (requestId !== null) {
      ackPromise = new Promise<SetStateAckMsg>((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          this._pendingRemoteRequests.delete(requestId);
          reject(new Error(`Set backup sync timed out for '${name}'`));
        }, 10_000);
        this._pendingRemoteRequests.set(requestId, {
          resolve: (msg) => resolve(msg as SetStateAckMsg),
          reject,
          timeoutHandle,
        });
      });
    }

    const msg: SetStateSyncMsg = {
      type: "SET_STATE_SYNC",
      requestId,
      sourceNodeId: this._instanceName,
      setName: name,
      version: container.version,
      items: Array.from(container.items.values()).map(encodeData),
    };
    this._transport.send(backupId, msg);

    if (ackPromise !== null) await ackPromise;
  }

  private _resyncAll(): void {
    for (const [name, container] of Array.from(this._containers.entries())) {
      void this._replicateState(name, container);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private _getOrCreate(name: string): SetContainer {
    let container = this._containers.get(name);
    if (container === undefined) {
      container = {
        items: new Map(),
        version: 0,
        operationChain: Promise.resolve(),
      };
      this._containers.set(name, container);
    }
    return container;
  }

  private _enqueueOperation<T>(
    name: string,
    fn: (container: SetContainer) => Promise<T>,
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

  private _boolResponse(value: boolean): SetResponseMsg {
    return {
      type: "SET_RESPONSE",
      requestId: "local",
      success: true,
      resultType: "boolean",
      booleanResult: value,
    };
  }

  private _numberResponse(value: number): SetResponseMsg {
    return {
      type: "SET_RESPONSE",
      requestId: "local",
      success: true,
      resultType: "number",
      numberResult: value,
    };
  }

  private _voidResponse(): SetResponseMsg {
    return {
      type: "SET_RESPONSE",
      requestId: "local",
      success: true,
      resultType: "none",
    };
  }
}
