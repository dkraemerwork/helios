/**
 * Port of {@code com.hazelcast.cache.impl.maxsize.impl.EntryCountCacheEvictionChecker}.
 * Cache max-size policy implementation for {@code MaxSizePolicy.ENTRY_COUNT}.
 */

const MAX_ENTRY_COUNT_FOR_THRESHOLD_USAGE = 1_000_000;
const STD_DEV_OF_5_THRESHOLD = 4_000;
const STD_DEV_MULTIPLIER_5 = 5;
const STD_DEV_MULTIPLIER_3 = 3;

export class EntryCountCacheEvictionChecker {
    private readonly _recordMap: { size: number };
    private readonly _maxPartitionSize: number;

    constructor(maxEntryCount: number, recordMap: { size: number }, partitionCount: number) {
        this._recordMap = recordMap;
        this._maxPartitionSize = EntryCountCacheEvictionChecker.calculateMaxPartitionSize(maxEntryCount, partitionCount);
    }

    /**
     * Calculates the per-partition size threshold using statistical estimation.
     * Exposed as public static so tests can verify the formula directly.
     */
    static calculateMaxPartitionSize(maxEntryCount: number, partitionCount: number): number {
        const balancedPartitionSize = maxEntryCount / partitionCount;
        const approximatedStdDev = Math.sqrt(balancedPartitionSize);
        let stdDevMultiplier: number;

        if (maxEntryCount <= STD_DEV_OF_5_THRESHOLD) {
            stdDevMultiplier = STD_DEV_MULTIPLIER_5;
        } else if (maxEntryCount <= MAX_ENTRY_COUNT_FOR_THRESHOLD_USAGE) {
            stdDevMultiplier = STD_DEV_MULTIPLIER_3;
        } else {
            stdDevMultiplier = 0;
        }

        return Math.floor(approximatedStdDev * stdDevMultiplier + balancedPartitionSize);
    }

    isEvictionRequired(): boolean {
        return this._recordMap.size >= this._maxPartitionSize;
    }
}
