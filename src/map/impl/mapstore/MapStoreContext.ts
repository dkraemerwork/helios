import type { MapStoreConfig } from '../../../config/MapStoreConfig.js';
import { InitialLoadMode } from '../../../config/MapStoreConfig.js';
import type { MapDataStore } from './MapDataStore.js';
import { MapStoreWrapper } from './MapStoreWrapper.js';
import { LoadOnlyMapDataStore } from './LoadOnlyMapDataStore.js';
import { WriteThroughStore } from './writethrough/WriteThroughStore.js';
import { CoalescedWriteBehindQueue } from './writebehind/CoalescedWriteBehindQueue.js';
import { ArrayWriteBehindQueue } from './writebehind/ArrayWriteBehindQueue.js';
import { WriteBehindProcessor } from './writebehind/WriteBehindProcessor.js';
import { WriteBehindStore } from './writebehind/WriteBehindStore.js';

export class MapStoreContext<K, V> {
  private readonly _wrapper: MapStoreWrapper<K, V>;
  private readonly _mapDataStore: MapDataStore<K, V>;
  private readonly _initialEntries: Map<K, V> | null;

  private constructor(
    wrapper: MapStoreWrapper<K, V>,
    store: MapDataStore<K, V>,
    initialEntries: Map<K, V> | null,
  ) {
    this._wrapper = wrapper;
    this._mapDataStore = store;
    this._initialEntries = initialEntries;
  }

  static async create<K, V>(
    mapName: string,
    config: MapStoreConfig,
  ): Promise<MapStoreContext<K, V>> {
    // Resolve implementation: factory first, then direct implementation
    const factoryImpl = config.getFactoryImplementation() as any;
    const directImpl = config.getImplementation();

    const rawImpl = factoryImpl
      ? await factoryImpl.newMapStore(mapName, config.getProperties())
      : directImpl;

    if (!rawImpl) {
      throw new Error(
        `MapStoreConfig for '${mapName}' has no implementation/factory set`,
      );
    }

    const wrapper = new MapStoreWrapper<K, V>(rawImpl as any);

    // Init lifecycle if supported
    if (wrapper.supportsLifecycle) {
      await wrapper.init(config.getProperties(), mapName);
    }

    let store: MapDataStore<K, V>;
    if (!wrapper.isMapStore) {
      // MapLoader only — reads work, writes are in-memory only
      store = new LoadOnlyMapDataStore(wrapper);
    } else if (config.getWriteDelaySeconds() > 0) {
      // Write-behind
      const queue = config.isWriteCoalescing()
        ? new CoalescedWriteBehindQueue<K, V>()
        : new ArrayWriteBehindQueue<K, V>();
      const processor = new WriteBehindProcessor<K, V>(wrapper, config.getWriteBatchSize());
      store = new WriteBehindStore<K, V>(wrapper, queue, processor, config.getWriteDelaySeconds() * 1000);
    } else {
      // Write-through
      store = new WriteThroughStore<K, V>(wrapper);
    }

    // EAGER initial load
    let initialEntries: Map<K, V> | null = null;
    if (config.getInitialLoadMode() === InitialLoadMode.EAGER) {
      const keys = await wrapper.loadAllKeys();
      if (keys.length > 0) {
        initialEntries = await wrapper.loadAll(keys);
      } else {
        initialEntries = new Map<K, V>();
      }
    }

    return new MapStoreContext<K, V>(wrapper, store, initialEntries);
  }

  getMapDataStore(): MapDataStore<K, V> {
    return this._mapDataStore;
  }

  getInitialEntries(): Map<K, V> | null {
    return this._initialEntries;
  }

  async destroy(): Promise<void> {
    await this._mapDataStore.flush();
    if (this._mapDataStore instanceof WriteBehindStore) {
      this._mapDataStore.destroy();
    }
    if (this._wrapper.supportsLifecycle) {
      await this._wrapper.destroy();
    }
  }
}
