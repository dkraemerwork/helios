/**
 * Port of {@code com.hazelcast.spi.impl.operationservice.impl.operations.Backup}.
 *
 * Executes a backup operation on a replica node. Validates ownership and
 * version freshness before executing. Sends BackupAck for sync backups.
 */
import { Operation } from '@zenystx/core/spi/impl/operationservice/Operation';
import type { Address } from '@zenystx/core/cluster/Address';
import type { PartitionReplica } from '@zenystx/core/internal/partition/PartitionReplica';
import type { InternalPartition } from '@zenystx/core/internal/partition/InternalPartition';

/**
 * Version tracking for backup replicas.
 * Implemented by PartitionReplicaManager (Block E.1).
 */
export interface BackupReplicaVersionManager {
    isPartitionReplicaVersionStale(partitionId: number, replicaVersions: bigint[], replicaIndex: number): boolean;
    updatePartitionReplicaVersions(partitionId: number, replicaVersions: bigint[], replicaIndex: number): void;
}

/**
 * Transport for sending backup acknowledgments.
 */
export interface BackupAckSender {
    /** Send a BackupAck to a remote caller. */
    sendBackupAck(callerAddress: Address, callId: bigint): void;
    /** Notify a local invocation that its backup is complete. */
    notifyBackupCompleteLocal(callId: bigint): void;
}

export class Backup extends Operation {
    private readonly _backupOp: Operation;
    private readonly _originalCaller: Address;
    private readonly _replicaVersions: bigint[];
    private readonly _sync: boolean;
    private readonly _partition: InternalPartition;
    private readonly _localReplica: PartitionReplica;
    private readonly _versionManager: BackupReplicaVersionManager;
    private readonly _ackSender: BackupAckSender;

    private _valid = true;

    constructor(
        backupOp: Operation,
        originalCaller: Address,
        replicaVersions: bigint[],
        sync: boolean,
        partitionId: number,
        replicaIndex: number,
        partition: InternalPartition,
        localReplica: PartitionReplica,
        versionManager: BackupReplicaVersionManager,
        ackSender: BackupAckSender,
    ) {
        super();
        this._backupOp = backupOp;
        this._originalCaller = originalCaller;
        this._replicaVersions = replicaVersions;
        this._sync = sync;
        this.partitionId = partitionId;
        this.replicaIndex = replicaIndex;
        this._partition = partition;
        this._localReplica = localReplica;
        this._versionManager = versionManager;
        this._ackSender = ackSender;
    }

    /** Backups never send regular responses. Acks go through a separate channel. */
    returnsResponse(): boolean {
        return false;
    }

    async beforeRun(): Promise<void> {
        // Ownership validation: check this node is the correct replica
        const replica = this._partition.getReplica(this.replicaIndex);
        if (replica === null || !replica.equals(this._localReplica)) {
            this._valid = false;
            return;
        }

        // Version staleness check
        if (this._versionManager.isPartitionReplicaVersionStale(
            this.partitionId, this._replicaVersions, this.replicaIndex,
        )) {
            this._valid = false;
            return;
        }
    }

    async run(): Promise<void> {
        if (!this._valid) {
            return;
        }

        await this._backupOp.run();

        this._versionManager.updatePartitionReplicaVersions(
            this.partitionId, this._replicaVersions, this.replicaIndex,
        );
    }

    async afterRun(): Promise<void> {
        if (!this._sync) {
            return;
        }

        const callId = this.getCallId();

        // Check if caller is local
        if (this._originalCaller.equals(this._localReplica.address())) {
            this._ackSender.notifyBackupCompleteLocal(callId);
        } else {
            this._ackSender.sendBackupAck(this._originalCaller, callId);
        }
    }
}
