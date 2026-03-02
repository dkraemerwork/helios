import type { MapDataStore } from './MapDataStore.js';
import type { MapStoreWrapper } from './MapStoreWrapper.js';

export class LoadOnlyMapDataStore<K, V> implements MapDataStore<K, V> {
  constructor(private readonly _wrapper: MapStoreWrapper<K, V>) {}

  async add(_key: K, _value: V, _now: number): Promise<void> {}
  async remove(_key: K, _now: number): Promise<void> {}

  async load(key: K): Promise<V | null> {
    return this._wrapper.load(key);
  }

  async loadAll(keys: K[]): Promise<Map<K, V>> {
    return this._wrapper.loadAll(keys);
  }

  async flush(): Promise<void> {}
  async clear(): Promise<void> {}
  isWithStore(): boolean { return true; }
  hasPendingWrites(): boolean { return false; }
}
