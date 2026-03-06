/**
 * Port of {@code com.hazelcast.internal.partition.IPartition}.
 * SPI-level partition interface.
 */
import type { Address } from '@zenystx/helios-core/cluster/Address';

export interface IPartition {
    readonly MAX_BACKUP_COUNT: 6;
    isLocal(): boolean;
    getPartitionId(): number;
    getOwnerOrNull(): Address | null;
    isMigrating(): boolean;
    getReplicaAddress(replicaIndex: number): Address | null;
    isOwnerOrBackupAddress(address: Address): boolean;
    version(): number;
}

export const MAX_BACKUP_COUNT = 6;
