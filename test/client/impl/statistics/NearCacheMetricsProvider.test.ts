/**
 * Unit tests for {@code NearCacheMetricsProvider}.
 *
 * Port of concepts from
 * {@code com.hazelcast.client.impl.statistics.NearCacheMetricsProvider}.
 */
import { NearCacheMetricsProvider } from '@zenystx/helios-core/client/impl/statistics/NearCacheMetricsProvider';
import type { NearCacheConfig } from '@zenystx/helios-core/config/NearCacheConfig';
import type { NearCache } from '@zenystx/helios-core/internal/nearcache/NearCache';
import { NOT_CACHED } from '@zenystx/helios-core/internal/nearcache/NearCache';
import type { NearCacheManager } from '@zenystx/helios-core/internal/nearcache/NearCacheManager';
import type { NearCacheStats } from '@zenystx/helios-core/nearcache/NearCacheStats';
import { describe, expect, test } from 'bun:test';

function makeStats(hits: number, misses: number): NearCacheStats {
    return {
        getHits: () => hits,
        getMisses: () => misses,
        getOwnedEntryCount: () => 0,
        getOwnedEntryMemoryCost: () => 0,
        getExpirations: () => 0,
        getEvictions: () => 0,
        getInvalidations: () => 0,
        getInvalidationRequests: () => 0,
        getPersistenceCount: () => 0,
        getLastPersistenceTime: () => 0,
        getLastPersistenceKeyCount: () => 0,
        getLastPersistenceStorageSize: () => 0,
        getLastPersistenceDuration: () => 0,
        getLastPersistenceFailure: () => '',
        setOwnedEntryCount: () => {},
        setOwnedEntryMemoryCost: () => {},
        incrementHits: () => {},
        incrementMisses: () => {},
        incrementExpirations: () => {},
        incrementEvictions: () => {},
        incrementInvalidations: () => {},
        incrementInvalidationRequests: () => {},
        toString: () => '',
    } as unknown as NearCacheStats;
}

function makeNearCache(name: string, stats: NearCacheStats): NearCache {
    return {
        initialize: () => {},
        getName: () => name,
        getNearCacheConfig: () => ({} as NearCacheConfig),
        get: () => NOT_CACHED,
        put: () => {},
        invalidate: () => {},
        clear: () => {},
        destroy: () => {},
        size: () => 0,
        getNearCacheStats: () => stats,
        isSerializeKeys: () => false,
        preload: () => {},
        storeKeys: () => {},
        isPreloadDone: () => true,
        unwrap: () => { throw new Error(); },
        tryReserveForUpdate: () => -1,
        tryPublishReserved: (_k: unknown, v: unknown) => v,
    } as unknown as NearCache;
}

function makeMgr(nearCaches: NearCache[]): NearCacheManager {
    return {
        getNearCache: () => null,
        getOrCreateNearCache: () => { throw new Error(); },
        startPreloading: () => {},
        listAllNearCaches: () => nearCaches,
        clearNearCache: () => false,
        clearAllNearCaches: () => {},
        destroyNearCache: () => false,
        destroyAllNearCaches: () => {},
    };
}

describe('NearCacheMetricsProvider', () => {
    test('collectAll returns empty map when no managers are provided', () => {
        const provider = new NearCacheMetricsProvider([]);
        const result = provider.collectAll();
        expect(result.size).toBe(0);
    });

    test('collectAll returns stats for all near caches across all managers', () => {
        const stats1 = makeStats(10, 5);
        const stats2 = makeStats(20, 3);
        const nc1 = makeNearCache('mapA', stats1);
        const nc2 = makeNearCache('mapB', stats2);

        const mgr1 = makeMgr([nc1]);
        const mgr2 = makeMgr([nc2]);

        const provider = new NearCacheMetricsProvider([mgr1, mgr2]);
        const result = provider.collectAll();

        expect(result.size).toBe(2);
        expect(result.get('mapA')).toBe(stats1);
        expect(result.get('mapB')).toBe(stats2);
    });

    test('collectAll handles single manager with multiple near caches', () => {
        const stats1 = makeStats(1, 0);
        const stats2 = makeStats(2, 1);
        const stats3 = makeStats(3, 2);
        const nc1 = makeNearCache('a', stats1);
        const nc2 = makeNearCache('b', stats2);
        const nc3 = makeNearCache('c', stats3);

        const mgr = makeMgr([nc1, nc2, nc3]);
        const provider = new NearCacheMetricsProvider([mgr]);
        const result = provider.collectAll();

        expect(result.size).toBe(3);
        expect(result.get('a')).toBe(stats1);
        expect(result.get('b')).toBe(stats2);
        expect(result.get('c')).toBe(stats3);
    });

    test('collectAll returns empty map when manager has no near caches', () => {
        const mgr = makeMgr([]);
        const provider = new NearCacheMetricsProvider([mgr]);
        expect(provider.collectAll().size).toBe(0);
    });
});
