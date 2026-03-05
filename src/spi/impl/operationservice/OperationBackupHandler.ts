/**
 * Port of {@code com.hazelcast.spi.impl.operationservice.impl.OperationBackupHandler}.
 *
 * After a primary operation executes, this handler checks whether it is a
 * BackupAwareOperation that needs backups sent to replica nodes.
 * It increments replica versions, caps backup counts by cluster size,
 * and dispatches backup copies via BackupSender.
 */
import type { Operation } from '@helios/spi/impl/operationservice/Operation';
import type { Address } from '@helios/cluster/Address';
import type { InternalPartition } from '@helios/internal/partition/InternalPartition';
import { isBackupAwareOperation } from '@helios/spi/impl/operationservice/BackupAwareOperation';

/**
 * Transport abstraction for sending backup operations to remote nodes.
 * Implemented by the TCP layer or test stubs.
 */
export interface BackupSender {
    sendBackup(
        backupOp: Operation,
        target: Address,
        partitionId: number,
        replicaVersions: bigint[],
        sync: boolean,
        replicaIndex: number,
        callerAddress: Address,
        callId: bigint,
    ): void;
}

/**
 * Version tracking abstraction for partition replicas.
 * Will be implemented by PartitionReplicaManager (Block E.1).
 */
export interface ReplicaVersionManager {
    incrementPartitionReplicaVersions(partitionId: number, totalBackups: number): bigint[];
}

/**
 * Partition + cluster topology provider.
 */
export interface PartitionProvider {
    getPartition(partitionId: number): InternalPartition;
    getClusterSize(): number;
}

export class OperationBackupHandler {
    private readonly _localAddress: Address;
    private readonly _sender: BackupSender;
    private readonly _versionManager: ReplicaVersionManager;
    private readonly _partitionProvider: PartitionProvider;

    constructor(
        localAddress: Address,
        sender: BackupSender,
        versionManager: ReplicaVersionManager,
        partitionProvider: PartitionProvider,
    ) {
        this._localAddress = localAddress;
        this._sender = sender;
        this._versionManager = versionManager;
        this._partitionProvider = partitionProvider;
    }

    /**
     * Inspect the completed operation and send backups if needed.
     * @returns The number of synchronous backups actually sent (for backup-ack tracking).
     */
    sendBackups(op: Operation): number {
        if (!isBackupAwareOperation(op)) {
            return 0;
        }

        if (!op.shouldBackup()) {
            return 0;
        }

        const requestedSync = op.getSyncBackupCount();
        const requestedAsync = op.getAsyncBackupCount();
        const requestedTotal = requestedSync + requestedAsync;

        if (requestedTotal === 0) {
            return 0;
        }

        // Cap by cluster size - 1 (can't backup to more nodes than exist)
        const maxBackups = Math.max(0, this._partitionProvider.getClusterSize() - 1);
        const totalBackups = Math.min(requestedTotal, maxBackups);

        if (totalBackups === 0) {
            return 0;
        }

        // Cap sync count within the capped total
        const syncBackups = Math.min(requestedSync, totalBackups);

        const partitionId = op.partitionId;
        const partition = this._partitionProvider.getPartition(partitionId);

        // Increment replica versions
        const replicaVersions = this._versionManager.incrementPartitionReplicaVersions(
            partitionId, totalBackups,
        );

        const backupOp = op.getBackupOperation();
        const callId = op.getCallId();

        let actualSyncCount = 0;

        for (let replicaIndex = 1; replicaIndex <= totalBackups; replicaIndex++) {
            const replica = partition.getReplica(replicaIndex);
            if (replica === null) {
                continue;
            }

            const target = replica.address();
            const isSyncBackup = replicaIndex <= syncBackups;

            this._sender.sendBackup(
                backupOp, target, partitionId, replicaVersions,
                isSyncBackup, replicaIndex, this._localAddress, callId,
            );

            if (isSyncBackup) {
                actualSyncCount++;
            }
        }

        return actualSyncCount;
    }
}
