import type { MapDataStore } from '../MapDataStore.js';
import type { MapStoreWrapper } from '../MapStoreWrapper.js';
import type { WriteBehindQueue } from './WriteBehindQueue.js';
import type { WriteBehindProcessor } from './WriteBehindProcessor.js';
import { StoreWorker } from './StoreWorker.js';
import { addedEntry, deletedEntry } from './DelayedEntry.js';

export class WriteBehindStore<K, V> implements MapDataStore<K, V> {
  private readonly _worker: StoreWorker<K, V>;

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
    this._queue.offer(addedEntry(key, value, now + this._writeDelayMs));
  }

  async remove(key: K, now: number): Promise<void> {
    this._queue.offer(deletedEntry(key, now + this._writeDelayMs));
  }

  async load(key: K): Promise<V | null> {
    return this._wrapper.load(key);
  }

  async loadAll(keys: K[]): Promise<Map<K, V>> {
    return this._wrapper.loadAll(keys);
  }

  async flush(): Promise<void> {
    await this._worker.flush();
  }

  async clear(): Promise<void> {
    // 1. Stop periodic worker
    this._worker.stop();
    // 2. Flush pending writes
    const pending = this._queue.drainAll();
    if (pending.length > 0) {
      await this._processor.process(pending);
    }
    // 3. Load all external keys and delete them
    const keys = await this._wrapper.loadAllKeys();
    if (keys.length > 0) {
      await this._wrapper.deleteAll(keys);
    }
    // 4. Clear local queue
    this._queue.clear();
    // 5. Restart worker
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
  }
}
