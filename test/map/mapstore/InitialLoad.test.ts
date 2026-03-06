/**
 * Block 12.A3 — EAGER vs LAZY initial load tests.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { MapConfig } from '@zenystx/helios-core/config/MapConfig';
import { MapStoreConfig, InitialLoadMode } from '@zenystx/helios-core/config/MapStoreConfig';
import type { MapStore } from '@zenystx/helios-core/map/MapStore';
import { MapKeyStream } from '@zenystx/helios-core/map/MapKeyStream';

class SeedingMapStore implements MapStore<string, string> {
    private readonly _seed: Map<string, string>;
    loadAllKeysCalled = false;
    loadAllCalled = false;

    constructor(seed: Map<string, string>) {
        this._seed = seed;
    }

    async store(_key: string, _value: string): Promise<void> {}
    async storeAll(_entries: Map<string, string>): Promise<void> {}
    async delete(_key: string): Promise<void> {}
    async deleteAll(_keys: string[]): Promise<void> {}

    async load(key: string): Promise<string | null> {
        return this._seed.get(key) ?? null;
    }

    async loadAll(keys: string[]): Promise<Map<string, string>> {
        this.loadAllCalled = true;
        const result = new Map<string, string>();
        for (const k of keys) {
            const v = this._seed.get(k);
            if (v !== undefined) result.set(k, v);
        }
        return result;
    }

    async loadAllKeys(): Promise<MapKeyStream<string>> {
        this.loadAllKeysCalled = true;
        return MapKeyStream.fromIterable(Array.from(this._seed.keys()));
    }
}

describe('InitialLoad', () => {
    let instance: HeliosInstanceImpl;

    afterEach(() => {
        if (instance?.isRunning()) instance.shutdown();
    });

    it('LAZY mode: loadAllKeys not called on map creation', async () => {
        const seed = new Map([['k1', 'v1'], ['k2', 'v2']]);
        const mockStore = new SeedingMapStore(seed);
        const storeConfig = new MapStoreConfig()
            .setEnabled(true)
            .setImplementation(mockStore);
        // LAZY is default

        const config = new HeliosConfig('lazy-test');
        const mapConfig = new MapConfig('lazy-map');
        mapConfig.setMapStoreConfig(storeConfig);
        config.addMapConfig(mapConfig);
        instance = new HeliosInstanceImpl(config);

        const map = instance.getMap<string, string>('lazy-map');
        // Trigger wiring with a get (which is a miss for a lazy map)
        await map.get('k1');

        expect(mockStore.loadAllKeysCalled).toBe(false); // LAZY: no bulk load
        // load() may be called for the individual key (load-on-miss)
    });

    it('EAGER mode: loadAllKeys + loadAll called, entries pre-populated', async () => {
        const seed = new Map([['k1', 'v1'], ['k2', 'v2']]);
        const mockStore = new SeedingMapStore(seed);
        const storeConfig = new MapStoreConfig()
            .setEnabled(true)
            .setInitialLoadMode(InitialLoadMode.EAGER)
            .setImplementation(mockStore);

        const config = new HeliosConfig('eager-test');
        const mapConfig = new MapConfig('eager-map');
        mapConfig.setMapStoreConfig(storeConfig);
        config.addMapConfig(mapConfig);
        instance = new HeliosInstanceImpl(config);

        const map = instance.getMap<string, string>('eager-map');

        // A get triggers lazy wiring → which includes EAGER load
        await map.get('k1');

        expect(mockStore.loadAllKeysCalled).toBe(true);
        expect(mockStore.loadAllCalled).toBe(true);

        // Both keys should be in the in-memory store now (no load-on-miss needed)
        expect(map.containsKey('k1')).toBe(true);
        expect(map.containsKey('k2')).toBe(true);
    });

    it('EAGER mode with empty store: no-op (no crash)', async () => {
        const mockStore = new SeedingMapStore(new Map());
        const storeConfig = new MapStoreConfig()
            .setEnabled(true)
            .setInitialLoadMode(InitialLoadMode.EAGER)
            .setImplementation(mockStore);

        const config = new HeliosConfig('eager-empty');
        const mapConfig = new MapConfig('eager-empty-map');
        mapConfig.setMapStoreConfig(storeConfig);
        config.addMapConfig(mapConfig);
        instance = new HeliosInstanceImpl(config);

        const map = instance.getMap<string, string>('eager-empty-map');
        await map.put('k', 'v'); // should not throw

        expect(mockStore.loadAllKeysCalled).toBe(true);
        expect(map.containsKey('k')).toBe(true);
    });

    it('LAZY mode: load-on-miss does not pre-populate other keys', async () => {
        const seed = new Map([['k1', 'v1'], ['k2', 'v2']]);
        const mockStore = new SeedingMapStore(seed);
        const storeConfig = new MapStoreConfig()
            .setEnabled(true)
            .setImplementation(mockStore);

        const config = new HeliosConfig('lazy-miss');
        const mapConfig = new MapConfig('lazy-miss-map');
        mapConfig.setMapStoreConfig(storeConfig);
        config.addMapConfig(mapConfig);
        instance = new HeliosInstanceImpl(config);

        const map = instance.getMap<string, string>('lazy-miss-map');

        // Only k1 is accessed
        const v = await map.get('k1');
        expect(v).toBe('v1');

        // k2 is not in memory (was never accessed)
        // (we can't easily verify "not loaded" unless we check loadAllKeysCalled is false)
        expect(mockStore.loadAllKeysCalled).toBe(false);
    });
});
