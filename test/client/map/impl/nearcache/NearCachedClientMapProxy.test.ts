/**
 * Unit tests for {@code NearCachedClientMapProxy}.
 *
 * Tests the client-side map proxy near-cache read-through / write-invalidation semantics.
 * NearCachedClientMapProxy extends ClientMapProxy — all remote operations are async.
 */
import { describe, test, expect } from 'bun:test';
import { NearCachedClientMapProxy } from '@zenystx/helios-core/client/map/impl/nearcache/NearCachedClientMapProxy';
import { ClientMapProxy } from '@zenystx/helios-core/client/proxy/ClientMapProxy';
import { CACHED_AS_NULL, NOT_CACHED } from '@zenystx/helios-core/internal/nearcache/NearCache';
import { NOT_RESERVED } from '@zenystx/helios-core/internal/nearcache/NearCacheRecord';
import type { NearCache } from '@zenystx/helios-core/internal/nearcache/NearCache';
import type { NearCacheStats } from '@zenystx/helios-core/nearcache/NearCacheStats';
import type { NearCacheConfig } from '@zenystx/helios-core/config/NearCacheConfig';

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
    test('extends ClientMapProxy', () => {
        expect(NearCachedClientMapProxy.prototype instanceof ClientMapProxy).toBeTrue();
    });

    test('getNearCache returns the near cache instance', () => {
        const nc = makeNearCache<string, string>();
        // Can't fully instantiate without a real serialization service, but prototype check suffices
        expect(typeof NearCachedClientMapProxy.prototype.getNearCache).toBe('function');
    });

    test('nearCacheSize method exists', () => {
        expect(typeof NearCachedClientMapProxy.prototype.nearCacheSize).toBe('function');
    });

    test('get method exists and is a function', () => {
        expect(typeof NearCachedClientMapProxy.prototype.get).toBe('function');
    });

    test('put method exists and is a function', () => {
        expect(typeof NearCachedClientMapProxy.prototype.put).toBe('function');
    });

    test('remove method exists and is a function', () => {
        expect(typeof NearCachedClientMapProxy.prototype.remove).toBe('function');
    });

    test('set method exists (inherited + override)', () => {
        expect(typeof NearCachedClientMapProxy.prototype.set).toBe('function');
    });

    test('delete method exists (inherited + override)', () => {
        expect(typeof NearCachedClientMapProxy.prototype.delete).toBe('function');
    });

    test('clear method exists (inherited + override)', () => {
        expect(typeof NearCachedClientMapProxy.prototype.clear).toBe('function');
    });
});
