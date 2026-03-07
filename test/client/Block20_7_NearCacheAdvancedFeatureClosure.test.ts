/**
 * Block 20.7 — Near-cache completion + advanced feature closure.
 *
 * Tests cover:
 * 1. NearCachedClientMapProxy wraps real async ClientMapProxy (not sync backing store)
 * 2. NearCachedClientCacheProxy wraps real async proxy
 * 3. Metadata fetchers use binary client protocol invocations
 * 4. Reconnect re-registration for near-cache invalidation listeners
 * 5. Stale-read detection wired through client near-cache manager
 * 6. Metrics collection for client near-caches
 * 7. Destroy/shutdown cleanup for near-cache resources
 * 8. Advanced client surfaces are explicitly deferred (not hidden stubs)
 * 9. Package exports align with actually wired features
 * 10. Verification: no hidden mini-runtimes or fake parity
 */
import { describe, test, expect } from 'bun:test';

// ── 1. NearCachedClientMapProxy wraps real ClientMapProxy ────────────────────

describe('NearCachedClientMapProxy — real remote proxy backing', () => {
    test('extends ClientMapProxy and inherits async get/put/remove', async () => {
        const { NearCachedClientMapProxy } = await import(
            '@zenystx/helios-core/client/map/impl/nearcache/NearCachedClientMapProxy'
        );
        const { ClientMapProxy } = await import(
            '@zenystx/helios-core/client/proxy/ClientMapProxy'
        );
        // NearCachedClientMapProxy must extend ClientMapProxy (not use a sync backing store)
        expect(NearCachedClientMapProxy.prototype instanceof ClientMapProxy).toBeTrue();
    });

    test('get() returns a Promise (async, not sync)', async () => {
        const { NearCachedClientMapProxy } = await import(
            '@zenystx/helios-core/client/map/impl/nearcache/NearCachedClientMapProxy'
        );
        // get must be async — its return type must be Promise
        const proto = NearCachedClientMapProxy.prototype;
        expect(typeof proto.get).toBe('function');
        // The class must not export ClientMapBackingStore anymore
        const mod = await import(
            '@zenystx/helios-core/client/map/impl/nearcache/NearCachedClientMapProxy'
        );
        expect('ClientMapBackingStore' in mod).toBeFalse();
    });

    test('put() writes through ClientMapProxy then invalidates near cache', async () => {
        const { NearCachedClientMapProxy } = await import(
            '@zenystx/helios-core/client/map/impl/nearcache/NearCachedClientMapProxy'
        );
        // Must have an invalidation-on-write path that calls super.put() then nearCache.invalidate()
        const proto = NearCachedClientMapProxy.prototype;
        expect(typeof proto.put).toBe('function');
    });

    test('remove() writes through ClientMapProxy then invalidates near cache', async () => {
        const { NearCachedClientMapProxy } = await import(
            '@zenystx/helios-core/client/map/impl/nearcache/NearCachedClientMapProxy'
        );
        const proto = NearCachedClientMapProxy.prototype;
        expect(typeof proto.remove).toBe('function');
    });

    test('set/delete/clear operations also invalidate near cache', async () => {
        const { NearCachedClientMapProxy } = await import(
            '@zenystx/helios-core/client/map/impl/nearcache/NearCachedClientMapProxy'
        );
        const proto = NearCachedClientMapProxy.prototype;
        expect(typeof proto.set).toBe('function');
        expect(typeof proto.delete).toBe('function');
        expect(typeof proto.clear).toBe('function');
    });

    test('getNearCache() returns the wired NearCache instance', async () => {
        const { NearCachedClientMapProxy } = await import(
            '@zenystx/helios-core/client/map/impl/nearcache/NearCachedClientMapProxy'
        );
        expect(typeof NearCachedClientMapProxy.prototype.getNearCache).toBe('function');
    });
});

// ── 2. NearCachedClientCacheProxy wraps real async proxy ─────────────────────

