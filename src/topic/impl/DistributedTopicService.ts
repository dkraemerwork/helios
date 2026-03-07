import type {
  ClusterMessage,
  TopicAckMsg,
  TopicMessageMsg,
} from "@zenystx/helios-core/cluster/tcp/ClusterMessage";
import { decodeData, encodeData } from "@zenystx/helios-core/cluster/tcp/DataWireCodec";
import { TcpClusterTransport } from "@zenystx/helios-core/cluster/tcp/TcpClusterTransport";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import { TopicConfig } from "@zenystx/helios-core/config/TopicConfig";
import type { HeliosClusterCoordinator } from "@zenystx/helios-core/instance/impl/HeliosClusterCoordinator";
import type { Data } from "@zenystx/helios-core/internal/serialization/Data";
import type { SerializationService } from "@zenystx/helios-core/internal/serialization/SerializationService";
import {
  LocalTopicStatsImpl,
  type LocalTopicStats,
} from "@zenystx/helios-core/topic/LocalTopicStats";
import { Message } from "@zenystx/helios-core/topic/Message";
import type { MessageListener } from "@zenystx/helios-core/topic/MessageListener";

interface TopicRuntime<T = unknown> {
  listeners: Map<string, MessageListener<T>>;
  stats: LocalTopicStatsImpl;
  listenerCounter: number;
  nextSequence: number;
}

interface PendingPublish {
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

export class DistributedTopicService {
  private readonly _topics = new Map<string, TopicRuntime>();
  private readonly _pendingPublishes = new Map<string, PendingPublish>();
  private readonly _destroyedTopics = new Set<string>();

  constructor(
    private readonly _instanceName: string,
    private readonly _config: HeliosConfig,
    private readonly _serializationService: SerializationService,
    private readonly _transport: TcpClusterTransport | null,
    private readonly _coordinator: HeliosClusterCoordinator | null,
  ) {}

  handleMessage(message: ClusterMessage): boolean {
    switch (message.type) {
      case "TOPIC_PUBLISH_REQUEST":
        this._handlePublishRequest(message);
        return true;
      case "TOPIC_MESSAGE":
        this._deliverMessage(message);
        return true;
      case "TOPIC_ACK":
        this._resolveAck(message);
        return true;
      default:
        return false;
    }
  }

