/**
 * Block 5.3 — End-to-end near-cache production-flow acceptance tests.
 *
 * Proves the canonical near-cache lifecycle using the REAL DefaultNearCache +
 * NearCachedClientMapProxy / NearCachedClientCacheProxy stack, with an
 * in-process backing store simulating the remote cluster.
 *
 * Scenarios:
 *   1. Map:   miss → hit (no backing-store call on hit path)
 *   2. Map:   remote write invalidation → re-fetch (backing-store called after invalidation)
 *   3. Cache: miss → hit (JCache variant)
 *   4. Cache: CACHE_ON_UPDATE → write publishes directly into near-cache
 *   5. Dropped-invalidation repair: RepairingTask detects miss count above threshold,
 *      marks sequences stale, forcing stale records to be evicted on next read.
 */
import { describe, test, expect, beforeEach } from 'bun:test';

import { DefaultNearCache } from '@zenystx/core/internal/nearcache/impl/DefaultNearCache';
import { NearCacheConfig, LocalUpdatePolicy } from '@zenystx/core/config/NearCacheConfig';
import { InMemoryFormat } from '@zenystx/core/config/InMemoryFormat';
import { NearCachedClientMapProxy } from '@zenystx/core/client/map/impl/nearcache/NearCachedClientMapProxy';
import { NearCachedClientCacheProxy } from '@zenystx/core/client/cache/impl/nearcache/NearCachedClientCacheProxy';
import { RepairingTask } from '@zenystx/core/internal/nearcache/impl/invalidation/RepairingTask';
import { MapHeliosProperties } from '@zenystx/core/spi/properties/HeliosProperties';
import { NoOpTaskScheduler } from '@zenystx/core/internal/nearcache/impl/TaskScheduler';
import type { MinimalPartitionService } from '@zenystx/core/internal/nearcache/impl/invalidation/MinimalPartitionService';
import type { InvalidationMetaDataFetcher } from '@zenystx/core/internal/nearcache/impl/invalidation/InvalidationMetaDataFetcher';
import type { SerializationService } from '@zenystx/core/internal/serialization/SerializationService';

// ── shared helpers ────────────────────────────────────────────────────────────

/** Serialization service stub sufficient for OBJECT-format near-cache. */
function makeSerialization(): SerializationService {
    return {
        toData: () => null,
        toObject: (d: unknown) => d,
    } as unknown as SerializationService;
}

/** Partition service that maps every key to partition 0. */
function makePartitionService(): MinimalPartitionService {
    return {
        getPartitionCount: () => 271,
        getPartitionId: () => 0,
    };
}

/** No-op metadata fetcher (no cluster members to contact). */
function makeNoOpFetcher(): InvalidationMetaDataFetcher {
    return {
        init: () => true,
        fetchMetadata: () => {},
    };
}

/** No-op logger. */
const noOpLogger = {
    finest: () => {},
    isFinestEnabled: () => false,
} as const;

/** Build a DefaultNearCache (OBJECT format, no TTL/max-idle). */
function buildNearCache<K, V>(name: string): DefaultNearCache<K, V> {
    const config = new NearCacheConfig(name);
    config.setInMemoryFormat(InMemoryFormat.OBJECT);
    const nc = new DefaultNearCache<K, V>(name, config, makeSerialization());
    nc.initialize();
    return nc;
}

// ── 1. Map: miss → hit canonical sequence ────────────────────────────────────

