import type {
  ClusterMessage,
  QueueEventMsg,
  QueueResponseMsg,
  QueueStateAckMsg,
  QueueStateItemMsg,
  QueueStateSyncMsg,
} from "@zenystx/helios-core/cluster/tcp/ClusterMessage";
import {
  decodeData,
  encodeData
} from "@zenystx/helios-core/cluster/tcp/DataWireCodec";
import { TcpClusterTransport } from "@zenystx/helios-core/cluster/tcp/TcpClusterTransport";
import { ItemEvent } from "@zenystx/helios-core/collection/ItemEvent";
import { QueueStoreWrapper } from "@zenystx/helios-core/collection/impl/queue/QueueStoreWrapper";
import type { ItemListener } from "@zenystx/helios-core/collection/ItemListener";
import {
  LocalQueueStatsImpl,
  type LocalQueueStats,
} from "@zenystx/helios-core/collection/LocalQueueStats";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import { QueueConfig } from "@zenystx/helios-core/config/QueueConfig";
import type { HeliosClusterCoordinator } from "@zenystx/helios-core/instance/impl/HeliosClusterCoordinator";
import type { Data } from "@zenystx/helios-core/internal/serialization/Data";
import type { SerializationService } from "@zenystx/helios-core/internal/serialization/SerializationService";
import type { RecentStringSet } from "@zenystx/helios-core/internal/util/RecentStringSet";
import { RecentStringSet as RecentStringSetImpl } from "@zenystx/helios-core/internal/util/RecentStringSet";

interface QueueStateItem {
  itemId: number;
  enqueuedAt: number;
  data: Data;
}

interface QueueReplicaState {
  creationTime: number;
  version: number;
  nextItemId: number;
  ownerNodeId: string;
  items: QueueStateItem[];
}

interface QueueLocalStats {
  creationTime: number;
  offerOperationCount: number;
  rejectedOfferOperationCount: number;
  pollOperationCount: number;
  emptyPollOperationCount: number;
  otherOperationCount: number;
  eventOperationCount: number;
}

interface PendingPoll {
  resolve: (value: Data | null) => void;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

interface PendingOffer {
  data: Data;
  resolve: (value: boolean) => void;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

interface QueueRuntime {
  state: QueueReplicaState;
  operationChain: Promise<void>;
  pendingPolls: PendingPoll[];
  pendingOffers: PendingOffer[];
  destroyHandle: ReturnType<typeof setTimeout> | null;
  appliedTxnOpIds: RecentStringSet;
}

interface QueueListenerRegistration<E = unknown> {
  listener: ItemListener<E>;
  includeValue: boolean;
}

interface PendingRemoteRequest {
  resolve: (message: QueueResponseMsg | QueueStateAckMsg) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

type QueueOperation =
  | "offer"
  | "poll"
  | "peek"
  | "size"
  | "isEmpty"
  | "remainingCapacity"
  | "remove"
  | "contains"
  | "containsAll"
  | "toArray"
  | "drain"
  | "addAll"
  | "removeAll"
  | "retainAll"
  | "clear";

export class DistributedQueueService {
  private readonly _runtimes = new Map<string, QueueRuntime>();
  private readonly _listeners = new Map<
    string,
    Map<string, QueueListenerRegistration>
  >();
  private readonly _listenerCounters = new Map<string, number>();
  private readonly _stats = new Map<string, QueueLocalStats>();
  private readonly _pendingRemoteRequests = new Map<
    string,
    PendingRemoteRequest
  >();
  private readonly _storeWrappers = new Map<string, QueueStoreWrapper<unknown>>();

  constructor(
    private readonly _instanceName: string,
    private readonly _config: HeliosConfig,
    private readonly _serializationService: SerializationService,
    private readonly _transport: TcpClusterTransport | null,
    private readonly _coordinator: HeliosClusterCoordinator | null,
  ) {
    this._coordinator?.onMembershipChanged(() => {
      this._resyncAllStates();
    });
  }

  handleMessage(message: ClusterMessage): boolean {
    switch (message.type) {
      case "QUEUE_REQUEST":
        this._handleQueueRequest(message);
        return true;
      case "QUEUE_RESPONSE":
      case "QUEUE_STATE_ACK":
        this._handlePendingRemoteRequest(message);
        return true;
      case "QUEUE_STATE_SYNC":
        this._handleQueueStateSync(message);
        return true;
      case "QUEUE_EVENT":
        this._dispatchQueueEvent(message);
        return true;
      default:
        return false;
    }
  }

  async offer(name: string, data: Data, timeoutMs = 0, dedupeId?: string, dedupeSet?: RecentStringSet): Promise<boolean> {
    const response = await this._invokeOnOwner(name, "offer", {
      data,
      timeoutMs,
    }, dedupeId, dedupeSet);
    return response.booleanResult ?? false;
  }

