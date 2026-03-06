import type { MapKeyStream } from './MapKeyStream.js';

export interface MapLoader<K, V> {
  load(key: K): Promise<V | null>;
  loadAll(keys: K[]): Promise<Map<K, V>>;
  loadAllKeys(): Promise<MapKeyStream<K>>;
}
