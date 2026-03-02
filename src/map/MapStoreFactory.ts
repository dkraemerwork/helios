import type { MapLoader } from './MapLoader.js';
import type { MapStore } from './MapStore.js';

export interface MapStoreFactory<K, V> {
  newMapStore(
    mapName: string,
    properties: Map<string, string>,
  ): MapStore<K, V> | MapLoader<K, V> | Promise<MapStore<K, V> | MapLoader<K, V>>;
}
