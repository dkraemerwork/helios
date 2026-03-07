/**
 * Port of {@code com.hazelcast.internal.partition.operation.PartitionBackupReplicaAntiEntropyOperation}.
 *
 * Executes on a backup node. Compares the primary's version vector against the local
 * replica versions. If any mismatch is detected, triggers a replica sync request.
 *
 * Block 21.0: Namespace-scoped version comparison — compares per-service-namespace
 * versions so only dirty namespaces trigger sync, not the entire partition.
 */
import { MAX_REPLICA_COUNT } from '@zenystx/helios-core/internal/partition/InternalPartition';
import type { PartitionReplicaManager } from '@zenystx/helios-core/internal/partition/impl/PartitionReplicaManager';

export interface AntiEntropyResult {
    /** Whether a sync was triggered due to version mismatch. */
    syncTriggered: boolean;
    /** Namespace names that are dirty and need sync. Empty if no namespace-scoped tracking. */
    dirtyNamespaces: string[];
}

export class PartitionBackupReplicaAntiEntropyOp {
    readonly partitionId: number;
    readonly primaryVersions: bigint[];
    readonly targetReplicaIndex: number;
    /** Per-namespace version maps from the primary (undefined if no namespace tracking active). */
    readonly namespaceVersions: Map<string, bigint[]> | undefined;

    constructor(
        partitionId: number,
        primaryVersions: bigint[],
        targetReplicaIndex: number = 1,
        namespaceVersions?: Map<string, bigint[]>,
    ) {
        this.partitionId = partitionId;
        this.primaryVersions = primaryVersions;
        this.targetReplicaIndex = targetReplicaIndex;
        this.namespaceVersions = namespaceVersions;
    }

    /**
     * Compare primary versions against the local replica manager's versions.
     * If namespace-scoped versions are available, compare per-namespace and
     * only mark dirty namespaces for sync. Otherwise fall back to partition-level.
     */
    execute(replicaManager: PartitionReplicaManager): AntiEntropyResult {
        const dirtyNamespaces: string[] = [];

        // Namespace-scoped comparison takes precedence
        if (this.namespaceVersions !== undefined && this.namespaceVersions.size > 0) {
            for (const [namespace, primaryNsVersions] of this.namespaceVersions) {
                const localNsVersions = replicaManager.getNamespaceReplicaVersions(this.partitionId, namespace);
                for (let i = 0; i < MAX_REPLICA_COUNT; i++) {
                    if (primaryNsVersions[i] !== localNsVersions[i]) {
                        replicaManager.markNamespaceReplicaAsSyncRequired(this.partitionId, namespace, i);
                        dirtyNamespaces.push(namespace);
                        break;
                    }
                }
            }

            if (dirtyNamespaces.length > 0) {
                // Also mark partition-level as needing sync for backward compat
                replicaManager.markPartitionReplicaAsSyncRequired(this.partitionId, this.targetReplicaIndex);
                return { syncTriggered: true, dirtyNamespaces };
            }

            return { syncTriggered: false, dirtyNamespaces: [] };
        }

        // Fallback: partition-level comparison
        const localVersions = replicaManager.getPartitionReplicaVersions(this.partitionId);
        for (let i = 0; i < MAX_REPLICA_COUNT; i++) {
            if (this.primaryVersions[i] !== localVersions[i]) {
                replicaManager.markPartitionReplicaAsSyncRequired(this.partitionId, i);
                return { syncTriggered: true, dirtyNamespaces: [] };
            }
        }

        return { syncTriggered: false, dirtyNamespaces: [] };
    }
}
