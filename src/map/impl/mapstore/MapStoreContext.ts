import type { MapStoreConfig } from '../../../config/MapStoreConfig.js';
import { InitialLoadMode } from '../../../config/MapStoreConfig.js';
import type { StoreLatencyTracker } from '../../../diagnostics/StoreLatencyTracker.js';
import { LoadOnlyMapDataStore } from './LoadOnlyMapDataStore.js';
import type { MapDataStore } from './MapDataStore.js';
import { MapStoreDynamicLoader } from './MapStoreDynamicLoader.js';
import type { MapStoreProviderRegistry } from './MapStoreProviderRegistry.js';
import { MapStoreWrapper } from './MapStoreWrapper.js';
import { ArrayWriteBehindQueue } from './writebehind/ArrayWriteBehindQueue.js';
import { CoalescedWriteBehindQueue } from './writebehind/CoalescedWriteBehindQueue.js';
import { WriteBehindProcessor } from './writebehind/WriteBehindProcessor.js';
import { WriteBehindStore } from './writebehind/WriteBehindStore.js';
import { WriteThroughStore } from './writethrough/WriteThroughStore.js';

export interface MapStoreContextOptions {
  registry?: MapStoreProviderRegistry;
  configOrigin?: string | null;
}

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
    options?: MapStoreContextOptions,
  ): Promise<MapStoreContext<K, V>> {
    const rawImpl = await MapStoreContext._resolveImplementation(mapName, config, options);

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
      store = new WriteThroughStore<K, V>(wrapper, config.getWriteBatchSize());
    }

    // EAGER initial load
    let initialEntries: Map<K, V> | null = null;
    if (config.getInitialLoadMode() === InitialLoadMode.EAGER) {
      if (!config.isLoadAllKeys()) {
        throw new Error(
          `MapStoreConfig for '${mapName}': EAGER initial-load mode requires load-all-keys=true`,
        );
      }
      const stream = await wrapper.loadAllKeys();
      initialEntries = new Map<K, V>();
      const LOAD_BATCH_SIZE = 10_000;
      try {
        let keyBatch: K[] = [];
        for await (const k of stream) {
          keyBatch.push(k);
          if (keyBatch.length >= LOAD_BATCH_SIZE) {
            const loaded = await wrapper.loadAll(keyBatch);
            for (const [lk, lv] of loaded) {
              initialEntries.set(lk, lv);
            }
            keyBatch = [];
          }
        }
        if (keyBatch.length > 0) {
          const loaded = await wrapper.loadAll(keyBatch);
          for (const [lk, lv] of loaded) {
            initialEntries.set(lk, lv);
          }
        }
      } finally {
        await stream.close();
      }
    }

    return new MapStoreContext<K, V>(wrapper, store, initialEntries);
  }

  private static async _resolveImplementation(
    mapName: string,
    config: MapStoreConfig,
    options?: MapStoreContextOptions,
  ): Promise<unknown> {
    // 1. Direct factoryImplementation / implementation (programmatic API)
    const factoryImpl = config.getFactoryImplementation() as any;
    if (factoryImpl) {
      return await factoryImpl.newMapStore(mapName, config.getProperties());
    }
    const directImpl = config.getImplementation();
    if (directImpl) {
      return directImpl;
    }

    const registry = options?.registry;
    const configOrigin = options?.configOrigin;

    // 2. factoryClassName — check registry first, then dynamic-load
    const factoryClassName = config.getFactoryClassName();
    if (factoryClassName) {
      const registryHit = registry?.get(factoryClassName);
      if (registryHit) {
        return await registryHit.newMapStore(mapName, config.getProperties());
      }
      const loaded = await MapStoreDynamicLoader.load(factoryClassName, configOrigin);
      if (typeof loaded === 'function') {
        const factory = new (loaded as any)();
        return await factory.newMapStore(mapName, config.getProperties());
      }
      return await (loaded as any).newMapStore(mapName, config.getProperties());
    }

    // 3. className — check registry first, then dynamic-load
    const className = config.getClassName();
    if (className) {
      const registryHit = registry?.get(className);
      if (registryHit) {
        return await registryHit.newMapStore(mapName, config.getProperties());
      }
      const loaded = await MapStoreDynamicLoader.load(className, configOrigin);
      if (typeof loaded === 'function') {
        return new (loaded as any)();
      }
      return loaded;
    }

    return null;
  }

  getMapDataStore(): MapDataStore<K, V> {
    return this._mapDataStore;
  }

  getInitialEntries(): Map<K, V> | null {
    return this._initialEntries;
  }

  /** Attach a latency tracker to the underlying MapStoreWrapper. */
  setLatencyTracker(tracker: StoreLatencyTracker | null): void {
    this._wrapper.setLatencyTracker(tracker);
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
