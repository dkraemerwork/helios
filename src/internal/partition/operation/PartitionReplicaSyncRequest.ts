/**
 * Port of {@code com.hazelcast.internal.partition.operation.PartitionReplicaSyncRequest}.
 *
 * Sent from a backup node to the primary when anti-entropy detects a version mismatch.
 * The primary collects per-namespace state from its PartitionContainer and returns
 * a PartitionReplicaSyncResponse.
 *
 * Bounded parallelism: the request acquires a sync permit from the PartitionReplicaManager
 * before executing.
 */
import type { PartitionReplicaManager } from '@zenystx/helios-core/internal/partition/impl/PartitionReplicaManager';
import type { PartitionContainer } from '@zenystx/helios-core/internal/partition/impl/PartitionContainer';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { ReplicationNamespaceState } from '@zenystx/helios-core/internal/partition/operation/PartitionReplicaSyncResponse';

export interface SyncRequestResult {
    partitionId: number;
    replicaIndex: number;
    namespaces: string[];
}

export class PartitionReplicaSyncRequest {
    readonly partitionId: number;
    readonly replicaIndex: number;

    constructor(partitionId: number, replicaIndex: number) {
        this.partitionId = partitionId;
        this.replicaIndex = replicaIndex;
    }

    /** Returns true if there are available sync permits. */
    canExecute(replicaManager: PartitionReplicaManager): boolean {
        return replicaManager.availableReplicaSyncPermits() > 0;
    }

    /**
     * Acquire a sync permit and return the list of namespaces in the container.
     * @throws Error if no permits are available.
     */
    execute(replicaManager: PartitionReplicaManager, container: PartitionContainer): SyncRequestResult {
        const acquired = replicaManager.tryAcquireReplicaSyncPermits(1);
        if (acquired === 0) {
            throw new Error('No sync permits available');
        }

        return {
            partitionId: this.partitionId,
            replicaIndex: this.replicaIndex,
            namespaces: container.getAllNamespaces(),
        };
    }
}

/**
 * Collect per-namespace state from a PartitionContainer on the primary.
 * Each namespace produces one ReplicationNamespaceState entry with all entries
 * and an estimated byte size.
 */
export function collectNamespaceStates(container: PartitionContainer): ReplicationNamespaceState[] {
    const namespaces = container.getAllNamespaces();
    const states: ReplicationNamespaceState[] = [];

    for (const ns of namespaces) {
        const store = container.getRecordStore(ns);
        const entries: Array<readonly [Data, Data]> = [];
        let estimatedSize = 0;

        for (const [key, value] of store.entries()) {
            entries.push([key, value]);
            const keyBytes = key.toByteArray();
            const valBytes = value.toByteArray();
            estimatedSize += (keyBytes?.length ?? 0) + (valBytes?.length ?? 0);
        }

        states.push({
            namespace: ns,
            entries,
            estimatedSizeBytes: estimatedSize,
        });
    }

    return states;
}
