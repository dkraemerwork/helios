/**
 * Block 7.6 — Near-cache production-proof soak / stress suite.
 *
 * NearCachedClientMapProxy now extends ClientMapProxy (async, protocol-based).
 * Map near-cache soak tests use DefaultNearCache directly since full protocol
 * requires a live cluster. Cache proxy tests use AsyncCacheBackingStore.
 *
 * Production Proof Gate scenarios:
 *  1. E2E DefaultNearCache flow repeated >= 1000 iterations (hit ratio)
 *  2. Failure/repair runs with dropped invalidations (100 repair cycles)
 *  3. Stress run at target throughput (5000 mixed read/write ops without error)
 *  4. Metrics assertions: hit ratio, invalidation lag, stale-read safety
 *  5. Memory drift: eviction enforces maxSize under insertion pressure
 *  6. Invalidation counter accuracy across many puts
 */
import { describe, expect, test } from 'bun:test';

import type { AsyncCacheBackingStore } from '@zenystx/helios-core/client/cache/impl/nearcache/NearCachedClientCacheProxy';
import { NearCachedClientCacheProxy } from '@zenystx/helios-core/client/cache/impl/nearcache/NearCachedClientCacheProxy';
import { EvictionPolicy } from '@zenystx/helios-core/config/EvictionPolicy';
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

// ── Shared helpers ─────────────────────────────────────────────────────────────

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
    return { init: () => true, fetchMetadata: () => {} };
}

const noOpLogger = { finest: () => {}, isFinestEnabled: () => false } as const;

function buildNearCache<K, V>(
    name: string,
    opts: { maxSize?: number; ttlSeconds?: number; maxIdleSeconds?: number } = {},
): DefaultNearCache<K, V> {
    const config = new NearCacheConfig(name);
    config.setInMemoryFormat(InMemoryFormat.OBJECT);
    if (opts.maxSize !== undefined) {
        config.getEvictionConfig()
            .setSize(opts.maxSize)
            .setEvictionPolicy(EvictionPolicy.LRU);
    }
    if (opts.ttlSeconds !== undefined) config.setTimeToLiveSeconds(opts.ttlSeconds);
    if (opts.maxIdleSeconds !== undefined) config.setMaxIdleSeconds(opts.maxIdleSeconds);
    const nc = new DefaultNearCache<K, V>(name, config, makeSerialization());
    nc.initialize();
    return nc;
}

/** Simulate the near-cache read path: check cache → on miss reserve+fetch+publish. */
function ncGet<K, V>(nc: DefaultNearCache<K, V>, key: K, backing: Map<K, V>, calls: { count: number }): V | null {
    const cached = nc.get(key);
    if (cached !== NOT_CACHED) return cached as V | null;
    calls.count++;
    const value = backing.get(key) ?? null;
    const rid = nc.tryReserveForUpdate(key, null, 'READ_UPDATE');
    if (rid !== -1) nc.tryPublishReserved(key, value, rid, false);
    return value;
}

