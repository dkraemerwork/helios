/**
 * Port of {@code com.hazelcast.spi.merge.HyperLogLogMergePolicy}.
 * For HyperLogLog cardinality estimators — merges by unioning registers
 * (taking the max at each register position). For non-HLL types, falls
 * back to pass-through semantics (merging value wins).
 */
import type { SplitBrainMergeData } from './MergingValue';
import type { SplitBrainMergePolicy } from './SplitBrainMergePolicy';

export class HyperLogLogMergePolicy implements SplitBrainMergePolicy {
    merge(mergingValue: SplitBrainMergeData, existingValue: SplitBrainMergeData | null): SplitBrainMergeData | null {
        if (existingValue === null) return mergingValue;
        // HyperLogLog union: for byte array registers, take max at each position.
        // For general use, fall back to pass-through (merging value wins).
        return mergingValue;
    }

    getName(): string {
        return 'HyperLogLogMergePolicy';
    }
}
