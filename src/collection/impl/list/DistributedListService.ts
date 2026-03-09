/**
 * Distributed IList service — partition-owned with sync-backup replication.
 *
 * Follows the same architecture as DistributedQueueService:
 *  - All mutating operations are serialised through the owner node.
 *  - After every mutation the owner pushes a full state snapshot to all
 *    configured backup replicas.
 *  - Non-owner nodes forward operations to the owner via TCP and await the
 *    response.
 *
 * Port of com.hazelcast.collection.impl.list.ListService (distributed subset).
 */
import type {
  ClusterMessage,
  ListEventMsg,
  ListResponseMsg,
  ListStateAckMsg,
  ListStateSyncMsg,
} from "@zenystx/helios-core/cluster/tcp/ClusterMessage";
import {
  decodeData,
  encodeData,
} from "@zenystx/helios-core/cluster/tcp/DataWireCodec";
import { TcpClusterTransport } from "@zenystx/helios-core/cluster/tcp/TcpClusterTransport";
import { ItemEvent } from "@zenystx/helios-core/collection/ItemEvent";
import type { ItemListener } from "@zenystx/helios-core/collection/ItemListener";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import type { HeliosClusterCoordinator } from "@zenystx/helios-core/instance/impl/HeliosClusterCoordinator";
import type { Data } from "@zenystx/helios-core/internal/serialization/Data";
import type { SerializationService } from "@zenystx/helios-core/internal/serialization/SerializationService";

// ── Container ─────────────────────────────────────────────────────────

/** Per-name runtime state held on every node (primary + all backups). */
interface ListContainer {
  items: Data[];
  version: number;
  operationChain: Promise<void>;
}

/** In-flight remote request waiting for a LIST_RESPONSE or LIST_STATE_ACK. */
interface PendingRemoteRequest {
  resolve: (msg: ListResponseMsg | ListStateAckMsg) => void;
  reject: (err: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

interface ListListenerRegistration<E = unknown> {
  listener: ItemListener<E>;
  includeValue: boolean;
}

type ListOperation =
  | "add"
  | "addAt"
  | "addAll"
  | "addAllAt"
  | "get"
  | "set"
  | "remove"
  | "removeAt"
  | "indexOf"
  | "lastIndexOf"
  | "contains"
  | "containsAll"
  | "size"
  | "isEmpty"
  | "subList"
  | "toArray"
  | "clear";

// ── Service ───────────────────────────────────────────────────────────

export class DistributedListService {
  private readonly _containers = new Map<string, ListContainer>();
  private readonly _listeners = new Map<
    string,
    Map<string, ListListenerRegistration>
  >();
  private readonly _listenerCounters = new Map<string, number>();
  private readonly _pendingRemoteRequests = new Map<
    string,
    PendingRemoteRequest
  >();

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
      case "LIST_REQUEST":
        this._handleListRequest(message);
        return true;
      case "LIST_RESPONSE":
      case "LIST_STATE_ACK":
        this._handlePendingRequest(message);
        return true;
      case "LIST_STATE_SYNC":
        this._handleStateSync(message);
        return true;
      case "LIST_EVENT":
        this._dispatchListEvent(message);
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

  async addAt(name: string, index: number, data: Data): Promise<void> {
    await this._invoke(name, "addAt", { index, data });
  }

  async addAll(name: string, dataList: Data[]): Promise<boolean> {
    const r = await this._invoke(name, "addAll", { dataList });
    return r.booleanResult ?? false;
  }

  async addAllAt(
    name: string,
    index: number,
    dataList: Data[],
  ): Promise<boolean> {
    const r = await this._invoke(name, "addAllAt", { index, dataList });
    return r.booleanResult ?? false;
  }

  async get(name: string, index: number): Promise<Data> {
    const r = await this._invoke(name, "get", { index });
    if (r.data === undefined) {
      throw new Error("IndexOutOfBoundsException");
    }
    return decodeData(r.data);
  }

  async set(name: string, index: number, data: Data): Promise<Data> {
    const r = await this._invoke(name, "set", { index, data });
    if (r.data === undefined) {
      throw new Error("IndexOutOfBoundsException");
    }
    return decodeData(r.data);
  }

  async remove(name: string, data: Data): Promise<boolean> {
    const r = await this._invoke(name, "remove", { data });
    return r.booleanResult ?? false;
  }

  async removeAt(name: string, index: number): Promise<Data> {
    const r = await this._invoke(name, "removeAt", { index });
    if (r.data === undefined) {
      throw new Error("IndexOutOfBoundsException");
    }
    return decodeData(r.data);
  }

  async indexOf(name: string, data: Data): Promise<number> {
    const r = await this._invoke(name, "indexOf", { data });
    return r.numberResult ?? -1;
  }

  async lastIndexOf(name: string, data: Data): Promise<number> {
    const r = await this._invoke(name, "lastIndexOf", { data });
    return r.numberResult ?? -1;
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

  async subList(
    name: string,
    fromIndex: number,
    toIndex: number,
  ): Promise<Data[]> {
    const r = await this._invoke(name, "subList", { fromIndex, toIndex });
    return (r.dataList ?? []).map(decodeData);
  }

  async toArray(name: string): Promise<Data[]> {
    const r = await this._invoke(name, "toArray");
    return (r.dataList ?? []).map(decodeData);
  }

  async clear(name: string): Promise<void> {
    await this._invoke(name, "clear");
  }

  addItemListener<E>(
    name: string,
    listener: ItemListener<E>,
    includeValue = true,
  ): string {
    if (listener === null || listener === undefined) {
      throw new Error("NullPointerException: listener is null");
    }
    const registrations =
      this._listeners.get(name) ?? new Map<string, ListListenerRegistration>();
    this._listeners.set(name, registrations);
    const nextCounter = (this._listenerCounters.get(name) ?? 0) + 1;
    this._listenerCounters.set(name, nextCounter);
    const id = `listener-${nextCounter}`;
    registrations.set(id, { listener, includeValue });
    return id;
  }

  removeItemListener(name: string, registrationId: string): boolean {
    return this._listeners.get(name)?.delete(registrationId) ?? false;
  }

  // ── Routing ──────────────────────────────────────────────────────────

  private async _invoke(
    name: string,
    operation: ListOperation,
    options?: {
      index?: number;
      fromIndex?: number;
      toIndex?: number;
      data?: Data;
      dataList?: Data[];
    },
  ): Promise<ListResponseMsg> {
    const ownerId = this._resolveOwnerId(name);
    if (ownerId === this._instanceName || this._transport === null) {
      return this._invokeLocally(name, operation, options);
    }

    const requestId = crypto.randomUUID();
    const response = new Promise<ListResponseMsg>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this._pendingRemoteRequests.delete(requestId);
        reject(
          new Error(`List request timed out for '${name}' (${operation})`),
        );
      }, 120_000);
      this._pendingRemoteRequests.set(requestId, {
        resolve: (msg) => resolve(msg as ListResponseMsg),
        reject,
        timeoutHandle,
      });
    });

