/**
 * Port of com.hazelcast.map.impl.query.QueryResultSizeLimiterTest
 *
 * Uses plain TypeScript stub objects instead of Mockito mocks.
 */
import { PartitionIdSet } from '@zenystx/helios-core/internal/util/collection/PartitionIdSet';
import type { MapServiceContext } from '@zenystx/helios-core/map/impl/MapServiceContext';
import { QueryResultSizeLimiter } from '@zenystx/helios-core/map/impl/query/QueryResultSizeLimiter';
import { QueryResultSizeExceededException } from '@zenystx/helios-core/map/QueryResultSizeExceededException';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine';
import { ClusterProperty } from '@zenystx/helios-core/spi/properties/ClusterProperty';
import type { HeliosProperties } from '@zenystx/helios-core/spi/properties/HeliosProperties';
import { describe, expect, it } from 'bun:test';

const ANY_MAP_NAME = 'foobar';
const PARTITION_COUNT = parseInt(ClusterProperty.PARTITION_COUNT.defaultValue, 10); // 271

/** Build a minimal MapServiceContext stub for the limiter. */
function buildContext(
    maxResultSizeLimit: number,
    maxLocalPartitionLimitForPreCheck: number,
    localPartitions: Map<number, number>,
): { ctx: MapServiceContext; callCount: { exceeded: number } } {
    const callCount = { exceeded: 0 };

    const props: HeliosProperties = {
        getInteger(prop) {
            if (prop === ClusterProperty.QUERY_RESULT_SIZE_LIMIT) return maxResultSizeLimit;
            if (prop === ClusterProperty.QUERY_MAX_LOCAL_PARTITION_LIMIT_FOR_PRE_CHECK) return maxLocalPartitionLimitForPreCheck;
            if (prop === ClusterProperty.PARTITION_COUNT) return PARTITION_COUNT;
            return parseInt(prop.defaultValue, 10);
        },
        getString(prop) { return prop.defaultValue; },
    };

    const nodeEngine: Pick<NodeEngine, 'getProperties' | 'getPartitionService'> = {
        getProperties: () => props,
        getPartitionService: () => ({
            getPartitionCount: () => PARTITION_COUNT,
        }),
    } as unknown as NodeEngine;

    // Iterator over localPartitions keys
    const partitionIdSet = new PartitionIdSet(PARTITION_COUNT, [...localPartitions.keys()]);

    // Simulate RecordStore.size() cycling through partition sizes in insertion order
    const sizeIterator: Iterator<number> = localPartitions.values()[Symbol.iterator]();
    let lastValue = 0;

    const localMapStatsImpl = {
        incrementQueryResultSizeExceededCount: () => { callCount.exceeded++; },
    };

    const localMapStatsProvider = {
        hasLocalMapStatsImpl: (_mapName: string) => true,
        getLocalMapStatsImpl: (_mapName: string) => localMapStatsImpl,
    };

    const ctx: MapServiceContext = {
        getNodeEngine: () => nodeEngine as NodeEngine,
        getRecordStore: (_partitionId: number, _mapName: string) => {
            const next = sizeIterator.next();
            if (!next.done) lastValue = next.value;
            return {
                size: () => lastValue,
            } as unknown as import('@zenystx/helios-core/map/impl/recordstore/RecordStore').RecordStore;
        },
        getCachedOwnedPartitions: () => partitionIdSet,
        getLocalMapStatsProvider: () => localMapStatsProvider,
    } as unknown as MapServiceContext;

    return { ctx, callCount };
}

function makeLimiter(maxResultSizeLimit: number, maxLocalPartitionLimitForPreCheck = Integer.MAX_VALUE, localPartitions: Map<number, number> = new Map()): { limiter: QueryResultSizeLimiter; callCount: { exceeded: number } } {
    const { ctx, callCount } = buildContext(maxResultSizeLimit, maxLocalPartitionLimitForPreCheck, localPartitions);
    const limiter = new QueryResultSizeLimiter(ctx, { finest: () => {} } as any);
    return { limiter, callCount };
}

