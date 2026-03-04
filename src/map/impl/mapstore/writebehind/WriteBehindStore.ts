import type { MapDataStore } from '../MapDataStore.js';
import type { MapStoreWrapper } from '../MapStoreWrapper.js';
import type { WriteBehindQueue } from './WriteBehindQueue.js';
import type { WriteBehindProcessor } from './WriteBehindProcessor.js';
import { StoreWorker } from './StoreWorker.js';
import { addedEntry, deletedEntry, DelayedEntryType } from './DelayedEntry.js';
import type { DelayedEntry } from './DelayedEntry.js';

/**
 * Write-behind map data store implementation.
 *
 * Features a staging area for read-your-writes consistency:
 * when a key has a pending write-behind entry, load() returns the
 * staged value instead of querying the external MapStore, preventing
 * stale reads.
 *
 * Mirrors Hazelcast's WriteBehindStore.java.
 */
export class WriteBehindStore<K, V> implements MapDataStore<K, V> {
  private readonly _worker: StoreWorker<K, V>;
  /**
   * Read-your-writes staging area. Maps JSON.stringify(key) → most recent DelayedEntry.
   * Checked by load()/loadAll() before falling through to the external MapStore.
   * Prevents stale reads for keys with pending write-behind operations.
   */
  private readonly _stagingArea = new Map<string, DelayedEntry<K, V>>();

  constructor(
    private readonly _wrapper: MapStoreWrapper<K, V>,
    private readonly _queue: WriteBehindQueue<K, V>,
    private readonly _processor: WriteBehindProcessor<K, V>,
    private readonly _writeDelayMs: number,
  ) {
    this._worker = new StoreWorker(_queue, _processor);
    this._worker.start();
  }

  async add(key: K, value: V, now: number): Promise<void> {
    const entry = addedEntry(key, value, now + this._writeDelayMs);
    this._queue.offer(entry);
    this._stagingArea.set(JSON.stringify(key), entry);
  }

  async remove(key: K, now: number): Promise<void> {
    const entry = deletedEntry<K, V>(key, now + this._writeDelayMs);
    this._queue.offer(entry);
    this._stagingArea.set(JSON.stringify(key), entry);
  }

  async load(key: K): Promise<V | null> {
    const staged = this._stagingArea.get(JSON.stringify(key));
    if (staged !== undefined) {
      // DELETE entry in staging → key was deleted, don't hit store
      if (staged.type === DelayedEntryType.DELETE) {
        return null;
      }
      // ADD entry in staging → return staged value
      return staged.value;
    }
    return this._wrapper.load(key);
  }

  async loadAll(keys: K[]): Promise<Map<K, V>> {
    const result = new Map<K, V>();
    const keysToLoad: K[] = [];

    for (const key of keys) {
      const staged = this._stagingArea.get(JSON.stringify(key));
      if (staged !== undefined) {
        if (staged.type === DelayedEntryType.ADD && staged.value !== null) {
          result.set(key, staged.value as V);
        }
        // DELETE entries are intentionally excluded — key was deleted
      } else {
        keysToLoad.push(key);
      }
    }

    if (keysToLoad.length > 0) {
      const loaded = await this._wrapper.loadAll(keysToLoad);
      for (const [k, v] of loaded) {
        result.set(k, v);
      }
    }

    return result;
  }

  async flush(): Promise<void> {
    await this._worker.flush();
    this._stagingArea.clear();
  }

  async clear(): Promise<void> {
    this._worker.stop();
    const pending = this._queue.drainAll();
    if (pending.length > 0) {
      await this._processor.process(pending);
    }
    const keys = await this._wrapper.loadAllKeys();
    if (keys.length > 0) {
      await this._wrapper.deleteAll(keys);
    }
    this._queue.clear();
    this._stagingArea.clear();
    this._worker.start();
  }

  isWithStore(): boolean {
    return true;
  }

  hasPendingWrites(): boolean {
    return !this._queue.isEmpty();
  }

  destroy(): void {
    this._worker.stop();
    this._stagingArea.clear();
  }
}
