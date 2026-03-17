/**
 * Port of {@code com.hazelcast.spi.merge.PutIfAbsentMergePolicy}.
 * Only puts the merging value if no existing value is present.
 */
import type { SplitBrainMergeData } from './MergingValue';
import type { SplitBrainMergePolicy } from './SplitBrainMergePolicy';

export class PutIfAbsentMergePolicy implements SplitBrainMergePolicy {
    merge(mergingValue: SplitBrainMergeData, existingValue: SplitBrainMergeData | null): SplitBrainMergeData | null {
        return existingValue !== null ? existingValue : mergingValue;
    }

    getName(): string {
        return 'PutIfAbsentMergePolicy';
    }
}
