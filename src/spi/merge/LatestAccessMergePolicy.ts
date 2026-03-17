/**
 * Port of {@code com.hazelcast.spi.merge.LatestAccessMergePolicy}.
 * Keeps the entry with the most recent last-access time.
 */
import type { SplitBrainMergeData } from './MergingValue';
import type { SplitBrainMergePolicy } from './SplitBrainMergePolicy';

export class LatestAccessMergePolicy implements SplitBrainMergePolicy {
    merge(mergingValue: SplitBrainMergeData, existingValue: SplitBrainMergeData | null): SplitBrainMergeData | null {
        if (existingValue === null) return mergingValue;
        return mergingValue.getLastAccessTime() >= existingValue.getLastAccessTime() ? mergingValue : existingValue;
    }

    getName(): string {
        return 'LatestAccessMergePolicy';
    }
}
