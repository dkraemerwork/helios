/**
 * Port of {@code com.hazelcast.client.map.impl.nearcache.NearCacheIsNotSharedTest}.
 *
 * Verifies that near caches are not shared across different data structure types
 * (or different manager instances) even when they share the same configured name.
 *
 * Since NearCachedClientMapProxy now extends ClientMapProxy (async, protocol-based),
 * this test verifies isolation through the NearCacheManager level rather than
 * constructing proxies with synchronous backing stores.
 */
import { describe, test, expect } from 'bun:test';
import { DefaultNearCacheManager } from '@zenystx/helios-core/internal/nearcache/impl/DefaultNearCacheManager';
import { NearCacheConfig } from '@zenystx/helios-core/config/NearCacheConfig';
import { InMemoryFormat } from '@zenystx/helios-core/config/InMemoryFormat';
import { NOT_CACHED } from '@zenystx/helios-core/internal/nearcache/NearCache';
import type { SerializationService } from '@zenystx/helios-core/internal/serialization/SerializationService';

function makeSerialization(): SerializationService {
    return {
        toData: (v: unknown) => v,
        toObject: (v: unknown) => v,
    } as unknown as SerializationService;
}

describe('NearCacheIsNotSharedTest', () => {
    test('near cache should not be shared between different managers with same name', () => {
        const ss = makeSerialization();
        const manager1 = new DefaultNearCacheManager(ss);
        const manager2 = new DefaultNearCacheManager(ss);

        const config = new NearCacheConfig('test').setInMemoryFormat(InMemoryFormat.OBJECT);

        const nc1 = manager1.getOrCreateNearCache('test', config);
        const nc2 = manager2.getOrCreateNearCache('test', config);

        // They should be distinct instances
        expect(nc1).not.toBe(nc2);

        // Writing to one should not affect the other
        nc1.put('key' as any, null, 'value-1' as any, null);
        expect(nc1.get('key' as any)).toBe('value-1');
        expect(nc2.get('key' as any)).toBe(NOT_CACHED);
    });

    test('same manager returns same near cache instance for same name', () => {
        const ss = makeSerialization();
        const manager = new DefaultNearCacheManager(ss);
        const config = new NearCacheConfig('test').setInMemoryFormat(InMemoryFormat.OBJECT);

        const nc1 = manager.getOrCreateNearCache('test', config);
        const nc2 = manager.getOrCreateNearCache('test', config);

        expect(nc1).toBe(nc2);
    });

    test('same manager returns different instances for different names', () => {
        const ss = makeSerialization();
        const manager = new DefaultNearCacheManager(ss);

        const nc1 = manager.getOrCreateNearCache('map-cache', new NearCacheConfig('map-cache').setInMemoryFormat(InMemoryFormat.OBJECT));
        const nc2 = manager.getOrCreateNearCache('replicated-cache', new NearCacheConfig('replicated-cache').setInMemoryFormat(InMemoryFormat.OBJECT));

        expect(nc1).not.toBe(nc2);

        nc1.put('key' as any, null, 'v1' as any, null);
        expect(nc2.get('key' as any)).toBe(NOT_CACHED);
    });
});
