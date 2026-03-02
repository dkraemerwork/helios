/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.NearCacheManagerTest}.
 *
 * Tests NearCacheManager lifecycle: create, get, list, clear, destroy.
 */
import { describe, it, expect } from 'bun:test';
import { DefaultNearCacheManager } from '@helios/internal/nearcache/impl/DefaultNearCacheManager';
import { NearCacheConfig } from '@helios/config/NearCacheConfig';
import { InMemoryFormat } from '@helios/config/InMemoryFormat';
import { TestSerializationService } from '@helios/test-support/TestSerializationService';
import { MapHeliosProperties } from '@helios/spi/properties/HeliosProperties';
import { NoOpTaskScheduler } from '@helios/internal/nearcache/impl/TaskScheduler';

const DEFAULT_NEAR_CACHE_COUNT = 5;
const DEFAULT_NEAR_CACHE_NAME = 'TestNearCache';

function createNearCacheManager(): DefaultNearCacheManager {
    return new DefaultNearCacheManager(
        new TestSerializationService(),
        new NoOpTaskScheduler(),
        null,
        new MapHeliosProperties(),
    );
}

function createNearCacheConfig(name: string, inMemoryFormat: InMemoryFormat = InMemoryFormat.BINARY): NearCacheConfig {
    return new NearCacheConfig(name).setInMemoryFormat(inMemoryFormat);
}

describe('NearCacheManagerTest', () => {
    it('createAndGetNearCache', () => {
        const mgr = createNearCacheManager();

        expect(mgr.getNearCache(DEFAULT_NEAR_CACHE_NAME)).toBeNull();

        const nc1 = mgr.getOrCreateNearCache(DEFAULT_NEAR_CACHE_NAME, createNearCacheConfig(DEFAULT_NEAR_CACHE_NAME));
        expect(nc1).not.toBeNull();

        // Getting again returns same instance
        const nc2 = mgr.getOrCreateNearCache(DEFAULT_NEAR_CACHE_NAME, createNearCacheConfig(DEFAULT_NEAR_CACHE_NAME));
        expect(nc2).toBe(nc1);

        const all = mgr.listAllNearCaches();
        expect(all.length).toBe(1);
        expect(all[0]).toBe(nc1);
    });

    it('listNearCaches', () => {
        const mgr = createNearCacheManager();
        expect(mgr.listAllNearCaches().length).toBe(0);

        const names = new Set<string>();
        for (let i = 0; i < DEFAULT_NEAR_CACHE_COUNT; i++) {
            const name = `${DEFAULT_NEAR_CACHE_NAME}-${i}`;
            mgr.getOrCreateNearCache(name, createNearCacheConfig(name));
            names.add(name);
        }

        const all = mgr.listAllNearCaches();
        expect(all.length).toBe(DEFAULT_NEAR_CACHE_COUNT);
        for (const nc of all) {
            expect(names.has(nc.getName())).toBe(true);
        }
    });

    it('clearNearCacheAndClearAllNearCaches', () => {
        const mgr = createNearCacheManager();
        for (let i = 0; i < DEFAULT_NEAR_CACHE_COUNT; i++) {
            const name = `${DEFAULT_NEAR_CACHE_NAME}-${i}`;
            mgr.getOrCreateNearCache(name, createNearCacheConfig(name));
        }

        expect(mgr.listAllNearCaches().length).toBe(DEFAULT_NEAR_CACHE_COUNT);

        for (let i = 0; i < DEFAULT_NEAR_CACHE_COUNT; i++) {
            expect(mgr.clearNearCache(`${DEFAULT_NEAR_CACHE_NAME}-${i}`)).toBe(true);
        }

        // clear keeps the near caches, just clears them
        expect(mgr.listAllNearCaches().length).toBe(DEFAULT_NEAR_CACHE_COUNT);

        mgr.clearAllNearCaches();
        // clearAll also keeps them
        expect(mgr.listAllNearCaches().length).toBe(DEFAULT_NEAR_CACHE_COUNT);

        // non-existent cache returns false
        expect(mgr.clearNearCache(`${DEFAULT_NEAR_CACHE_NAME}-${DEFAULT_NEAR_CACHE_COUNT}`)).toBe(false);
    });

    it('destroyNearCacheAndDestroyAllNearCaches', () => {
        const mgr = createNearCacheManager();
        for (let i = 0; i < DEFAULT_NEAR_CACHE_COUNT; i++) {
            const name = `${DEFAULT_NEAR_CACHE_NAME}-${i}`;
            mgr.getOrCreateNearCache(name, createNearCacheConfig(name));
        }

        expect(mgr.listAllNearCaches().length).toBe(DEFAULT_NEAR_CACHE_COUNT);

        for (let i = 0; i < DEFAULT_NEAR_CACHE_COUNT; i++) {
            expect(mgr.destroyNearCache(`${DEFAULT_NEAR_CACHE_NAME}-${i}`)).toBe(true);
        }

        // destroy removes them
        expect(mgr.listAllNearCaches().length).toBe(0);

        // non-existent returns false
        expect(mgr.clearNearCache(`${DEFAULT_NEAR_CACHE_NAME}-${DEFAULT_NEAR_CACHE_COUNT}`)).toBe(false);

        // Re-create them
        for (let i = 0; i < DEFAULT_NEAR_CACHE_COUNT; i++) {
            const name = `${DEFAULT_NEAR_CACHE_NAME}-${i}`;
            mgr.getOrCreateNearCache(name, createNearCacheConfig(name));
        }
        expect(mgr.listAllNearCaches().length).toBe(DEFAULT_NEAR_CACHE_COUNT);

        mgr.destroyAllNearCaches();
        expect(mgr.listAllNearCaches().length).toBe(0);
    });
});