  async poll(name: string, timeoutMs = 0, dedupeId?: string, dedupeSet?: RecentStringSet): Promise<Data | null> {
    const response = await this._invokeOnOwner(name, "poll", { timeoutMs }, dedupeId, dedupeSet);
    return response.data === undefined ? null : decodeData(response.data);
  }

  async peek(name: string): Promise<Data | null> {
    const response = await this._invokeOnOwner(name, "peek");
    return response.data === undefined ? null : decodeData(response.data);
  }

  async size(name: string): Promise<number> {
    const response = await this._invokeOnOwner(name, "size");
    return response.numberResult ?? 0;
  }

  async isEmpty(name: string): Promise<boolean> {
    const response = await this._invokeOnOwner(name, "isEmpty");
    return response.booleanResult ?? true;
  }

  async remainingCapacity(name: string): Promise<number> {
    const response = await this._invokeOnOwner(name, "remainingCapacity");
    return response.numberResult ?? 0;
  }

  async remove(name: string, data: Data): Promise<boolean> {
    const response = await this._invokeOnOwner(name, "remove", { data });
    return response.booleanResult ?? false;
  }

  async contains(name: string, data: Data): Promise<boolean> {
    const response = await this._invokeOnOwner(name, "contains", { data });
    return response.booleanResult ?? false;
  }

  async containsAll(name: string, dataList: Data[]): Promise<boolean> {
    const response = await this._invokeOnOwner(name, "containsAll", {
      dataList,
    });
    return response.booleanResult ?? false;
  }

  async toArray(name: string): Promise<Data[]> {
    const response = await this._invokeOnOwner(name, "toArray");
    return (response.dataList ?? []).map((entry) => decodeData(entry));
  }

  async drain(name: string, maxElements = -1): Promise<Data[]> {
    const response = await this._invokeOnOwner(name, "drain", { maxElements });
    return (response.dataList ?? []).map((entry) => decodeData(entry));
  }

  async addAll(name: string, dataList: Data[]): Promise<boolean> {
    const response = await this._invokeOnOwner(name, "addAll", { dataList });
    return response.booleanResult ?? false;
  }

  async removeAll(name: string, dataList: Data[]): Promise<boolean> {
    const response = await this._invokeOnOwner(name, "removeAll", { dataList });
    return response.booleanResult ?? false;
  }

  async retainAll(name: string, dataList: Data[]): Promise<boolean> {
    const response = await this._invokeOnOwner(name, "retainAll", { dataList });
    return response.booleanResult ?? false;
  }

  async clear(name: string): Promise<void> {
    await this._invokeOnOwner(name, "clear");
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
      this._listeners.get(name) ?? new Map<string, QueueListenerRegistration>();
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

  getLocalQueueStats(name: string): LocalQueueStats {
    const stats = this._getStats(name);
    const runtime = this._runtimes.get(name);
    const state = runtime?.state;
    const ages = state?.items.map((item) => Date.now() - item.enqueuedAt) ?? [];
    const ownerId = this._resolveOwnerId(name);
    const backupIds = this._resolveBackupIds(name);
    const ownedItemCount =
      ownerId === this._instanceName ? (state?.items.length ?? 0) : 0;
    const backupItemCount = backupIds.includes(this._instanceName)
      ? (state?.items.length ?? 0)
      : 0;

    return new LocalQueueStatsImpl({
      creationTime: stats.creationTime,
      ownedItemCount,
      backupItemCount,
      minAge: ages.length === 0 ? 0 : Math.min(...ages),
      maxAge: ages.length === 0 ? 0 : Math.max(...ages),
      averageAge:
        ages.length === 0
          ? 0
          : Math.floor(ages.reduce((sum, age) => sum + age, 0) / ages.length),
      offerOperationCount: stats.offerOperationCount,
      rejectedOfferOperationCount: stats.rejectedOfferOperationCount,
      pollOperationCount: stats.pollOperationCount,
      emptyPollOperationCount: stats.emptyPollOperationCount,
      otherOperationCount: stats.otherOperationCount,
      eventOperationCount: stats.eventOperationCount,
    });
  }

  /**
   * Register a QueueStoreWrapper for the given queue name.
   * Call this before any operations when a QueueStoreConfig is present.
   */
  registerStore(name: string, store: QueueStoreWrapper<unknown>): void {
    this._storeWrappers.set(name, store);
  }

  /**
   * Load initial items from the store into the queue runtime.
   * Should be called after registerStore, before serving operations.
   */
  async loadFromStore(name: string): Promise<void> {
    const store = this._storeWrappers.get(name);
    if (store === undefined) return;

    const loaded = await store.loadAll();
    if (loaded.size === 0) return;

    const runtime = this._getOrCreateRuntime(name);
    const entries = Array.from(loaded.entries()).sort(([a], [b]) => a - b);
    for (const [itemId, value] of entries) {
      const data = this._serializationService.toData(value);
      if (data === null) continue;
      runtime.state.items.push({ itemId, enqueuedAt: Date.now(), data });
      if (itemId >= runtime.state.nextItemId) {
        runtime.state.nextItemId = itemId + 1;
      }
    }
    runtime.state.version++;
  }

  destroy(name: string): void {
    const runtime = this._runtimes.get(name);
    if (runtime !== undefined) {
      this._cancelDestroy(runtime);
      runtime.state.items.length = 0;
      for (const pendingPoll of runtime.pendingPolls.splice(0)) {
        if (pendingPoll.timeoutHandle !== null) {
          clearTimeout(pendingPoll.timeoutHandle);
        }
        pendingPoll.resolve(null);
      }
      for (const pendingOffer of runtime.pendingOffers.splice(0)) {
        if (pendingOffer.timeoutHandle !== null) {
          clearTimeout(pendingOffer.timeoutHandle);
        }
        pendingOffer.resolve(false);
      }
      this._runtimes.delete(name);
    }

    this._listeners.delete(name);
    this._listenerCounters.delete(name);
    this._stats.delete(name);
  }

  private async _invokeOnOwner(
    name: string,
    operation: QueueOperation,
    options?: {
      data?: Data;
      dataList?: Data[];
      maxElements?: number;
      timeoutMs?: number;
    },
    dedupeId?: string,
    dedupeSet?: RecentStringSet,
  ): Promise<QueueResponseMsg> {
    if (dedupeId !== undefined && ((dedupeSet?.has(dedupeId) ?? false) || this._getOrCreateRuntime(name).appliedTxnOpIds.has(dedupeId))) {
      return this._dedupedSuccessResponse(operation);
    }
    const ownerId = this._resolveOwnerId(name);
    if (ownerId === this._instanceName || this._transport === null) {
      const response = await this._invokeLocally(name, operation, options);
      if (dedupeId !== undefined) {
        this._getOrCreateRuntime(name).appliedTxnOpIds.add(dedupeId);
        dedupeSet?.add(dedupeId);
      }
      return response;
    }

    const requestId = crypto.randomUUID();
    const responsePromise = new Promise<QueueResponseMsg>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this._pendingRemoteRequests.delete(requestId);
        reject(
          new Error(`Queue request timed out for '${name}' (${operation})`),
        );
      }, 120_000);

