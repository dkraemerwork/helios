/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.invalidation.RepairingTaskTest}.
 *
 * Tests config validation for RepairingTask.
 */
import type { InvalidationMetaDataFetcher } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/InvalidationMetaDataFetcher';
import type { MinimalPartitionService } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/MinimalPartitionService';
import { RepairingTask } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/RepairingTask';
import type { TaskScheduler } from '@zenystx/helios-core/internal/nearcache/impl/TaskScheduler';
import type { SerializationService } from '@zenystx/helios-core/internal/serialization/SerializationService';
import { MapHeliosProperties } from '@zenystx/helios-core/spi/properties/HeliosProperties';
import { describe, expect, it } from 'bun:test';

const NANOS_PER_SECOND = 1_000_000_000;

function makeRepairingTask(props: Record<string, string>): RepairingTask {
    const properties = new MapHeliosProperties(props);
    const fetcher: InvalidationMetaDataFetcher = {
        init: () => true,
        fetchMetadata: () => {},
    } as unknown as InvalidationMetaDataFetcher;
    const scheduler: TaskScheduler = {
        schedule: () => ({ cancel: () => {} }),
        scheduleWithRepetition: () => ({ cancel: () => {} }),
    };
    const serialization = {} as SerializationService;
    const partitionService: MinimalPartitionService = {
        getPartitionCount: () => 271,
        getPartitionId: () => 0,
    };
    const uuid = 'local-member-uuid';
    const logger = { finest: () => {}, isFinestEnabled: () => false, warning: () => {} } as never;

    return new RepairingTask(properties, fetcher, scheduler, serialization, partitionService, uuid, logger);
}

describe('RepairingTaskTest', () => {
    it('whenToleratedMissCountIsConfigured_thenItShouldBeUsed', () => {
        const maxToleratedMissCount = 123;
        const task = makeRepairingTask({
            [RepairingTask.MAX_TOLERATED_MISS_COUNT.name]: String(maxToleratedMissCount),
        });
        expect(task.maxToleratedMissCount).toBe(maxToleratedMissCount);
    });

    it('whenToleratedMissCountIsNegative_thenThrowException', () => {
        expect(() => makeRepairingTask({
            [RepairingTask.MAX_TOLERATED_MISS_COUNT.name]: '-1',
        })).toThrow();
    });

    it('whenReconciliationIntervalSecondsIsConfigured_thenItShouldBeUsed', () => {
        const reconciliationIntervalSeconds = 91;
        const task = makeRepairingTask({
            [RepairingTask.RECONCILIATION_INTERVAL_SECONDS.name]: String(reconciliationIntervalSeconds),
        });
        // reconciliationIntervalNanos should be reconciliationIntervalSeconds * 1e9
        const actualSeconds = task.reconciliationIntervalNanos / NANOS_PER_SECOND;
        expect(actualSeconds).toBe(reconciliationIntervalSeconds);
    });

    it('whenReconciliationIntervalSecondsIsNegative_thenThrowException', () => {
        expect(() => makeRepairingTask({
            [RepairingTask.RECONCILIATION_INTERVAL_SECONDS.name]: '-1',
        })).toThrow();
    });

    it('whenReconciliationIntervalSecondsIsNotZeroButSmallerThanThresholdValue_thenThrowException', () => {
        const thresholdValue = parseInt(RepairingTask.MIN_RECONCILIATION_INTERVAL_SECONDS.defaultValue, 10);
        // Any value between 1 and (threshold - 1) should throw
        const tooSmall = Math.max(1, thresholdValue - 1);
        expect(() => makeRepairingTask({
            [RepairingTask.RECONCILIATION_INTERVAL_SECONDS.name]: String(tooSmall),
        })).toThrow();
    });
});
