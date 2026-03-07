/**
 * Block 5.3 — End-to-end near-cache production-flow acceptance tests.
 *
 * Proves the canonical near-cache lifecycle using the REAL DefaultNearCache +
 * NearCachedClientCacheProxy stack with an async backing store.
 *
 * NearCachedClientMapProxy now extends ClientMapProxy (protocol-based, async).
 * Map near-cache e2e flows are tested at the DefaultNearCache level since
 * full ClientMapProxy requires a real cluster connection.
 *
 * Scenarios:
 *   1. DefaultNearCache: miss → hit via direct put/get
 *   2. DefaultNearCache: invalidation → re-fetch
 *   3. Cache: miss → hit (JCache variant, async backing)
 *   4. Cache: CACHE_ON_UPDATE → write publishes directly into near-cache
 *   5. Dropped-invalidation repair: RepairingTask detects miss count above threshold,
 *      marks sequences stale, forcing stale records to be evicted on next read.
 */
import { beforeEach, describe, expect, test } from 'bun:test';

import type { AsyncCacheBackingStore } from '@zenystx/helios-core/client/cache/impl/nearcache/NearCachedClientCacheProxy';
import { NearCachedClientCacheProxy } from '@zenystx/helios-core/client/cache/impl/nearcache/NearCachedClientCacheProxy';
import { InMemoryFormat } from '@zenystx/helios-core/config/InMemoryFormat';
import { LocalUpdatePolicy, NearCacheConfig } from '@zenystx/helios-core/config/NearCacheConfig';
import { DefaultNearCache } from '@zenystx/helios-core/internal/nearcache/impl/DefaultNearCache';
import type { InvalidationMetaDataFetcher } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/InvalidationMetaDataFetcher';
import type { MinimalPartitionService } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/MinimalPartitionService';
import { RepairingTask } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/RepairingTask';
import { NoOpTaskScheduler } from '@zenystx/helios-core/internal/nearcache/impl/TaskScheduler';
import { NOT_CACHED } from '@zenystx/helios-core/internal/nearcache/NearCache';
import type { SerializationService } from '@zenystx/helios-core/internal/serialization/SerializationService';
import { MapHeliosProperties } from '@zenystx/helios-core/spi/properties/HeliosProperties';

// ── shared helpers ────────────────────────────────────────────────────────────

function makeSerialization(): SerializationService {
    return {
        toData: () => null,
        toObject: (d: unknown) => d,
    } as unknown as SerializationService;
}

function makePartitionService(): MinimalPartitionService {
    return {
        getPartitionCount: () => 271,
        getPartitionId: () => 0,
    };
}

function makeNoOpFetcher(): InvalidationMetaDataFetcher {
    return {
        init: () => true,
        fetchMetadata: () => {},
    };
}

const noOpLogger = {
    finest: () => {},
    isFinestEnabled: () => false,
} as const;

function buildNearCache<K, V>(name: string): DefaultNearCache<K, V> {
    const config = new NearCacheConfig(name);
    config.setInMemoryFormat(InMemoryFormat.OBJECT);
    const nc = new DefaultNearCache<K, V>(name, config, makeSerialization());
    nc.initialize();
    return nc;
}

// ── 1. DefaultNearCache: miss → hit ──────────────────────────────────────────

describe('NearCacheProductionFlow — DefaultNearCache direct', () => {
    test('miss → hit: first get returns NOT_CACHED, after put returns value', () => {
        const nc = buildNearCache<string, string>('test-map');

        // MISS
        expect(nc.get('key1' as any)).toBe(NOT_CACHED as any);

        // Simulate backing store fetch + publish via reservation
        const rid = nc.tryReserveForUpdate('key1' as any, null, 'READ_UPDATE');
        nc.tryPublishReserved('key1' as any, 'value1', rid, false);

        // HIT
        expect(nc.get('key1' as any)).toBe('value1');
        expect(nc.size()).toBe(1);
    });

    test('invalidation clears entry, subsequent get returns NOT_CACHED', () => {
        const nc = buildNearCache<string, string>('test-map-inv');

        const rid = nc.tryReserveForUpdate('key1' as any, null, 'READ_UPDATE');
        nc.tryPublishReserved('key1' as any, 'value1', rid, false);
        expect(nc.get('key1' as any)).toBe('value1');

        nc.invalidate('key1' as any);
        expect(nc.get('key1' as any)).toBe(NOT_CACHED as any);
    });
});

// ── 3. JCache (NearCachedClientCacheProxy) ───────────────────────────────────

describe('NearCacheProductionFlow — JCache INVALIDATE policy', () => {
    let backingStore: Map<string, string>;
    let backingCallCount: number;
    let proxy: NearCachedClientCacheProxy<string, string>;

    beforeEach(() => {
        backingStore = new Map([['ckey', 'cval']]);
        backingCallCount = 0;

        const nc = buildNearCache<string, string>('test-cache');
        const backing: AsyncCacheBackingStore<string, string> = {
            get: async (k) => { backingCallCount++; return backingStore.get(k) ?? null; },
            put: async (k, v) => { const old = backingStore.get(k) ?? null; backingStore.set(k, v); return old; },
            remove: async (k) => { const old = backingStore.get(k) ?? null; backingStore.delete(k); return old; },
        };
        proxy = new NearCachedClientCacheProxy<string, string>(
            'test-cache', nc, backing, LocalUpdatePolicy.INVALIDATE,
        );
    });

    test('cache miss → hit: first get fetches from backing store, second is a near-cache hit', async () => {
        const first = await proxy.get('ckey');
        expect(first).toBe('cval');
        expect(backingCallCount).toBe(1);
        expect(proxy.nearCacheSize()).toBe(1);

        const second = await proxy.get('ckey');
        expect(second).toBe('cval');
        expect(backingCallCount).toBe(1);
    });

    test('put with INVALIDATE policy invalidates near-cache; subsequent get re-fetches', async () => {
        await proxy.get('ckey');
        expect(proxy.nearCacheSize()).toBe(1);

        await proxy.put('ckey', 'cval-updated');
        expect(proxy.nearCacheSize()).toBe(0);

        const refetched = await proxy.get('ckey');
        expect(refetched).toBe('cval-updated');
        expect(backingCallCount).toBe(2);
    });
});