      this._pendingRemoteRequests.set(requestId, {
        resolve: (message) => resolve(message as QueueResponseMsg),
        reject,
        timeoutHandle,
      });
    });

    this._transport.send(ownerId, {
      type: "QUEUE_REQUEST",
      requestId,
      sourceNodeId: this._instanceName,
      queueName: name,
      operation,
      txnDedupeId: dedupeId,
      timeoutMs: options?.timeoutMs,
      data: options?.data ? encodeData(options.data) : undefined,
      dataList: options?.dataList?.map((entry) => encodeData(entry)),
      maxElements: options?.maxElements,
    });

    const response = await responsePromise;
    if (dedupeId !== undefined) {
      dedupeSet?.add(dedupeId);
    }
    return response;
  }

  private _dedupedSuccessResponse(operation: QueueOperation): QueueResponseMsg {
    return {
      type: "QUEUE_RESPONSE",
      requestId: "deduped",
      success: true,
      resultType: operation === "poll" ? "none" : "boolean",
      booleanResult: operation === "offer" ? true : undefined,
    };
  }

  private async _invokeLocally(
    name: string,
    operation: QueueOperation,
    options?: {
      data?: Data;
      dataList?: Data[];
      maxElements?: number;
      timeoutMs?: number;
    },
    dedupeId?: string,
    dedupeSet?: RecentStringSet,
  ): Promise<QueueResponseMsg> {
    if (dedupeId !== undefined && ((dedupeSet?.has(dedupeId) ?? false) || this._getOrCreateRuntime(name).appliedTxnOpIds.has(dedupeId))) {
      return this._dedupedSuccessResponse(operation);
    }
    return this._enqueueOwnerOperation(name, async (runtime) => {
      this._cancelDestroy(runtime);

      if (dedupeId !== undefined && ((dedupeSet?.has(dedupeId) ?? false) || runtime.appliedTxnOpIds.has(dedupeId))) {
        return this._dedupedSuccessResponse(operation);
      }

      const finalize = (response: QueueResponseMsg): QueueResponseMsg => {
        if (dedupeId !== undefined) {
          runtime.appliedTxnOpIds.add(dedupeId);
          dedupeSet?.add(dedupeId);
        }
        return response;
      };

      switch (operation) {
        case "offer": {
          const accepted = await this._offerInternal(
            name,
            runtime,
            options?.data,
            options?.timeoutMs ?? 0,
          );
          return finalize({
            type: "QUEUE_RESPONSE",
            requestId: "local",
            success: true,
            resultType: "boolean",
            booleanResult: accepted,
          });
        }
        case "poll": {
          const result = await this._pollInternal(
            name,
            runtime,
            options?.timeoutMs ?? 0,
          );
          return finalize({
            type: "QUEUE_RESPONSE",
            requestId: "local",
            success: true,
            resultType: result === null ? "none" : "data",
            data: result === null ? undefined : encodeData(result),
          });
        }
        case "peek": {
          const result = runtime.state.items[0]?.data ?? null;
          this._getStats(name).otherOperationCount++;
          return finalize({
            type: "QUEUE_RESPONSE",
            requestId: "local",
            success: true,
            resultType: result === null ? "none" : "data",
            data: result === null ? undefined : encodeData(result),
          });
        }
        case "size":
          this._getStats(name).otherOperationCount++;
          return finalize({
            type: "QUEUE_RESPONSE",
            requestId: "local",
            success: true,
            resultType: "number",
            numberResult: runtime.state.items.length,
          });
        case "isEmpty":
          this._getStats(name).otherOperationCount++;
          return finalize({
            type: "QUEUE_RESPONSE",
            requestId: "local",
            success: true,
            resultType: "boolean",
            booleanResult: runtime.state.items.length === 0,
          });
        case "remainingCapacity":
          this._getStats(name).otherOperationCount++;
          return finalize({
            type: "QUEUE_RESPONSE",
            requestId: "local",
            success: true,
            resultType: "number",
            numberResult: this._remainingCapacity(name, runtime),
          });
        case "remove": {
          const removed = this._removeByValue(name, runtime, options?.data);
          return finalize({
            type: "QUEUE_RESPONSE",
            requestId: "local",
            success: true,
            resultType: "boolean",
            booleanResult: removed,
          });
        }
        case "contains":
          return finalize({
            type: "QUEUE_RESPONSE",
            requestId: "local",
            success: true,
            resultType: "boolean",
            booleanResult: this._containsValue(name, runtime, options?.data),
          });
        case "containsAll":
          return finalize({
            type: "QUEUE_RESPONSE",
            requestId: "local",
            success: true,
            resultType: "boolean",
            booleanResult: (options?.dataList ?? []).every((entry) =>
              this._containsValue(name, runtime, entry),
            ),
          });
        case "toArray":
          this._getStats(name).otherOperationCount++;
          return finalize({
            type: "QUEUE_RESPONSE",
            requestId: "local",
            success: true,
            resultType: "data-array",
            dataList: runtime.state.items.map((entry) =>
              encodeData(entry.data),
            ),
          });
        case "drain": {
          const dataList = this._drain(
            name,
            runtime,
            options?.maxElements ?? -1,
          );
          return finalize({
            type: "QUEUE_RESPONSE",
            requestId: "local",
            success: true,
            resultType: "data-array",
            dataList: dataList.map((entry) => encodeData(entry)),
          });
        }
        case "addAll": {
          const changed = await this._addAll(
            name,
            runtime,
            options?.dataList ?? [],
          );
          return finalize({
            type: "QUEUE_RESPONSE",
            requestId: "local",
            success: true,
            resultType: "boolean",
            booleanResult: changed,
          });
        }
        case "removeAll": {
          const changed = this._removeAll(
            name,
            runtime,
            options?.dataList ?? [],
          );
          return finalize({
            type: "QUEUE_RESPONSE",
            requestId: "local",
            success: true,
            resultType: "boolean",
            booleanResult: changed,
          });
        }
        case "retainAll": {
          const changed = this._retainAll(
            name,
            runtime,
            options?.dataList ?? [],
          );
          return finalize({
            type: "QUEUE_RESPONSE",
            requestId: "local",
            success: true,
            resultType: "boolean",
            booleanResult: changed,
          });
        }
        case "clear":
          this._clear(name, runtime);
          return finalize({
            type: "QUEUE_RESPONSE",
            requestId: "local",
            success: true,
            resultType: "none",
          });
      }
    });
  }

