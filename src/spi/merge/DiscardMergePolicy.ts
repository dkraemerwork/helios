/**
 * Port of {@code com.hazelcast.spi.merge.DiscardMergePolicy}.
 * Always discards the merging value; keeps the existing entry unchanged.
 */
import type { SplitBrainMergeData } from './MergingValue';
import type { SplitBrainMergePolicy } from './SplitBrainMergePolicy';

export class DiscardMergePolicy implements SplitBrainMergePolicy {
    merge(_mergingValue: SplitBrainMergeData, existingValue: SplitBrainMergeData | null): SplitBrainMergeData | null {
        return existingValue;
    }

    getName(): string {
        return 'DiscardMergePolicy';
    }
}
