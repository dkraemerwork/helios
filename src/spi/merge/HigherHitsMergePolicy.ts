/**
 * Port of {@code com.hazelcast.spi.merge.HigherHitsMergePolicy}.
 * Keeps the entry with the higher hit count (number of accesses).
 */
import type { SplitBrainMergeData } from './MergingValue';
import type { SplitBrainMergePolicy } from './SplitBrainMergePolicy';

export class HigherHitsMergePolicy implements SplitBrainMergePolicy {
    merge(mergingValue: SplitBrainMergeData, existingValue: SplitBrainMergeData | null): SplitBrainMergeData | null {
        if (existingValue === null) return mergingValue;
        return mergingValue.getHits() >= existingValue.getHits() ? mergingValue : existingValue;
    }

    getName(): string {
        return 'HigherHitsMergePolicy';
    }
}
