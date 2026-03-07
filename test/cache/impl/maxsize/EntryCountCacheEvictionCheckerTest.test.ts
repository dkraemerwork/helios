/**
 * Port of logic tested in {@code com.hazelcast.cache.eviction.CacheEvictionPolicyComparatorTest}
 * and internal eviction size calculation logic from
 * {@code com.hazelcast.cache.impl.maxsize.impl.EntryCountCacheEvictionChecker}.
 */
import { EntryCountCacheEvictionChecker } from '@zenystx/helios-core/cache/impl/maxsize/impl/EntryCountCacheEvictionChecker';
import { describe, expect, test } from 'bun:test';

describe('EntryCountCacheEvictionCheckerTest', () => {
    test('calculateMaxPartitionSize_smallEntryCount', () => {
        // Below 4000: uses stdDev multiplier of 5
        const size = EntryCountCacheEvictionChecker.calculateMaxPartitionSize(100, 271);
        expect(size).toBeGreaterThan(0);
        // balancedPartitionSize ≈ 100/271 ≈ 0.37
        // approxStdDev ≈ sqrt(0.37) ≈ 0.61
        // maxPartitionSize ≈ 0.61*5 + 0.37 ≈ 3.4 → 3
        // With rounding, should be small
        expect(size).toBeGreaterThanOrEqual(1);
    });

    test('calculateMaxPartitionSize_mediumEntryCount', () => {
        // Between 4000 and 1000000: uses stdDev multiplier of 3
        const size = EntryCountCacheEvictionChecker.calculateMaxPartitionSize(100000, 271);
        expect(size).toBeGreaterThan(0);
        // balancedPartitionSize ≈ 100000/271 ≈ 369
        // approxStdDev ≈ sqrt(369) ≈ 19.2
        // maxPartitionSize ≈ 19.2*3 + 369 ≈ 427
        expect(size).toBeGreaterThan(300);
    });

    test('calculateMaxPartitionSize_largeEntryCount_noStdDev', () => {
        // Over 1000000: no standard deviation, just balanced size
        const size = EntryCountCacheEvictionChecker.calculateMaxPartitionSize(2000000, 271);
        // balancedPartitionSize ≈ 2000000/271 ≈ 7380
        // stdDevMultiplier = 0, so maxPartitionSize ≈ 7380
        expect(size).toBeCloseTo(Math.floor(2000000 / 271), -1);
    });

    test('calculateMaxPartitionSize_isAtLeast_balancedSize', () => {
        const partitionCount = 271;
        const maxEntryCount = 10000;
        const size = EntryCountCacheEvictionChecker.calculateMaxPartitionSize(maxEntryCount, partitionCount);
        const balancedSize = maxEntryCount / partitionCount;
        expect(size).toBeGreaterThanOrEqual(balancedSize);
    });

    test('isEvictionRequired_belowMax', () => {
        // maxEntryCount=10000, partitionCount=271 → maxPartitionSize ≈ 55
        // 5 records << 55, so eviction should NOT be required
        const records = new Map<unknown, unknown>();
        for (let i = 0; i < 5; i++) records.set(i, `v${i}`);
        const checker = new EntryCountCacheEvictionChecker(10000, records, 271);
        expect(checker.isEvictionRequired()).toBe(false);
    });

    test('isEvictionRequired_atMax', () => {
        const maxPartitionSize = EntryCountCacheEvictionChecker.calculateMaxPartitionSize(100, 271);
        const records = new Map<unknown, unknown>();
        for (let i = 0; i < maxPartitionSize; i++) records.set(i, `v${i}`);
        const checker = new EntryCountCacheEvictionChecker(100, records, 271);
        expect(checker.isEvictionRequired()).toBe(true);
    });

    test('isEvictionRequired_emptyStore', () => {
        const records = new Map<unknown, unknown>();
        const checker = new EntryCountCacheEvictionChecker(1000, records, 271);
        expect(checker.isEvictionRequired()).toBe(false);
    });

    test('calculateMaxPartitionSize_symmetry', () => {
        // Same inputs always produce same result
        const a = EntryCountCacheEvictionChecker.calculateMaxPartitionSize(5000, 271);
        const b = EntryCountCacheEvictionChecker.calculateMaxPartitionSize(5000, 271);
        expect(a).toBe(b);
    });

    test('calculateMaxPartitionSize_boundary_4000', () => {
        // At exactly 4000 (STD_DEV_OF_5_THRESHOLD): uses multiplier 5
        const size = EntryCountCacheEvictionChecker.calculateMaxPartitionSize(4000, 271);
        const balanced = 4000 / 271;
        const approxStdDev = Math.sqrt(balanced);
        const expected = Math.floor(approxStdDev * 5 + balanced);
        expect(size).toBe(expected);
    });

    test('calculateMaxPartitionSize_boundary_1000001', () => {
        // Over 1000000: multiplier 0
        const size = EntryCountCacheEvictionChecker.calculateMaxPartitionSize(1000001, 271);
        const balanced = 1000001 / 271;
        // stdDevMultiplier = 0
        const expected = Math.floor(balanced);
        expect(size).toBe(expected);
    });

    test('calculateMaxPartitionSize_singlePartition', () => {
        // With 1 partition, max partition size should equal max entry count
        const size = EntryCountCacheEvictionChecker.calculateMaxPartitionSize(100, 1);
        // With 1 partition, balanced size = 100, stdDev ≈ 10
        // With multiplier 5: 10*5 + 100 = 150
        expect(size).toBe(150);
    });
});