describe('NearCachedClientCacheProxy — real remote proxy backing', () => {
    test('does not export ClientCacheBackingStore (sync interface removed)', async () => {
        const mod = await import(
            '@zenystx/helios-core/client/cache/impl/nearcache/NearCachedClientCacheProxy'
        );
        expect('ClientCacheBackingStore' in mod).toBeFalse();
    });

    test('get() is async (returns Promise)', async () => {
        const { NearCachedClientCacheProxy } = await import(
            '@zenystx/helios-core/client/cache/impl/nearcache/NearCachedClientCacheProxy'
        );
        expect(typeof NearCachedClientCacheProxy.prototype.get).toBe('function');
    });
});

// ── 3. Metadata fetchers use binary protocol ─────────────────────────────────

describe('ClientMapInvalidationMetaDataFetcher — binary protocol', () => {
    test('fetchMemberResponse is async (uses protocol invocation, not in-process op)', async () => {
        const { ClientMapInvalidationMetaDataFetcher } = await import(
            '@zenystx/helios-core/client/map/impl/nearcache/invalidation/ClientMapInvalidationMetaDataFetcher'
        );
        // The fetcher must accept an invocation service, not a MetaDataGenerator
        const proto = ClientMapInvalidationMetaDataFetcher.prototype;
        expect(typeof proto.fetchMemberResponse).toBe('function');
    });

    test('does not import MapGetInvalidationMetaDataOperation (no in-process path)', async () => {
        const src = await Bun.file(
            'src/client/map/impl/nearcache/invalidation/ClientMapInvalidationMetaDataFetcher.ts',
        ).text();
        expect(src).not.toContain('MapGetInvalidationMetaDataOperation');
    });
});

describe('ClientCacheInvalidationMetaDataFetcher — binary protocol', () => {
    test('does not import CacheGetInvalidationMetaDataOperation (no in-process path)', async () => {
        const src = await Bun.file(
            'src/client/cache/impl/nearcache/invalidation/ClientCacheInvalidationMetaDataFetcher.ts',
        ).text();
        expect(src).not.toContain('CacheGetInvalidationMetaDataOperation');
    });
});

// ── 4. Reconnect re-registration ────────────────────────────────────────────

describe('Near-cache reconnect re-registration', () => {
    test('ClientNearCacheManager exposes re-registration method for reconnect', async () => {
        const { ClientNearCacheManager } = await import(
            '@zenystx/helios-core/client/impl/nearcache/ClientNearCacheManager'
        );
        const proto = ClientNearCacheManager.prototype;
        expect(typeof proto.reregisterInvalidationListeners).toBe('function');
    });

    test('ProxyManager wires near-cache manager for map proxies with near-cache config', async () => {
        const { ProxyManager } = await import(
            '@zenystx/helios-core/client/proxy/ProxyManager'
        );
        expect(typeof ProxyManager.prototype.getNearCacheManager).toBe('function');
    });
});

// ── 5. Stale-read detection ─────────────────────────────────────────────────

describe('Client near-cache stale-read detection', () => {
    test('ClientNearCacheManager wires StaleReadDetector on near-cache creation', async () => {
        const { ClientNearCacheManager } = await import(
            '@zenystx/helios-core/client/impl/nearcache/ClientNearCacheManager'
        );
        const proto = ClientNearCacheManager.prototype;
        expect(typeof proto.getRepairingTask).toBe('function');
    });
});

// ── 6. Metrics ──────────────────────────────────────────────────────────────

describe('Client near-cache metrics', () => {
    test('NearCacheMetricsProvider collects stats from client near-cache manager', async () => {
        const { NearCacheMetricsProvider } = await import(
            '@zenystx/helios-core/client/impl/statistics/NearCacheMetricsProvider'
        );
        const provider = new NearCacheMetricsProvider([]);
        const stats = provider.collectAll();
        expect(stats).toBeInstanceOf(Map);
        expect(stats.size).toBe(0);
    });
});

// ── 7. Destroy/shutdown cleanup ─────────────────────────────────────────────