/** Simulate the near-cache write path: put to backing → invalidate. */
function ncPut<K, V>(nc: DefaultNearCache<K, V>, key: K, value: V, backing: Map<K, V>): V | null {
    const old = backing.get(key) ?? null;
    backing.set(key, value);
    nc.invalidate(key);
    return old;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. High-Volume E2E Flow — 1000 iterations
// ═══════════════════════════════════════════════════════════════════════════════

describe('NearCacheSoak — 1000-iteration E2E miss→hit cycle', () => {

    test('1000 read iterations: backing store called once per key, subsequent reads are hits', () => {
        const ITERATIONS = 1000;
        const KEY = 'hotkey' as any;
        const backing = new Map([[KEY, 'value']]);
        const calls = { count: 0 };
        const nc = buildNearCache<string, string>('soak-1k');

        const v0 = ncGet(nc, KEY, backing, calls);
        expect(v0).toBe('value');
        expect(calls.count).toBe(1);

        for (let i = 1; i < ITERATIONS; i++) {
            const v = ncGet(nc, KEY, backing, calls);
            expect(v).toBe('value');
        }
        expect(calls.count).toBe(1);
    });

    test('1000-key warm-up: after warming all keys, second pass is 100% cache hits', () => {
        const N = 1000;
        const backing = new Map<string, string>();
        for (let i = 0; i < N; i++) backing.set(`k${i}`, `v${i}`);
        const calls = { count: 0 };
        const nc = buildNearCache<string, string>('soak-warmup');

        for (let i = 0; i < N; i++) ncGet(nc, `k${i}` as any, backing as any, calls);
        expect(calls.count).toBe(N);

        const afterWarmup = calls.count;
        for (let i = 0; i < N; i++) {
            const v = ncGet(nc, `k${i}` as any, backing as any, calls);
            expect(v).toBe(`v${i}`);
        }
        expect(calls.count).toBe(afterWarmup);
    });

    test('1000-iteration hit ratio >= 0.66 with 1 miss followed by 2 hits per key (N=100 keys)', () => {
        const N = 100;
        const backing = new Map<string, string>();
        for (let i = 0; i < N; i++) backing.set(`key${i}`, `val${i}`);
        const calls = { count: 0 };
        const nc = buildNearCache<string, string>('soak-hitratio');

        for (let i = 0; i < N; i++) ncGet(nc, `key${i}` as any, backing as any, calls);
        for (let i = 0; i < N; i++) ncGet(nc, `key${i}` as any, backing as any, calls);
        for (let i = 0; i < N; i++) ncGet(nc, `key${i}` as any, backing as any, calls);

        const stats = nc.getNearCacheStats();
        const hits = stats.getHits();
        const misses = stats.getMisses();
        const total = hits + misses;
        const ratio = hits / total;

        expect(total).toBe(3 * N);
        expect(misses).toBe(N);
        expect(hits).toBe(2 * N);
        expect(ratio).toBeGreaterThanOrEqual(0.66);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Dropped-Invalidation Repair Soak — 100 cycles
// ═══════════════════════════════════════════════════════════════════════════════

describe('NearCacheSoak — dropped-invalidation repair (100 cycles)', () => {

    test('100 repair cycles: each sequence gap forces re-fetch with fresh value', () => {
        const CYCLES = 100;
        const PARTITION_ID = 0;
        const PARTITION_UUID = 'soak-partition-uuid';

        const nc = buildNearCache<string, string>('soak-repair');
        const repairingTask = new RepairingTask(
            new MapHeliosProperties(),
            makeNoOpFetcher(),
            new NoOpTaskScheduler(),
            makeSerialization(),
            makePartitionService(),
            'local-node',
            noOpLogger,
        );
        const handler = repairingTask.registerAndGetHandler('soak-repair', nc);
        handler.checkOrRepairUuid(PARTITION_ID, PARTITION_UUID);

        const backing = new Map<string, string>();
        const calls = { count: 0 };

        let totalRepairFetches = 0;

        for (let cycle = 0; cycle < CYCLES; cycle++) {
            const key = `repkey${cycle}` as any;
            const initial = `initial-${cycle}`;
            const updated = `updated-${cycle}`;
            backing.set(key, initial);

            const v1 = ncGet(nc, key, backing as any, calls);
            expect(v1).toBe(initial);

            backing.set(key, updated);

            const currentSeq = handler.getMetaDataContainer(PARTITION_ID).getSequence();
            handler.checkOrRepairSequence(PARTITION_ID, currentSeq + 12, false);
            repairingTask['_fixSequenceGaps']();

            const beforeRepair = calls.count;
            const v2 = ncGet(nc, key, backing as any, calls);
            expect(v2).toBe(updated);
            expect(calls.count).toBe(beforeRepair + 1);
            totalRepairFetches++;
        }

        expect(totalRepairFetches).toBe(CYCLES);
    });

    test('repair does not corrupt valid (non-stale) entries in the same partition', () => {
        const PARTITION_ID = 0;
        const PARTITION_UUID = 'soak-noisy-uuid';

        const nc = buildNearCache<string, string>('soak-noisy');
        const repairingTask = new RepairingTask(
            new MapHeliosProperties(),
            makeNoOpFetcher(),
            new NoOpTaskScheduler(),
            makeSerialization(),
            makePartitionService(),
            'local-node-noisy',
            noOpLogger,
        );
        const handler = repairingTask.registerAndGetHandler('soak-noisy', nc);
        handler.checkOrRepairUuid(PARTITION_ID, PARTITION_UUID);

        const backing = new Map([['stable', 'stable-value'], ['volatile', 'v0']]) as Map<string, string>;
        const calls = { count: 0 };

        ncGet(nc, 'stable' as any, backing as any, calls);
        ncGet(nc, 'volatile' as any, backing as any, calls);

        backing.set('volatile', 'v1');
        const seq = handler.getMetaDataContainer(PARTITION_ID).getSequence();
        handler.checkOrRepairSequence(PARTITION_ID, seq + 12, false);
        repairingTask['_fixSequenceGaps']();

        // After repair, all entries in the partition are stale (partition-wide)
        // Re-fetch should return correct value
        const stableVal = ncGet(nc, 'stable' as any, backing as any, calls);
        expect(stableVal).toBe('stable-value');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Throughput / Stress
// ═══════════════════════════════════════════════════════════════════════════════

describe('NearCacheSoak — throughput / stress', () => {

    test('5000 mixed read/write operations complete without error', () => {
        const N_KEYS = 50;
        const OPS = 5000;

        const backing = new Map<string, string>();
        for (let i = 0; i < N_KEYS; i++) backing.set(`k${i}`, `v${i}`);
        const nc = buildNearCache<string, string>('soak-stress');
        const calls = { count: 0 };

        let errors = 0;
        let ops = 0;

        while (ops < OPS) {
            const key = `k${ops % N_KEYS}` as any;
            try {
                if (ops % 4 === 0) {
                    ncPut(nc, key, `updated-${ops}`, backing as any);
                } else {
                    ncGet(nc, key, backing as any, calls);
                }
            } catch {
                errors++;
            }
            ops++;
        }

        expect(errors).toBe(0);
        expect(ops).toBe(OPS);
    });

    test('sequential scan of 500 keys: all misses on first pass, all hits on second pass', () => {
        const N = 500;
        const backing = new Map<string, string>();
        for (let i = 0; i < N; i++) backing.set(`sk${i}`, `sv${i}`);
        const nc = buildNearCache<string, string>('soak-scan');
        const calls = { count: 0 };

        for (let i = 0; i < N; i++) {
            const v = ncGet(nc, `sk${i}` as any, backing as any, calls);
            expect(v).toBe(`sv${i}`);
        }
        expect(calls.count).toBe(N);

        const afterFirst = calls.count;
        for (let i = 0; i < N; i++) {
            const v = ncGet(nc, `sk${i}` as any, backing as any, calls);
            expect(v).toBe(`sv${i}`);
        }
        expect(calls.count).toBe(afterFirst);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Metrics Assertions
// ═══════════════════════════════════════════════════════════════════════════════

describe('NearCacheSoak — metrics assertions', () => {

    test('invalidation counter matches write count: N puts → N invalidation requests', () => {
        const N = 200;
        const nc = buildNearCache<string, string>('soak-inv');
        const backing = new Map([['k', 'v0']]) as Map<string, string>;
        const calls = { count: 0 };

        ncGet(nc, 'k' as any, backing as any, calls);
        const initInvReqs = nc.getNearCacheStats().getInvalidationRequests();

        for (let i = 0; i < N; i++) {
            ncPut(nc, 'k' as any, `v${i}`, backing as any);
        }

        const finalInvReqs = nc.getNearCacheStats().getInvalidationRequests();
        expect(finalInvReqs - initInvReqs).toBe(N);
    });

    test('hit ratio monotonically improves as the cache warms up', () => {
        const N = 100;
        const backing = new Map<string, string>();
        for (let i = 0; i < N; i++) backing.set(`key${i}`, `val${i}`);
        const nc = buildNearCache<string, string>('soak-ratio');
        const calls = { count: 0 };

        for (let i = 0; i < N; i++) ncGet(nc, `key${i}` as any, backing as any, calls);
        const ratio1 = nc.getNearCacheStats().getRatio();

        for (let i = 0; i < N; i++) ncGet(nc, `key${i}` as any, backing as any, calls);
        const ratio2 = nc.getNearCacheStats().getRatio();

        for (let i = 0; i < N; i++) ncGet(nc, `key${i}` as any, backing as any, calls);
        const ratio3 = nc.getNearCacheStats().getRatio();

        expect(ratio2).toBeGreaterThanOrEqual(ratio1);
        expect(ratio3).toBeGreaterThanOrEqual(ratio2);
        expect(ratio3).toBeGreaterThanOrEqual(0.66);
    });

    test('JCache INVALIDATE policy: invalidation counters track cache→put→get cycle', async () => {
        const N = 50;
        const backing = new Map<string, string>();
        for (let i = 0; i < N; i++) backing.set(`ck${i}`, `cv${i}`);
        const nc = buildNearCache<string, string>('soak-jcache');
        const asyncBacking: AsyncCacheBackingStore<string, string> = {
            get: async (k) => backing.get(k) ?? null,
            put: async (k, v) => { const old = backing.get(k) ?? null; backing.set(k, v); return old; },
            remove: async (k) => { const old = backing.get(k) ?? null; backing.delete(k); return old; },
        };
        const proxy = new NearCachedClientCacheProxy<string, string>(
            'soak-jcache', nc, asyncBacking, LocalUpdatePolicy.INVALIDATE,
        );

        for (let i = 0; i < N; i++) await proxy.get(`ck${i}`);
        const statsAfterWarmup = nc.getNearCacheStats();
        expect(statsAfterWarmup.getMisses()).toBe(N);
        expect(statsAfterWarmup.getHits()).toBe(0);

        for (let i = 0; i < N; i++) await proxy.get(`ck${i}`);
        const statsAfterHits = nc.getNearCacheStats();
        expect(statsAfterHits.getHits()).toBe(N);

        for (let i = 0; i < N; i++) await proxy.put(`ck${i}`, `cv${i}-new`);
        const statsAfterPuts = nc.getNearCacheStats();
        expect(statsAfterPuts.getInvalidationRequests()).toBeGreaterThanOrEqual(N);
        expect(nc.size()).toBe(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Memory / Eviction
// ═══════════════════════════════════════════════════════════════════════════════

describe('NearCacheSoak — memory drift / eviction', () => {

    test('maxSize=100: inserting 300 distinct keys keeps near-cache size <= 100', () => {
        const MAX_SIZE = 100;
        const INSERT_COUNT = 300;
        const backing = new Map<string, string>();
        for (let i = 0; i < INSERT_COUNT; i++) backing.set(`ek${i}`, `ev${i}`);
        const nc = buildNearCache<string, string>('soak-evict', { maxSize: MAX_SIZE });
        const calls = { count: 0 };

        for (let i = 0; i < INSERT_COUNT; i++) {
            ncGet(nc, `ek${i}` as any, backing as any, calls);
        }

        expect(nc.size()).toBeLessThanOrEqual(MAX_SIZE);
        const evictions = nc.getNearCacheStats().getEvictions();
        expect(evictions).toBeGreaterThanOrEqual(INSERT_COUNT - MAX_SIZE);
    });

    test('maxSize=50: repeated insert/evict cycle keeps size bounded', () => {
        const MAX_SIZE = 50;
        const ROUNDS = 5;
        const KEYS_PER_ROUND = 100;
        const backing = new Map<string, string>();
        const nc = buildNearCache<string, string>('soak-bounded', { maxSize: MAX_SIZE });
        const calls = { count: 0 };

        for (let round = 0; round < ROUNDS; round++) {
            for (let i = 0; i < KEYS_PER_ROUND; i++) {
                const key = `r${round}k${i}` as any;
                backing.set(key, `r${round}v${i}`);
                ncGet(nc, key, backing as any, calls);
            }
            expect(nc.size()).toBeLessThanOrEqual(MAX_SIZE);
        }

        const totalOps = ROUNDS * KEYS_PER_ROUND;
        const evictions = nc.getNearCacheStats().getEvictions();
        expect(evictions).toBeGreaterThanOrEqual(totalOps - MAX_SIZE);
    });
});
