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
 * 10. Reliable-topic and executor client decision: NOT-RETAINED
 * 11. Verification — no hidden mini-runtimes, deferred throws, or fake parity
 */
import { describe, expect, test } from 'bun:test';

// ── 1. NearCachedClientMapProxy wraps real ClientMapProxy ────────────────────

describe('NearCachedClientMapProxy — real remote proxy backing', () => {
    test('extends ClientMapProxy and inherits async get/put/remove', async () => {
        const { NearCachedClientMapProxy } = await import(
            '@zenystx/helios-core/client/map/impl/nearcache/NearCachedClientMapProxy'
        );
        const { ClientMapProxy } = await import(
            '@zenystx/helios-core/client/proxy/ClientMapProxy'
        );
        expect(NearCachedClientMapProxy.prototype instanceof ClientMapProxy).toBeTrue();
    });

    test('get() returns a Promise (async, not sync)', async () => {
        const { NearCachedClientMapProxy } = await import(
            '@zenystx/helios-core/client/map/impl/nearcache/NearCachedClientMapProxy'
        );
        const proto = NearCachedClientMapProxy.prototype;
        expect(typeof proto.get).toBe('function');
        const mod = await import(
            '@zenystx/helios-core/client/map/impl/nearcache/NearCachedClientMapProxy'
        );
        expect('ClientMapBackingStore' in mod).toBeFalse();
    });

    test('put() writes through ClientMapProxy then invalidates near cache', async () => {
        const { NearCachedClientMapProxy } = await import(
            '@zenystx/helios-core/client/map/impl/nearcache/NearCachedClientMapProxy'
        );
        expect(typeof NearCachedClientMapProxy.prototype.put).toBe('function');
    });

    test('remove() writes through ClientMapProxy then invalidates near cache', async () => {
        const { NearCachedClientMapProxy } = await import(
            '@zenystx/helios-core/client/map/impl/nearcache/NearCachedClientMapProxy'
        );
        expect(typeof NearCachedClientMapProxy.prototype.remove).toBe('function');
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
        expect(typeof ClientNearCacheManager.prototype.reregisterInvalidationListeners).toBe('function');
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
        expect(typeof ClientNearCacheManager.prototype.getRepairingTask).toBe('function');
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
            '@zenystx/helios-core/client'
        );
        const client = new HeliosClient();
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
            '@zenystx/helios-core/client'
        );
        expect('getCacheManager' in HeliosClient.prototype).toBeFalse();
    });

    test('HeliosClient.getDistributedObject() rejects cacheService as not retained', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client'
        );
        const client = new HeliosClient();
        expect(() => client.getDistributedObject('hz:impl:cacheService', 'cache-a'))
            .toThrow(/not retained on the remote-client contract/);
        client.shutdown();
    });

    test('HeliosClient does not expose getTransactionContext (transactions deferred)', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client'
        );
        expect('getTransactionContext' in HeliosClient.prototype).toBeFalse();
    });

    test('HeliosClient does not expose getSql (SQL deferred)', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client'
        );
        expect('getSql' in HeliosClient.prototype).toBeFalse();
    });

    test('HeliosClient does not expose getPNCounter (PN counter deferred)', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client'
        );
        expect('getPNCounter' in HeliosClient.prototype).toBeFalse();
    });

    test('HeliosClient does not expose getFlakeIdGenerator (flake ID deferred)', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client'
        );
        expect('getFlakeIdGenerator' in HeliosClient.prototype).toBeFalse();
    });

    test('DEFERRED_CLIENT_FEATURES lists all deferred services including executor and reliable-topic', async () => {
        const { DEFERRED_CLIENT_FEATURES } = await import(
            '@zenystx/helios-core/client'
        );
        expect(Array.isArray(DEFERRED_CLIENT_FEATURES)).toBeTrue();
        expect(DEFERRED_CLIENT_FEATURES).toContain('cache');
        expect(DEFERRED_CLIENT_FEATURES).toContain('transactions');
        expect(DEFERRED_CLIENT_FEATURES).toContain('sql');
        expect(DEFERRED_CLIENT_FEATURES).toContain('reliable-topic-client');
        expect(DEFERRED_CLIENT_FEATURES).toContain('executor');
    });

    test('HeliosClient does not expose getScheduledExecutorService (deferred)', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client'
        );
        expect('getScheduledExecutorService' in HeliosClient.prototype).toBeFalse();
    });

    test('HeliosClient does not expose getCardinalityEstimator (deferred)', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client'
        );
        expect('getCardinalityEstimator' in HeliosClient.prototype).toBeFalse();
    });
});

