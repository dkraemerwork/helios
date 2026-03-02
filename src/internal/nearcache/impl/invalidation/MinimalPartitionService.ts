/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.invalidation.MinimalPartitionService}.
 *
 * Abstraction over member and client partition services.
 */

export interface MinimalPartitionService {
    /** Returns the partition ID for a given key. */
    getPartitionId(key: unknown): number;

    /** Returns the number of partitions. */
    getPartitionCount(): number;
}