  publish(name: string, data: Data): Promise<void> {
    this._recordPublish(name);

    if (this._transport === null || this._coordinator === null) {
      this._fanout(name, data, this._instanceName, Date.now(), null);
      return Promise.resolve();
    }

    if (!this._usesGlobalOrdering(name)) {
      this._fanout(name, data, this._instanceName, Date.now(), null);
      return Promise.resolve();
    }

    const ownerId = this._resolveOwnerId(name);
    const requestId = crypto.randomUUID();
    const publishTime = Date.now();

    if (ownerId === this._instanceName) {
      this._publishAsOwner(
        name,
        data,
        publishTime,
        this._instanceName,
        requestId,
      );
      return Promise.resolve();
    }

    const pending = new Promise<void>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this._pendingPublishes.delete(requestId);
        reject(new Error(`Topic publish timed out for '${name}'`));
      }, 30_000);
      this._pendingPublishes.set(requestId, { resolve, reject, timeoutHandle });
    });

    this._transport.send(ownerId, {
      type: "TOPIC_PUBLISH_REQUEST",
      requestId,
      topicName: name,
      data: encodeData(data),
      publishTime,
      sourceNodeId: this._instanceName,
    });

    return pending;
  }

  addMessageListener<T>(name: string, listener: MessageListener<T>): string {
    const runtime = this._getOrCreateRuntime<T>(name);
    const id = `listener-${++runtime.listenerCounter}`;
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
    const runtime = this._topics.get(name);
    if (runtime !== undefined) {
      runtime.listeners.clear();
    }
    this._topics.delete(name);
    this._destroyedTopics.add(name);
  }

  /** Allow re-creation after destroy (for getTopic() returning fresh instance). */
  undestroy(name: string): void {
    this._destroyedTopics.delete(name);
  }

  private _handlePublishRequest(
    message: Extract<ClusterMessage, { type: "TOPIC_PUBLISH_REQUEST" }>,
  ): void {
    this._publishAsOwner(
      message.topicName,
      decodeData(message.data),
      message.publishTime,
      message.sourceNodeId,
      message.requestId,
    );
  }

  private _publishAsOwner(
    name: string,
    data: Data,
    publishTime: number,
    sourceNodeId: string,
    requestId: string,
  ): void {
    this._fanout(
      name,
      data,
      sourceNodeId,
      publishTime,
      this._nextSequence(name),
    );
    if (sourceNodeId === this._instanceName) {
      this._resolveAck({ type: "TOPIC_ACK", requestId });
      return;
    }
    this._transport?.send(sourceNodeId, { type: "TOPIC_ACK", requestId });
  }

  private _fanout(
    name: string,
    data: Data,
    sourceNodeId: string,
    publishTime: number,
    sequence: number | null,
  ): void {
    const message: TopicMessageMsg = {
      type: "TOPIC_MESSAGE",
      topicName: name,
      data: encodeData(data),
      publishTime,
      sourceNodeId,
      sequence,
    };
    this._deliverMessage(message);
    this._transport?.broadcast(message);
  }

  private _deliverMessage(message: TopicMessageMsg): void {
    const runtime = this._getOrCreateRuntime(message.topicName);
    const payload = this._serializationService.toObject<unknown>(
      decodeData(message.data),
    ) as unknown;
    const event = new Message(
      message.topicName,
      payload,
      message.publishTime,
      message.sourceNodeId,
    );
    for (const listener of Array.from(runtime.listeners.values())) {
      try {
        listener(event);
      } catch {
        // Listener exception isolation: continue to next listener
      }
      this._recordReceive(message.topicName);
    }
  }

  private _resolveAck(message: TopicAckMsg): void {
    const pending = this._pendingPublishes.get(message.requestId);
    if (pending === undefined) {
      return;
    }
    this._pendingPublishes.delete(message.requestId);
    if (pending.timeoutHandle !== null) {
      clearTimeout(pending.timeoutHandle);
    }
    if (message.error !== undefined) {
      pending.reject(new Error(message.error));
      return;
    }
    pending.resolve();
  }

  private _resolveOwnerId(name: string): string {
    return (
      this._coordinator?.getOwnerId(this._coordinator.getPartitionId(name)) ??
      this._instanceName
    );
  }

  private _usesGlobalOrdering(name: string): boolean {
    return this._getTopicConfig(name).isGlobalOrderingEnabled();
  }

  private _nextSequence(name: string): number {
    return this._getOrCreateRuntime(name).nextSequence++;
  }

  private _recordPublish(name: string): void {
    if (!this._getTopicConfig(name).isStatisticsEnabled()) {
      return;
    }
    this._getOrCreateRuntime(name).stats.incrementPublish(1);
  }

  private _recordReceive(name: string): void {
    if (!this._getTopicConfig(name).isStatisticsEnabled()) {
      return;
    }
    this._getOrCreateRuntime(name).stats.incrementReceive(1);
  }

  private _getTopicConfig(name: string): TopicConfig {
    return this._config.getTopicConfig(name);
  }

  private _getOrCreateRuntime<T = unknown>(name: string): TopicRuntime<T> {
    let runtime = this._topics.get(name);
    if (runtime === undefined) {
      runtime = {
        listeners: new Map<string, MessageListener<unknown>>(),
        stats: new LocalTopicStatsImpl(),
        listenerCounter: 0,
        nextSequence: 0,
      };
      this._topics.set(name, runtime);
    }
    return runtime as TopicRuntime<T>;
  }
}
