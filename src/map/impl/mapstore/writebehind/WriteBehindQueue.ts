import type { DelayedEntry } from './DelayedEntry.js';

export interface WriteBehindQueue<K, V> {
  offer(entry: DelayedEntry<K, V>): void;
  /** Returns entries where storeTime <= now, removing them from the queue. */
  drainTo(now: number): DelayedEntry<K, V>[];
  /** Returns and removes ALL entries (for flush/shutdown). */
  drainAll(): DelayedEntry<K, V>[];
  size(): number;
  isEmpty(): boolean;
  clear(): void;
}
