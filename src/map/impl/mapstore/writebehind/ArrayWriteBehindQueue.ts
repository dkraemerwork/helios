import type { DelayedEntry } from './DelayedEntry.js';
import type { WriteBehindQueue } from './WriteBehindQueue.js';

export class ArrayWriteBehindQueue<K, V> implements WriteBehindQueue<K, V> {
  private readonly _queue: DelayedEntry<K, V>[] = [];

  offer(entry: DelayedEntry<K, V>): void {
    this._queue.push(entry);
  }

  addFirst(entries: DelayedEntry<K, V>[]): void {
    if (entries.length === 0) return;
    this._queue.unshift(...entries);
  }

  addForcibly(entry: DelayedEntry<K, V>): void {
    this._queue.push(entry);
  }

  drainTo(now: number): DelayedEntry<K, V>[] {
    const drained: DelayedEntry<K, V>[] = [];
    while (this._queue.length > 0 && this._queue[0].storeTime <= now) {
      drained.push(this._queue.shift()!);
    }
    return drained;
  }

  drainAll(): DelayedEntry<K, V>[] {
    const all = this._queue.slice();
    this._queue.length = 0;
    return all;
  }

  size(): number {
    return this._queue.length;
  }

  isEmpty(): boolean {
    return this._queue.length === 0;
  }

  clear(): void {
    this._queue.length = 0;
  }

  asList(): DelayedEntry<K, V>[] {
    return this._queue.slice();
  }
}
