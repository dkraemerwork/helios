/**
 * Port of {@code com.hazelcast.spi.merge.LatestUpdateMergePolicy}.
 * Keeps the entry with the most recent last-update time.
 */
import type { SplitBrainMergeData } from './MergingValue';
import type { SplitBrainMergePolicy } from './SplitBrainMergePolicy';

export class LatestUpdateMergePolicy implements SplitBrainMergePolicy {
    merge(mergingValue: SplitBrainMergeData, existingValue: SplitBrainMergeData | null): SplitBrainMergeData | null {
        if (existingValue === null) return mergingValue;
        return mergingValue.getLastUpdateTime() >= existingValue.getLastUpdateTime() ? mergingValue : existingValue;
    }

    getName(): string {
        return 'LatestUpdateMergePolicy';
    }
}
