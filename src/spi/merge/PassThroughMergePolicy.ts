/**
 * Port of {@code com.hazelcast.spi.merge.PassThroughMergePolicy}.
 * Always returns the merging value, overwriting the existing entry.
 */
import type { SplitBrainMergeData } from './MergingValue';
import type { SplitBrainMergePolicy } from './SplitBrainMergePolicy';

export class PassThroughMergePolicy implements SplitBrainMergePolicy {
    merge(mergingValue: SplitBrainMergeData, _existingValue: SplitBrainMergeData | null): SplitBrainMergeData | null {
        return mergingValue;
    }

    getName(): string {
        return 'PassThroughMergePolicy';
    }
}