  private _handleQueueRequest(
    message: Extract<ClusterMessage, { type: "QUEUE_REQUEST" }>,
  ): void {
    void this._invokeLocally(
      message.queueName,
      message.operation as QueueOperation,
      {
        data: message.data ? decodeData(message.data) : undefined,
        dataList: message.dataList?.map((entry) => decodeData(entry)),
        maxElements: message.maxElements,
        timeoutMs: message.timeoutMs,
      },
      message.txnDedupeId,
      this._getOrCreateRuntime(message.queueName).appliedTxnOpIds,
    )
      .then((response) => {
        this._transport?.send(message.sourceNodeId, {
          ...response,
          requestId: message.requestId,
        });
      })
      .catch((error: Error) => {
        this._transport?.send(message.sourceNodeId, {
          type: "QUEUE_RESPONSE",
          requestId: message.requestId,
          success: false,
          resultType: "none",
          error: error.message,
        });
      });
  }

  private _handlePendingRemoteRequest(
    message: QueueResponseMsg | QueueStateAckMsg,
  ): void {
    const pending = this._pendingRemoteRequests.get(message.requestId);
    if (pending === undefined) {
      return;
    }
    this._pendingRemoteRequests.delete(message.requestId);
    if (pending.timeoutHandle !== null) {
      clearTimeout(pending.timeoutHandle);
    }

    if ("success" in message && !message.success) {
      pending.reject(new Error(message.error ?? "Queue operation failed"));
      return;
    }

    pending.resolve(message);
  }

