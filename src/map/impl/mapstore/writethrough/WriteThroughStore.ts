import type { MapDataStore } from '../MapDataStore.js';
import type { MapStoreWrapper } from '../MapStoreWrapper.js';

export class WriteThroughStore<K, V> implements MapDataStore<K, V> {
  private readonly _writeBatchSize: number;

  constructor(
    private readonly _wrapper: MapStoreWrapper<K, V>,
    writeBatchSize: number = 0,
  ) {
    this._writeBatchSize = writeBatchSize > 0 ? writeBatchSize : 0;
  }

  async add(key: K, value: V, _now: number): Promise<void> {
    await this._wrapper.store(key, value);
  }

  async addAll(entries: Map<K, V>): Promise<void> {
    if (entries.size === 0) return;
    if (this._writeBatchSize <= 0 || entries.size <= this._writeBatchSize) {
      await this._wrapper.storeAll(entries);
      return;
    }
    const items = Array.from(entries);
    for (let i = 0; i < items.length; i += this._writeBatchSize) {
      const chunk = new Map(items.slice(i, i + this._writeBatchSize));
      await this._wrapper.storeAll(chunk);
    }
  }

  async remove(key: K, _now: number): Promise<void> {
    await this._wrapper.delete(key);
  }

  async addBackup(_key: K, _value: V, _now: number): Promise<void> {
    // Backup: no external write — shadow-state only
  }

  async removeBackup(_key: K, _now: number): Promise<void> {
    // Backup: no external delete — shadow-state only
  }

  async load(key: K): Promise<V | null> {
    return this._wrapper.load(key);
  }

  async loadAll(keys: K[]): Promise<Map<K, V>> {
    return this._wrapper.loadAll(keys);
  }

  async flush(): Promise<void> {
    // no-op for write-through
  }

  async clear(): Promise<void> {
    const stream = await this._wrapper.loadAllKeys();
    const keys: K[] = [];
    try {
      for await (const k of stream) keys.push(k);
    } finally {
      await stream.close();
    }
    if (keys.length === 0) return;
    if (this._writeBatchSize <= 0 || keys.length <= this._writeBatchSize) {
      await this._wrapper.deleteAll(keys);
      return;
    }
    for (let i = 0; i < keys.length; i += this._writeBatchSize) {
      await this._wrapper.deleteAll(keys.slice(i, i + this._writeBatchSize));
    }
  }

  isWithStore(): boolean {
    return true;
  }

  hasPendingWrites(): boolean {
    return false;
  }
}
