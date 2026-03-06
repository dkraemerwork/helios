/**
 * Unit tests for NearCachedMapProxyImpl.
 *
 * Tests the server-side near cache read-through proxy:
 * - get() checks the near cache first; on miss fetches from backing store and populates cache
 * - put()/remove() write to backing store and invalidate the near cache
 * - local invalidation on writes
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { NearCachedMapProxyImpl } from '@zenystx/core/map/impl/nearcache/NearCachedMapProxyImpl';
import { DefaultNearCache } from '@zenystx/core/internal/nearcache/impl/DefaultNearCache';
import { NearCacheConfig } from '@zenystx/core/config/NearCacheConfig';
import { InMemoryFormat } from '@zenystx/core/config/InMemoryFormat';
import { TestSerializationService } from '@zenystx/core/test-support/TestSerializationService';
import { NoOpTaskScheduler } from '@zenystx/core/internal/nearcache/impl/TaskScheduler';
import { MapHeliosProperties } from '@zenystx/core/spi/properties/HeliosProperties';

function makeNearCache(name = 'testMap'): DefaultNearCache<string, string> {
    const config = new NearCacheConfig(name)
        .setInMemoryFormat(InMemoryFormat.OBJECT);
    const nc = new DefaultNearCache<string, string>(
        name, config,
        new TestSerializationService() as never,
        new NoOpTaskScheduler(),
        null,
        new MapHeliosProperties(),
    );
    nc.initialize();
    return nc;
}

/** Minimal in-memory backing store for tests */
function makeBackingStore(initial: Record<string, string> = {}): {
    store: Map<string, string>;
    getCalls: string[];
    putCalls: Array<[string, string]>;
    removeCalls: string[];
    get(key: string): string | null;
    put(key: string, value: string): string | null;
    remove(key: string): string | null;
} {
    const store = new Map(Object.entries(initial));
    const getCalls: string[] = [];
    const putCalls: Array<[string, string]> = [];
    const removeCalls: string[] = [];
    return {
        store,
        getCalls,
        putCalls,
        removeCalls,
        get(key: string): string | null {
            getCalls.push(key);
            return store.get(key) ?? null;
        },
        put(key: string, value: string): string | null {
            putCalls.push([key, value]);
            const old = store.get(key) ?? null;
            store.set(key, value);
            return old;
        },
        remove(key: string): string | null {
            removeCalls.push(key);
            const old = store.get(key) ?? null;
            store.delete(key);
            return old;
        },
    };
}

describe('NearCachedMapProxyImpl', () => {
    let nc: DefaultNearCache<string, string>;
    let backing: ReturnType<typeof makeBackingStore>;
    let proxy: NearCachedMapProxyImpl<string, string>;

    beforeEach(() => {
        nc = makeNearCache();
        backing = makeBackingStore({ 'k1': 'v1', 'k2': 'v2' });
        proxy = new NearCachedMapProxyImpl('testMap', nc, backing);
    });

    it('get() on cache miss fetches from backing store', () => {
        const result = proxy.get('k1');
        expect(result).toBe('v1');
        expect(backing.getCalls).toContain('k1');
    });

    it('get() after cache miss populates the near cache', () => {
        proxy.get('k1');
        // second call should be served from cache — no additional backing store call
        const callsBefore = backing.getCalls.length;
        const result = proxy.get('k1');
        expect(result).toBe('v1');
        expect(backing.getCalls.length).toBe(callsBefore); // no new call
    });

    it('get() returns null for non-existent key', () => {
        expect(proxy.get('nonExistent')).toBeNull();
    });

    it('put() stores value in backing store', () => {
        proxy.put('k3', 'v3');
        expect(backing.store.get('k3')).toBe('v3');
        expect(backing.putCalls).toContainEqual(['k3', 'v3']);
    });

    it('put() invalidates the near cache for the key', () => {
        // populate cache
        proxy.get('k1');
        // mutate
        proxy.put('k1', 'v1Updated');
        // next get should fetch from backing (cache invalidated)
        const callsBefore = backing.getCalls.length;
        const result = proxy.get('k1');
        expect(result).toBe('v1Updated');
        expect(backing.getCalls.length).toBeGreaterThan(callsBefore);
    });

    it('remove() removes value from backing store', () => {
        proxy.remove('k1');
        expect(backing.store.has('k1')).toBe(false);
        expect(backing.removeCalls).toContain('k1');
    });

    it('remove() invalidates the near cache for the key', () => {
        proxy.get('k1'); // populate cache
        proxy.remove('k1');
        // after remove, get should return null and not come from cache
        const callsBefore = backing.getCalls.length;
        const result = proxy.get('k1');
        expect(result).toBeNull();
        expect(backing.getCalls.length).toBeGreaterThan(callsBefore);
    });

    it('size() returns the near cache entry count', () => {
        expect(proxy.nearCacheSize()).toBe(0);
        proxy.get('k1');
        proxy.get('k2');
        expect(proxy.nearCacheSize()).toBe(2);
    });
});
