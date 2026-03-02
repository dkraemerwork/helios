/**
 * Port of MapNearCacheStalenessTest (simplified for single-node).
 *
 * Verifies that the near cache does not serve stale data after
 * local writes invalidate cached entries.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { NearCachedMapProxyImpl } from '@helios/map/impl/nearcache/NearCachedMapProxyImpl';
import { DefaultNearCache } from '@helios/internal/nearcache/impl/DefaultNearCache';
import { NearCacheConfig } from '@helios/config/NearCacheConfig';
import { InMemoryFormat } from '@helios/config/InMemoryFormat';
import { TestSerializationService } from '@helios/test-support/TestSerializationService';
import { NoOpTaskScheduler } from '@helios/internal/nearcache/impl/TaskScheduler';
import { MapHeliosProperties } from '@helios/spi/properties/HeliosProperties';

function makeProxyAndStore(mapName = 'stalenessTestMap') {
    const config = new NearCacheConfig(mapName)
        .setInMemoryFormat(InMemoryFormat.OBJECT);
    const nc = new DefaultNearCache<string, string>(
        mapName, config,
        new TestSerializationService() as never,
        new NoOpTaskScheduler(),
        null,
        new MapHeliosProperties(),
    );
    nc.initialize();

    const store = new Map<string, string>();
    const backing = {
        get: (k: string) => store.get(k) ?? null,
        put: (k: string, v: string) => { const old = store.get(k) ?? null; store.set(k, v); return old; },
        remove: (k: string) => { const old = store.get(k) ?? null; store.delete(k); return old; },
    };
    return { proxy: new NearCachedMapProxyImpl(mapName, nc, backing), store };
}

describe('MapNearCacheStalenessTest', () => {
    let proxy: NearCachedMapProxyImpl<string, string>;
    let store: Map<string, string>;

    beforeEach(() => {
        ({ proxy, store } = makeProxyAndStore());
    });

    it('no stale reads after put invalidation', () => {
        store.set('k', 'v1');
        proxy.get('k'); // warm cache
        store.set('k', 'v2');
        proxy.put('k', 'v2'); // invalidate cache
        expect(proxy.get('k')).toBe('v2');
    });

    it('no stale reads after remove invalidation', () => {
        store.set('k', 'v1');
        proxy.get('k'); // warm cache
        proxy.remove('k'); // invalidate
        expect(proxy.get('k')).toBeNull();
    });

    it('near cache is populated again after re-put', () => {
        store.set('k', 'v1');
        proxy.get('k'); // populate
        proxy.remove('k'); // invalidate + remove from store
        store.set('k', 'v2');
        proxy.put('k', 'v2'); // write back
        // Get twice to confirm it's re-cached
        proxy.get('k');
        const sizeBefore = proxy.nearCacheSize();
        proxy.get('k'); // should be cache hit now
        expect(proxy.nearCacheSize()).toBe(sizeBefore);
        expect(proxy.get('k')).toBe('v2');
    });

    it('multiple keys can be independently invalidated', () => {
        store.set('a', 'va');
        store.set('b', 'vb');
        proxy.get('a');
        proxy.get('b');
        expect(proxy.nearCacheSize()).toBe(2);

        proxy.put('a', 'va-new'); // only a is invalidated
        store.set('a', 'va-new');

        // b should still be served from cache
        expect(proxy.get('a')).toBe('va-new');
        // b is cached and backing store still has 'vb'
        expect(proxy.get('b')).toBe('vb');
    });
});