describe('NearCacheProductionFlow — Map INVALIDATE policy', () => {
    let backingStore: Map<string, string>;
    let backingCallCount: number;
    let proxy: NearCachedClientMapProxy<string, string>;

    beforeEach(() => {
        backingStore = new Map([['key1', 'value1']]);
        backingCallCount = 0;

        const nc = buildNearCache<string, string>('test-map');
        proxy = new NearCachedClientMapProxy<string, string>(
            'test-map',
            nc,
            {
                get: (k) => { backingCallCount++; return backingStore.get(k) ?? null; },
                put: (k, v) => { const old = backingStore.get(k) ?? null; backingStore.set(k, v); return old; },
                remove: (k) => { const old = backingStore.get(k) ?? null; backingStore.delete(k); return old; },
            },
        );
    });

    test('miss → hit: first get fetches from backing store, second get is a near-cache hit', () => {
        // MISS: backing store consulted
        const first = proxy.get('key1');
        expect(first).toBe('value1');
        expect(backingCallCount).toBe(1);
        expect(proxy.nearCacheSize()).toBe(1);

        // HIT: backing store NOT consulted
        const second = proxy.get('key1');
        expect(second).toBe('value1');
        expect(backingCallCount).toBe(1); // unchanged
        expect(proxy.nearCacheSize()).toBe(1);
    });

    test('remote write invalidation → re-fetch: put invalidates cache, next get consults backing store', () => {
        // Populate near-cache
        proxy.get('key1');
        expect(backingCallCount).toBe(1);
        expect(proxy.nearCacheSize()).toBe(1);

        // Remote write (simulated via same proxy — in production this would be a second client)
        proxy.put('key1', 'value1-updated');
        expect(backingStore.get('key1')).toBe('value1-updated');
        expect(proxy.nearCacheSize()).toBe(0); // invalidated

        // Re-fetch: backing store must be consulted, returns new value
        const refetched = proxy.get('key1');
        expect(refetched).toBe('value1-updated');
        expect(backingCallCount).toBe(2); // fetched again
    });

    test('remove invalidates near-cache; subsequent get re-fetches (returns null for absent key)', () => {
        proxy.get('key1');
        expect(backingCallCount).toBe(1);
        expect(proxy.nearCacheSize()).toBe(1);

        proxy.remove('key1');
        expect(proxy.nearCacheSize()).toBe(0); // invalidated

        const after = proxy.get('key1'); // backing store consulted; key absent
        expect(after).toBeNull();
        expect(backingCallCount).toBe(2);
    });

    test('two distinct keys are cached independently', () => {
        backingStore.set('key2', 'value2');

        proxy.get('key1');
        proxy.get('key2');
        expect(backingCallCount).toBe(2);
        expect(proxy.nearCacheSize()).toBe(2);

        // Both hit without further backing-store calls
        proxy.get('key1');
        proxy.get('key2');
        expect(backingCallCount).toBe(2);
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
        proxy = new NearCachedClientCacheProxy<string, string>(
            'test-cache',
            nc,
            {
                get: (k) => { backingCallCount++; return backingStore.get(k) ?? null; },
                put: (k, v) => { const old = backingStore.get(k) ?? null; backingStore.set(k, v); return old; },
                remove: (k) => { const old = backingStore.get(k) ?? null; backingStore.delete(k); return old; },
            },
            LocalUpdatePolicy.INVALIDATE,
        );
    });

    test('cache miss → hit: first get fetches from backing store, second is a near-cache hit', () => {
        const first = proxy.get('ckey');
        expect(first).toBe('cval');
        expect(backingCallCount).toBe(1);
        expect(proxy.nearCacheSize()).toBe(1);

        const second = proxy.get('ckey');
        expect(second).toBe('cval');
        expect(backingCallCount).toBe(1); // no extra backing call
    });

    test('put with INVALIDATE policy invalidates near-cache; subsequent get re-fetches', () => {
        proxy.get('ckey');
        expect(proxy.nearCacheSize()).toBe(1);

        proxy.put('ckey', 'cval-updated');
        expect(proxy.nearCacheSize()).toBe(0); // invalidated

        const refetched = proxy.get('ckey');
        expect(refetched).toBe('cval-updated');
        expect(backingCallCount).toBe(2);
    });
});

// ── 4. JCache CACHE_ON_UPDATE policy ────────────────────────────────────────

describe('NearCacheProductionFlow — JCache CACHE_ON_UPDATE policy', () => {
    test('put with CACHE_ON_UPDATE publishes directly into near-cache', () => {
        const backingStore = new Map<string, string>();
        let backingCallCount = 0;

        const nc = buildNearCache<string, string>('test-cache-cou');
        const proxy = new NearCachedClientCacheProxy<string, string>(
            'test-cache-cou',
            nc,
            {
                get: (k) => { backingCallCount++; return backingStore.get(k) ?? null; },
                put: (k, v) => { const old = backingStore.get(k) ?? null; backingStore.set(k, v); return old; },
                remove: (k) => { const old = backingStore.get(k) ?? null; backingStore.delete(k); return old; },
            },
            LocalUpdatePolicy.CACHE_ON_UPDATE,
        );

        // put populates the near-cache (CACHE_ON_UPDATE)
        proxy.put('k', 'v1');
        expect(backingStore.get('k')).toBe('v1');
        expect(proxy.nearCacheSize()).toBe(1);

        // next get should hit the near-cache without calling backing store
        const result = proxy.get('k');
        expect(result).toBe('v1');
        expect(backingCallCount).toBe(0); // no miss
    });
});

// ── 5. Dropped-invalidation repair convergence ───────────────────────────────