  private _handleQueueStateSync(message: QueueStateSyncMsg): void {
    const runtime = this._getOrCreateRuntime(message.queueName);
    if (message.version < runtime.state.version) {
      return;
    }

    runtime.state = {
      creationTime: runtime.state.creationTime,
      version: message.version,
      nextItemId: message.nextItemId,
      ownerNodeId: message.ownerNodeId,
      items: message.items.map((item) => this._fromWireQueueItem(item)),
    };
    runtime.appliedTxnOpIds.replace(message.appliedTxnOpIds);
    this._scheduleDestroyIfNeeded(message.queueName, runtime);

    if (message.requestId !== null) {
      void this._sendQueueStateAck(message);
    }
  }

  private async _sendQueueStateAck(message: QueueStateSyncMsg): Promise<void> {
    if (this._transport === null || message.requestId === null) {
      return;
    }

    const connected = await this._ensurePeerConnected(message.sourceNodeId);
    if (!connected) {
      return;
    }

    this._transport.send(message.sourceNodeId, {
      type: "QUEUE_STATE_ACK",
      requestId: message.requestId,
      queueName: message.queueName,
      version: message.version,
    });
  }

  private _dispatchQueueEvent(message: QueueEventMsg): void {
    const registrations = this._listeners.get(message.queueName);
    if (registrations === undefined) {
      return;
    }

    for (const registration of Array.from(registrations.values())) {
      const value =
        registration.includeValue && message.data !== null
          ? this._serializationService.toObject(decodeData(message.data))
          : null;
      const event = new ItemEvent(
        message.queueName,
        value,
        message.eventType,
        message.sourceNodeId,
      );
      if (message.eventType === "ADDED") {
        registration.listener.itemAdded?.(event);
      } else {
        registration.listener.itemRemoved?.(event);
      }
      this._getStats(message.queueName).eventOperationCount++;
    }
  }

  private async _offerInternal(
    name: string,
    runtime: QueueRuntime,
    data: Data | undefined,
    timeoutMs: number,
  ): Promise<boolean> {
    if (data === undefined) {
      throw new Error("NullPointerException: null element");
    }
    const stats = this._getStats(name);

    if (this._remainingCapacity(name, runtime) > 0) {
      this._appendItem(name, runtime, data);
      await this._replicateState(name, runtime);
      this._drainWaiters(name, runtime);
      return true;
    }

    if (timeoutMs === 0) {
      stats.rejectedOfferOperationCount++;
      return false;
    }

    return new Promise<boolean>((resolve) => {
      const pendingOffer: PendingOffer = {
        data,
        resolve,
        timeoutHandle:
          timeoutMs < 0
            ? null
            : setTimeout(() => {
                runtime.pendingOffers = runtime.pendingOffers.filter(
                  (entry) => entry !== pendingOffer,
                );
                stats.rejectedOfferOperationCount++;
                resolve(false);
              }, timeoutMs),
      };
      runtime.pendingOffers.push(pendingOffer);
    });
  }

  private async _pollInternal(
    name: string,
    runtime: QueueRuntime,
    timeoutMs: number,
  ): Promise<Data | null> {
    const immediate = this._pollNow(name, runtime);
    if (immediate !== null) {
      await this._replicateState(name, runtime);
      this._drainWaiters(name, runtime);
      return immediate;
    }

    if (timeoutMs === 0) {
      this._getStats(name).emptyPollOperationCount++;
      return null;
    }

    return new Promise<Data | null>((resolve) => {
      const pendingPoll: PendingPoll = {
        resolve,
        timeoutHandle:
          timeoutMs < 0
            ? null
            : setTimeout(() => {
                runtime.pendingPolls = runtime.pendingPolls.filter(
                  (entry) => entry !== pendingPoll,
                );
                this._getStats(name).emptyPollOperationCount++;
                resolve(null);
              }, timeoutMs),
      };
      runtime.pendingPolls.push(pendingPoll);
    });
  }

  private _pollNow(name: string, runtime: QueueRuntime): Data | null {
    const entry = runtime.state.items.shift();
    if (entry === undefined) {
      return null;
    }
    this._getStats(name).pollOperationCount++;
    runtime.state.version++;
    this._broadcastEvent(name, "REMOVED", entry.data);
    this._scheduleDestroyIfNeeded(name, runtime);

    const store = this._storeWrappers.get(name);
    if (store !== undefined) {
      void store.delete(entry.itemId);
    }

    return entry.data;
  }

  private _appendItem(name: string, runtime: QueueRuntime, data: Data): void {
    const itemId = runtime.state.nextItemId++;
    runtime.state.items.push({
      itemId,
      enqueuedAt: Date.now(),
      data,
    });
    runtime.state.version++;
    runtime.state.ownerNodeId = this._instanceName;
    this._getStats(name).offerOperationCount++;
    this._broadcastEvent(name, "ADDED", data);

    const store = this._storeWrappers.get(name);
    if (store !== undefined) {
      const value = this._serializationService.toObject(data);
      void store.store(itemId, value);
    }
  }