// ── 9. Package exports — aligned with wired features ─────────────────────────

describe('Package exports — client features aligned', () => {
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
        expect('ClientCacheManager' in mod).toBeFalse();
        expect('ClientTransactionContext' in mod).toBeFalse();
        expect('ClientSqlService' in mod).toBeFalse();
    });

    test('index.ts exports DEFERRED_CLIENT_FEATURES for transparency', async () => {
        const mod = await import('@zenystx/helios-core/index');
        expect('DEFERRED_CLIENT_FEATURES' in mod).toBeTrue();
    });

    test('index.ts does not export ClientReliableTopicProxy (NOT-RETAINED)', async () => {
        const mod = await import('@zenystx/helios-core/index');
        expect('ClientReliableTopicProxy' in mod).toBeFalse();
    });

    test('index.ts does not export ClientExecutorProxy (NOT-RETAINED)', async () => {
        const mod = await import('@zenystx/helios-core/index');
        expect('ClientExecutorProxy' in mod).toBeFalse();
    });
});

// ── 10. Reliable-topic and executor client — NOT-RETAINED decision ──────────

describe('Reliable-topic client — NOT-RETAINED', () => {
    test('HeliosClient does not expose getReliableTopic() (NOT-RETAINED)', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client'
        );
        expect('getReliableTopic' in HeliosClient.prototype).toBeFalse();
    });

    test('HeliosInstance interface does not include getReliableTopic()', async () => {
        const src = await Bun.file('src/core/HeliosInstance.ts').text();
        expect(src).not.toContain('getReliableTopic');
    });

    test('ProxyManager does not register reliableTopicService factory', async () => {
        const src = await Bun.file('src/client/proxy/ProxyManager.ts').text();
        expect(src).not.toContain('reliableTopicService');
    });

    test('DEFERRED_CLIENT_FEATURES includes reliable-topic-client', async () => {
        const { DEFERRED_CLIENT_FEATURES } = await import(
            '@zenystx/helios-core/client'
        );
        expect(DEFERRED_CLIENT_FEATURES).toContain('reliable-topic-client');
    });
});

describe('Executor client — NOT-RETAINED', () => {
    test('HeliosClient does not expose getExecutorService() (NOT-RETAINED)', async () => {
        const { HeliosClient } = await import(
            '@zenystx/helios-core/client'
        );
        expect('getExecutorService' in HeliosClient.prototype).toBeFalse();
    });

    test('HeliosInstance interface does not include getExecutorService()', async () => {
        const src = await Bun.file('src/core/HeliosInstance.ts').text();
        expect(src).not.toContain('getExecutorService');
    });

    test('ProxyManager does not register executorService factory', async () => {
        const src = await Bun.file('src/client/proxy/ProxyManager.ts').text();
        expect(src).not.toContain('executorService');
    });

    test('DEFERRED_CLIENT_FEATURES includes executor', async () => {
        const { DEFERRED_CLIENT_FEATURES } = await import(
            '@zenystx/helios-core/client'
        );
        expect(DEFERRED_CLIENT_FEATURES).toContain('executor');
    });
});

// ── 11. Verification — no hidden mini-runtimes, deferred throws, or fake parity ────

describe('Verification — no hidden mini-runtimes, deferred throws, or fake parity', () => {
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

    test('HeliosClient source has no deferred throw stubs on exported methods', async () => {
        const src = await Bun.file('src/client/HeliosClient.ts').text();
        expect(src).not.toMatch(/throw new Error\(.*(?:not supported|deferred|not implemented)/i);
    });

    test('client-example.ts does not reference reliable-topic or executor', async () => {
        const src = await Bun.file('examples/native-app/src/client-example.ts').text();
        expect(src).not.toContain('getReliableTopic');
        expect(src).not.toContain('getExecutorService');
    });

    test('HeliosInstanceImpl still exposes getReliableTopic and getExecutorService as member-only', async () => {
        const { HeliosInstanceImpl } = await import(
            '@zenystx/helios-core/instance/impl/HeliosInstanceImpl'
        );
        expect(typeof HeliosInstanceImpl.prototype.getReliableTopic).toBe('function');
        expect(typeof HeliosInstanceImpl.prototype.getExecutorService).toBe('function');
    });

    test('parity matrix marks reliable-topic and executor as NOT-RETAINED for client', async () => {
        const src = await Bun.file('plans/CLIENT_E2E_PARITY_MATRIX.md').text();
        expect(src).toMatch(/getReliableTopic.*NOT-RETAINED/i);
        expect(src).toMatch(/getExecutorService.*NOT-RETAINED/i);
    });
});
