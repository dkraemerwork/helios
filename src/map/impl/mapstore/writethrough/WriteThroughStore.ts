import type { MapDataStore } from '../MapDataStore.js';
import type { MapStoreWrapper } from '../MapStoreWrapper.js';

export class WriteThroughStore<K, V> implements MapDataStore<K, V> {
  constructor(private readonly _wrapper: MapStoreWrapper<K, V>) {}

  async add(key: K, value: V, _now: number): Promise<void> {
    await this._wrapper.store(key, value);
  }

  async remove(key: K, _now: number): Promise<void> {
    await this._wrapper.delete(key);
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
    const keys = await this._wrapper.loadAllKeys();
    if (keys.length > 0) {
      await this._wrapper.deleteAll(keys);
    }
  }

  isWithStore(): boolean {
    return true;
  }

  hasPendingWrites(): boolean {
    return false;
  }
}
