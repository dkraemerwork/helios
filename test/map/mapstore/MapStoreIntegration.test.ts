/**
 * Block 12.A3 — Integration tests for IMap + MapStore wiring.
 *
 * Tests the end-to-end flow: HeliosInstance configured with a MapStore,
 * IMap async methods triggering store operations.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { MapConfig } from '@zenystx/helios-core/config/MapConfig';
import { MapStoreConfig } from '@zenystx/helios-core/config/MapStoreConfig';
import type { MapStore } from '@zenystx/helios-core/map/MapStore';
import type { MapLoader } from '@zenystx/helios-core/map/MapLoader';
import type { MapLoaderLifecycleSupport } from '@zenystx/helios-core/map/MapLoaderLifecycleSupport';
import { MapKeyStream } from '@zenystx/helios-core/map/MapKeyStream';

// ── Mock store implementations ─────────────────────────────────────────────

/** Simple in-memory mock MapStore for testing. */
class MockMapStore<K extends string, V> implements MapStore<K, V> {
    readonly stored = new Map<K, V>();
    storeCount = 0;
    deleteCount = 0;
    loadCount = 0;
    initCount = 0;
    destroyCount = 0;

    async store(key: K, value: V): Promise<void> {
        this.storeCount++;
        this.stored.set(key, value);
    }

    async storeAll(entries: Map<K, V>): Promise<void> {
        for (const [k, v] of entries) {
            this.storeCount++;
            this.stored.set(k, v);
        }
    }

    async delete(key: K): Promise<void> {
        this.deleteCount++;
        this.stored.delete(key);
    }

    async deleteAll(keys: K[]): Promise<void> {
        for (const k of keys) {
            this.deleteCount++;
            this.stored.delete(k);
        }
    }

    async load(key: K): Promise<V | null> {
        this.loadCount++;
        return this.stored.get(key) ?? null;
    }

    async loadAll(keys: K[]): Promise<Map<K, V>> {
        const result = new Map<K, V>();
        for (const k of keys) {
            const v = this.stored.get(k);
            if (v !== undefined) result.set(k, v);
        }
        return result;
    }

    async loadAllKeys(): Promise<MapKeyStream<K>> {
        return MapKeyStream.fromIterable(Array.from(this.stored.keys()));
    }
}

/** Mock MapStore that also supports lifecycle. */
class MockLifecycleMapStore<K extends string, V>
    extends MockMapStore<K, V>
    implements MapLoaderLifecycleSupport
{
    async init(_properties: Map<string, string>, _mapName: string): Promise<void> {
        this.initCount++;
    }

    async destroy(): Promise<void> {
        this.destroyCount++;
    }
}

/** MapLoader-only mock (no write capabilities). */
class MockMapLoader<K extends string, V> implements MapLoader<K, V> {
    readonly data = new Map<K, V>();
    loadCount = 0;

    async load(key: K): Promise<V | null> {
        this.loadCount++;
        return this.data.get(key) ?? null;
    }

    async loadAll(keys: K[]): Promise<Map<K, V>> {
        const result = new Map<K, V>();
        for (const k of keys) {
            const v = this.data.get(k);
            if (v !== undefined) result.set(k, v);
        }
        return result;
    }

    async loadAllKeys(): Promise<MapKeyStream<K>> {
        return MapKeyStream.fromIterable(Array.from(this.data.keys()));
    }
}

// ── Test helpers ───────────────────────────────────────────────────────────

