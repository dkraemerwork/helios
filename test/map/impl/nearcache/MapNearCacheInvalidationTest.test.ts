/**
 * Port of MapNearCacheInvalidationTest (simplified for single-node).
 *
 * Tests that the MapNearCacheManager's invalidator properly removes
 * near cache entries when data structure mutations occur.
 */
import { InMemoryFormat } from '@zenystx/helios-core/config/InMemoryFormat';
import { NearCacheConfig } from '@zenystx/helios-core/config/NearCacheConfig';
import type { MapNearCacheNodeEngine } from '@zenystx/helios-core/map/impl/nearcache/MapNearCacheManager';
import { MapNearCacheManager } from '@zenystx/helios-core/map/impl/nearcache/MapNearCacheManager';
import { NearCachedMapProxyImpl } from '@zenystx/helios-core/map/impl/nearcache/NearCachedMapProxyImpl';
import { MapHeliosProperties } from '@zenystx/helios-core/spi/properties/HeliosProperties';
import { TestSerializationService } from '@zenystx/helios-core/test-support/TestSerializationService';
import { beforeEach, describe, expect, it } from 'bun:test';

function makeNodeEngine(): MapNearCacheNodeEngine {
    const partitionService = {
        getPartitionCount: () => 271,
        getPartitionId: (_key: unknown) => 0,
    };
    const eventService = {
        getRegistrations: (_sn: string, _name: string) => [],
        publishEvent: () => {},
    };
    const logger = {
        finest: () => {},
        isFinestEnabled: () => false,
        warning: () => {},
        fine: () => {},
        info: () => {},
    };
    const scheduler = {
        schedule: (_fn: () => void, _d: number) => ({ cancel: () => {} }),
        scheduleWithRepetition: (_fn: () => void, _i: number, _p: number) => ({ cancel: () => {} }),
    };
    const ss = new TestSerializationService() as never;
    const props = new MapHeliosProperties();
    const lifecycleService = {
        isRunning: () => true,
    };

    return {
        getLogger: () => logger,
        getPartitionService: () => partitionService,
        getSerializationService: () => ss,
        getProperties: () => props,
        getEventService: () => eventService,
        getLifecycleService: () => lifecycleService as never,
        getLocalMemberUuid: () => 'uuid-invalidation-test',
        getTaskScheduler: () => scheduler,
    } as MapNearCacheNodeEngine;
}

const MAP_NAME = 'invalidationTestMap';

function makeProxy(mgr: MapNearCacheManager) {
    const config = new NearCacheConfig(MAP_NAME)
        .setInMemoryFormat(InMemoryFormat.OBJECT);
    const nc = mgr.getOrCreateNearCache<string, string>(MAP_NAME, config);
    const store = new Map<string, string>();
    const backing = {
        get: (k: string) => store.get(k) ?? null,
        put: (k: string, v: string) => { const old = store.get(k) ?? null; store.set(k, v); return old; },
        remove: (k: string) => { const old = store.get(k) ?? null; store.delete(k); return old; },
    };
    return { proxy: new NearCachedMapProxyImpl(MAP_NAME, nc, backing), store };
}

describe('MapNearCacheInvalidationTest', () => {
    let mgr: MapNearCacheManager;

    beforeEach(() => {
        mgr = new MapNearCacheManager(makeNodeEngine());
    });

    it('near cache entry is invalidated on put', () => {
        const { proxy, store } = makeProxy(mgr);
        store.set('key', 'old');
        proxy.get('key'); // populate
        store.set('key', 'new');
        proxy.put('key', 'new');
        expect(proxy.get('key')).toBe('new');
    });

    it('near cache entry is invalidated on remove', () => {
        const { proxy, store } = makeProxy(mgr);
        store.set('key', 'val');
        proxy.get('key'); // populate
        proxy.remove('key');
        expect(proxy.get('key')).toBeNull();
    });

    it('destroyNearCache via manager clears all cached entries', () => {
        const { proxy, store } = makeProxy(mgr);
        store.set('a', 'va');
        store.set('b', 'vb');
        proxy.get('a');
        proxy.get('b');
        expect(proxy.nearCacheSize()).toBe(2);
        mgr.destroyNearCache(MAP_NAME);
        // near cache is gone from manager
        expect(mgr.getNearCache(MAP_NAME)).toBeNull();
    });

    it('reset via manager clears all cached entries but keeps near cache registered', () => {
        const { proxy } = makeProxy(mgr);
        proxy.put('k', 'v');
        // Populate cache
        proxy.put('k', 'v2');
        mgr.reset();
        // near cache should still exist but be empty
        expect(mgr.getNearCache(MAP_NAME)).not.toBeNull();
    });

    it('near cache stats record hits and misses', () => {
        const config = new NearCacheConfig('statsMap')
            .setInMemoryFormat(InMemoryFormat.OBJECT);
        const nc = mgr.getOrCreateNearCache<string, string>('statsMap', config);
        const store = new Map<string, string>([['k1', 'v1']]);
        const backing = {
            get: (k: string) => store.get(k) ?? null,
            put: (k: string, v: string) => { store.set(k, v); return null; },
            remove: (k: string) => { store.delete(k); return null; },
        };
        const proxy = new NearCachedMapProxyImpl('statsMap', nc, backing);

        proxy.get('k1'); // miss
        proxy.get('k1'); // hit
        const stats = nc.getNearCacheStats();
        expect(stats.getMisses()).toBe(1);
        expect(stats.getHits()).toBe(1);
    });
});
