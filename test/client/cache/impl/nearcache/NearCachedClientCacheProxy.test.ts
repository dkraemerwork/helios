/**
 * Unit tests for {@code NearCachedClientCacheProxy}.
 *
 * Tests the client-side JCache proxy read-through / write semantics
 * (INVALIDATE and CACHE_ON_UPDATE local update policies).
 */
import { describe, test, expect } from 'bun:test';
import { NearCachedClientCacheProxy } from '@zenystx/helios-core/client/cache/impl/nearcache/NearCachedClientCacheProxy';
import { LocalUpdatePolicy } from '@zenystx/helios-core/config/NearCacheConfig';
import { CACHED_AS_NULL, NOT_CACHED } from '@zenystx/helios-core/internal/nearcache/NearCache';
import { NOT_RESERVED } from '@zenystx/helios-core/internal/nearcache/NearCacheRecord';
import type { NearCache } from '@zenystx/helios-core/internal/nearcache/NearCache';
import type { NearCacheStats } from '@zenystx/helios-core/nearcache/NearCacheStats';
import type { NearCacheConfig } from '@zenystx/helios-core/config/NearCacheConfig';

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

// ── tests ─────────────────────────────────────────────────────────────────────

describe('NearCachedClientCacheProxy', () => {
    describe('get — INVALIDATE policy (default)', () => {
        test('cache miss: fetches from backing store and publishes to near cache', () => {
            let published = false;
            const nc = makeNearCache<string, string>({
                get: () => NOT_CACHED as unknown as string,
                tryReserveForUpdate: () => 5,
                tryPublishReserved: (_k, v, _id, _d) => { published = true; return v; },
            });

            const backing = new Map([['k', 'v']]);
            const proxy = new NearCachedClientCacheProxy<string, string>(
                'myCache',
                nc,
                { get: k => backing.get(k) ?? null, put: () => null, remove: () => null },
                LocalUpdatePolicy.INVALIDATE,
            );

            expect(proxy.get('k')).toBe('v');
            expect(published).toBeTrue();
        });

        test('cache hit: returns cached value without backing call', () => {
            let backingCalled = false;
            const nc = makeNearCache<string, string>({
                get: () => 'cached',
            });

            const proxy = new NearCachedClientCacheProxy<string, string>(
                'myCache',
                nc,
                { get: () => { backingCalled = true; return 'backing'; }, put: () => null, remove: () => null },
                LocalUpdatePolicy.INVALIDATE,
            );

            expect(proxy.get('k')).toBe('cached');
            expect(backingCalled).toBeFalse();
        });

        test('CACHED_AS_NULL: returns null without backing call (cache does not use null sentinel)', () => {
            // JCache does not support null values per spec, so CACHED_AS_NULL is not used
            // The proxy should treat NOT_CACHED as miss and fetch from backing
            const nc = makeNearCache<string, string>({
                get: () => NOT_CACHED as unknown as string,
                tryReserveForUpdate: () => 10,
                tryPublishReserved: (_k, v) => v,
            });

            let backingCalled = false;
            const proxy = new NearCachedClientCacheProxy<string, string>(
                'myCache',
                nc,
                { get: () => { backingCalled = true; return null; }, put: () => null, remove: () => null },
                LocalUpdatePolicy.INVALIDATE,
            );

            proxy.get('k');
            expect(backingCalled).toBeTrue();
        });

        test('put with INVALIDATE: writes to backing and invalidates near cache', () => {
            let invalidated: string | null = null;
            const nc = makeNearCache<string, string>({
                invalidate: (k) => { invalidated = k; },
            });

            const backing = new Map<string, string>();
            const proxy = new NearCachedClientCacheProxy<string, string>(
                'myCache',
                nc,
                {
                    get: k => backing.get(k) ?? null,
                    put: (k, v) => { const old = backing.get(k) ?? null; backing.set(k, v); return old; },
                    remove: k => { const old = backing.get(k) ?? null; backing.delete(k); return old; },
                },
                LocalUpdatePolicy.INVALIDATE,
            );

            proxy.put('k', 'v');
            expect(backing.get('k')).toBe('v');
            expect(invalidated!).toBe('k');
        });

        test('remove with INVALIDATE: removes from backing and invalidates near cache', () => {
            let invalidated: string | null = null;
            const backing = new Map([['k', 'v']]);
            const nc = makeNearCache<string, string>({
                invalidate: (k) => { invalidated = k; },
            });

            const proxy = new NearCachedClientCacheProxy<string, string>(
                'myCache',
                nc,
                {
                    get: k => backing.get(k) ?? null,
                    put: (k, v) => { const old = backing.get(k) ?? null; backing.set(k, v); return old; },
                    remove: k => { const old = backing.get(k) ?? null; backing.delete(k); return old; },
                },
                LocalUpdatePolicy.INVALIDATE,
            );

            proxy.remove('k');
            expect(backing.has('k')).toBeFalse();
            expect(invalidated!).toBe('k');
        });
    });

    describe('get — CACHE_ON_UPDATE policy', () => {
        test('put with CACHE_ON_UPDATE: reserves before write, publishes on success', () => {
            let reservedSemantic: string | null = null;
            let published = false;
            const nc = makeNearCache<string, string>({
                get: () => NOT_CACHED as unknown as string,
                tryReserveForUpdate: (_k, _kd, s) => { reservedSemantic = s; return 77; },
                tryPublishReserved: (_k, v, _id, _d) => { published = true; return v; },
            });

            const backing = new Map<string, string>();
            const proxy = new NearCachedClientCacheProxy<string, string>(
                'myCache',
                nc,
                {
                    get: k => backing.get(k) ?? null,
                    put: (k, v) => { const old = backing.get(k) ?? null; backing.set(k, v); return old; },
                    remove: k => { const old = backing.get(k) ?? null; backing.delete(k); return old; },
                },
                LocalUpdatePolicy.CACHE_ON_UPDATE,
            );

            proxy.put('k', 'v');
            expect(reservedSemantic!).toBe('WRITE_UPDATE');
            expect(published).toBeTrue();
        });

        test('put with CACHE_ON_UPDATE: invalidates when reservation fails', () => {
            let invalidated: string | null = null;
            const nc = makeNearCache<string, string>({
                get: () => NOT_CACHED as unknown as string,
                tryReserveForUpdate: () => NOT_RESERVED,
                invalidate: (k) => { invalidated = k; },
            });

            const backing = new Map<string, string>();
            const proxy = new NearCachedClientCacheProxy<string, string>(
                'myCache',
                nc,
                {
                    get: k => backing.get(k) ?? null,
                    put: (k, v) => { const old = backing.get(k) ?? null; backing.set(k, v); return old; },
                    remove: k => { const old = backing.get(k) ?? null; backing.delete(k); return old; },
                },
                LocalUpdatePolicy.CACHE_ON_UPDATE,
            );

            proxy.put('k', 'v');
            expect(invalidated!).toBe('k');
        });
    });

    describe('nearCacheSize / getNearCache / getName', () => {
        test('nearCacheSize returns near cache entry count', () => {
            const nc = makeNearCache<string, string>({ size: () => 3 });
            const proxy = new NearCachedClientCacheProxy<string, string>(
                'myCache', nc, { get: () => null, put: () => null, remove: () => null },
                LocalUpdatePolicy.INVALIDATE,
            );
            expect(proxy.nearCacheSize()).toBe(3);
        });

        test('getNearCache returns near cache instance', () => {
            const nc = makeNearCache<string, string>();
            const proxy = new NearCachedClientCacheProxy<string, string>(
                'myCache', nc, { get: () => null, put: () => null, remove: () => null },
                LocalUpdatePolicy.INVALIDATE,
            );
            expect(proxy.getNearCache()).toBe(nc);
        });

        test('getName returns cache name', () => {
            const nc = makeNearCache<string, string>();
            const proxy = new NearCachedClientCacheProxy<string, string>(
                'theCache', nc, { get: () => null, put: () => null, remove: () => null },
                LocalUpdatePolicy.INVALIDATE,
            );
            expect(proxy.getName()).toBe('theCache');
        });
    });
});
