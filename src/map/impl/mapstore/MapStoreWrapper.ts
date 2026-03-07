import { MapKeyStream } from '../../MapKeyStream.js';
import type { MapLoader } from '../../MapLoader.js';
import type { MapStore } from '../../MapStore.js';

type AnyStore<K, V> = MapStore<K, V> | MapLoader<K, V>;

export class MapStoreWrapper<K = unknown, V = unknown> {
  readonly isMapStore: boolean;
  readonly supportsLifecycle: boolean;

  private readonly _impl: AnyStore<K, V>;

  constructor(impl: AnyStore<K, V>) {
    this._impl = impl;
    this.isMapStore = typeof (impl as any).store === 'function';
    this.supportsLifecycle =
      typeof (impl as any).init === 'function' &&
      typeof (impl as any).destroy === 'function';
  }

  async load(key: K): Promise<V | null> {
    return this._impl.load(key);
  }

  async loadAll(keys: K[]): Promise<Map<K, V>> {
    return this._impl.loadAll(keys);
  }

  async loadAllKeys(): Promise<MapKeyStream<K>> {
    const result = await this._impl.loadAllKeys();
    // Support legacy adapters returning K[] by wrapping in MapKeyStream
    if (result instanceof MapKeyStream) {
      return result;
    }
    return MapKeyStream.fromIterable(result as unknown as K[]);
  }

  async store(key: K, value: V): Promise<void> {
    if (this.isMapStore) {
      await (this._impl as MapStore<K, V>).store(key, value);
    }
  }

  async storeAll(entries: Map<K, V>): Promise<void> {
    if (this.isMapStore && entries.size > 0) {
      await (this._impl as MapStore<K, V>).storeAll(entries);
    }
  }

  async delete(key: K): Promise<void> {
    if (this.isMapStore) {
      await (this._impl as MapStore<K, V>).delete(key);
    }
  }

  async deleteAll(keys: K[]): Promise<void> {
    if (this.isMapStore && keys.length > 0) {
      await (this._impl as MapStore<K, V>).deleteAll(keys);
    }
  }

  async init(properties: Map<string, string>, mapName: string): Promise<void> {
    if (this.supportsLifecycle) {
      await (this._impl as any).init(properties, mapName);
    }
  }

  async destroy(): Promise<void> {
    if (this.supportsLifecycle) {
      await (this._impl as any).destroy();
    }
  }
}
