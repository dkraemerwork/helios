/**
 * Port of {@code com.hazelcast.internal.partition.operation.PartitionReplicaSyncResponse}.
 *
 * Sent from the primary back to the backup after a PartitionReplicaSyncRequest.
 * Contains per-namespace state (entries) that the backup applies to its local
 * PartitionContainer.
 *
 * **Per-namespace chunking (Finding 16):** Each ReplicationNamespaceState carries
 * state for exactly ONE namespace. If a single namespace exceeds
 * maxSingleSyncSizeBytes (default 50MB), a warning is logged but sync proceeds
 * (the alternative is OOM, which is worse).
 */
import type { PartitionContainer } from '@zenystx/helios-core/internal/partition/impl/PartitionContainer';
import type { PartitionReplicaManager } from '@zenystx/helios-core/internal/partition/impl/PartitionReplicaManager';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';

/** State for a single namespace within a partition sync response. */
export interface ReplicationNamespaceState {
    namespace: string;
    entries: ReadonlyArray<readonly [Data, Data]>;
    estimatedSizeBytes: number;
}

export interface SyncApplyOptions {
    /** Maximum byte size for a single namespace before logging a warning. Default: 50MB. */
    maxSingleSyncSizeBytes?: number;
}

const DEFAULT_MAX_SINGLE_SYNC_SIZE_BYTES = 50_000_000;

export class PartitionReplicaSyncResponse {
    readonly partitionId: number;
    readonly replicaIndex: number;
    readonly namespaceStates: readonly ReplicationNamespaceState[];
    readonly versions: bigint[];
    readonly namespaceVersions: ReadonlyMap<string, bigint[]>;

    constructor(
        partitionId: number,
        replicaIndex: number,
        namespaceStates: readonly ReplicationNamespaceState[],
        versions: bigint[],
        namespaceVersions?: ReadonlyMap<string, bigint[]>,
    ) {
        this.partitionId = partitionId;
        this.replicaIndex = replicaIndex;
        this.namespaceStates = namespaceStates;
        this.versions = versions;
        this.namespaceVersions = namespaceVersions ?? new Map();
    }

    /**
     * Apply the sync response to the backup's partition container.
     * For each namespace: clear the existing store, then write all entries.
     * Finally, finalize the replica versions and release the sync permit.
     */
    apply(
        container: PartitionContainer,
        replicaManager: PartitionReplicaManager,
        options?: SyncApplyOptions,
    ): void {
        const maxSize = options?.maxSingleSyncSizeBytes ?? DEFAULT_MAX_SINGLE_SYNC_SIZE_BYTES;

        for (const state of this.namespaceStates) {
            if (state.estimatedSizeBytes > maxSize) {
                console.warn(
                    `[PartitionReplicaSync] Namespace '${state.namespace}' in partition ${this.partitionId} ` +
                    `exceeds maxSingleSyncSizeBytes (${state.estimatedSizeBytes} > ${maxSize}). ` +
                    `Proceeding with sync to avoid data loss.`,
                );
            }

            const store = container.getRecordStore(state.namespace);
            store.clear();
            for (const [key, value] of state.entries) {
                store.put(key, value, -1, -1);
            }
        }

        // Finalize versions
        replicaManager.finalizeReplicaSync(this.partitionId, this.replicaIndex, this.versions);
        if (this.namespaceVersions.size > 0) {
            replicaManager.finalizeNamespaceReplicaSync(
                this.partitionId,
                this.replicaIndex,
                this.namespaceVersions,
            );
        }

        // Release permit
        replicaManager.releaseReplicaSyncPermits(1);
    }
}
