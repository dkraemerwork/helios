import type { MapDataStore } from './MapDataStore.js';

export class EmptyMapDataStore<K, V> implements MapDataStore<K, V> {
  private static readonly _instance = new EmptyMapDataStore<unknown, unknown>();

  static empty<K, V>(): MapDataStore<K, V> {
    return EmptyMapDataStore._instance as MapDataStore<K, V>;
  }

  async add(_key: K, _value: V, _now: number): Promise<void> {}
  async addAll(_entries: Map<K, V>): Promise<void> {}
  async remove(_key: K, _now: number): Promise<void> {}
  async load(_key: K): Promise<V | null> { return null; }
  async loadAll(_keys: K[]): Promise<Map<K, V>> { return new Map(); }
  async flush(): Promise<void> {}
  async clear(): Promise<void> {}
  isWithStore(): boolean { return false; }
  hasPendingWrites(): boolean { return false; }
}
