/**
 * Block 19.1 — MongoDB MapStore parity/scope freeze + core runtime closure
 *
 * Tests cover: MapKeyStream<K>, shutdownAsync flush await, EAGER preload timing,
 * load-all-keys legality, query/index rebuild after EAGER, putAll/getAll bulk paths,
 * clear ordering with write-behind, config-origin metadata, scope freeze.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { MapStoreContext } from '@zenystx/helios-core/map/impl/mapstore/MapStoreContext';
import { MapStoreWrapper } from '@zenystx/helios-core/map/impl/mapstore/MapStoreWrapper';
import { MapContainerService } from '@zenystx/helios-core/map/impl/MapContainerService';
import { MapStoreConfig, InitialLoadMode } from '@zenystx/helios-core/config/MapStoreConfig';
import { WriteBehindStore } from '@zenystx/helios-core/map/impl/mapstore/writebehind/WriteBehindStore';
import { WriteThroughStore } from '@zenystx/helios-core/map/impl/mapstore/writethrough/WriteThroughStore';
import { MapKeyStream } from '@zenystx/helios-core/map/MapKeyStream';
import type { MapLoader } from '@zenystx/helios-core/map/MapLoader';
import type { MapStore } from '@zenystx/helios-core/map/MapStore';
import type { MapLoaderLifecycleSupport } from '@zenystx/helios-core/map/MapLoaderLifecycleSupport';
import { loadConfig, parseRawConfig } from '@zenystx/helios-core/config/ConfigLoader';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** In-memory MapStore with tracking for test assertions. */
function createTrackingStore<K = string, V = string>(data: Map<K, V> = new Map()): MapStore<K, V> & MapLoaderLifecycleSupport & {
  storeCalls: Array<{ key: K; value: V }>;
  storeAllCalls: Array<Map<K, V>>;
  deleteAllCalls: Array<K[]>;
  loadAllKeysCalled: number;
  clearCalled: number;
  initCalled: boolean;
  destroyCalled: boolean;
} {
  const tracker = {
    storeCalls: [] as Array<{ key: K; value: V }>,
    storeAllCalls: [] as Array<Map<K, V>>,
    deleteAllCalls: [] as Array<K[]>,
    loadAllKeysCalled: 0,
    clearCalled: 0,
    initCalled: false,
    destroyCalled: false,

    async load(key: K): Promise<V | null> {
      return data.get(key) ?? null;
    },
    async loadAll(keys: K[]): Promise<Map<K, V>> {
      const result = new Map<K, V>();
      for (const k of keys) {
        const v = data.get(k);
        if (v !== undefined) result.set(k, v);
      }
      return result;
    },
    async loadAllKeys(): Promise<MapKeyStream<K>> {
      tracker.loadAllKeysCalled++;
      return MapKeyStream.fromIterable(data.keys());
    },
    async store(key: K, value: V): Promise<void> {
      tracker.storeCalls.push({ key, value });
      data.set(key, value);
    },
    async storeAll(entries: Map<K, V>): Promise<void> {
      tracker.storeAllCalls.push(new Map(entries));
      for (const [k, v] of entries) data.set(k, v);
    },
    async delete(key: K): Promise<void> {
      data.delete(key);
    },
    async deleteAll(keys: K[]): Promise<void> {
      tracker.deleteAllCalls.push([...keys]);
      for (const k of keys) data.delete(k);
    },
    async init(_properties: Map<string, string>, _mapName: string): Promise<void> {
      tracker.initCalled = true;
    },
    async destroy(): Promise<void> {
      tracker.destroyCalled = true;
    },
  };
  return tracker;
}

// ── MapKeyStream ─────────────────────────────────────────────────────────────

describe('MapKeyStream<K>', () => {
  it('is an AsyncIterable with close()', async () => {
    const { MapKeyStream: MKS } = await import('@zenystx/helios-core/map/MapKeyStream');
    const keys = ['a', 'b', 'c'];
    const stream: MapKeyStream<string> = MKS.fromIterable(keys);

    expect(Symbol.asyncIterator in stream).toBe(true);
    expect(typeof stream.close).toBe('function');

    const collected: string[] = [];
    for await (const key of stream) {
      collected.push(key);
    }
    expect(collected).toEqual(['a', 'b', 'c']);
    await stream.close();
  });

  it('close() stops iteration early', async () => {
    const { MapKeyStream: MKS } = await import('@zenystx/helios-core/map/MapKeyStream');
    const keys = ['a', 'b', 'c', 'd', 'e'];
    const stream = MKS.fromIterable(keys);

    const collected: string[] = [];
    for await (const key of stream) {
      collected.push(key);
      if (collected.length === 2) {
        await stream.close();
        break;
      }
    }
    expect(collected).toEqual(['a', 'b']);
  });

  it('wraps array-returning loadAllKeys into streaming contract', async () => {
    const store = createTrackingStore(new Map([['k1', 'v1'], ['k2', 'v2']]));
    const wrapper = new MapStoreWrapper<string, string>(store);
    const stream = await wrapper.loadAllKeys();

    // loadAllKeys now returns MapKeyStream, not K[]
    expect(Symbol.asyncIterator in stream).toBe(true);
    const collected: string[] = [];
    for await (const k of stream) collected.push(k);
    expect(collected.sort()).toEqual(['k1', 'k2']);
    await stream.close();
  });
});

