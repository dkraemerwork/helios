/**
 * Service managing reliable topic runtime state.
 * Each reliable topic is backed by a ringbuffer named `_hz_rb_<topicName>`.
 *
 * Port of com.hazelcast.topic.impl.reliable.ReliableTopicService.
 */
import { ArrayRingbuffer } from "@zenystx/helios-core/ringbuffer/impl/ArrayRingbuffer";
import { ReliableTopicMessageRecord } from "@zenystx/helios-core/topic/impl/reliable/ReliableTopicMessageRecord";
import { ReliableTopicListenerRunner } from "@zenystx/helios-core/topic/impl/reliable/ReliableTopicListenerRunner";
import {
  LocalTopicStatsImpl,
  type LocalTopicStats,
} from "@zenystx/helios-core/topic/LocalTopicStats";
import type { MessageListener } from "@zenystx/helios-core/topic/MessageListener";
import type { ReliableTopicConfig } from "@zenystx/helios-core/config/ReliableTopicConfig";
import { TopicOverloadPolicy } from "@zenystx/helios-core/config/ReliableTopicConfig";
import type { RingbufferConfig } from "@zenystx/helios-core/config/RingbufferConfig";
import type { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";

export const TOPIC_RB_PREFIX = "_hz_rb_";

interface TopicRuntime<T = unknown> {
  ringbuffer: ArrayRingbuffer<ReliableTopicMessageRecord>;
  runners: Map<string, ReliableTopicListenerRunner<T>>;
  stats: LocalTopicStatsImpl;
  runnerCounter: number;
  config: ReliableTopicConfig;
  destroyed: boolean;
}

export class ReliableTopicService {
  private readonly _topics = new Map<string, TopicRuntime>();
  private readonly _config: HeliosConfig;
  private readonly _instanceName: string;

  constructor(instanceName: string, config: HeliosConfig) {
    this._instanceName = instanceName;
    this._config = config;
  }

  publish<T>(name: string, message: T): void {
    if (message === null || message === undefined) {
      throw new Error("NullPointerException: message is null");
    }
    const runtime = this._getOrCreateRuntime(name);
    if (runtime.destroyed) {
      throw new Error(`Topic '${name}' has been destroyed`);
    }

    const record = new ReliableTopicMessageRecord(message, this._instanceName);
    const rb = runtime.ringbuffer;
    const overloadPolicy = runtime.config.getTopicOverloadPolicy();

    switch (overloadPolicy) {
      case TopicOverloadPolicy.ERROR: {
        if (rb.size() >= rb.getCapacity()) {
          throw new TopicOverloadException(
            `Topic overload: failed to publish on topic '${name}', ringbuffer is full (capacity=${rb.getCapacity()})`,
          );
        }
        rb.add(record);
        break;
      }
      case TopicOverloadPolicy.DISCARD_OLDEST: {
        rb.add(record); // ArrayRingbuffer naturally overwrites oldest
        break;
      }
      case TopicOverloadPolicy.DISCARD_NEWEST: {
        if (rb.size() >= rb.getCapacity()) {
          // Silently drop the message
          return;
        }
        rb.add(record);
        break;
      }
      case TopicOverloadPolicy.BLOCK: {
        // In single-node Bun context, blocking with backoff is not practical
        // for a single-threaded runtime. Default to overwrite behavior.
        rb.add(record);
        break;
      }
    }

    if (runtime.config.isStatisticsEnabled()) {
      runtime.stats.incrementPublish(1);
    }
  }

  async publishAsync<T>(name: string, message: T): Promise<void> {
    this.publish(name, message);
  }

  addMessageListener<T>(name: string, listener: MessageListener<T>): string {
    const runtime = this._getOrCreateRuntime<T>(name);
    const id = `rt-listener-${++runtime.runnerCounter}`;

    // Plain MessageListener adaptation: start from tail + 1 (don't replay history)
    const initialSequence = runtime.ringbuffer.tailSequence() + 1;
    const batchSize = runtime.config.getReadBatchSize();

    const runner = new ReliableTopicListenerRunner<T>(
      name,
      listener,
      runtime.ringbuffer,
      initialSequence,
      batchSize,
      () => this.recordReceive(name),
    );
    runtime.runners.set(id, runner as ReliableTopicListenerRunner<unknown>);
    runner.start();

    return id;
  }

  removeMessageListener(name: string, registrationId: string): boolean {
    const runtime = this._topics.get(name);
    if (runtime === undefined) return false;
    const runner = runtime.runners.get(registrationId);
    if (runner === undefined) return false;
    runner.cancel();
    runtime.runners.delete(registrationId);
    return true;
  }

  getLocalTopicStats(name: string): LocalTopicStats {
    return this._getOrCreateRuntime(name).stats;
  }

  destroy(name: string): void {
    const runtime = this._topics.get(name);
    if (runtime === undefined) return;
    runtime.destroyed = true;
    for (const runner of runtime.runners.values()) {
      runner.cancel();
    }
    runtime.runners.clear();
    this._topics.delete(name);
  }

  shutdown(): void {
    for (const [name] of this._topics) {
      this.destroy(name);
    }
  }

  recordReceive(name: string): void {
    const runtime = this._topics.get(name);
    if (runtime !== undefined && runtime.config.isStatisticsEnabled()) {
      runtime.stats.incrementReceive(1);
    }
  }

  private _getOrCreateRuntime<T = unknown>(name: string): TopicRuntime<T> {
    let runtime = this._topics.get(name);
    if (runtime === undefined) {
      const rtConfig = this._config.getReliableTopicConfig(name);
      const rbName = TOPIC_RB_PREFIX + name;
      const rbConfig = this._config.getRingbufferConfig(rbName);
      const capacity = rbConfig.getCapacity();

      runtime = {
        ringbuffer: new ArrayRingbuffer<ReliableTopicMessageRecord>(capacity),
        runners: new Map(),
        stats: new LocalTopicStatsImpl(),
        runnerCounter: 0,
        config: rtConfig,
        destroyed: false,
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
