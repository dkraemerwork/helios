import type { MessageListener } from "./MessageListener";
import type { LocalTopicStats } from "./LocalTopicStats";
import type { MaybePromise } from "@zenystx/core/util/MaybePromise";

/**
 * Distributed topic interface.
 * Port of com.hazelcast.topic.ITopic.
 */
export interface ITopic<T> {
  /** Returns the name of this topic. */
  getName(): string;

  /** Publishes a message to all subscribers synchronously. */
  publish(message: T): MaybePromise<void>;

  /** Publishes a message asynchronously. */
  publishAsync(message: T): Promise<void>;

  /** Publishes all messages in the collection synchronously. Throws if any is null. */
  publishAll(messages: Iterable<T | null>): MaybePromise<void>;

  /** Publishes all messages asynchronously. */
  publishAllAsync(messages: Iterable<T | null>): Promise<void>;

  /**
   * Registers a message listener.
   * @returns A registration ID that can be used to remove the listener.
   */
  addMessageListener(listener: MessageListener<T>): string;

  /**
   * Removes a message listener.
   * @returns true if the listener was found and removed.
   */
  removeMessageListener(registrationId: string): boolean;

  /** Returns local topic statistics. */
  getLocalTopicStats(): LocalTopicStats;

  /** Destroys this topic and removes all listeners. */
  destroy(): void;
}