  private _containsValue(
    name: string,
    runtime: QueueRuntime,
    data: Data | undefined,
  ): boolean {
    if (data === undefined) {
      throw new Error("NullPointerException: null element");
    }
    this._getStats(name).otherOperationCount++;
    return runtime.state.items.some((item) => item.data.equals(data));
  }

  private _removeByValue(
    name: string,
    runtime: QueueRuntime,
    data: Data | undefined,
  ): boolean {
    if (data === undefined) {
      throw new Error("NullPointerException: null element");
    }
    const stats = this._getStats(name);
    for (let index = 0; index < runtime.state.items.length; index++) {
      if (runtime.state.items[index].data.equals(data)) {
        const [removed] = runtime.state.items.splice(index, 1);
        runtime.state.version++;
        stats.otherOperationCount++;
        this._broadcastEvent(name, "REMOVED", removed.data);
        this._scheduleDestroyIfNeeded(name, runtime);
        void this._replicateState(name, runtime);
        this._drainWaiters(name, runtime);

        const store = this._storeWrappers.get(name);
        if (store !== undefined) {
          void store.delete(removed.itemId);
        }

        return true;
      }
    }
    stats.otherOperationCount++;
    return false;
  }

  private _drain(
    name: string,
    runtime: QueueRuntime,
    maxElements: number,
  ): Data[] {
    const drainCount =
      maxElements < 0 ? runtime.state.items.length : maxElements;
    const drained = runtime.state.items.splice(0, drainCount);
    if (drained.length > 0) {
      runtime.state.version++;
      this._getStats(name).otherOperationCount++;
      for (const entry of drained) {
        this._broadcastEvent(name, "REMOVED", entry.data);
      }
      this._scheduleDestroyIfNeeded(name, runtime);
      void this._replicateState(name, runtime);
      this._drainWaiters(name, runtime);

      const store = this._storeWrappers.get(name);
      if (store !== undefined) {
        const keys = new Set(drained.map((entry) => entry.itemId));
        void store.deleteAll(keys);
      }
    }
    return drained.map((entry) => entry.data);
  }

  private async _addAll(
    name: string,
    runtime: QueueRuntime,
    dataList: Data[],
  ): Promise<boolean> {
    if (dataList.length === 0) {
      return false;
    }
    if (dataList.some((entry) => entry === null || entry === undefined)) {
      throw new Error("NullPointerException: null element in collection");
    }
    const maxSize = this._getQueueConfig(name).getMaxSize();
    if (maxSize > 0 && runtime.state.items.length + dataList.length > maxSize) {
      throw new Error("IllegalStateException: Queue capacity exceeded");
    }
    for (const entry of dataList) {
      this._appendItem(name, runtime, entry);
    }
    await this._replicateState(name, runtime);
    this._drainWaiters(name, runtime);
    return true;
  }

  private _removeAll(
    name: string,
    runtime: QueueRuntime,
    dataList: Data[],
  ): boolean {
    let changed = false;
    const removedIds: number[] = [];
    for (let index = runtime.state.items.length - 1; index >= 0; index--) {
      if (
        dataList.some((candidate) =>
          runtime.state.items[index].data.equals(candidate),
        )
      ) {
        const [removed] = runtime.state.items.splice(index, 1);
        this._broadcastEvent(name, "REMOVED", removed.data);
        removedIds.push(removed.itemId);
        changed = true;
      }
    }
    if (changed) {
      runtime.state.version++;
      this._getStats(name).otherOperationCount++;
      this._scheduleDestroyIfNeeded(name, runtime);
      void this._replicateState(name, runtime);
      this._drainWaiters(name, runtime);

      const store = this._storeWrappers.get(name);
      if (store !== undefined && removedIds.length > 0) {
        void store.deleteAll(new Set(removedIds));
      }
    }
    return changed;
  }

  private _retainAll(
    name: string,
    runtime: QueueRuntime,
    dataList: Data[],
  ): boolean {
    let changed = false;
    const removedIds: number[] = [];
    for (let index = runtime.state.items.length - 1; index >= 0; index--) {
      const keep = dataList.some((candidate) =>
        runtime.state.items[index].data.equals(candidate),
      );
      if (!keep) {
        const [removed] = runtime.state.items.splice(index, 1);
        this._broadcastEvent(name, "REMOVED", removed.data);
        removedIds.push(removed.itemId);
        changed = true;
      }
    }
    if (changed) {
      runtime.state.version++;
      this._getStats(name).otherOperationCount++;
      this._scheduleDestroyIfNeeded(name, runtime);
      void this._replicateState(name, runtime);
      this._drainWaiters(name, runtime);

      const store = this._storeWrappers.get(name);
      if (store !== undefined && removedIds.length > 0) {
        void store.deleteAll(new Set(removedIds));
      }
    }
    return changed;
  }

