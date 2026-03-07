/**
 * Port of {@code com.hazelcast.internal.partition.InternalPartition}.
 */
import type { Address } from '@zenystx/helios-core/cluster/Address';
import { MAX_BACKUP_COUNT } from '@zenystx/helios-core/internal/partition/IPartition';
import type { PartitionReplica } from '@zenystx/helios-core/internal/partition/PartitionReplica';

export const MAX_REPLICA_COUNT = MAX_BACKUP_COUNT + 1; // 7

export interface InternalPartition {
    isLocal(): boolean;
    getPartitionId(): number;
    getOwnerOrNull(): Address | null;
    isMigrating(): boolean;
    getReplicaAddress(replicaIndex: number): Address | null;
    isOwnerOrBackupAddress(address: Address): boolean;
    isOwnerOrBackupReplica(replica: PartitionReplica): boolean;
    version(): number;

    getOwnerReplicaOrNull(): PartitionReplica | null;
    getReplicaIndex(replica: PartitionReplica): number;
    getReplica(replicaIndex: number): PartitionReplica | null;
    getReplicasCopy(): (PartitionReplica | null)[];
}
