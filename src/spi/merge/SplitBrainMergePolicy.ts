/**
 * Port of {@code com.hazelcast.spi.merge.SplitBrainMergePolicy}.
 * The generic merge policy interface.
 */
import type { SplitBrainMergeData } from './MergingValue';

export interface SplitBrainMergePolicy {
    /**
     * Merge a value from the smaller (merging) brain into the larger (existing) brain.
     * @param mergingValue — the entry from the merging (smaller) cluster
     * @param existingValue — the current entry in the surviving cluster (null if absent)
     * @returns the data to keep, or null to discard (remove)
     */
    merge(mergingValue: SplitBrainMergeData, existingValue: SplitBrainMergeData | null): SplitBrainMergeData | null;

    /** Policy name for configuration. */
    getName(): string;
}