  private _clear(name: string, runtime: QueueRuntime): void {
    if (runtime.state.items.length === 0) {
      return;
    }
    const removed = runtime.state.items.splice(0, runtime.state.items.length);
    runtime.state.version++;
    this._getStats(name).otherOperationCount++;
    for (const entry of removed) {
      this._broadcastEvent(name, "REMOVED", entry.data);
    }
    this._scheduleDestroyIfNeeded(name, runtime);
    void this._replicateState(name, runtime);
    this._drainWaiters(name, runtime);

    const store = this._storeWrappers.get(name);
    if (store !== undefined && removed.length > 0) {
      const keys = new Set(removed.map((entry) => entry.itemId));
      void store.deleteAll(keys);
    }
  }

  private _drainWaiters(name: string, runtime: QueueRuntime): void {
    let progressed = true;
    let stateChanged = false;
    while (progressed) {
      progressed = false;

      while (
        runtime.pendingOffers.length > 0 &&
        this._remainingCapacity(name, runtime) > 0
      ) {
        const pendingOffer = runtime.pendingOffers.shift()!;
        if (pendingOffer.timeoutHandle !== null) {
          clearTimeout(pendingOffer.timeoutHandle);
        }
        this._appendItem(name, runtime, pendingOffer.data);
        pendingOffer.resolve(true);
        progressed = true;
        stateChanged = true;
      }

      while (
        runtime.pendingPolls.length > 0 &&
        runtime.state.items.length > 0
      ) {
        const pendingPoll = runtime.pendingPolls.shift()!;
        if (pendingPoll.timeoutHandle !== null) {
          clearTimeout(pendingPoll.timeoutHandle);
        }
        const item = this._pollNow(name, runtime);
        pendingPoll.resolve(item);
        progressed = true;
        stateChanged = true;
      }
    }

    if (stateChanged) {
      void this._replicateState(name, runtime);
    }
  }

  private async _replicateState(
    name: string,
    runtime: QueueRuntime,
  ): Promise<void> {
    if (this._transport === null || this._coordinator === null) {
      return;
    }

    const partitionId = this._getPartitionId(name);
    const config = this._getQueueConfig(name);
    const syncBackups = this._coordinator.getBackupIds(
      partitionId,
      config.getBackupCount(),
    );
    const asyncBackups = this._coordinator
      .getBackupIds(partitionId, config.getTotalBackupCount())
      .slice(syncBackups.length);

    const syncRequests = syncBackups.map((backupId) =>
      this._sendStateSync(backupId, name, runtime, true),
    );
    const asyncRequests = asyncBackups.map((backupId) =>
      this._sendStateSync(backupId, name, runtime, false),
    );

    await Promise.all(syncRequests);
    await Promise.all(asyncRequests);
  }

