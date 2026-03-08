import type { StoreLatencyTracker } from '../../../diagnostics/StoreLatencyTracker.js';
import { MapKeyStream } from '../../MapKeyStream.js';
import type { MapLoader } from '../../MapLoader.js';
import type { MapStore } from '../../MapStore.js';

type AnyStore<K, V> = MapStore<K, V> | MapLoader<K, V>;

export class MapStoreWrapper<K = unknown, V = unknown> {
  readonly isMapStore: boolean;
  readonly supportsLifecycle: boolean;

  private readonly _impl: AnyStore<K, V>;
  private _latencyTracker: StoreLatencyTracker | null = null;

  constructor(impl: AnyStore<K, V>) {
    this._impl = impl;
    this.isMapStore = typeof (impl as any).store === 'function';
    this.supportsLifecycle =
      typeof (impl as any).init === 'function' &&
      typeof (impl as any).destroy === 'function';
  }

  /** Attach a latency tracker. Called by HeliosInstanceImpl when monitoring is enabled. */
  setLatencyTracker(tracker: StoreLatencyTracker | null): void {
    this._latencyTracker = tracker;
  }

  async load(key: K): Promise<V | null> {
    const t0 = Date.now();
    const result = await this._impl.load(key);
    this._latencyTracker?.recordLatency('load', Date.now() - t0);
    return result;
  }

  async loadAll(keys: K[]): Promise<Map<K, V>> {
    const t0 = Date.now();
    const result = await this._impl.loadAll(keys);
    this._latencyTracker?.recordLatency('loadAll', Date.now() - t0);
    return result;
  }

  async loadAllKeys(): Promise<MapKeyStream<K>> {
    const t0 = Date.now();
    const result = await this._impl.loadAllKeys();
    this._latencyTracker?.recordLatency('loadAllKeys', Date.now() - t0);
    // Support legacy adapters returning K[] by wrapping in MapKeyStream
    if (result instanceof MapKeyStream) {
      return result;
    }
    return MapKeyStream.fromIterable(result as unknown as K[]);
  }

  async store(key: K, value: V): Promise<void> {
    if (this.isMapStore) {
      const t0 = Date.now();
      await (this._impl as MapStore<K, V>).store(key, value);
      this._latencyTracker?.recordLatency('store', Date.now() - t0);
    }
  }

  async storeAll(entries: Map<K, V>): Promise<void> {
    if (this.isMapStore && entries.size > 0) {
      const t0 = Date.now();
      await (this._impl as MapStore<K, V>).storeAll(entries);
      this._latencyTracker?.recordLatency('storeAll', Date.now() - t0);
    }
  }

  async delete(key: K): Promise<void> {
    if (this.isMapStore) {
      const t0 = Date.now();
      await (this._impl as MapStore<K, V>).delete(key);
      this._latencyTracker?.recordLatency('delete', Date.now() - t0);
    }
  }

  async deleteAll(keys: K[]): Promise<void> {
    if (this.isMapStore && keys.length > 0) {
      const t0 = Date.now();
      await (this._impl as MapStore<K, V>).deleteAll(keys);
      this._latencyTracker?.recordLatency('deleteAll', Date.now() - t0);
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