// Java Integer.MAX_VALUE = 2^31 - 1
const Integer = { MAX_VALUE: 2147483647 };

// ── constructor validation ───────────────────────────────────────────────────

describe('QueryResultSizeLimiterTest', () => {
    it('testNodeResultResultSizeLimitNegative — throws for limit -2', () => {
        expect(() => makeLimiter(-2)).toThrow(Error);
    });

    it('testNodeResultResultSizeLimitZero — throws for limit 0', () => {
        expect(() => makeLimiter(0)).toThrow(Error);
    });

    it('testNodeResultFeatureDisabled — limit -1 disables the feature', () => {
        const { limiter } = makeLimiter(-1);
        expect(limiter.isQueryResultLimitEnabled()).toBe(false);
    });

    it('testNodeResultFeatureEnabled — positive limit enables the feature', () => {
        const { limiter } = makeLimiter(1);
        expect(limiter.isQueryResultLimitEnabled()).toBe(true);
    });

    it('testNodeResultPreCheckLimitNegative — throws for precheck limit -2', () => {
        expect(() => makeLimiter(Integer.MAX_VALUE, -2)).toThrow(Error);
    });

    it('testNodeResultPreCheckLimitZero — throws for precheck limit 0', () => {
        expect(() => makeLimiter(Integer.MAX_VALUE, 0)).toThrow(Error);
    });

    it('testNodeResultPreCheckLimitDisabled — precheck disabled when limit -1', () => {
        const { limiter } = makeLimiter(Integer.MAX_VALUE, -1);
        expect(limiter.isQueryResultLimitEnabled()).toBe(true);
        expect(limiter.isPreCheckEnabled()).toBe(false);
    });

    it('testNodeResultPreCheckLimitEnabled — precheck enabled with positive limit', () => {
        const { limiter } = makeLimiter(Integer.MAX_VALUE, 1);
        expect(limiter.isQueryResultLimitEnabled()).toBe(true);
        expect(limiter.isPreCheckEnabled()).toBe(true);
    });

    // ── node result limit math ───────────────────────────────────────────────

    it('testNodeResultLimitMinResultLimit — below minimum clamps to minimum', () => {
        const { limiter: l1 } = makeLimiter(QueryResultSizeLimiter.MINIMUM_MAX_RESULT_LIMIT, 3);
        const limit1 = l1.getNodeResultLimit(1);

        const { limiter: l2 } = makeLimiter(Math.floor(QueryResultSizeLimiter.MINIMUM_MAX_RESULT_LIMIT / 2), 3);
        const limit2 = l2.getNodeResultLimit(1);

        expect(limit1).toBe(limit2);
    });

    it('testNodeResultLimitSinglePartition — 200000 limit, 1 partition → 849', () => {
        const { limiter } = makeLimiter(200000, 3);
        expect(limiter.getNodeResultLimit(1)).toBe(849);
    });

    it('testNodeResultLimitThreePartitions — 200000 limit, 3 partitions → 2547', () => {
        const { limiter } = makeLimiter(200000, 3);
        expect(limiter.getNodeResultLimit(3)).toBe(2547);
    });

    // ── precheckMaxResultLimitOnLocalPartitions ──────────────────────────────

    it('testLocalPreCheckDisabled — no-op when precheck disabled', () => {
        const { limiter } = makeLimiter(200000, QueryResultSizeLimiter.DISABLED);
        // should not throw
        limiter.precheckMaxResultLimitOnLocalPartitions(ANY_MAP_NAME);
    });

    it('testLocalPreCheckEnabledWithNoLocalPartitions — no-op when no local partitions', () => {
        const { limiter } = makeLimiter(200000, 1);
        // localPartitions empty → no-op
        limiter.precheckMaxResultLimitOnLocalPartitions(ANY_MAP_NAME);
    });

    it('testLocalPreCheckEnabledWithEmptyPartition — no-op for zero-size partition', () => {
        const parts = new Map([[0, 0]]);
        const { limiter } = makeLimiter(200000, 1, parts);
        limiter.precheckMaxResultLimitOnLocalPartitions(ANY_MAP_NAME);
    });

    it('testLocalPreCheckEnabledWitPartitionBelowLimit — no throw for 848 entries', () => {
        const parts = new Map([[0, 848]]);
        const { limiter } = makeLimiter(200000, 1, parts);
        limiter.precheckMaxResultLimitOnLocalPartitions(ANY_MAP_NAME);
    });

    it('testLocalPreCheckEnabledWitPartitionOverLimit — throws for 1090 entries', () => {
        const parts = new Map([[0, 1090]]);
        const { limiter } = makeLimiter(200000, 1, parts);
        expect(() => limiter.precheckMaxResultLimitOnLocalPartitions(ANY_MAP_NAME))
            .toThrow(QueryResultSizeExceededException);
    });

    it('testLocalPreCheckEnabledWitTwoPartitionsBelowLimit — no throw for 849+849', () => {
        const parts = new Map([[0, 849], [1, 849]]);
        const { limiter } = makeLimiter(200000, 2, parts);
        limiter.precheckMaxResultLimitOnLocalPartitions(ANY_MAP_NAME);
    });

    it('testLocalPreCheckEnabledWitTwoPartitionsOverLimit — throws and increments stats', () => {
        const parts = new Map([[0, 1062], [1, 1063]]);
        const { limiter, callCount } = makeLimiter(200000, 2, parts);
        expect(() => limiter.precheckMaxResultLimitOnLocalPartitions(ANY_MAP_NAME))
            .toThrow(QueryResultSizeExceededException);
        expect(callCount.exceeded).toBe(1);
    });

    it('testLocalPreCheckEnabledWitMorePartitionsThanPreCheckThresholdBelowLimit', () => {
        // precheck limit = 2, so only first 2 partitions checked (849 + 849 = 1698 < 2547*1.25)
        const parts = new Map([[0, 849], [1, 849], [2, Integer.MAX_VALUE]]);
        const { limiter } = makeLimiter(200000, 2, parts);
        limiter.precheckMaxResultLimitOnLocalPartitions(ANY_MAP_NAME);
    });

    it('testLocalPreCheckEnabledWitMorePartitionsThanPreCheckThresholdOverLimit', () => {
        const parts = new Map([[0, 1200], [1, 1000], [2, -2147483648]]);
        const { limiter } = makeLimiter(200000, 2, parts);
        expect(() => limiter.precheckMaxResultLimitOnLocalPartitions(ANY_MAP_NAME))
            .toThrow(QueryResultSizeExceededException);
    });

    it('testLocalPreCheckEnabledWitDifferentPartitionSizesBelowLimit', () => {
        // 566 + 1132 = 1698 → below 2547 * 1.25 = 3183.75
        const parts = new Map([[0, 566], [1, 1132], [2, Integer.MAX_VALUE]]);
        const { limiter } = makeLimiter(200000, 2, parts);
        limiter.precheckMaxResultLimitOnLocalPartitions(ANY_MAP_NAME);
    });

    it('testLocalPreCheckEnabledWitDifferentPartitionSizesOverLimit', () => {
        // 0 + 2200 = 2200, limit for 2 partitions = ceil(848.71*2) = 1698
        // 2200 > 1698 * 1.25 = 2122.5 → throws
        const parts = new Map([[0, 0], [1, 2200], [2, -2147483648]]);
        const { limiter } = makeLimiter(200000, 2, parts);
        expect(() => limiter.precheckMaxResultLimitOnLocalPartitions(ANY_MAP_NAME))
            .toThrow(QueryResultSizeExceededException);
    });
});
