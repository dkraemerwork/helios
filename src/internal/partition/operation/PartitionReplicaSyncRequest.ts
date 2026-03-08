/**
 * Port of {@code com.hazelcast.internal.partition.operation.PartitionReplicaSyncRequest}.
 *
 * Sent from a backup node to the primary when anti-entropy detects a version mismatch.
 * The primary collects per-namespace state from its PartitionContainer and returns
 * one or more PartitionReplicaSyncResponse messages (chunked if state is large).
 *
 * Block B.3 enhancements:
 *   - Stable correlation ID per sync session (from ReplicaSyncManager).
 *   - Stale response rejection via epoch mismatch.
 *   - Chunked transfer: chunk size configurable (default 1 MB).
 *   - Bounded parallelism: acquire sync permit before executing.
 */
import type { PartitionContainer } from '@zenystx/helios-core/internal/partition/impl/PartitionContainer';
import type { PartitionReplicaManager } from '@zenystx/helios-core/internal/partition/impl/PartitionReplicaManager';
import type { ReplicationNamespaceState } from '@zenystx/helios-core/internal/partition/operation/PartitionReplicaSyncResponse';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';

export interface SyncRequestResult {
    /** Stable correlation ID assigned by the requester (ReplicaSyncManager). */
    correlationId: string;
    partitionId: number;
    replicaIndex: number;
    namespaces: string[];
}

/**
 * Default max chunk size for chunked sync transfer.
 * Block B.3: increased from 256 KB to 1 MB per specification.
 */
export const DEFAULT_MAX_SYNC_CHUNK_SIZE_BYTES = 1024 * 1024;

export class PartitionReplicaSyncRequest {
    readonly correlationId: string;
    readonly partitionId: number;
    readonly replicaIndex: number;

    /**
     * @param partitionId   Partition to sync.
     * @param replicaIndex  Replica index.
     * @param correlationId Stable ID for this sync session (from ReplicaSyncManager).
     *                      If omitted, a new UUID is generated (legacy path).
     */
    constructor(partitionId: number, replicaIndex: number, correlationId?: string) {
        this.partitionId = partitionId;
        this.replicaIndex = replicaIndex;
        this.correlationId = correlationId ?? crypto.randomUUID();
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
            correlationId: this.correlationId,
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

function estimateEntrySize(entry: readonly [Data, Data]): number {
    const [key, value] = entry;
    return (key.toByteArray()?.length ?? 0) + (value.toByteArray()?.length ?? 0);
}

function splitNamespaceState(
    state: ReplicationNamespaceState,
    maxChunkSizeBytes: number,
): ReplicationNamespaceState[] {
    if (state.entries.length === 0) {
        return [state];
    }

    const fragments: ReplicationNamespaceState[] = [];
    let chunkEntries: Array<readonly [Data, Data]> = [];
    let chunkSize = 0;

    for (const entry of state.entries) {
        const entrySize = estimateEntrySize(entry);
        const exceedsCurrentChunk = chunkEntries.length > 0 && chunkSize + entrySize > maxChunkSizeBytes;
        if (exceedsCurrentChunk) {
            fragments.push({
                namespace: state.namespace,
                entries: chunkEntries,
                estimatedSizeBytes: chunkSize,
            });
            chunkEntries = [];
            chunkSize = 0;
        }

        chunkEntries.push(entry);
        chunkSize += entrySize;
    }

    if (chunkEntries.length > 0) {
        fragments.push({
            namespace: state.namespace,
            entries: chunkEntries,
            estimatedSizeBytes: chunkSize,
        });
    }

    return fragments;
}

export function chunkNamespaceStates(
    states: readonly ReplicationNamespaceState[],
    maxChunkSizeBytes: number = DEFAULT_MAX_SYNC_CHUNK_SIZE_BYTES,
): ReplicationNamespaceState[][] {
    const chunks: ReplicationNamespaceState[][] = [];
    let currentChunk: ReplicationNamespaceState[] = [];
    let currentChunkSize = 0;

    for (const state of states) {
        for (const fragment of splitNamespaceState(state, maxChunkSizeBytes)) {
            const exceedsCurrentChunk = currentChunk.length > 0
                && currentChunkSize + fragment.estimatedSizeBytes > maxChunkSizeBytes;
            if (exceedsCurrentChunk) {
                chunks.push(currentChunk);
                currentChunk = [];
                currentChunkSize = 0;
            }

            currentChunk.push(fragment);
            currentChunkSize += fragment.estimatedSizeBytes;

            if (fragment.estimatedSizeBytes >= maxChunkSizeBytes) {
                chunks.push(currentChunk);
                currentChunk = [];
                currentChunkSize = 0;
            }
        }
    }

    if (currentChunk.length > 0 || chunks.length === 0) {
        chunks.push(currentChunk);
    }

    return chunks;
}
