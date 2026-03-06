/**
 * Port of {@code com.hazelcast.internal.partition.operation.PartitionBackupReplicaAntiEntropyOperation}.
 *
 * Executes on a backup node. Compares the primary's version vector against the local
 * replica versions. If any mismatch is detected, triggers a replica sync request.
 *
 * **v1 limitation (Finding 21):** Version tracking is per-partition, not per-namespace.
 */
import { MAX_REPLICA_COUNT } from '@zenystx/helios-core/internal/partition/InternalPartition';
import type { PartitionReplicaManager } from '@zenystx/helios-core/internal/partition/impl/PartitionReplicaManager';

export interface AntiEntropyResult {
    /** Whether a sync was triggered due to version mismatch. */
    syncTriggered: boolean;
}

export class PartitionBackupReplicaAntiEntropyOp {
    readonly partitionId: number;
    readonly primaryVersions: bigint[];
    readonly targetReplicaIndex: number;

    constructor(partitionId: number, primaryVersions: bigint[], targetReplicaIndex: number = 1) {
        this.partitionId = partitionId;
        this.primaryVersions = primaryVersions;
        this.targetReplicaIndex = targetReplicaIndex;
    }

    /**
     * Compare primary versions against the local replica manager's versions.
     * If any version differs, trigger a sync.
     */
    execute(replicaManager: PartitionReplicaManager): AntiEntropyResult {
        const localVersions = replicaManager.getPartitionReplicaVersions(this.partitionId);

        for (let i = 0; i < MAX_REPLICA_COUNT; i++) {
            if (this.primaryVersions[i] !== localVersions[i]) {
                replicaManager.markPartitionReplicaAsSyncRequired(this.partitionId, i);
                return { syncTriggered: true };
            }
        }

        return { syncTriggered: false };
    }
}
