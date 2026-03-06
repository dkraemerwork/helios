import { describe, test, expect, beforeEach } from 'bun:test';
import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import type { BackupAwareOperation } from '@zenystx/helios-core/spi/impl/operationservice/BackupAwareOperation';
import {
    OperationBackupHandler,
    type BackupSender,
    type ReplicaVersionManager,
    type PartitionProvider,
} from '@zenystx/helios-core/spi/impl/operationservice/OperationBackupHandler';
import type { InternalPartition } from '@zenystx/helios-core/internal/partition/InternalPartition';
import { PartitionReplica } from '@zenystx/helios-core/internal/partition/PartitionReplica';
import { Address } from '@zenystx/helios-core/cluster/Address';

/**
 * Tests for OperationBackupHandler (Block 16.D2).
 */

// ── Test helpers ─────────────────────────────────────────────────────────

class NoOpBackupOperation extends Operation {
    async run(): Promise<void> {}
}

class TestBackupOp extends Operation implements BackupAwareOperation {
    constructor(
        private readonly _shouldBackup: boolean,
        private readonly _syncCount: number,
        private readonly _asyncCount: number,
    ) {
        super();
    }

    async run(): Promise<void> {
        this.sendResponse('ok');
    }

    shouldBackup(): boolean { return this._shouldBackup; }
    getSyncBackupCount(): number { return this._syncCount; }
    getAsyncBackupCount(): number { return this._asyncCount; }

    getBackupOperation(): Operation {
        const op = new NoOpBackupOperation();
        op.partitionId = this.partitionId;
        return op;
    }
}

class PlainOperation extends Operation {
    async run(): Promise<void> {
        this.sendResponse('done');
    }
}

function makeReplica(host: string, port: number): PartitionReplica {
    return new PartitionReplica(new Address(host, port), `${host}:${port}`);
}

