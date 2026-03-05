/**
 * Port of {@code com.hazelcast.internal.partition.InternalPartitionService} (minimal surface).
 *
 * Provides partition topology information to services and operations.
 */
import type { Data } from '@helios/internal/serialization/Data';

export interface PartitionService {
    /** Returns the total number of partitions in the cluster. */
    getPartitionCount(): number;

    /** Returns the partition ID for the given serialized key. */
    getPartitionId(key: Data): number;
}
