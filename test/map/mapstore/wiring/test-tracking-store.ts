/**
 * Shared tracking MapStore/MapStoreFactory for wiring proof tests.
 * Exported so dynamic-loading tests can import it.
 */
import { MapKeyStream } from '@zenystx/helios-core/map/MapKeyStream';
import type { MapStore } from '@zenystx/helios-core/map/MapStore';
import type { MapStoreFactory } from '@zenystx/helios-core/map/MapStoreFactory';

export class TrackingMapStore implements MapStore<string, string> {
  readonly data = new Map<string, string>();
  initCalled = false;
  destroyCalled = false;
  initMapName: string | null = null;

  async load(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async loadAll(keys: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const k of keys) {
      const v = this.data.get(k);
      if (v !== undefined) result.set(k, v);
    }
    return result;
  }

  async loadAllKeys(): Promise<MapKeyStream<string>> {
    return MapKeyStream.fromIterable(this.data.keys());
  }

  async store(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  async storeAll(entries: Map<string, string>): Promise<void> {
    for (const [k, v] of entries) this.data.set(k, v);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async deleteAll(keys: string[]): Promise<void> {
    for (const k of keys) this.data.delete(k);
  }

  async init(_properties: Map<string, string>, mapName: string): Promise<void> {
    this.initCalled = true;
    this.initMapName = mapName;
  }

  async destroy(): Promise<void> {
    this.destroyCalled = true;
  }
}

export class TrackingMapStoreFactory implements MapStoreFactory<string, string> {
  lastCreatedStore: TrackingMapStore | null = null;
  createCount = 0;

  newMapStore(mapName: string, _properties: Map<string, string>): MapStore<string, string> {
    this.createCount++;
    const store = new TrackingMapStore();
    store.initMapName = mapName;
    this.lastCreatedStore = store;
    return store;
  }
}
