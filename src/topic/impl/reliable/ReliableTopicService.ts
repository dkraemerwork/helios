/**
 * Service managing reliable topic runtime state.
 * Each reliable topic is backed by a ringbuffer named `_hz_rb_<topicName>`.
 */
import { decodeData, encodeData } from "@zenystx/helios-core/cluster/tcp/DataWireCodec";
import type { ClusterMessage } from "@zenystx/helios-core/cluster/tcp/ClusterMessage";
import type { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import type { ReliableTopicConfig } from "@zenystx/helios-core/config/ReliableTopicConfig";
import { TopicOverloadPolicy } from "@zenystx/helios-core/config/ReliableTopicConfig";
import type { SerializationService } from "@zenystx/helios-core/internal/serialization/SerializationService";
import type { HeliosClusterCoordinator } from "@zenystx/helios-core/instance/impl/HeliosClusterCoordinator";
import type { RingbufferContainer } from "@zenystx/helios-core/ringbuffer/impl/RingbufferContainer";
import { RingbufferService } from "@zenystx/helios-core/ringbuffer/impl/RingbufferService";
import {
  LocalTopicStatsImpl,
  type LocalTopicStats,
} from "@zenystx/helios-core/topic/LocalTopicStats";
import { Message } from "@zenystx/helios-core/topic/Message";
import type { MessageListener } from "@zenystx/helios-core/topic/MessageListener";
import { ReliableTopicMessageRecord } from "@zenystx/helios-core/topic/impl/reliable/ReliableTopicMessageRecord";
import { TcpClusterTransport } from "@zenystx/helios-core/cluster/tcp/TcpClusterTransport";

export const TOPIC_RB_PREFIX = "_hz_rb_";

interface TopicRuntime<T = unknown> {
  container: RingbufferContainer<ReliableTopicMessageRecord, ReliableTopicMessageRecord>;
  listeners: Map<string, MessageListener<T>>;
  stats: LocalTopicStatsImpl;
  listenerCounter: number;
  config: ReliableTopicConfig;
}

interface PendingPublish {
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

interface PendingBackupAcks {
  expected: number;
  received: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

export class ReliableTopicService {
  private readonly _topics = new Map<string, TopicRuntime>();
  private readonly _destroyedTopics = new Set<string>();
  private readonly _pendingPublishes = new Map<string, PendingPublish>();
  private readonly _pendingBackupAcks = new Map<string, PendingBackupAcks>();

  constructor(
    private readonly _instanceName: string,
    private readonly _config: HeliosConfig,
    private readonly _ringbufferService: RingbufferService,
    private readonly _serializationService?: SerializationService,
    private readonly _transport?: TcpClusterTransport | null,
    private readonly _coordinator?: HeliosClusterCoordinator | null,
  ) {}

  handleMessage(message: ClusterMessage): boolean {
    switch (message.type) {
      case "RELIABLE_TOPIC_PUBLISH_REQUEST":
        void this._handlePublishRequest(message);
        return true;
      case "RELIABLE_TOPIC_PUBLISH_ACK":
        this._resolvePublishAck(message.requestId, message.error);
        return true;
      case "RELIABLE_TOPIC_MESSAGE":
        this._deliverLocalMessage(
          message.topicName,
          message.sequence,
          new ReliableTopicMessageRecord(
            this._toObject(message.data),
            message.publisherAddress,
            message.publishTime,
          ),
        );
        return true;
      case "RELIABLE_TOPIC_BACKUP":
        this._handleBackup(message);
        return true;
      case "RELIABLE_TOPIC_BACKUP_ACK":
        this._ackBackup(message.requestId);
        return true;
      case "RELIABLE_TOPIC_DESTROY":
        this._destroyLocal(message.topicName);
        return true;
      default:
        return false;
    }
  }

  publish<T>(name: string, message: T): Promise<void> {
    return this.publishAsync(name, message);
  }

  async publishAsync<T>(name: string, message: T): Promise<void> {
    if (message === null || message === undefined) {
      throw new Error("NullPointerException: message is null");
    }
    this._assertUsable(name);

    if (!this._isDistributed()) {
      await this._publishAsOwner(name, message, this._instanceName, null);
      return;
    }

    const ownerId = this._resolveOwnerId(name);
    if (ownerId === this._instanceName) {
      await this._publishAsOwner(name, message, this._instanceName, null);
      return;
    }

    const requestId = crypto.randomUUID();
    const pending = new Promise<void>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this._pendingPublishes.delete(requestId);
        reject(new Error(`Reliable topic publish timed out for '${name}'`));
      }, 30_000);
      this._pendingPublishes.set(requestId, { resolve, reject, timeoutHandle });
    });

    this._transport!.send(ownerId, {
      type: "RELIABLE_TOPIC_PUBLISH_REQUEST",
      requestId,
      topicName: name,
      data: this._toWireData(message),
      sourceNodeId: this._instanceName,
    });

    await pending;
  }

  addMessageListener<T>(name: string, listener: MessageListener<T>): string {
    this._assertUsable(name);
    const runtime = this._getOrCreateRuntime<T>(name);
    const id = `rt-listener-${++runtime.listenerCounter}`;
    runtime.listeners.set(id, listener as MessageListener<unknown>);
    return id;
  }

  removeMessageListener(name: string, registrationId: string): boolean {
    const runtime = this._topics.get(name);
    if (runtime === undefined) return false;
    return runtime.listeners.delete(registrationId);
  }

  getLocalTopicStats(name: string): LocalTopicStats {
    return this._getOrCreateRuntime(name).stats;
  }

  isDestroyed(name: string): boolean {
    return this._destroyedTopics.has(name);
  }

  destroy(name: string): void {
    this._destroyLocal(name);
    this._transport?.broadcast({ type: "RELIABLE_TOPIC_DESTROY", topicName: name });
  }

  undestroy(name: string): void {
    this._destroyedTopics.delete(name);
  }

  shutdown(): void {
    for (const timeout of this._pendingPublishes.values()) {
      if (timeout.timeoutHandle !== null) {
        clearTimeout(timeout.timeoutHandle);
      }
      timeout.reject(new Error("ReliableTopicService shut down"));
    }
    this._pendingPublishes.clear();

    for (const pending of this._pendingBackupAcks.values()) {
      if (pending.timeoutHandle !== null) {
        clearTimeout(pending.timeoutHandle);
      }
      pending.reject(new Error("ReliableTopicService shut down"));
    }
    this._pendingBackupAcks.clear();

    for (const name of Array.from(this._topics.keys())) {
      this._destroyLocal(name);
    }
  }

  getRingbufferService(): RingbufferService {
    return this._ringbufferService;
  }

  private async _handlePublishRequest(
    message: Extract<ClusterMessage, { type: "RELIABLE_TOPIC_PUBLISH_REQUEST" }>,
  ): Promise<void> {
    try {
      await this._publishAsOwner(
        message.topicName,
        this._toObject(message.data),
        message.sourceNodeId,
        message.requestId,
      );
    } catch (error) {
      this._transport?.send(message.sourceNodeId, {
        type: "RELIABLE_TOPIC_PUBLISH_ACK",
        requestId: message.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async _publishAsOwner<T>(
    name: string,
    message: T,
    sourceNodeId: string,
    requestId: string | null,
  ): Promise<void> {
    const append = await this._appendLocally(name, message, sourceNodeId);
    if (!append.stored) {
      this._ackPublish(sourceNodeId, requestId);
      return;
    }

    await this._replicateToBackups(name, append.sequence, append.record);
    this._broadcastMessage(name, append.sequence, append.record);
    this._ackPublish(sourceNodeId, requestId);
  }

  private async _appendLocally<T>(
    name: string,
    message: T,
    publisherAddress: string | null,
  ): Promise<{ stored: false } | { stored: true; sequence: number; record: ReliableTopicMessageRecord }> {
    const runtime = this._getOrCreateRuntime(name);
    this._assertUsable(name);

    const container = runtime.container;
    const overloadPolicy = runtime.config.getTopicOverloadPolicy();
    const record = new ReliableTopicMessageRecord(message, publisherAddress);

    switch (overloadPolicy) {
      case TopicOverloadPolicy.ERROR:
        if (this._isFull(container)) {
          throw new TopicOverloadException(
            `Topic overload: failed to publish on topic '${name}', ringbuffer is full (capacity=${container.getCapacity()})`,
          );
        }
        break;
      case TopicOverloadPolicy.DISCARD_NEWEST:
        if (this._isFull(container)) {
          return { stored: false };
        }
        break;
      case TopicOverloadPolicy.BLOCK:
        await this._waitForCapacity(name, container);
        this._assertUsable(name);
        break;
      case TopicOverloadPolicy.DISCARD_OLDEST:
        break;
    }

    const sequence = container.add(record);
    if (runtime.config.isStatisticsEnabled()) {
      runtime.stats.incrementPublish(1);
    }
    return { stored: true, sequence, record };
  }

  private async _replicateToBackups(
    name: string,
    sequence: number,
    record: ReliableTopicMessageRecord,
  ): Promise<void> {
    if (!this._isDistributed()) {
      return;
    }

    const runtime = this._getOrCreateRuntime(name);
    const requestedSync = runtime.container.getConfig().getBackupCount();
    const requestedAsync = runtime.container.getConfig().getAsyncBackupCount();
    const requestedTotal = requestedSync + requestedAsync;
    const clusterSize = this._coordinator!.getCluster().getMembers().length;
    const totalBackups = Math.min(requestedTotal, Math.max(0, clusterSize - 1));
    if (totalBackups === 0) {
      return;
    }

    const syncBackups = Math.min(requestedSync, totalBackups);
    const partitionId = this._getPartitionId(name);
    const backupIds = this._coordinator!.getBackupIds(partitionId, totalBackups);
    if (backupIds.length === 0) {
      return;
    }

    let pending: Promise<void> | null = null;
    let requestId: string | null = null;
    if (syncBackups > 0) {
      requestId = crypto.randomUUID();
      pending = new Promise<void>((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          this._pendingBackupAcks.delete(requestId!);
          reject(new Error(`Reliable topic backup ack timed out for '${name}'`));
        }, 30_000);
        this._pendingBackupAcks.set(requestId!, {
          expected: syncBackups,
          received: 0,
          resolve,
          reject,
          timeoutHandle,
        });
      });
    }

    const payload = this._toWireData(record.payload);
    backupIds.forEach((backupId, index) => {
      this._transport!.send(backupId, {
        type: "RELIABLE_TOPIC_BACKUP",
        requestId: index < syncBackups ? requestId : null,
        topicName: name,
        sequence,
        publishTime: record.publishTime,
        publisherAddress: record.publisherAddress,
        data: payload,
        sourceNodeId: this._instanceName,
      });
    });

    if (pending !== null) {
      await pending;
    }
  }

  private _handleBackup(
    message: Extract<ClusterMessage, { type: "RELIABLE_TOPIC_BACKUP" }>,
  ): void {
    const runtime = this._getOrCreateRuntime(message.topicName);
    const record = new ReliableTopicMessageRecord(
      this._toObject(message.data),
      message.publisherAddress,
      message.publishTime,
    );
    runtime.container.set(message.sequence, record);
    if (message.requestId !== null) {
      this._transport?.send(message.sourceNodeId, {
        type: "RELIABLE_TOPIC_BACKUP_ACK",
        requestId: message.requestId,
      });
    }
  }

  private _broadcastMessage(
    name: string,
    sequence: number,
    record: ReliableTopicMessageRecord,
  ): void {
    this._deliverLocalMessage(name, sequence, record);
    this._transport?.broadcast({
      type: "RELIABLE_TOPIC_MESSAGE",
      topicName: name,
      sequence,
      publishTime: record.publishTime,
      publisherAddress: record.publisherAddress,
      data: this._toWireData(record.payload),
    });
  }

  private _deliverLocalMessage(
    name: string,
    _sequence: number,
    record: ReliableTopicMessageRecord,
  ): void {
    const runtime = this._topics.get(name);
    if (runtime === undefined) {
      return;
    }
    const event = new Message(
      name,
      record.payload,
      record.publishTime,
      record.publisherAddress,
    );
    for (const listener of Array.from(runtime.listeners.values())) {
      try {
        listener(event);
      } catch {
        // Listener exception isolation.
      }
      if (runtime.config.isStatisticsEnabled()) {
        runtime.stats.incrementReceive(1);
      }
    }
  }

  private _destroyLocal(name: string): void {
    const runtime = this._topics.get(name);
    if (runtime !== undefined) {
      runtime.listeners.clear();
      runtime.container.clear();
    }
    this._topics.delete(name);
    this._destroyedTopics.add(name);
  }

  private _resolvePublishAck(requestId: string, error?: string): void {
    const pending = this._pendingPublishes.get(requestId);
    if (pending === undefined) {
      return;
    }
    this._pendingPublishes.delete(requestId);
    if (pending.timeoutHandle !== null) {
      clearTimeout(pending.timeoutHandle);
    }
    if (error !== undefined) {
      pending.reject(new Error(error));
      return;
    }
    pending.resolve();
  }

  private _ackBackup(requestId: string): void {
    const pending = this._pendingBackupAcks.get(requestId);
    if (pending === undefined) {
      return;
    }
    pending.received++;
    if (pending.received < pending.expected) {
      return;
    }
    this._pendingBackupAcks.delete(requestId);
    if (pending.timeoutHandle !== null) {
      clearTimeout(pending.timeoutHandle);
    }
    pending.resolve();
  }

  private _ackPublish(targetNodeId: string, requestId: string | null): void {
    if (requestId === null) {
      return;
    }
    this._transport?.send(targetNodeId, {
      type: "RELIABLE_TOPIC_PUBLISH_ACK",
      requestId,
    });
  }

  private _assertUsable(name: string): void {
    if (this._destroyedTopics.has(name)) {
      throw new Error(`Topic '${name}' has been destroyed`);
    }
  }

  private _getPartitionId(name: string): number {
    return this._ringbufferService.getRingbufferPartitionId(TOPIC_RB_PREFIX + name);
  }

  private _resolveOwnerId(name: string): string {
    return this._coordinator?.getOwnerId(this._getPartitionId(name)) ?? this._instanceName;
  }

  private _isDistributed(): boolean {
    return this._transport !== null && this._transport !== undefined && this._coordinator !== null && this._coordinator !== undefined;
  }

  private _isFull(
    container: RingbufferContainer<ReliableTopicMessageRecord, ReliableTopicMessageRecord>,
  ): boolean {
    return container.size() >= container.getCapacity();
  }

  private async _waitForCapacity(
    name: string,
    container: RingbufferContainer<ReliableTopicMessageRecord, ReliableTopicMessageRecord>,
  ): Promise<void> {
    while (this._isFull(container)) {
      this._assertUsable(name);
      container.cleanup();
      if (!this._isFull(container)) {
        return;
      }
      await Bun.sleep(10);
    }
  }

  private _toWireData(value: unknown) {
    if (this._serializationService === undefined) {
      throw new Error("ReliableTopicService requires a SerializationService for distributed messaging");
    }
    const data = this._serializationService.toData(value);
    if (data === null) {
      throw new Error("NullPointerException: message is null");
    }
    return encodeData(data);
  }

  private _toObject(value: ReturnType<typeof encodeData>): unknown {
    if (this._serializationService === undefined) {
      throw new Error("ReliableTopicService requires a SerializationService for distributed messaging");
    }
    return this._serializationService.toObject(decodeData(value));
  }

  private _getOrCreateRuntime<T = unknown>(name: string): TopicRuntime<T> {
    let runtime = this._topics.get(name);
    if (runtime === undefined) {
      const rtConfig = this._config.getReliableTopicConfig(name);
      const rbName = TOPIC_RB_PREFIX + name;
      const rbConfig = this._config.getRingbufferConfig(rbName);
      const partitionId = this._ringbufferService.getRingbufferPartitionId(rbName);
      const ns = RingbufferService.getRingbufferNamespace(rbName);
      const container = this._ringbufferService.getOrCreateContainer(partitionId, ns, rbConfig) as RingbufferContainer<ReliableTopicMessageRecord, ReliableTopicMessageRecord>;

      runtime = {
        container,
        listeners: new Map(),
        stats: new LocalTopicStatsImpl(),
        listenerCounter: 0,
        config: rtConfig,
      };
      this._topics.set(name, runtime);
    }
    return runtime as TopicRuntime<T>;
  }
}

export class TopicOverloadException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TopicOverloadException";
  }
}
