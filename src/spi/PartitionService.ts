/**
 * Port of {@code com.hazelcast.internal.partition.InternalPartitionService} (minimal surface).
 *
 * Provides partition topology information to services and operations.
 */
export interface PartitionService {
    /** Returns the total number of partitions in the cluster. */
    getPartitionCount(): number;
}
