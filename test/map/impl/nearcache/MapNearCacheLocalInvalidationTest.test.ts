/**
 * Port of MapNearCacheLocalInvalidationTest (simplified for single-node).
 *
 * Tests local write invalidation: when a map entry is written locally,
 * its near cache entry should be invalidated so the next read fetches
 * the fresh value from the backing store.
 */
import { EvictionConfig } from '@zenystx/helios-core/config/EvictionConfig';
import { EvictionPolicy } from '@zenystx/helios-core/config/EvictionPolicy';
import { InMemoryFormat } from '@zenystx/helios-core/config/InMemoryFormat';
import { NearCacheConfig } from '@zenystx/helios-core/config/NearCacheConfig';
import { DefaultNearCache } from '@zenystx/helios-core/internal/nearcache/impl/DefaultNearCache';
import { NoOpTaskScheduler } from '@zenystx/helios-core/internal/nearcache/impl/TaskScheduler';
import { NearCachedMapProxyImpl } from '@zenystx/helios-core/map/impl/nearcache/NearCachedMapProxyImpl';
import { MapHeliosProperties } from '@zenystx/helios-core/spi/properties/HeliosProperties';
import { TestSerializationService } from '@zenystx/helios-core/test-support/TestSerializationService';
import { beforeEach, describe, expect, it } from 'bun:test';

const MAP_NAME = 'localInvalidationTestMap';

function makeProxy(memoryFormat: InMemoryFormat): {
    proxy: NearCachedMapProxyImpl<string, string>;
    backingStore: Map<string, string>;
    getCallCount: () => number;
} {
    const eviction = new EvictionConfig()
        .setEvictionPolicy(EvictionPolicy.NONE);
    const config = new NearCacheConfig(MAP_NAME)
        .setInMemoryFormat(memoryFormat)
        .setEvictionConfig(eviction);

    const nc = new DefaultNearCache<string, string>(
        MAP_NAME, config,
        new TestSerializationService() as never,
        new NoOpTaskScheduler(),
        null,
        new MapHeliosProperties(),
    );
    nc.initialize();

    const backingStore = new Map<string, string>();
    let getCalls = 0;
    const backing = {
        get(key: string) {
            getCalls++;
            return backingStore.get(key) ?? null;
        },
        put(key: string, value: string) {
            const old = backingStore.get(key) ?? null;
            backingStore.set(key, value);
            return old;
        },
        remove(key: string) {
            const old = backingStore.get(key) ?? null;
            backingStore.delete(key);
            return old;
        },
    };
    const proxy = new NearCachedMapProxyImpl(MAP_NAME, nc, backing);
    return { proxy, backingStore, getCallCount: () => getCalls };
}

describe('MapNearCacheLocalInvalidationTest', () => {
    describe('OBJECT format', () => {
        let proxy: NearCachedMapProxyImpl<string, string>;
        let backingStore: Map<string, string>;
        let getCallCount: () => number;

        beforeEach(() => {
            ({ proxy, backingStore, getCallCount } = makeProxy(InMemoryFormat.OBJECT));
        });

        it('put invalidates cached entry — next get fetches fresh value', () => {
            backingStore.set('key1', 'value1');
            proxy.get('key1'); // populate cache
            proxy.put('key1', 'value1Updated');
            const callsBefore = getCallCount();
            const result = proxy.get('key1');
            expect(result).toBe('value1Updated');
            expect(getCallCount()).toBeGreaterThan(callsBefore);
        });

        it('remove invalidates cached entry — next get returns null', () => {
            backingStore.set('key2', 'value2');
            proxy.get('key2'); // populate cache
            proxy.remove('key2');
            const callsBefore = getCallCount();
            const result = proxy.get('key2');
            expect(result).toBeNull();
            expect(getCallCount()).toBeGreaterThan(callsBefore);
        });

        it('consecutive puts invalidate near cache each time', () => {
            backingStore.set('key3', 'v0');
            proxy.get('key3'); // populate

            proxy.put('key3', 'v1');
            expect(proxy.get('key3')).toBe('v1');

            proxy.put('key3', 'v2');
            expect(proxy.get('key3')).toBe('v2');
        });

        it('cache hit count is zero before any get', () => {
            expect(proxy.nearCacheSize()).toBe(0);
        });
    });

    describe('BINARY format', () => {
        let proxy: NearCachedMapProxyImpl<string, string>;
        let backingStore: Map<string, string>;

        beforeEach(() => {
            ({ proxy, backingStore } = makeProxy(InMemoryFormat.BINARY));
        });

        it('put invalidates cached entry in BINARY format', () => {
            backingStore.set('binKey', 'binValue1');
            proxy.get('binKey'); // populate
            proxy.put('binKey', 'binValue2');
            // After put the near cache should not serve the old value
            backingStore.set('binKey', 'binValue2');
            const result = proxy.get('binKey');
            expect(result).toBe('binValue2');
        });
    });
});
