/**
 * Port of {@code com.hazelcast.client.map.impl.nearcache.NearCacheIsNotSharedTest}.
 *
 * Verifies that near caches are not shared across different data structure types
 * (or different manager instances) even when they share the same configured name.
 */
import { describe, test, expect } from 'bun:test';
import { NearCachedClientMapProxy } from '@helios/client/map/impl/nearcache/NearCachedClientMapProxy';
import { NOT_CACHED } from '@helios/internal/nearcache/NearCache';
import type { NearCache } from '@helios/internal/nearcache/NearCache';
import type { NearCacheStats } from '@helios/nearcache/NearCacheStats';
import type { NearCacheConfig } from '@helios/config/NearCacheConfig';

// ── helper ────────────────────────────────────────────────────────────────────

/** In-memory near cache with proper NOT_CACHED sentinel for misses. */
function makeSeparateNearCache<K, V>(name: string): NearCache<K, V> {
    const store = new Map<K, unknown>();
    let nextId = 1;
    const reservations = new Map<K, number>();
    return {
        initialize: () => {},
        getName: () => name,
        getNearCacheConfig: () => ({} as NearCacheConfig),
        get: (k: K) => {
            if (!store.has(k)) return NOT_CACHED as unknown as V;
            return store.get(k) as V | null;
        },
        put: (k: K, _kd, v: V | null, _vd) => { store.set(k, v); },
        invalidate: (k: K) => { store.delete(k); reservations.delete(k); },
        clear: () => { store.clear(); reservations.clear(); },
        destroy: () => {},
        size: () => store.size,
        getNearCacheStats: () => ({} as NearCacheStats),
        isSerializeKeys: () => false,
        preload: () => {},
        storeKeys: () => {},
        isPreloadDone: () => true,
        unwrap: () => { throw new Error('unwrap'); },
        tryReserveForUpdate: (k: K) => {
            const id = nextId++;
            reservations.set(k, id);
            return id;
        },
        tryPublishReserved: (k: K, v: V | null, id: number, _d: boolean) => {
            if (reservations.get(k) === id) {
                store.set(k, v);
                reservations.delete(k);
            }
            return v;
        },
    };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('NearCacheIsNotSharedTest', () => {
    test('near cache should not be shared between different data structure types with same name', () => {
        const mapNearCache = makeSeparateNearCache<string, string>('test');
        const replicatedMapNearCache = makeSeparateNearCache<string, string>('test');

        const mapBacking = new Map<string, string>();
        const replicatedMapBacking = new Map<string, string>();

        const mapProxy = new NearCachedClientMapProxy<string, string>(
            'test',
            mapNearCache,
            {
                get: k => mapBacking.get(k) ?? null,
                put: (k, v) => { const old = mapBacking.get(k) ?? null; mapBacking.set(k, v); return old; },
                remove: k => { const old = mapBacking.get(k) ?? null; mapBacking.delete(k); return old; },
            },
        );

        const replicatedMapProxy = new NearCachedClientMapProxy<string, string>(
            'test',
            replicatedMapNearCache,
            {
                get: k => replicatedMapBacking.get(k) ?? null,
                put: (k, v) => { const old = replicatedMapBacking.get(k) ?? null; replicatedMapBacking.set(k, v); return old; },
                remove: k => { const old = replicatedMapBacking.get(k) ?? null; replicatedMapBacking.delete(k); return old; },
            },
        );

        replicatedMapProxy.put('key', 'replicated-map-value');
        mapProxy.put('key', 'map-value');

        // Warm the map near cache
        mapProxy.get('key');

        // Reading from replicatedMap proxy should return its own value, NOT the map value
        expect(replicatedMapProxy.get('key')).toBe('replicated-map-value');
    });

    test('two map proxies with same name but different near cache instances use separate entry stores', () => {
        const nc1 = makeSeparateNearCache<string, string>('shared-name');
        const nc2 = makeSeparateNearCache<string, string>('shared-name');

        const backing1 = new Map([['k', 'v1']]);
        const backing2 = new Map([['k', 'v2']]);

        const proxy1 = new NearCachedClientMapProxy<string, string>(
            'shared-name', nc1,
            { get: k => backing1.get(k) ?? null, put: () => null, remove: () => null },
        );
        const proxy2 = new NearCachedClientMapProxy<string, string>(
            'shared-name', nc2,
            { get: k => backing2.get(k) ?? null, put: () => null, remove: () => null },
        );

        expect(proxy1.get('k')).toBe('v1');
        expect(proxy2.get('k')).toBe('v2');
        expect(proxy1.getNearCache()).not.toBe(proxy2.getNearCache());
    });

    test('write to map near cache does not invalidate replicated map near cache entry', () => {
        const mapNearCache = makeSeparateNearCache<string, string>('test');
        const replicatedMapNearCache = makeSeparateNearCache<string, string>('test');

        const mapBacking = new Map([['k', 'map-val']]);
        const replicatedBacking = new Map([['k', 'rep-val']]);

        const mapProxy = new NearCachedClientMapProxy<string, string>(
            'test', mapNearCache,
            {
                get: k => mapBacking.get(k) ?? null,
                put: (k, v) => { const old = mapBacking.get(k) ?? null; mapBacking.set(k, v); return old; },
                remove: k => { const old = mapBacking.get(k) ?? null; mapBacking.delete(k); return old; },
            },
        );
        const replicatedProxy = new NearCachedClientMapProxy<string, string>(
            'test', replicatedMapNearCache,
            {
                get: k => replicatedBacking.get(k) ?? null,
                put: (k, v) => { const old = replicatedBacking.get(k) ?? null; replicatedBacking.set(k, v); return old; },
                remove: k => { const old = replicatedBacking.get(k) ?? null; replicatedBacking.delete(k); return old; },
            },
        );

        // Warm both near caches
        expect(replicatedProxy.get('k')).toBe('rep-val');
        expect(mapProxy.get('k')).toBe('map-val');

        // Writing to map invalidates map near cache but NOT replicatedMap near cache
        mapProxy.put('k', 'new-map-val');

        // replicated near cache still holds cached value
        expect(replicatedProxy.get('k')).toBe('rep-val');
    });
});
