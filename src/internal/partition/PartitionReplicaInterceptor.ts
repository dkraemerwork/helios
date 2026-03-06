/**
 * Port of {@code com.hazelcast.internal.partition.PartitionReplicaInterceptor}.
 */
import type { PartitionReplica } from '@zenystx/helios-core/internal/partition/PartitionReplica';

export interface PartitionReplicaInterceptor {
    replicaChanged(
        partitionId: number,
        replicaIndex: number,
        oldReplica: PartitionReplica | null,
        newReplica: PartitionReplica | null,
    ): void;
}