function makePartition(
    partitionId: number,
    replicas: (PartitionReplica | null)[],
): InternalPartition {
    return {
        getPartitionId: () => partitionId,
        getReplica: (idx: number) => replicas[idx] ?? null,
        getReplicaAddress: (idx: number) => replicas[idx]?.address() ?? null,
        getOwnerOrNull: () => replicas[0]?.address() ?? null,
        isLocal: () => true,
        isMigrating: () => false,
        isOwnerOrBackupAddress: () => false,
        isOwnerOrBackupReplica: () => false,
        version: () => 1,
        getOwnerReplicaOrNull: () => replicas[0] ?? null,
        getReplicaIndex: () => -1,
        getReplicasCopy: () => [...replicas],
    };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('OperationBackupHandler', () => {
    const localAddress = new Address('127.0.0.1', 5701);
    const backupAddress1 = new Address('127.0.0.1', 5702);

    const localReplica = makeReplica('127.0.0.1', 5701);
    const backupReplica1 = makeReplica('127.0.0.1', 5702);
    const backupReplica2 = makeReplica('127.0.0.1', 5703);

    let sentBackups: {
        op: Operation;
        target: Address;
        partitionId: number;
        replicaVersions: bigint[];
        sync: boolean;
        replicaIndex: number;
        callerAddress: Address;
        callId: bigint;
    }[];

    let incrementedVersions: { partitionId: number; totalBackups: number }[];
    let currentVersions: bigint[];

    let sender: BackupSender;
    let versionManager: ReplicaVersionManager;
    let partitionProvider: PartitionProvider;

    let handler: OperationBackupHandler;

    beforeEach(() => {
        sentBackups = [];
        incrementedVersions = [];
        currentVersions = [0n, 0n, 0n, 0n, 0n, 0n, 0n];

        sender = {
            sendBackup(
                backupOp: Operation,
                target: Address,
                partitionId: number,
                replicaVersions: bigint[],
                sync: boolean,
                replicaIndex: number,
                callerAddress: Address,
                callId: bigint,
            ): void {
                sentBackups.push({
                    op: backupOp, target, partitionId, replicaVersions,
                    sync, replicaIndex, callerAddress, callId,
                });
            },
        };

        versionManager = {
            incrementPartitionReplicaVersions(partitionId: number, totalBackups: number): bigint[] {
                incrementedVersions.push({ partitionId, totalBackups });
                for (let i = 0; i < totalBackups; i++) {
                    currentVersions[i + 1]++;
                }
                return [...currentVersions];
            },
        };

        const partition = makePartition(0, [localReplica, backupReplica1, backupReplica2]);

        partitionProvider = {
            getPartition: (_id: number) => partition,
            getClusterSize: () => 3,
        };

        handler = new OperationBackupHandler(localAddress, sender, versionManager, partitionProvider);
    });

    test('returns 0 for non-BackupAwareOperation', () => {
        const op = new PlainOperation();
        op.partitionId = 0;
        op.setCallId(1n);
        expect(handler.sendBackups(op)).toBe(0);
        expect(sentBackups).toHaveLength(0);
    });

    test('returns 0 when shouldBackup is false', () => {
        const op = new TestBackupOp(false, 1, 0);
        op.partitionId = 0;
        op.setCallId(1n);
        expect(handler.sendBackups(op)).toBe(0);
        expect(sentBackups).toHaveLength(0);
    });

    test('sends 1 sync backup to replica 1', () => {
        const op = new TestBackupOp(true, 1, 0);
        op.partitionId = 0;
        op.setCallId(1n);

        expect(handler.sendBackups(op)).toBe(1);
        expect(sentBackups).toHaveLength(1);
        expect(sentBackups[0]!.target.equals(backupAddress1)).toBe(true);
        expect(sentBackups[0]!.sync).toBe(true);
        expect(sentBackups[0]!.replicaIndex).toBe(1);
        expect(sentBackups[0]!.callId).toBe(1n);
    });

    test('sends async backups with sync=false', () => {
        const op = new TestBackupOp(true, 0, 1);
        op.partitionId = 0;
        op.setCallId(2n);

        expect(handler.sendBackups(op)).toBe(0);
        expect(sentBackups).toHaveLength(1);
        expect(sentBackups[0]!.sync).toBe(false);
    });

    test('sends mixed sync and async backups', () => {
        const op = new TestBackupOp(true, 1, 1);
        op.partitionId = 0;
        op.setCallId(3n);

        expect(handler.sendBackups(op)).toBe(1);
        expect(sentBackups).toHaveLength(2);
        expect(sentBackups[0]!.sync).toBe(true);
        expect(sentBackups[0]!.replicaIndex).toBe(1);
        expect(sentBackups[1]!.sync).toBe(false);
        expect(sentBackups[1]!.replicaIndex).toBe(2);
    });

    test('caps backup count by cluster size - 1', () => {
        partitionProvider = {
            getPartition: partitionProvider.getPartition,
            getClusterSize: () => 2,
        };
        handler = new OperationBackupHandler(localAddress, sender, versionManager, partitionProvider);

        const op = new TestBackupOp(true, 2, 0);
        op.partitionId = 0;
        op.setCallId(4n);

        expect(handler.sendBackups(op)).toBe(1);
        expect(sentBackups).toHaveLength(1);
    });

    test('increments replica versions before sending', () => {
        const op = new TestBackupOp(true, 1, 0);
        op.partitionId = 0;
        op.setCallId(5n);

        handler.sendBackups(op);

        expect(incrementedVersions).toHaveLength(1);
        expect(incrementedVersions[0]!.partitionId).toBe(0);
        expect(incrementedVersions[0]!.totalBackups).toBe(1);
    });

    test('skips replica with null target', () => {
        const partition = makePartition(0, [localReplica, null, backupReplica2]);
        partitionProvider = {
            getPartition: () => partition,
            getClusterSize: () => 3,
        };
        handler = new OperationBackupHandler(localAddress, sender, versionManager, partitionProvider);

        const op = new TestBackupOp(true, 1, 1);
        op.partitionId = 0;
        op.setCallId(6n);

        handler.sendBackups(op);

        // replica 1 is null → skipped, only replica 2 sent
        expect(sentBackups).toHaveLength(1);
        expect(sentBackups[0]!.replicaIndex).toBe(2);
    });

    test('passes replicaVersions array to backup sender', () => {
        const op = new TestBackupOp(true, 1, 0);
        op.partitionId = 0;
        op.setCallId(7n);

        handler.sendBackups(op);

        expect(sentBackups[0]!.replicaVersions).toBeDefined();
        expect(sentBackups[0]!.replicaVersions.length).toBeGreaterThan(0);
    });
});
