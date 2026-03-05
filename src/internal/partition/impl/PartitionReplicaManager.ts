/**
 * Port of {@code com.hazelcast.internal.partition.impl.PartitionReplicaManager}.
 *
 * Tracks per-partition replica version vectors and manages bounded-parallelism
 * replica sync permits. Implements both {@link ReplicaVersionManager} (used by
 * OperationBackupHandler on the primary) and {@link BackupReplicaVersionManager}
 * (used by Backup on the replica).
 *
 * **v1 limitation (Finding 21):** Version tracking is per-partition, not per-namespace.
 * When a second service (e.g., CacheService) adds replication support, version
 * tracking must be retrofitted to per-namespace.
 */
import { MAX_REPLICA_COUNT } from '@helios/internal/partition/InternalPartition';
import type { ReplicaVersionManager } from '@helios/spi/impl/operationservice/OperationBackupHandler';
import type { BackupReplicaVersionManager } from '@helios/spi/impl/operationservice/operations/Backup';

/** Sentinel version meaning "needs full sync". */
export const REQUIRES_SYNC = -1n;

export class PartitionReplicaManager implements ReplicaVersionManager, BackupReplicaVersionManager {
    private readonly _versions: bigint[][];
    private readonly _maxParallelReplications: number;
    private _availablePermits: number;

    constructor(partitionCount: number, maxParallelReplications: number) {
        this._maxParallelReplications = maxParallelReplications;
        this._availablePermits = maxParallelReplications;
        this._versions = new Array(partitionCount);
        for (let i = 0; i < partitionCount; i++) {
            this._versions[i] = new Array<bigint>(MAX_REPLICA_COUNT).fill(0n);
        }
    }

    // ── ReplicaVersionManager (primary side) ──

    incrementPartitionReplicaVersions(partitionId: number, totalBackups: number): bigint[] {
        const versions = this._versions[partitionId];
        for (let i = 1; i <= totalBackups && i < MAX_REPLICA_COUNT; i++) {
            versions[i]++;
        }
        return versions;
    }

    // ── BackupReplicaVersionManager (backup side) ──

    isPartitionReplicaVersionStale(partitionId: number, replicaVersions: bigint[], replicaIndex: number): boolean {
        const current = this._versions[partitionId];
        return replicaVersions[replicaIndex] < current[replicaIndex];
    }

    updatePartitionReplicaVersions(partitionId: number, replicaVersions: bigint[], replicaIndex: number): void {
        const current = this._versions[partitionId];
        if (replicaVersions[replicaIndex] < current[replicaIndex]) {
            // Incoming is behind current — mark dirty (needs sync)
            current[replicaIndex] = REQUIRES_SYNC;
            return;
        }
        // Apply incoming versions for the replica index
        current[replicaIndex] = replicaVersions[replicaIndex];
    }

    // ── Version queries ──

    isPartitionReplicaVersionDirty(partitionId: number): boolean {
        const versions = this._versions[partitionId];
        for (let i = 0; i < MAX_REPLICA_COUNT; i++) {
            if (versions[i] === REQUIRES_SYNC) return true;
        }
        return false;
    }

    markPartitionReplicaAsSyncRequired(partitionId: number, replicaIndex: number): void {
        this._versions[partitionId][replicaIndex] = REQUIRES_SYNC;
    }

    getPartitionReplicaVersions(partitionId: number): bigint[] {
        return [...this._versions[partitionId]];
    }

    getPartitionReplicaVersionsForSync(partitionId: number): bigint[] {
        const versions = this._versions[partitionId];
        const result = new Array<bigint>(MAX_REPLICA_COUNT);
        for (let i = 0; i < MAX_REPLICA_COUNT; i++) {
            result[i] = versions[i] === REQUIRES_SYNC ? 0n : versions[i];
        }
        return result;
    }

    clearPartitionReplicaVersions(partitionId: number): void {
        this._versions[partitionId].fill(0n);
    }

    finalizeReplicaSync(partitionId: number, replicaIndex: number, versions: bigint[]): void {
        const current = this._versions[partitionId];
        // Clear and set from incoming
        current[replicaIndex] = versions[replicaIndex];
        // Clear REQUIRES_SYNC if it was set for this index
    }

    // ── Sync permit management ──

    tryAcquireReplicaSyncPermits(requested: number): number {
        const acquired = Math.min(requested, this._availablePermits);
        this._availablePermits -= acquired;
        return acquired;
    }

    releaseReplicaSyncPermits(permits: number): void {
        this._availablePermits = Math.min(
            this._availablePermits + permits,
            this._maxParallelReplications,
        );
    }

    availableReplicaSyncPermits(): number {
        return this._availablePermits;
    }

    // ── Reset ──

    reset(): void {
        for (const versions of this._versions) {
            versions.fill(0n);
        }
        this._availablePermits = this._maxParallelReplications;
    }
}
