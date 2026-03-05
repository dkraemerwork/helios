import type { WriteBehindQueue } from './WriteBehindQueue.js';
import type { DelayedEntry } from './DelayedEntry.js';

export class CoalescedWriteBehindQueue<K, V> implements WriteBehindQueue<K, V> {
  // key = JSON.stringify(entry.key), value = DelayedEntry (with original storeTime preserved)
  private readonly _map = new Map<string, DelayedEntry<K, V>>();

  offer(entry: DelayedEntry<K, V>): void {
    const key = JSON.stringify(entry.key);
    const existing = this._map.get(key);
    if (existing) {
      // Coalesce: update value/type but keep the original storeTime (deadline not pushed out)
      this._map.set(key, {
        type: entry.type,
        key: entry.key,
        value: entry.value,
        storeTime: existing.storeTime,  // preserve original deadline
        sequence: entry.sequence,
      });
    } else {
      this._map.set(key, entry);
    }
  }

  addFirst(entries: DelayedEntry<K, V>[]): void {
    for (const entry of entries) {
      const key = JSON.stringify(entry.key);
      // Only re-add if not already present (existing entry is newer, takes precedence)
      if (!this._map.has(key)) {
        this._map.set(key, entry);
      }
    }
  }

  addForcibly(entry: DelayedEntry<K, V>): void {
    const key = JSON.stringify(entry.key);
    this._map.set(key, entry);
  }

  drainTo(now: number): DelayedEntry<K, V>[] {
    const drained: DelayedEntry<K, V>[] = [];
    for (const [k, entry] of this._map) {
      if (entry.storeTime <= now) {
        drained.push(entry);
        this._map.delete(k);
      }
    }
    return drained;
  }

  drainAll(): DelayedEntry<K, V>[] {
    const all = Array.from(this._map.values());
    this._map.clear();
    return all;
  }

  size(): number {
    return this._map.size;
  }

  isEmpty(): boolean {
    return this._map.size === 0;
  }

  clear(): void {
    this._map.clear();
  }

  asList(): DelayedEntry<K, V>[] {
    return Array.from(this._map.values());
  }
}
