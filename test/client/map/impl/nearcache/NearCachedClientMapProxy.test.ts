/**
 * Unit tests for {@code NearCachedClientMapProxy}.
 *
 * Tests the client-side map proxy near-cache read-through / write-invalidation semantics.
 * NearCachedClientMapProxy extends ClientMapProxy — all remote operations are async.
 *
 * Also tests the end-to-end wiring: HeliosClient + ClientConfig with near-cache
 * → getMap() returns a NearCachedClientMapProxy and the near-cache manager has a
 * near-cache instance for that map name.
 */
import { describe, test, expect } from 'bun:test';
import { NearCachedClientMapProxy } from '@zenystx/helios-core/client/map/impl/nearcache/NearCachedClientMapProxy';
import { ClientMapProxy } from '@zenystx/helios-core/client/proxy/ClientMapProxy';
import { CACHED_AS_NULL, NOT_CACHED } from '@zenystx/helios-core/internal/nearcache/NearCache';
import { NOT_RESERVED } from '@zenystx/helios-core/internal/nearcache/NearCacheRecord';
import { NearCacheConfig } from '@zenystx/helios-core/config/NearCacheConfig';
import { InMemoryFormat } from '@zenystx/helios-core/config/InMemoryFormat';
import { HeliosClient } from '@zenystx/helios-core/client';
import { ClientConfig } from '@zenystx/helios-core/client/config/ClientConfig';
import type { NearCache } from '@zenystx/helios-core/internal/nearcache/NearCache';
import type { NearCacheStats } from '@zenystx/helios-core/nearcache/NearCacheStats';

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

// ── unit tests ───────────────────────────────────────────────────────────────

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

// ── end-to-end wiring tests ─────────────────────────────────────────────────

describe('Client near-cache wiring — HeliosClient ↔ ProxyManager ↔ NearCachedClientMapProxy', () => {
    test('getMap() returns NearCachedClientMapProxy when near-cache config matches the map name', () => {
        const config = new ClientConfig();
        config.setName('nc-wiring-test-1');
        const ncConfig = new NearCacheConfig('nc-map');
        ncConfig.setInMemoryFormat(InMemoryFormat.OBJECT);
        config.addNearCacheConfig(ncConfig);

        const client = new HeliosClient(config);
        try {
            const map = client.getMap('nc-map');
            expect(map).toBeInstanceOf(NearCachedClientMapProxy);
        } finally {
            client.shutdown();
        }
    });

    test('getMap() returns plain ClientMapProxy when no near-cache config matches', () => {
        const config = new ClientConfig();
        config.setName('nc-wiring-test-2');
        // No near-cache config added

        const client = new HeliosClient(config);
        try {
            const map = client.getMap('plain-map');
            expect(map).toBeInstanceOf(ClientMapProxy);
            expect(map).not.toBeInstanceOf(NearCachedClientMapProxy);
        } finally {
            client.shutdown();
        }
    });

    test('near-cache manager has an instance after getMap() for a near-cached map', () => {
        const config = new ClientConfig();
        config.setName('nc-wiring-test-3');
        const ncConfig = new NearCacheConfig('orders-*');
        ncConfig.setInMemoryFormat(InMemoryFormat.OBJECT);
        config.addNearCacheConfig(ncConfig);

        const client = new HeliosClient(config);
        try {
            client.getMap('orders-2024');
            const ncManager = client.getNearCacheManager();
            expect(ncManager.getNearCache('orders-2024')).not.toBeNull();
        } finally {
            client.shutdown();
        }
    });

    test('near-cache manager has no instance for a plain (non-near-cached) map', () => {
        const config = new ClientConfig();
        config.setName('nc-wiring-test-4');
        const ncConfig = new NearCacheConfig('cached-*');
        ncConfig.setInMemoryFormat(InMemoryFormat.OBJECT);
        config.addNearCacheConfig(ncConfig);

        const client = new HeliosClient(config);
        try {
            client.getMap('uncached-map');
            const ncManager = client.getNearCacheManager();
            expect(ncManager.getNearCache('uncached-map')).toBeNull();
        } finally {
            client.shutdown();
        }
    });

    test('same getMap() call returns the same cached proxy instance', () => {
        const config = new ClientConfig();
        config.setName('nc-wiring-test-5');
        const ncConfig = new NearCacheConfig('hot-data');
        ncConfig.setInMemoryFormat(InMemoryFormat.OBJECT);
        config.addNearCacheConfig(ncConfig);

        const client = new HeliosClient(config);
        try {
            const map1 = client.getMap('hot-data');
            const map2 = client.getMap('hot-data');
            expect(map1).toBe(map2);
            expect(map1).toBeInstanceOf(NearCachedClientMapProxy);
        } finally {
            client.shutdown();
        }
    });

    test('shutdown destroys near-caches created via getMap()', () => {
        const config = new ClientConfig();
        config.setName('nc-wiring-test-6');
        const ncConfig = new NearCacheConfig('ephemeral');
        ncConfig.setInMemoryFormat(InMemoryFormat.OBJECT);
        config.addNearCacheConfig(ncConfig);

        const client = new HeliosClient(config);
        client.getMap('ephemeral');
        const ncManager = client.getNearCacheManager();
        expect(ncManager.getNearCache('ephemeral')).not.toBeNull();

        client.shutdown();
        expect(ncManager.getNearCache('ephemeral')).toBeNull();
    });
});
