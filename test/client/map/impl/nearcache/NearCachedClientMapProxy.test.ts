/**
 * Unit tests for {@code NearCachedClientMapProxy}.
 *
 * Tests the client-side map proxy read-through / write-invalidation semantics
 * without requiring a live cluster.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { NearCachedClientMapProxy } from '@zenystx/core/client/map/impl/nearcache/NearCachedClientMapProxy';
import { CACHED_AS_NULL, NOT_CACHED } from '@zenystx/core/internal/nearcache/NearCache';
import { NOT_RESERVED } from '@zenystx/core/internal/nearcache/NearCacheRecord';
import type { NearCache } from '@zenystx/core/internal/nearcache/NearCache';
import type { NearCacheStats } from '@zenystx/core/nearcache/NearCacheStats';
import type { NearCacheConfig } from '@zenystx/core/config/NearCacheConfig';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeNearCache<K, V>(overrides: Partial<NearCache<K, V>> = {}): NearCache<K, V> {
    const store = new Map<K, unknown>();
    let size = 0;
    return {
        initialize: () => {},
        getName: () => 'test-cache',
        getNearCacheConfig: () => ({} as NearCacheConfig),
        get: (k: K) => {
            if (!store.has(k)) return NOT_CACHED as unknown as V;
            return store.get(k) as V | null;
        },
        put: (k: K, _kd, v: V | null, _vd) => { store.set(k, v); size++; },
        invalidate: (k: K) => { store.delete(k); if (size > 0) size--; },
        clear: () => { store.clear(); size = 0; },
        destroy: () => {},
        size: () => size,
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

describe('NearCachedClientMapProxy', () => {
    describe('get — cache miss path', () => {
        test('fetches from backing store on cache miss and populates near cache', () => {
            let publishCalled = false;
            const nc = makeNearCache<string, string>({
                get: () => NOT_CACHED as unknown as string,
                tryReserveForUpdate: () => 42,
                tryPublishReserved: (_k, v, _id, _d) => { publishCalled = true; return v; },
            });

            const backing = new Map([['key', 'value']]);
            const proxy = new NearCachedClientMapProxy<string, string>(
                'test',
                nc,
                { get: k => backing.get(k) ?? null, put: () => null, remove: () => null },
            );

            const result = proxy.get('key');
            expect(result).toBe('value');
            expect(publishCalled).toBeTrue();
        });

        test('returns null when backing store has no value for key', () => {
            const nc = makeNearCache<string, string>({
                get: () => NOT_CACHED as unknown as string,
                tryReserveForUpdate: () => 42,
                tryPublishReserved: (_k, v, _id, _d) => v,
            });

            const proxy = new NearCachedClientMapProxy<string, string>(
                'test',
                nc,
                { get: () => null, put: () => null, remove: () => null },
            );

            expect(proxy.get('missing')).toBeNull();
        });

        test('does not call tryPublishReserved when reservation fails', () => {
            let publishCalled = false;
            const nc = makeNearCache<string, string>({
                get: () => NOT_CACHED as unknown as string,
                tryReserveForUpdate: () => NOT_RESERVED,
                tryPublishReserved: () => { publishCalled = true; return null; },
            });

            const proxy = new NearCachedClientMapProxy<string, string>(
                'test',
                nc,
                { get: () => 'val', put: () => null, remove: () => null },
            );

            proxy.get('key');
            expect(publishCalled).toBeFalse();
        });
    });

    describe('get — cache hit path', () => {
        test('returns cached value without calling backing store', () => {
            let backingCalled = false;
            const nc = makeNearCache<string, string>({
                get: () => 'cached-value',
            });

            const proxy = new NearCachedClientMapProxy<string, string>(
                'test',
                nc,
                { get: () => { backingCalled = true; return 'backing'; }, put: () => null, remove: () => null },
            );

            const result = proxy.get('key');
            expect(result).toBe('cached-value');
            expect(backingCalled).toBeFalse();
        });

        test('returns null and does not call backing store when value cached as null', () => {
            let backingCalled = false;
            const nc = makeNearCache<string, string>({
                get: () => CACHED_AS_NULL as unknown as string,
            });

            const proxy = new NearCachedClientMapProxy<string, string>(
                'test',
                nc,
                { get: () => { backingCalled = true; return 'backing'; }, put: () => null, remove: () => null },
            );

            const result = proxy.get('key');
            expect(result).toBeNull();
            expect(backingCalled).toBeFalse();
        });
    });

    describe('put — write invalidation', () => {
        test('writes to backing store and invalidates near cache', () => {
            let invalidated: string | null = null;
            const nc = makeNearCache<string, string>({
                invalidate: (k) => { invalidated = k; },
            });

            const backing = new Map<string, string>();
            const proxy = new NearCachedClientMapProxy<string, string>(
                'test',
                nc,
                {
                    get: k => backing.get(k) ?? null,
                    put: (k, v) => { const old = backing.get(k) ?? null; backing.set(k, v); return old; },
                    remove: k => { const old = backing.get(k) ?? null; backing.delete(k); return old; },
                },
            );

            proxy.put('key', 'value');
            expect(backing.get('key')).toBe('value');
            expect(invalidated!).toBe('key');
        });

        test('returns previous value from backing store on put', () => {
            const backing = new Map([['key', 'old']]);
            const nc = makeNearCache<string, string>();
            const proxy = new NearCachedClientMapProxy<string, string>(
                'test',
                nc,
                {
                    get: k => backing.get(k) ?? null,
                    put: (k, v) => { const old = backing.get(k) ?? null; backing.set(k, v); return old; },
                    remove: k => { const old = backing.get(k) ?? null; backing.delete(k); return old; },
                },
            );

            const old = proxy.put('key', 'new');
            expect(old).toBe('old');
        });
    });

    describe('remove — write invalidation', () => {
        test('removes from backing store and invalidates near cache', () => {
            let invalidated: string | null = null;
            const backing = new Map([['key', 'value']]);
            const nc = makeNearCache<string, string>({
                invalidate: (k) => { invalidated = k; },
            });

            const proxy = new NearCachedClientMapProxy<string, string>(
                'test',
                nc,
                {
                    get: k => backing.get(k) ?? null,
                    put: (k, v) => { const old = backing.get(k) ?? null; backing.set(k, v); return old; },
                    remove: k => { const old = backing.get(k) ?? null; backing.delete(k); return old; },
                },
            );

            const removed = proxy.remove('key');
            expect(removed).toBe('value');
            expect(backing.has('key')).toBeFalse();
            expect(invalidated!).toBe('key');
        });
    });

    describe('nearCacheSize / getNearCache', () => {
        test('nearCacheSize returns near cache entry count', () => {
            const nc = makeNearCache<string, string>({
                size: () => 7,
            });
            const proxy = new NearCachedClientMapProxy<string, string>(
                'test', nc, { get: () => null, put: () => null, remove: () => null },
            );
            expect(proxy.nearCacheSize()).toBe(7);
        });

        test('getNearCache returns the near cache instance', () => {
            const nc = makeNearCache<string, string>();
            const proxy = new NearCachedClientMapProxy<string, string>(
                'test', nc, { get: () => null, put: () => null, remove: () => null },
            );
            expect(proxy.getNearCache()).toBe(nc);
        });
    });

    describe('getName', () => {
        test('returns proxy name', () => {
            const nc = makeNearCache<string, string>();
            const proxy = new NearCachedClientMapProxy<string, string>(
                'myMap', nc, { get: () => null, put: () => null, remove: () => null },
            );
            expect(proxy.getName()).toBe('myMap');
        });
    });
});
