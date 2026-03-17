/**
 * Port of {@code com.hazelcast.spi.merge.ExpirationTimeMergePolicy}.
 * Keeps the entry with the later expiration time (lives longer).
 */
import type { SplitBrainMergeData } from './MergingValue';
import type { SplitBrainMergePolicy } from './SplitBrainMergePolicy';

export class ExpirationTimeMergePolicy implements SplitBrainMergePolicy {
    merge(mergingValue: SplitBrainMergeData, existingValue: SplitBrainMergeData | null): SplitBrainMergeData | null {
        if (existingValue === null) return mergingValue;
        return mergingValue.getExpirationTime() >= existingValue.getExpirationTime() ? mergingValue : existingValue;
    }

    getName(): string {
        return 'ExpirationTimeMergePolicy';
    }
}
