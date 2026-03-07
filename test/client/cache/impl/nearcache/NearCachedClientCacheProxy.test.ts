/**
 * Unit tests for {@code NearCachedClientCacheProxy}.
 *
 * Tests the client-side JCache proxy read-through / write semantics
 * (INVALIDATE and CACHE_ON_UPDATE local update policies).
 * The backing store is now async (AsyncCacheBackingStore).
 */
import type { AsyncCacheBackingStore } from '@zenystx/helios-core/client/cache/impl/nearcache/NearCachedClientCacheProxy';
import { NearCachedClientCacheProxy } from '@zenystx/helios-core/client/cache/impl/nearcache/NearCachedClientCacheProxy';
import type { NearCacheConfig } from '@zenystx/helios-core/config/NearCacheConfig';
import { LocalUpdatePolicy } from '@zenystx/helios-core/config/NearCacheConfig';
import type { NearCache } from '@zenystx/helios-core/internal/nearcache/NearCache';
import { NOT_CACHED } from '@zenystx/helios-core/internal/nearcache/NearCache';
import { NOT_RESERVED } from '@zenystx/helios-core/internal/nearcache/NearCacheRecord';
import type { NearCacheStats } from '@zenystx/helios-core/nearcache/NearCacheStats';
import { describe, expect, test } from 'bun:test';

// ── helper ────────────────────────────────────────────────────────────────────

function makeNearCache<K, V>(overrides: Partial<NearCache<K, V>> = {}): NearCache<K, V> {
    const store = new Map<K, unknown>();
    return {
        initialize: () => {},
        getName: () => 'test-cache',
        getNearCacheConfig: () => ({} as NearCacheConfig),
        get: (k: K) => {
            if (!store.has(k)) return NOT_CACHED as unknown as V;
            return store.get(k) as V | null;
        },
        put: (k: K, _kd, v: V | null, _vd) => { store.set(k, v); },
        invalidate: (k: K) => { store.delete(k); },
        clear: () => { store.clear(); },
        destroy: () => {},
        size: () => store.size,
        getNearCacheStats: () => ({} as NearCacheStats),
        isSerializeKeys: () => false,
        preload: () => {},
        storeKeys: () => {},
        isPreloadDone: () => true,
        unwrap: () => { throw new Error('unwrap'); },
        tryReserveForUpdate: (_k, _kd, _s) => 1,
        tryPublishReserved: (_k, v, _id, _d) => v,
        ...overrides,
    };
}

