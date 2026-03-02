import type { MapLoader } from './MapLoader.js';

export interface MapStore<K, V> extends MapLoader<K, V> {
  store(key: K, value: V): Promise<void>;
  storeAll(entries: Map<K, V>): Promise<void>;
  delete(key: K): Promise<void>;
  deleteAll(keys: K[]): Promise<void>;
}