  private async _sendStateSync(
    backupId: string,
    name: string,
    runtime: QueueRuntime,
    waitForAck: boolean,
  ): Promise<void> {
    if (backupId === this._instanceName || this._transport === null) {
      return;
    }

    const connected = await this._ensurePeerConnected(backupId);
    if (!connected) {
      return;
    }

    const requestId = waitForAck ? crypto.randomUUID() : null;
    let responsePromise: Promise<QueueStateAckMsg> | null = null;

    if (requestId !== null) {
      responsePromise = new Promise<QueueStateAckMsg>((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          this._pendingRemoteRequests.delete(requestId);
          reject(
            new Error(`Timed out waiting for queue backup sync on '${name}'`),
          );
        }, 10_000);
        this._pendingRemoteRequests.set(requestId, {
          resolve: (message) => resolve(message as QueueStateAckMsg),
          reject,
          timeoutHandle,
        });
      });
    }

    const message: QueueStateSyncMsg = {
      type: "QUEUE_STATE_SYNC",
      requestId,
      sourceNodeId: this._instanceName,
      queueName: name,
      version: runtime.state.version,
      nextItemId: runtime.state.nextItemId,
      ownerNodeId: this._resolveOwnerId(name),
      items: runtime.state.items.map((item) => this._toWireQueueItem(item)),
      counters: {
        offerOperationCount: 0,
        rejectedOfferOperationCount: 0,
        pollOperationCount: 0,
        emptyPollOperationCount: 0,
        otherOperationCount: 0,
        eventOperationCount: 0,
      },
      appliedTxnOpIds: runtime.appliedTxnOpIds.snapshot(),
    };

    this._transport.send(backupId, message);

    if (responsePromise !== null) {
      await responsePromise;
    }
  }

  private _broadcastEvent(
    name: string,
    eventType: "ADDED" | "REMOVED",
    data: Data | null,
  ): void {
    const message: QueueEventMsg = {
      type: "QUEUE_EVENT",
      queueName: name,
      eventType,
      sourceNodeId: this._instanceName,
      data: data === null ? null : encodeData(data),
    };
    this._dispatchQueueEvent(message);
    this._transport?.broadcast(message);
  }

  private _resyncAllStates(): void {
    for (const [name, runtime] of Array.from(this._runtimes.entries())) {
      void this._resyncState(name, runtime);
    }
  }

  private async _resyncState(
    name: string,
    runtime: QueueRuntime,
  ): Promise<void> {
    if (this._transport === null || this._coordinator === null) {
      return;
    }
    const targets = new Set<string>([
      this._resolveOwnerId(name),
      ...this._resolveBackupIds(name),
    ]);
    targets.delete(this._instanceName);
    await Promise.all(
      Array.from(targets).map((target) =>
        this._sendStateSync(target, name, runtime, false),
      ),
    );
  }

  private async _ensurePeerConnected(peerId: string): Promise<boolean> {
    if (this._transport === null) {
      return false;
    }
    if (this._transport.hasPeer(peerId)) {
      return true;
    }

    const memberAddress = this._coordinator?.getMemberAddress(peerId);
    if (memberAddress === null || memberAddress === undefined) {
      return false;
    }

    try {
      await this._transport.connectToPeer(
        memberAddress.getHost(),
        memberAddress.getPort(),
      );
    } catch {
      return false;
    }

    const deadline = Date.now() + 500;
    while (!this._transport.hasPeer(peerId)) {
      if (Date.now() >= deadline) {
        return false;
      }
      await Bun.sleep(10);
    }

    return true;
  }

  private _remainingCapacity(name: string, runtime: QueueRuntime): number {
    const maxSize = this._getQueueConfig(name).getMaxSize();
    if (maxSize <= 0) {
      return 0x7fffffff;
    }
    return maxSize - runtime.state.items.length;
  }

  private _getOrCreateRuntime(name: string): QueueRuntime {
    let runtime = this._runtimes.get(name);
    if (runtime === undefined) {
      runtime = {
        state: {
          creationTime: Date.now(),
          version: 0,
          nextItemId: 1,
          ownerNodeId: this._resolveOwnerId(name),
          items: [],
        },
        operationChain: Promise.resolve(),
        pendingPolls: [],
        pendingOffers: [],
        destroyHandle: null,
        appliedTxnOpIds: new RecentStringSetImpl(8_192),
      };
      this._runtimes.set(name, runtime);
    }
    return runtime!;
  }

  private _enqueueOwnerOperation<T>(
    name: string,
    operation: (runtime: QueueRuntime) => Promise<T>,
  ): Promise<T> {
    const runtime = this._getOrCreateRuntime(name);
    const nextOperation = runtime.operationChain.then(
      () => operation(runtime),
      () => operation(runtime),
    );
    runtime.operationChain = nextOperation.then(
      () => undefined,
      () => undefined,
    );
    return nextOperation;
  }

  private _getStats(name: string): QueueLocalStats {
    let stats = this._stats.get(name);
    if (stats === undefined) {
      stats = {
        creationTime: Date.now(),
        offerOperationCount: 0,
        rejectedOfferOperationCount: 0,
        pollOperationCount: 0,
        emptyPollOperationCount: 0,
        otherOperationCount: 0,
        eventOperationCount: 0,
      };
      this._stats.set(name, stats);
    }
    return stats;
  }

  private _getQueueConfig(name: string): QueueConfig {
    return this._config.getQueueConfig(name);
  }

  private _resolveOwnerId(name: string): string {
    return (
      this._coordinator?.getOwnerId(this._getPartitionId(name)) ??
      this._instanceName
    );
  }

  private _resolveBackupIds(name: string): string[] {
    const config = this._getQueueConfig(name);
    return (
      this._coordinator?.getBackupIds(
        this._getPartitionId(name),
        config.getTotalBackupCount(),
      ) ?? []
    );
  }

  private _getPartitionId(name: string): number {
    return this._coordinator?.getPartitionId(name) ?? 0;
  }

  private _scheduleDestroyIfNeeded(name: string, runtime: QueueRuntime): void {
    this._cancelDestroy(runtime);
    const ttlSeconds = this._getQueueConfig(name).getEmptyQueueTtlSeconds();
    if (ttlSeconds <= 0 || runtime.state.items.length > 0) {
      return;
    }
    runtime.destroyHandle = setTimeout(() => {
      if (runtime.state.items.length === 0) {
        this._runtimes.delete(name);
      }
    }, ttlSeconds * 1000);
  }

  private _cancelDestroy(runtime: QueueRuntime): void {
    if (runtime.destroyHandle !== null) {
      clearTimeout(runtime.destroyHandle);
      runtime.destroyHandle = null;
    }
  }

  private _toWireQueueItem(item: QueueStateItem): QueueStateItemMsg {
    return {
      itemId: item.itemId,
      enqueuedAt: item.enqueuedAt,
      data: encodeData(item.data),
    };
  }

  private _fromWireQueueItem(item: QueueStateItemMsg): QueueStateItem {
    return {
      itemId: item.itemId,
      enqueuedAt: item.enqueuedAt,
      data: decodeData(item.data),
    };
  }
}