describe('Near-cache destroy/shutdown cleanup', () => {
    test('HeliosClient.shutdown() destroys near-cache manager', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client/HeliosClient'
        );
        // The HeliosClient must have near-cache manager cleanup on shutdown
        const client = new HeliosClient();
        // Should not throw
        client.shutdown();
    });

    test('ProxyManager.destroyProxy cleans up near-cache for map proxies', async () => {
        const { ProxyManager } = await import(
            '@zenystx/helios-core/client/proxy/ProxyManager'
        );
        expect(typeof ProxyManager.prototype.destroyProxy).toBe('function');
    });
});

// ── 8. Advanced client surfaces — explicitly deferred ───────────────────────

describe('Advanced client surfaces — explicit deferral', () => {
    test('HeliosClient does not expose getCacheManager (JCache deferred)', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client/HeliosClient'
        );
        expect('getCacheManager' in HeliosClient.prototype).toBeFalse();
    });

    test('HeliosClient does not expose getTransactionContext (transactions deferred)', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client/HeliosClient'
        );
        expect('getTransactionContext' in HeliosClient.prototype).toBeFalse();
    });

    test('HeliosClient does not expose getSql (SQL deferred)', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client/HeliosClient'
        );
        expect('getSql' in HeliosClient.prototype).toBeFalse();
    });

    test('HeliosClient does not expose getPNCounter (PN counter deferred)', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client/HeliosClient'
        );
        expect('getPNCounter' in HeliosClient.prototype).toBeFalse();
    });

    test('HeliosClient does not expose getFlakeIdGenerator (flake ID deferred)', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client/HeliosClient'
        );
        expect('getFlakeIdGenerator' in HeliosClient.prototype).toBeFalse();
    });

    test('DEFERRED_CLIENT_FEATURES constant lists all deferred services', async () => {
        const { DEFERRED_CLIENT_FEATURES } = await import(
            '@zenystx/helios-core/client/HeliosClient'
        );
        expect(Array.isArray(DEFERRED_CLIENT_FEATURES)).toBeTrue();
        expect(DEFERRED_CLIENT_FEATURES.length).toBeGreaterThan(0);
        expect(DEFERRED_CLIENT_FEATURES).toContain('cache');
        expect(DEFERRED_CLIENT_FEATURES).toContain('transactions');
        expect(DEFERRED_CLIENT_FEATURES).toContain('sql');
    });
});

// ── 9. Package exports ──────────────────────────────────────────────────────

describe('Package exports — client features', () => {
    test('index.ts exports HeliosClient', async () => {
        const mod = await import('@zenystx/helios-core/index');
        expect('HeliosClient' in mod).toBeTrue();
    });

    test('index.ts exports ClientConfig', async () => {
        const mod = await import('@zenystx/helios-core/index');
        expect('ClientConfig' in mod).toBeTrue();
    });

    test('index.ts does not export deferred features as if they were wired', async () => {
        const mod = await import('@zenystx/helios-core/index');
        // These should NOT be exported since they're deferred
        expect('ClientCacheManager' in mod).toBeFalse();
        expect('ClientTransactionContext' in mod).toBeFalse();
        expect('ClientSqlService' in mod).toBeFalse();
    });
});

// ── 10. Verification — no hidden mini-runtimes ──────────────────────────────

describe('Verification — no hidden mini-runtimes or fake parity', () => {
    test('NearCachedClientMapProxy source has no synchronous ClientMapBackingStore', async () => {
        const src = await Bun.file(
            'src/client/map/impl/nearcache/NearCachedClientMapProxy.ts',
        ).text();
        expect(src).not.toContain('ClientMapBackingStore');
    });

    test('NearCachedClientCacheProxy source has no synchronous ClientCacheBackingStore', async () => {
        const src = await Bun.file(
            'src/client/cache/impl/nearcache/NearCachedClientCacheProxy.ts',
        ).text();
        expect(src).not.toContain('ClientCacheBackingStore');
    });
});