function makeAsyncBacking<K extends string, V>(store: Map<K, V>): AsyncCacheBackingStore<K, V> {
    return {
        get: async (k: K) => store.get(k) ?? null,
        put: async (k: K, v: V) => { const old = store.get(k) ?? null; store.set(k, v); return old; },
        remove: async (k: K) => { const old = store.get(k) ?? null; store.delete(k); return old; },
    };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('NearCachedClientCacheProxy', () => {
    describe('get — INVALIDATE policy (default)', () => {
        test('cache miss: fetches from async backing store and publishes to near cache', async () => {
            let published = false;
            const nc = makeNearCache<string, string>({
                get: () => NOT_CACHED as unknown as string,
                tryReserveForUpdate: () => 5,
                tryPublishReserved: (_k, v, _id, _d) => { published = true; return v; },
            });

            const backing = new Map([['k', 'v']]) as Map<string, string>;
            const proxy = new NearCachedClientCacheProxy<string, string>(
                'myCache', nc, makeAsyncBacking(backing), LocalUpdatePolicy.INVALIDATE,
            );

            expect(await proxy.get('k')).toBe('v');
            expect(published).toBeTrue();
        });

        test('cache hit: returns cached value without backing call', async () => {
            let backingCalled = false;
            const nc = makeNearCache<string, string>({
                get: () => 'cached',
            });

            const proxy = new NearCachedClientCacheProxy<string, string>(
                'myCache', nc,
                { get: async () => { backingCalled = true; return 'backing'; }, put: async () => null, remove: async () => null },
                LocalUpdatePolicy.INVALIDATE,
            );

            expect(await proxy.get('k')).toBe('cached');
            expect(backingCalled).toBeFalse();
        });

        test('put with INVALIDATE: writes to backing and invalidates near cache', async () => {
            let invalidated: string | null = null;
            const nc = makeNearCache<string, string>({
                invalidate: (k) => { invalidated = k; },
            });

            const backing = new Map<string, string>();
            const proxy = new NearCachedClientCacheProxy<string, string>(
                'myCache', nc, makeAsyncBacking(backing), LocalUpdatePolicy.INVALIDATE,
            );

            await proxy.put('k', 'v');
            expect(backing.get('k')).toBe('v');
            expect(invalidated!).toBe('k');
        });

        test('remove with INVALIDATE: removes from backing and invalidates near cache', async () => {
            let invalidated: string | null = null;
            const backing = new Map([['k', 'v']]) as Map<string, string>;
            const nc = makeNearCache<string, string>({
                invalidate: (k) => { invalidated = k; },
            });

            const proxy = new NearCachedClientCacheProxy<string, string>(
                'myCache', nc, makeAsyncBacking(backing), LocalUpdatePolicy.INVALIDATE,
            );

            await proxy.remove('k');
            expect(backing.has('k')).toBeFalse();
            expect(invalidated!).toBe('k');
        });
    });

    describe('put — CACHE_ON_UPDATE policy', () => {
        test('reserves before write, publishes on success', async () => {
            let reservedSemantic: string | null = null;
            let published = false;
            const nc = makeNearCache<string, string>({
                get: () => NOT_CACHED as unknown as string,
                tryReserveForUpdate: (_k, _kd, s) => { reservedSemantic = s; return 77; },
                tryPublishReserved: (_k, v, _id, _d) => { published = true; return v; },
            });

            const backing = new Map<string, string>();
            const proxy = new NearCachedClientCacheProxy<string, string>(
                'myCache', nc, makeAsyncBacking(backing), LocalUpdatePolicy.CACHE_ON_UPDATE,
            );

            await proxy.put('k', 'v');
            expect(reservedSemantic!).toBe('WRITE_UPDATE');
            expect(published).toBeTrue();
        });

        test('invalidates when reservation fails', async () => {
            let invalidated: string | null = null;
            const nc = makeNearCache<string, string>({
                get: () => NOT_CACHED as unknown as string,
                tryReserveForUpdate: () => NOT_RESERVED,
                invalidate: (k) => { invalidated = k; },
            });

            const backing = new Map<string, string>();
            const proxy = new NearCachedClientCacheProxy<string, string>(
                'myCache', nc, makeAsyncBacking(backing), LocalUpdatePolicy.CACHE_ON_UPDATE,
            );

            await proxy.put('k', 'v');
            expect(invalidated!).toBe('k');
        });
    });

    describe('nearCacheSize / getNearCache / getName', () => {
        test('nearCacheSize returns near cache entry count', () => {
            const nc = makeNearCache<string, string>({ size: () => 3 });
            const proxy = new NearCachedClientCacheProxy<string, string>(
                'myCache', nc,
                { get: async () => null, put: async () => null, remove: async () => null },
                LocalUpdatePolicy.INVALIDATE,
            );
            expect(proxy.nearCacheSize()).toBe(3);
        });

        test('getNearCache returns near cache instance', () => {
            const nc = makeNearCache<string, string>();
            const proxy = new NearCachedClientCacheProxy<string, string>(
                'myCache', nc,
                { get: async () => null, put: async () => null, remove: async () => null },
                LocalUpdatePolicy.INVALIDATE,
            );
            expect(proxy.getNearCache()).toBe(nc);
        });

        test('getName returns cache name', () => {
            const nc = makeNearCache<string, string>();
            const proxy = new NearCachedClientCacheProxy<string, string>(
                'theCache', nc,
                { get: async () => null, put: async () => null, remove: async () => null },
                LocalUpdatePolicy.INVALIDATE,
            );
            expect(proxy.getName()).toBe('theCache');
        });
    });
});
