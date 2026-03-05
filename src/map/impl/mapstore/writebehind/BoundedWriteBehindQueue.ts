import type { WriteBehindQueue } from './WriteBehindQueue.js';
import type { DelayedEntry } from './DelayedEntry.js';
import { ReachedMaxSizeException } from './ReachedMaxSizeException.js';

/**
 * Wraps a WriteBehindQueue with a capacity limit.
 * Used for non-coalescing mode to prevent unbounded memory growth.
 * Mirrors Hazelcast's BoundedWriteBehindQueue.
 */
export class BoundedWriteBehindQueue<K, V> implements WriteBehindQueue<K, V> {
  private _usedCapacity = 0;

  constructor(
    private readonly _delegate: WriteBehindQueue<K, V>,
    private readonly _maxCapacity: number,
  ) {}

  offer(entry: DelayedEntry<K, V>): void {
    this._checkCapacity(1);
    this._delegate.offer(entry);
    this._usedCapacity++;
  }

  addFirst(entries: DelayedEntry<K, V>[]): void {
    if (entries.length === 0) return;
    // Re-queued failures bypass capacity check (matching Hazelcast's TODO comment:
    // "what if capacity is exceeded during addFirst" — they allow it)
    this._delegate.addFirst(entries);
    this._usedCapacity += entries.length;
  }

  addForcibly(entry: DelayedEntry<K, V>): void {
    // Forcible adds bypass capacity checks (for partition replication)
    this._delegate.addForcibly(entry);
    this._usedCapacity++;
  }

  drainTo(now: number): DelayedEntry<K, V>[] {
    const drained = this._delegate.drainTo(now);
    this._usedCapacity -= drained.length;
    return drained;
  }

  drainAll(): DelayedEntry<K, V>[] {
    const all = this._delegate.drainAll();
    this._usedCapacity = 0;
    return all;
  }

  size(): number {
    return this._delegate.size();
  }

  isEmpty(): boolean {
    return this._delegate.isEmpty();
  }

  clear(): void {
    this._delegate.clear();
    this._usedCapacity = 0;
  }

  get maxCapacity(): number {
    return this._maxCapacity;
  }

  get usedCapacity(): number {
    return this._usedCapacity;
  }

  asList(): DelayedEntry<K, V>[] {
    return this._delegate.asList();
  }

  private _checkCapacity(count: number): void {
    if (this._usedCapacity + count > this._maxCapacity) {
      throw new ReachedMaxSizeException(
        `Write-behind queue capacity exceeded: ${this._usedCapacity + count} > ${this._maxCapacity}`
      );
    }
  }
}
