import type { DelayedEntry } from './DelayedEntry.js';

export interface WriteBehindQueue<K, V> {
  offer(entry: DelayedEntry<K, V>): void;
  /** Add entries to the FRONT of the queue (for re-queuing failed entries). */
  addFirst(entries: DelayedEntry<K, V>[]): void;
  /** Forcibly add an entry, bypassing capacity checks (for partition replication). */
  addForcibly(entry: DelayedEntry<K, V>): void;
  /** Returns entries where storeTime <= now, removing them from the queue. */
  drainTo(now: number): DelayedEntry<K, V>[];
  /** Returns and removes ALL entries (for flush/shutdown). */
  drainAll(): DelayedEntry<K, V>[];
  size(): number;
  isEmpty(): boolean;
  clear(): void;
  /** Returns a snapshot copy of all entries (for replication capture). */
  asList(): DelayedEntry<K, V>[];
}