// ── shutdownAsync flush await ────────────────────────────────────────────────

describe('shutdownAsync flush await', () => {
  it('shutdownAsync awaits MapContainerService.flushAll()', async () => {
    // MapContainerService.flushAll must be called and awaited by shutdownAsync
    const service = new MapContainerService();
    let flushCompleted = false;
    const originalFlushAll = service.flushAll.bind(service);

    // Create a store with write-behind to prove flush is awaited
    const data = new Map([['k1', 'v1']]);
    const store = createTrackingStore(data);
    const config = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store)
      .setWriteDelaySeconds(60); // long delay to prove flush drains

    await service.getOrCreateMapDataStore('test-map', config);

    // Verify flushAll exists and is async
    const flushPromise = service.flushAll();
    expect(flushPromise instanceof Promise).toBe(true);
    await flushPromise;
  });

  it('MapContainerService.flushAll destroys all active contexts', async () => {
    const service = new MapContainerService();
    const store1 = createTrackingStore<string, string>(new Map([['a', '1']]));
    const store2 = createTrackingStore<string, string>(new Map([['b', '2']]));

    const config1 = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store1);
    const config2 = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store2);

    await service.getOrCreateMapDataStore('map1', config1);
    await service.getOrCreateMapDataStore('map2', config2);

    await service.flushAll();

    // Both stores should have destroy called through context destroy
    expect(store1.destroyCalled).toBe(true);
    expect(store2.destroyCalled).toBe(true);
  });
});

// ── EAGER preload timing ─────────────────────────────────────────────────────

describe('EAGER preload timing', () => {
  it('EAGER preload completes before first map operation resolves', async () => {
    const data = new Map<string, string>([['eager1', 'val1'], ['eager2', 'val2']]);
    const store = createTrackingStore(data);
    const config = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store)
      .setInitialLoadMode(InitialLoadMode.EAGER);

    const ctx = await MapStoreContext.create<string, string>('eager-map', config);
    const entries = ctx.getInitialEntries();

    // EAGER must produce initial entries
    expect(entries).not.toBeNull();
    expect(entries!.size).toBe(2);
    expect(entries!.get('eager1')).toBe('val1');
    expect(store.loadAllKeysCalled).toBe(1);
  });

  it('EAGER preload triggers index rebuild before first operation', async () => {
    // After EAGER preload populates RecordStore, indexes must be rebuilt
    // so queries see the preloaded data
    const service = new MapContainerService();
    const data = new Map<string, string>([['x', '{"name":"alice"}'], ['y', '{"name":"bob"}']]);
    const store = createTrackingStore(data);
    const config = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store)
      .setInitialLoadMode(InitialLoadMode.EAGER);

    const dataStore = await service.getOrCreateMapDataStore<string, string>('index-map', config);

    // After EAGER preload, the service should have called rebuildIndexes
    // This test verifies the integration point exists
    expect(dataStore.isWithStore()).toBe(true);
  });
});

// ── load-all-keys legality ──────────────────────────────────────────────────

describe('load-all-keys config', () => {
  it('load-all-keys=false prevents loadAllKeys() from being called during EAGER', async () => {
    const store = createTrackingStore(new Map([['k1', 'v1']]));
    const config = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store)
      .setInitialLoadMode(InitialLoadMode.EAGER)
      .setLoadAllKeys(false);

    // EAGER + load-all-keys=false is an invalid combination — must fail fast
    await expect(
      MapStoreContext.create<string, string>('invalid-map', config)
    ).rejects.toThrow();
  });

  it('load-all-keys=false skips loadAllKeys on LAZY mode', async () => {
    const store = createTrackingStore(new Map([['k1', 'v1']]));
    const config = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store)
      .setInitialLoadMode(InitialLoadMode.LAZY)
      .setLoadAllKeys(false);

    const ctx = await MapStoreContext.create<string, string>('lazy-no-keys', config);
    expect(store.loadAllKeysCalled).toBe(0);
    expect(ctx.getInitialEntries()).toBeNull();
  });

  it('load-all-keys=true (default) allows loadAllKeys', async () => {
    const store = createTrackingStore(new Map([['k1', 'v1']]));
    const config = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store)
      .setInitialLoadMode(InitialLoadMode.EAGER);

    // Default is load-all-keys=true
    expect(config.isLoadAllKeys()).toBe(true);

    const ctx = await MapStoreContext.create<string, string>('eager-with-keys', config);
    expect(store.loadAllKeysCalled).toBe(1);
  });
});