function makeInstance(mapName: string, storeConfig: MapStoreConfig): HeliosInstanceImpl {
    const config = new HeliosConfig('test');
    const mapConfig = new MapConfig(mapName);
    mapConfig.setMapStoreConfig(storeConfig);
    config.addMapConfig(mapConfig);
    return new HeliosInstanceImpl(config);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('MapStore Integration — write-through', () => {
    let instance: HeliosInstanceImpl;
    let mockStore: MockMapStore<string, string>;

    beforeEach(() => {
        mockStore = new MockMapStore();
        const storeConfig = new MapStoreConfig()
            .setEnabled(true)
            .setImplementation(mockStore);
        instance = makeInstance('wt-map', storeConfig);
    });

    afterEach(() => {
        if (instance.isRunning()) instance.shutdown();
    });

    it('write-through: put(k,v) calls store() on backend', async () => {
        const map = instance.getMap<string, string>('wt-map');
        await map.put('key1', 'val1');
        expect(mockStore.storeCount).toBe(1);
        expect(mockStore.stored.get('key1')).toBe('val1');
    });

    it('write-through: get(miss) calls load() on backend', async () => {
        mockStore.stored.set('external-key', 'external-val');
        const map = instance.getMap<string, string>('wt-map');
        const val = await map.get('external-key');
        expect(val).toBe('external-val');
        expect(mockStore.loadCount).toBe(1);
    });

    it('write-through: get hit after load-on-miss does not call load() again', async () => {
        mockStore.stored.set('k', 'v');
        const map = instance.getMap<string, string>('wt-map');

        const first = await map.get('k');
        expect(first).toBe('v');
        expect(mockStore.loadCount).toBe(1);

        const second = await map.get('k');
        expect(second).toBe('v');
        expect(mockStore.loadCount).toBe(1); // no additional load
    });

    it('write-through: remove(key) calls delete() on backend', async () => {
        await instance.getMap<string, string>('wt-map').put('k', 'v');
        await instance.getMap<string, string>('wt-map').remove('k');
        expect(mockStore.deleteCount).toBe(1);
        expect(mockStore.stored.has('k')).toBe(false);
    });

    it('write-through: clear() removes external persisted entries', async () => {
        mockStore.stored.set('a', '1');
        mockStore.stored.set('b', '2');
        const map = instance.getMap<string, string>('wt-map');
        await map.clear();
        expect(mockStore.stored.size).toBe(0);
    });

    it('write-through: clear on MapStore-backed map prevents resurrection on next get', async () => {
        mockStore.stored.set('key', 'value');
        const map = instance.getMap<string, string>('wt-map');

        // Pre-populate in-memory via get (which loads from store)
        await map.get('key');
        expect(map.containsKey('key')).toBe(true);

        // Clear — removes both in-memory and external
        await map.clear();
        expect(map.containsKey('key')).toBe(false);
        expect(mockStore.stored.size).toBe(0);

        // Next get should return null (store is empty, no resurrection)
        const val = await map.get('key');
        expect(val).toBeNull();
    });
});

describe('MapStore Integration — write-behind', () => {
    let instance: HeliosInstanceImpl;
    let mockStore: MockMapStore<string, string>;

    beforeEach(() => {
        mockStore = new MockMapStore();
        const storeConfig = new MapStoreConfig()
            .setEnabled(true)
            .setWriteDelaySeconds(60) // long delay so no auto-flush during test
            .setImplementation(mockStore);
        instance = makeInstance('wb-map', storeConfig);
    });

    afterEach(() => {
        if (instance.isRunning()) instance.shutdown();
    });

    it('write-behind: put(k,v) does NOT call store() immediately', async () => {
        const map = instance.getMap<string, string>('wb-map');
        await map.put('key1', 'val1');
        expect(mockStore.storeCount).toBe(0); // not flushed yet
        expect(map.containsKey('key1')).toBe(true); // in-memory only
    });

    it('write-behind: destroy() flushes pending entries', async () => {
        const map = instance.getMap<string, string>('wb-map');
        await map.put('k1', 'v1');
        await map.put('k2', 'v2');
        expect(mockStore.storeCount).toBe(0);

        instance.shutdown();
        // After shutdown (which calls flush), entries should be stored
        expect(mockStore.storeCount).toBeGreaterThanOrEqual(1);
    });
});

describe('MapStore Integration — loader-only', () => {
    let instance: HeliosInstanceImpl;
    let mockLoader: MockMapLoader<string, string>;

    beforeEach(() => {
        mockLoader = new MockMapLoader();
        mockLoader.data.set('preloaded', 'value');
        const storeConfig = new MapStoreConfig()
            .setEnabled(true)
            .setImplementation(mockLoader as unknown as object);
        instance = makeInstance('loader-map', storeConfig);
    });

    afterEach(() => {
        if (instance.isRunning()) instance.shutdown();
    });

    it('loader-only: get(miss) loads from loader', async () => {
        const map = instance.getMap<string, string>('loader-map');
        const val = await map.get('preloaded');
        expect(val).toBe('value');
        expect(mockLoader.loadCount).toBe(1);
    });

    it('loader-only: clear empties in-memory only, loader still has data', async () => {
        const map = instance.getMap<string, string>('loader-map');
        await map.get('preloaded'); // loads into memory
        expect(map.containsKey('preloaded')).toBe(true);

        await map.clear();
        expect(map.containsKey('preloaded')).toBe(false);
        // loader data is NOT deleted (read-only source)
        expect(mockLoader.data.has('preloaded')).toBe(true);
    });
});

describe('MapStore Integration — lifecycle', () => {
    it('lifecycle: init() called on context creation', async () => {
        const mockStore = new MockLifecycleMapStore<string, string>();
        const storeConfig = new MapStoreConfig()
            .setEnabled(true)
            .setImplementation(mockStore);
        const instance = makeInstance('lc-map', storeConfig);
        const map = instance.getMap<string, string>('lc-map');

        // First store-touching op triggers lazy init
        await map.put('k', 'v');
        expect(mockStore.initCount).toBe(1);

        instance.shutdown();
    });

    it('lazy wiring race: two concurrent first calls trigger one init only', async () => {
        const mockStore = new MockLifecycleMapStore<string, string>();
        const storeConfig = new MapStoreConfig()
            .setEnabled(true)
            .setImplementation(mockStore);
        const instance = makeInstance('race-map', storeConfig);
        const map = instance.getMap<string, string>('race-map');

        // Fire two concurrent puts
        await Promise.all([
            map.put('k1', 'v1'),
            map.put('k2', 'v2'),
        ]);

        // Only one init should have occurred
        expect(mockStore.initCount).toBe(1);

        instance.shutdown();
    });

    it('wiring via factory implementation: factory.newMapStore() called per-map', async () => {
        let factoryCallCount = 0;
        const innerStore = new MockMapStore<string, string>();
        const factory = {
            newMapStore(_mapName: string, _props: Map<string, string>) {
                factoryCallCount++;
                return innerStore;
            },
        };
        const storeConfig = new MapStoreConfig()
            .setEnabled(true)
            .setFactoryImplementation(factory);
        const instance = makeInstance('factory-map', storeConfig);
        const map = instance.getMap<string, string>('factory-map');
        await map.put('k', 'v');

        expect(factoryCallCount).toBe(1);
        expect(innerStore.storeCount).toBe(1);

        instance.shutdown();
    });
});

describe('MapStore Integration — disabled store', () => {
    it('no-op when store is disabled', async () => {
        const mockStore = new MockMapStore<string, string>();
        const storeConfig = new MapStoreConfig(); // disabled by default
        const instance = makeInstance('no-store', storeConfig);
        const map = instance.getMap<string, string>('no-store');

        await map.put('k', 'v');
        expect(mockStore.storeCount).toBe(0); // no store called

        const val = await map.get('k');
        expect(val).toBe('v'); // in-memory works

        instance.shutdown();
    });
});