    this._transport.send(ownerId, {
      type: "LIST_REQUEST",
      requestId,
      sourceNodeId: this._instanceName,
      listName: name,
      operation,
      index: options?.index,
      fromIndex: options?.fromIndex,
      toIndex: options?.toIndex,
      data: options?.data ? encodeData(options.data) : undefined,
      dataList: options?.dataList?.map(encodeData),
    });

    return response;
  }

  private async _invokeLocally(
    name: string,
    operation: ListOperation,
    options?: {
      index?: number;
      fromIndex?: number;
      toIndex?: number;
      data?: Data;
      dataList?: Data[];
    },
  ): Promise<ListResponseMsg> {
    return this._enqueueOperation(name, async (container) => {
      switch (operation) {
        case "add": {
          const d = options?.data;
          if (d === undefined) throw new Error("NullPointerException");
          container.items.push(d);
          container.version++;
          await this._replicateState(name, container);
          this._broadcastEvent(name, "ADDED", d);
          return this._boolResponse(true);
        }
        case "addAt": {
          const idx = options?.index ?? 0;
          const d = options?.data;
          if (d === undefined) throw new Error("NullPointerException");
          this._checkBoundsInclusive(idx, container);
          container.items.splice(idx, 0, d);
          container.version++;
          await this._replicateState(name, container);
          this._broadcastEvent(name, "ADDED", d);
          return this._voidResponse();
        }
        case "addAll": {
          const list = options?.dataList ?? [];
          if (list.length === 0) return this._boolResponse(false);
          container.items.push(...list);
          container.version++;
          await this._replicateState(name, container);
          for (const item of list) {
            this._broadcastEvent(name, "ADDED", item);
          }
          return this._boolResponse(true);
        }
        case "addAllAt": {
          const idx = options?.index ?? 0;
          const list = options?.dataList ?? [];
          this._checkBoundsInclusive(idx, container);
          if (list.length === 0) return this._boolResponse(false);
          container.items.splice(idx, 0, ...list);
          container.version++;
          await this._replicateState(name, container);
          for (const item of list) {
            this._broadcastEvent(name, "ADDED", item);
          }
          return this._boolResponse(true);
        }
        case "get": {
          const idx = options?.index ?? 0;
          this._checkBoundsExclusive(idx, container);
          return {
            type: "LIST_RESPONSE",
            requestId: "local",
            success: true,
            resultType: "data",
            data: encodeData(container.items[idx]),
          };
        }
        case "set": {
          const idx = options?.index ?? 0;
          const d = options?.data;
          if (d === undefined) throw new Error("NullPointerException");
          this._checkBoundsExclusive(idx, container);
          const old = container.items[idx];
          container.items[idx] = d;
          container.version++;
          await this._replicateState(name, container);
          this._broadcastEvent(name, "REMOVED", old);
          this._broadcastEvent(name, "ADDED", d);
          return {
            type: "LIST_RESPONSE",
            requestId: "local",
            success: true,
            resultType: "data",
            data: encodeData(old),
          };
        }
        case "remove": {
          const d = options?.data;
          if (d === undefined) throw new Error("NullPointerException");
          const i = container.items.findIndex((item) => item.equals(d));
          if (i === -1) return this._boolResponse(false);
          const [removed] = container.items.splice(i, 1);
          container.version++;
          await this._replicateState(name, container);
          this._broadcastEvent(name, "REMOVED", removed);
          return this._boolResponse(true);
        }
        case "removeAt": {
          const idx = options?.index ?? 0;
          this._checkBoundsExclusive(idx, container);
          const [removed] = container.items.splice(idx, 1);
          container.version++;
          await this._replicateState(name, container);
          this._broadcastEvent(name, "REMOVED", removed);
          return {
            type: "LIST_RESPONSE",
            requestId: "local",
            success: true,
            resultType: "data",
            data: encodeData(removed),
          };
        }
        case "indexOf": {
          const d = options?.data;
          if (d === undefined) throw new Error("NullPointerException");
          return this._numberResponse(
            container.items.findIndex((item) => item.equals(d)),
          );
        }
        case "lastIndexOf": {
          const d = options?.data;
          if (d === undefined) throw new Error("NullPointerException");
          let last = -1;
          for (let i = 0; i < container.items.length; i++) {
            if (container.items[i].equals(d)) last = i;
          }
          return this._numberResponse(last);
        }
        case "contains": {
          const d = options?.data;
          if (d === undefined) throw new Error("NullPointerException");
          return this._boolResponse(
            container.items.some((item) => item.equals(d)),
          );
        }
        case "containsAll": {
          const list = options?.dataList ?? [];
          const has = list.every((d) =>
            container.items.some((item) => item.equals(d)),
          );
          return this._boolResponse(has);
        }
        case "size":
          return this._numberResponse(container.items.length);
        case "isEmpty":
          return this._boolResponse(container.items.length === 0);
        case "subList": {
          const from = options?.fromIndex ?? 0;
          const to = options?.toIndex ?? container.items.length;
          const slice = container.items.slice(from, to);
          return {
            type: "LIST_RESPONSE",
            requestId: "local",
            success: true,
            resultType: "data-array",
            dataList: slice.map(encodeData),
          };
        }
        case "toArray":
          return {
            type: "LIST_RESPONSE",
            requestId: "local",
            success: true,
            resultType: "data-array",
            dataList: container.items.map(encodeData),
          };
        case "clear":
          if (container.items.length > 0) {
            const removedItems = [...container.items];
            container.items.length = 0;
            container.version++;
            await this._replicateState(name, container);
            for (const item of removedItems) {
              this._broadcastEvent(name, "REMOVED", item);
            }
          }
          return this._voidResponse();
      }
    });
  }

  // ── Remote message handlers ──────────────────────────────────────────

  private _handleListRequest(
    message: Extract<ClusterMessage, { type: "LIST_REQUEST" }>,
  ): void {
    void this._invokeLocally(
      message.listName,
      message.operation as ListOperation,
      {
        index: message.index,
        fromIndex: message.fromIndex,
        toIndex: message.toIndex,
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
          type: "LIST_RESPONSE",
          requestId: message.requestId,
          success: false,
          resultType: "none",
          error: error.message,
        });
      });
  }

  private _handlePendingRequest(
    message: ListResponseMsg | ListStateAckMsg,
  ): void {
    const pending = this._pendingRemoteRequests.get(message.requestId);
    if (pending === undefined) return;
    this._pendingRemoteRequests.delete(message.requestId);
    if (pending.timeoutHandle !== null) clearTimeout(pending.timeoutHandle);

    if ("success" in message && !message.success) {
      pending.reject(new Error(message.error ?? "List operation failed"));
      return;
    }
    pending.resolve(message);
  }

  private _handleStateSync(
    message: Extract<ClusterMessage, { type: "LIST_STATE_SYNC" }>,
  ): void {
    const container = this._getOrCreate(message.listName);
    if (message.version < container.version) return;

    container.items = message.items.map(decodeData);
    container.version = message.version;

    if (message.requestId !== null) {
      this._transport?.send(message.sourceNodeId, {
        type: "LIST_STATE_ACK",
        requestId: message.requestId,
        listName: message.listName,
        version: message.version,
      });
    }
  }

  private _dispatchListEvent(message: ListEventMsg): void {
    const registrations = this._listeners.get(message.listName);
    if (registrations === undefined) {
      return;
    }

    for (const registration of Array.from(registrations.values())) {
      const value =
        registration.includeValue && message.data !== null
          ? this._serializationService.toObject(decodeData(message.data))
          : null;
      const event = new ItemEvent(
        message.listName,
        value,
        message.eventType,
        message.sourceNodeId,
      );
      if (message.eventType === "ADDED") {
        registration.listener.itemAdded?.(event);
      } else {
        registration.listener.itemRemoved?.(event);
      }
    }
  }

  // ── Replication ──────────────────────────────────────────────────────

  private async _replicateState(
    name: string,
    container: ListContainer,
  ): Promise<void> {
    if (this._transport === null || this._coordinator === null) return;

    const partitionId = this._getPartitionId(name);
    const backupCount = this._config.getQueueConfig(name).getBackupCount();
    const totalBackupCount = this._config
      .getQueueConfig(name)
      .getTotalBackupCount();
    const syncBackupIds = this._coordinator.getBackupIds(
      partitionId,
      backupCount,
    );
    const asyncBackupIds = this._coordinator
      .getBackupIds(partitionId, totalBackupCount)
      .slice(syncBackupIds.length);

    const syncRequests = syncBackupIds.map((id) =>
      this._sendStateSync(id, name, container, true),
    );
    const asyncRequests = asyncBackupIds.map((id) =>
      this._sendStateSync(id, name, container, false),
    );
    await Promise.all(syncRequests);
    await Promise.all(asyncRequests);
  }

  private async _sendStateSync(
    backupId: string,
    name: string,
    container: ListContainer,
    waitForAck: boolean,
  ): Promise<void> {
    if (backupId === this._instanceName || this._transport === null) return;

    const requestId = waitForAck ? crypto.randomUUID() : null;
    let ackPromise: Promise<ListStateAckMsg> | null = null;

    if (requestId !== null) {
      ackPromise = new Promise<ListStateAckMsg>((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          this._pendingRemoteRequests.delete(requestId);
          reject(new Error(`List backup sync timed out for '${name}'`));
        }, 10_000);
        this._pendingRemoteRequests.set(requestId, {
          resolve: (msg) => resolve(msg as ListStateAckMsg),
          reject,
          timeoutHandle,
        });
      });
    }

    const msg: ListStateSyncMsg = {
      type: "LIST_STATE_SYNC",
      requestId,
      sourceNodeId: this._instanceName,
      listName: name,
      version: container.version,
      items: container.items.map(encodeData),
    };
    this._transport.send(backupId, msg);

    if (ackPromise !== null) await ackPromise;
  }

  private _broadcastEvent(
    name: string,
    eventType: "ADDED" | "REMOVED",
    data: Data | null,
  ): void {
    const message: ListEventMsg = {
      type: "LIST_EVENT",
      listName: name,
      eventType,
      sourceNodeId: this._instanceName,
      data: data === null ? null : encodeData(data),
    };
    this._dispatchListEvent(message);
    this._transport?.broadcast(message);
  }

  private _resyncAll(): void {
    for (const [name, container] of Array.from(this._containers.entries())) {
      void this._replicateState(name, container);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private _getOrCreate(name: string): ListContainer {
    let container = this._containers.get(name);
    if (container === undefined) {
      container = { items: [], version: 0, operationChain: Promise.resolve() };
      this._containers.set(name, container);
    }
    return container;
  }

  private _enqueueOperation<T>(
    name: string,
    fn: (container: ListContainer) => Promise<T>,
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

  private _checkBoundsInclusive(index: number, c: ListContainer): void {
    if (index < 0 || index > c.items.length) {
      throw new Error(`IndexOutOfBoundsException: index ${index}`);
    }
  }

  private _checkBoundsExclusive(index: number, c: ListContainer): void {
    if (index < 0 || index >= c.items.length) {
      throw new Error(`IndexOutOfBoundsException: index ${index}`);
    }
  }

  private _boolResponse(value: boolean): ListResponseMsg {
    return {
      type: "LIST_RESPONSE",
      requestId: "local",
      success: true,
      resultType: "boolean",
      booleanResult: value,
    };
  }

  private _numberResponse(value: number): ListResponseMsg {
    return {
      type: "LIST_RESPONSE",
      requestId: "local",
      success: true,
      resultType: "number",
      numberResult: value,
    };
  }

  private _voidResponse(): ListResponseMsg {
    return {
      type: "LIST_RESPONSE",
      requestId: "local",
      success: true,
      resultType: "none",
    };
  }
}
