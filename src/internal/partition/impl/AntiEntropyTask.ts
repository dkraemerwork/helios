/**
 * Port of {@code com.hazelcast.internal.partition.impl.PartitionReplicaManager.AntiEntropyTask}
 * and {@code PartitionPrimaryReplicaAntiEntropyTask}.
 *
 * Scheduled periodically on the primary. Iterates all locally-owned partitions and
 * generates {@link PartitionBackupReplicaAntiEntropyOp} for each backup replica,
 * carrying the primary's current version vector.
 */
import type { PartitionReplicaManager } from '@helios/internal/partition/impl/PartitionReplicaManager';
import { PartitionBackupReplicaAntiEntropyOp } from '@helios/internal/partition/operation/PartitionBackupReplicaAntiEntropyOp';

export class AntiEntropyTask {
    private readonly _replicaManager: PartitionReplicaManager;

    constructor(replicaManager: PartitionReplicaManager) {
        this._replicaManager = replicaManager;
    }

    /**
     * Generate anti-entropy ops for the given locally-owned partitions.
     *
     * For each partition, produces one op per backup replica index (1..backupCount),
     * each carrying the primary's current version vector.
     */
    generateOps(localPartitionIds: number[], backupCount: number): PartitionBackupReplicaAntiEntropyOp[] {
        if (backupCount <= 0) return [];

        const ops: PartitionBackupReplicaAntiEntropyOp[] = [];

        for (const partitionId of localPartitionIds) {
            const versions = this._replicaManager.getPartitionReplicaVersions(partitionId);

            for (let replicaIndex = 1; replicaIndex <= backupCount; replicaIndex++) {
                ops.push(new PartitionBackupReplicaAntiEntropyOp(
                    partitionId,
                    versions,
                    replicaIndex,
                ));
            }
        }

        return ops;
    }
}
