/**
 * Port of {@code com.hazelcast.internal.partition.InternalPartitionService} (minimal surface).
 *
 * Provides partition topology information to services and operations.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { Address } from '@zenystx/helios-core/cluster/Address';

export interface PartitionService {
    /** Returns the total number of partitions in the cluster. */
    getPartitionCount(): number;

    /** Returns the partition ID for the given serialized key. */
    getPartitionId(key: Data): number;

    /** Returns the owner address for the given partition, or null if unassigned. */
    getPartitionOwner(partitionId: number): Address | null;

    /** Returns true if the given partition is currently migrating. */
    isMigrating(partitionId: number): boolean;
}