describe('NearCacheProductionFlow — dropped-invalidation repair', () => {
    test('dropped invalidations exceeding maxToleratedMissCount force stale-sequence advance, evicting stale records', () => {
        const PARTITION_ID = 0;
        const PARTITION_UUID = 'test-partition-uuid-001';

        // Build a near-cache
        const nc = buildNearCache<string, string>('repair-map');

        // Build a RepairingTask with a 0-second reconciliation interval (anti-entropy disabled)
        // and maxToleratedMissCount = 10 (default).
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

        // registerAndGetHandler wires a StaleReadDetectorImpl onto the DefaultNearCache record store
        const handler = repairingTask.registerAndGetHandler('repair-map', nc);

        // Establish the initial partition UUID and sequence (simulating cluster state sync)
        handler.checkOrRepairUuid(PARTITION_ID, PARTITION_UUID);
        // sequence is 0 at this point

        // Backing store
        const backingStore = new Map([['hotkey', 'initial-value']]);
        let backingCallCount = 0;
        const proxy = new NearCachedClientMapProxy<string, string>(
            'repair-map',
            nc,
            {
                get: (k) => { backingCallCount++; return backingStore.get(k) ?? null; },
                put: (k, v) => { const old = backingStore.get(k) ?? null; backingStore.set(k, v); return old; },
                remove: (k) => { const old = backingStore.get(k) ?? null; backingStore.delete(k); return old; },
            },
        );

        // MISS: populate near-cache; record captures sequence=0, uuid=PARTITION_UUID
        const first = proxy.get('hotkey');
        expect(first).toBe('initial-value');
        expect(backingCallCount).toBe(1);
        expect(proxy.nearCacheSize()).toBe(1);

        // HIT: verify the entry is in the cache
        const hit = proxy.get('hotkey');
        expect(hit).toBe('initial-value');
        expect(backingCallCount).toBe(1); // no backing call

        // Simulate a "remote write" updating the backing store (but the invalidation is DROPPED —
        // the near-cache is not invalidated directly).
        backingStore.set('hotkey', 'updated-value');

        // Simulate receipt of a later invalidation event with a sequence gap.
        // Gap = 12 (sequence jumps 0 → 12), which is > maxToleratedMissCount=10.
        // checkOrRepairSequence advances the sequence and records 11 missed events (gap-1=11).
        handler.checkOrRepairSequence(PARTITION_ID, 12, false);

        const container = handler.getMetaDataContainer(PARTITION_ID);
        expect(container.getSequence()).toBe(12);
        expect(container.getMissedSequenceCount()).toBe(11); // 12 - 0 - 1 = 11

        // RepairingTask._fixSequenceGaps: missCount=11 > maxToleratedMissCount=10 →
        // updateLastKnownStaleSequences → staleSequence = sequence = 12.
        repairingTask['_fixSequenceGaps'](); // call private method for test isolation
        expect(container.getStaleSequence()).toBe(12);

        // The cached record has invalidationSequence=0, staleSequence=12 → STALE.
        // AbstractNearCacheRecordStore.get() detects staleness, invalidates, returns null → miss.
        const afterRepair = proxy.get('hotkey');
        expect(afterRepair).toBe('updated-value'); // re-fetched from backing store
        expect(backingCallCount).toBe(2);           // backing store called again
        expect(proxy.nearCacheSize()).toBe(1);       // re-populated with fresh data
    });

    test('reconnect scenario: UUID change clears sequence, new records are fresh', () => {
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

        // Establish old UUID
        handler.checkOrRepairUuid(PARTITION_ID, OLD_UUID);
        handler.checkOrRepairSequence(PARTITION_ID, 5, false);

        const backingStore = new Map([['rkey', 'rval']]);
        let backingCallCount = 0;
        const proxy = new NearCachedClientMapProxy<string, string>(
            'reconnect-map',
            nc,
            {
                get: (k) => { backingCallCount++; return backingStore.get(k) ?? null; },
                put: (k, v) => { const old = backingStore.get(k) ?? null; backingStore.set(k, v); return old; },
                remove: (k) => { const old = backingStore.get(k) ?? null; backingStore.delete(k); return old; },
            },
        );

        // Populate near-cache under OLD_UUID
        proxy.get('rkey');
        expect(backingCallCount).toBe(1);
        expect(proxy.nearCacheSize()).toBe(1);

        // Simulate reconnect: server partition UUID changes → RepairingHandler resets sequence
        handler.checkOrRepairUuid(PARTITION_ID, NEW_UUID);
        const container = handler.getMetaDataContainer(PARTITION_ID);
        // After UUID change the sequence is reset to 0
        expect(container.getUuid()).toBe(NEW_UUID);
        expect(container.getSequence()).toBe(0);

        // Cached record has OLD_UUID; StaleReadDetector detects UUID mismatch → stale → evicted
        const afterReconnect = proxy.get('rkey');
        expect(afterReconnect).toBe('rval');
        expect(backingCallCount).toBe(2); // re-fetched

        // Second get now uses the fresh record under NEW_UUID → hit
        const afterRefetch = proxy.get('rkey');
        expect(afterRefetch).toBe('rval');
        expect(backingCallCount).toBe(2); // no extra backing call
    });
});
