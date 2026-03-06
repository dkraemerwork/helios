import type { ItemListener } from "@helios/collection/ItemListener";
import type { LocalQueueStats } from "@helios/collection/LocalQueueStats";
import type { MaybePromise } from "@helios/util/MaybePromise";

/**
 * Distributed queue interface.
 * TypeScript-native port of Hazelcast IQueue semantics.
 */
export interface IQueue<E> {
  getName(): string;

  offer(element: E): MaybePromise<boolean>;
  offer(element: E, timeoutMs: number): Promise<boolean>;
  put(element: E): Promise<void>;

  poll(): MaybePromise<E | null>;
  poll(timeoutMs: number): Promise<E | null>;
  take(): Promise<E>;

  peek(): MaybePromise<E | null>;
  element(): Promise<E>;

  add(element: E): MaybePromise<boolean>;
  remove(element: E): MaybePromise<boolean>;
  contains(element: E): MaybePromise<boolean>;
  containsAll(elements: E[]): MaybePromise<boolean>;

  size(): MaybePromise<number>;
  isEmpty(): MaybePromise<boolean>;
  remainingCapacity(): Promise<number>;

  addAll(elements: E[]): MaybePromise<boolean>;
  removeAll(elements: E[]): MaybePromise<boolean>;
  retainAll(elements: E[]): MaybePromise<boolean>;
  clear(): MaybePromise<void>;

  toArray(): MaybePromise<E[]>;
  iterator(): MaybePromise<Iterator<E> & { remove(): never }>;

  addItemListener(listener: ItemListener<E>, includeValue?: boolean): string;
  removeItemListener(registrationId: string): boolean;
  getLocalQueueStats(): LocalQueueStats;

  drainTo(collection: E[]): MaybePromise<number>;
  drainTo(collection: E[], maxElements: number): MaybePromise<number>;
}