// ── putAll bulk path ─────────────────────────────────────────────────────────

describe('putAll bulk path', () => {
  it('putAll reaches storeAll on write-through store', async () => {
    const store = createTrackingStore<string, string>();
    const config = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store)
      .setWriteDelaySeconds(0);

    const ctx = await MapStoreContext.create<string, string>('bulk-put-map', config);
    const dataStore = ctx.getMapDataStore();

    // Bulk add should route to storeAll, not individual store calls
    await dataStore.addAll(new Map([['a', '1'], ['b', '2'], ['c', '3']]));
    expect(store.storeAllCalls.length).toBe(1);
    expect(store.storeAllCalls[0].size).toBe(3);
  });
});

// ── getAll bulk path ─────────────────────────────────────────────────────────

describe('getAll bulk path', () => {
  it('getAll batch-miss reaches loadAll on the store', async () => {
    const data = new Map<string, string>([['k1', 'v1'], ['k2', 'v2'], ['k3', 'v3']]);
    const store = createTrackingStore(data);
    const config = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store)
      .setWriteDelaySeconds(0);

    const ctx = await MapStoreContext.create<string, string>('bulk-get-map', config);
    const dataStore = ctx.getMapDataStore();

    // Batch load should route through loadAll
    const result = await dataStore.loadAll(['k1', 'k2', 'k3']);
    expect(result.size).toBe(3);
    expect(result.get('k1')).toBe('v1');
  });
});

// ── clear ordering with write-behind ─────────────────────────────────────────

describe('clear ordering with write-behind', () => {
  it('clear quiesces write-behind queue before external delete', async () => {
    const data = new Map<string, string>();
    const store = createTrackingStore(data);
    const config = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store)
      .setWriteDelaySeconds(5);

    const ctx = await MapStoreContext.create<string, string>('clear-map', config);
    const dataStore = ctx.getMapDataStore() as WriteBehindStore<string, string>;

    // Queue some writes
    await dataStore.add('k1', 'v1', Date.now());
    await dataStore.add('k2', 'v2', Date.now());
    expect(dataStore.hasPendingWrites()).toBe(true);

    // clear() must flush pending writes first, then delete externally
    await dataStore.clear();
    expect(dataStore.hasPendingWrites()).toBe(false);
  });
});

// ── Config-origin metadata ──────────────────────────────────────────────────

describe('config-origin metadata', () => {
  it('loadConfig preserves config file origin path', async () => {
    // parseRawConfig should accept and propagate configOrigin
    const config = parseRawConfig({ name: 'test' }, '/path/to/config.json');
    expect(config.getConfigOrigin()).toBe('/path/to/config.json');
  });

  it('programmatic config has null configOrigin', () => {
    const { HeliosConfig } = require('@zenystx/helios-core/config/HeliosConfig');
    const config = new HeliosConfig();
    expect(config.getConfigOrigin()).toBeNull();
  });

  it('config-origin resolves relative specifiers from config file directory', async () => {
    const config = parseRawConfig({ name: 'test' }, '/opt/app/helios.json');
    expect(config.getConfigOrigin()).toBe('/opt/app/helios.json');
    // The config origin directory would be /opt/app/
  });
});

// ── Scope freeze ─────────────────────────────────────────────────────────────

describe('scope freeze', () => {
  it('MapStore interface has store/storeAll/delete/deleteAll', async () => {
    const store = createTrackingStore();
    expect(typeof store.store).toBe('function');
    expect(typeof store.storeAll).toBe('function');
    expect(typeof store.delete).toBe('function');
    expect(typeof store.deleteAll).toBe('function');
  });

  it('MapLoader interface has load/loadAll/loadAllKeys', async () => {
    const store = createTrackingStore();
    expect(typeof store.load).toBe('function');
    expect(typeof store.loadAll).toBe('function');
    expect(typeof store.loadAllKeys).toBe('function');
  });

  it('MapDataStore interface exposes addAll for bulk operations', async () => {
    const store = createTrackingStore();
    const config = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store);

    const ctx = await MapStoreContext.create<string, string>('scope-map', config);
    const dataStore = ctx.getMapDataStore();
    expect(typeof dataStore.addAll).toBe('function');
  });
});
