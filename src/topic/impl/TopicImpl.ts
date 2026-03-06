import type { ITopic } from "../ITopic";
import type { MessageListener } from "../MessageListener";
import type { LocalTopicStats } from "../LocalTopicStats";
import { LocalTopicStatsImpl } from "../LocalTopicStats";
import { Message } from "../Message";

/**
 * In-memory single-node ITopic implementation.
 * Port of com.hazelcast.topic.impl.TopicProxy (single-node subset).
 */
export class TopicImpl<T> implements ITopic<T> {
  private readonly listeners = new Map<string, MessageListener<T>>();
  private readonly stats = new LocalTopicStatsImpl();
  private listenerCounter = 0;

  constructor(private readonly name: string) {}

  getName(): string {
    return this.name;
  }

  publish(message: T): void {
    if (message === null || message === undefined) {
      throw new Error("NullPointerException: message is null");
    }
    this.stats.incrementPublish(1);
    this._deliver(message, Date.now());
  }

  deliverRemote(
    message: T,
    publishTime: number,
    publishingMemberId: string | null,
  ): void {
    if (message === null || message === undefined) {
      throw new Error("NullPointerException: message is null");
    }
    this._deliver(message, publishTime, publishingMemberId);
  }

  private _deliver(
    message: T,
    publishTime: number,
    publishingMemberId: string | null = null,
  ): void {
    const msg = new Message<T>(
      this.name,
      message,
      publishTime,
      publishingMemberId,
    );
    for (const listener of Array.from(this.listeners.values())) {
      listener(msg);
      this.stats.incrementReceive(1);
    }
  }

  publishAsync(message: T): Promise<void> {
    return Promise.resolve().then(() => this.publish(message));
  }

  publishAll(messages: Iterable<T | null>): void {
    for (const message of Array.from(messages)) {
      if (message === null || message === undefined) {
        throw new Error("NullPointerException: message in collection is null");
      }
      this.publish(message);
    }
  }

  publishAllAsync(messages: Iterable<T | null>): Promise<void> {
    return Promise.resolve().then(() => this.publishAll(messages));
  }

  addMessageListener(listener: MessageListener<T>): string {
    const id = `listener-${++this.listenerCounter}`;
    this.listeners.set(id, listener);
    return id;
  }

  removeMessageListener(registrationId: string): boolean {
    return this.listeners.delete(registrationId);
  }

  getLocalTopicStats(): LocalTopicStats {
    return this.stats;
  }

  destroy(): void {
    this.listeners.clear();
  }
}