// ── 4. JCache CACHE_ON_UPDATE policy ────────────────────────────────────────

describe('NearCacheProductionFlow — JCache CACHE_ON_UPDATE policy', () => {
    test('put with CACHE_ON_UPDATE publishes directly into near-cache', async () => {
        const backingStore = new Map<string, string>();
        let backingCallCount = 0;

        const nc = buildNearCache<string, string>('test-cache-cou');
        const backing: AsyncCacheBackingStore<string, string> = {
            get: async (k) => { backingCallCount++; return backingStore.get(k) ?? null; },
            put: async (k, v) => { const old = backingStore.get(k) ?? null; backingStore.set(k, v); return old; },
            remove: async (k) => { const old = backingStore.get(k) ?? null; backingStore.delete(k); return old; },
        };
        const proxy = new NearCachedClientCacheProxy<string, string>(
            'test-cache-cou', nc, backing, LocalUpdatePolicy.CACHE_ON_UPDATE,
        );

        await proxy.put('k', 'v1');
        expect(backingStore.get('k')).toBe('v1');
        expect(proxy.nearCacheSize()).toBe(1);

        const result = await proxy.get('k');
        expect(result).toBe('v1');
        expect(backingCallCount).toBe(0);
    });
});

// ── 5. Dropped-invalidation repair convergence ───────────────────────────────

describe('NearCacheProductionFlow — dropped-invalidation repair', () => {
    test('dropped invalidations exceeding maxToleratedMissCount force stale-sequence advance', () => {
        const PARTITION_ID = 0;
        const PARTITION_UUID = 'test-partition-uuid-001';

        const nc = buildNearCache<string, string>('repair-map');

        const properties = new MapHeliosProperties();
        const partitionService = makePartitionService();
        const repairingTask = new RepairingTask(
            properties,
            makeNoOpFetcher(),
            new NoOpTaskScheduler(),
            makeSerialization(),
            partitionService,
            'local-node-uuid',
            noOpLogger,
        );

        const handler = repairingTask.registerAndGetHandler('repair-map', nc);
        handler.checkOrRepairUuid(PARTITION_ID, PARTITION_UUID);

        // Populate near-cache directly
        const rid = nc.tryReserveForUpdate('hotkey' as any, null, 'READ_UPDATE');
        nc.tryPublishReserved('hotkey' as any, 'initial-value', rid, false);
        expect(nc.size()).toBe(1);
        expect(nc.get('hotkey' as any)).toBe('initial-value');

        // Simulate dropped invalidations: sequence jumps 0 → 12 (gap=11 > maxToleratedMissCount=10)
        handler.checkOrRepairSequence(PARTITION_ID, 12, false);

        const container = handler.getMetaDataContainer(PARTITION_ID);
        expect(container.getSequence()).toBe(12);
        expect(container.getMissedSequenceCount()).toBe(11);

        repairingTask['_fixSequenceGaps']();
        expect(container.getStaleSequence()).toBe(12);

        // Cached record has invalidationSequence=0, staleSequence=12 → STALE
        // DefaultNearCache's get() detects staleness, invalidates, returns NOT_CACHED
        const afterRepair = nc.get('hotkey' as any);
        expect(afterRepair).toBe(NOT_CACHED as any);
    });

    test('reconnect scenario: UUID change invalidates old records', () => {
        const PARTITION_ID = 0;
        const OLD_UUID = 'uuid-before-reconnect';
        const NEW_UUID = 'uuid-after-reconnect';

        const nc = buildNearCache<string, string>('reconnect-map');
        const partitionService = makePartitionService();
        const repairingTask = new RepairingTask(
            new MapHeliosProperties(),
            makeNoOpFetcher(),
            new NoOpTaskScheduler(),
            makeSerialization(),
            partitionService,
            'local-node-uuid',
            noOpLogger,
        );

        const handler = repairingTask.registerAndGetHandler('reconnect-map', nc);
        handler.checkOrRepairUuid(PARTITION_ID, OLD_UUID);
        handler.checkOrRepairSequence(PARTITION_ID, 5, false);

        // Populate near-cache under OLD_UUID
        const rid = nc.tryReserveForUpdate('rkey' as any, null, 'READ_UPDATE');
        nc.tryPublishReserved('rkey' as any, 'rval', rid, false);
        expect(nc.get('rkey' as any)).toBe('rval');

        // Simulate reconnect: UUID change
        handler.checkOrRepairUuid(PARTITION_ID, NEW_UUID);
        const container = handler.getMetaDataContainer(PARTITION_ID);
        expect(container.getUuid()).toBe(NEW_UUID);
        expect(container.getSequence()).toBe(0);

        // Old record has OLD_UUID → stale → evicted on next read
        const afterReconnect = nc.get('rkey' as any);
        expect(afterReconnect).toBe(NOT_CACHED as any);
    });
});
