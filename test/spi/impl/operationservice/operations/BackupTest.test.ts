/**
 * Tests for Block 16.D3 — Backup execution.
 *
 * Tests cover: ownership validation, version staleness check, backup op
 * execution, BackupAck sending (sync vs async), and migration edge cases (H-11).
 */
import { Address } from '@zenystx/helios-core/cluster/Address';
import type { InternalPartition } from '@zenystx/helios-core/internal/partition/InternalPartition';
import { PartitionReplica } from '@zenystx/helios-core/internal/partition/PartitionReplica';
import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import { Backup, type BackupAckSender, type BackupReplicaVersionManager } from '@zenystx/helios-core/spi/impl/operationservice/operations/Backup';
import { beforeEach, describe, expect, test } from 'bun:test';

// ── Helpers ──────────────────────────────────────────────────────────

class StubBackupOp extends Operation {
    ran = false;
    async run(): Promise<void> {
        this.ran = true;
    }
}

function makeAddress(port: number): Address {
    return new Address('127.0.0.1', port);
}

function makeReplica(port: number, uuid = `uuid-${port}`): PartitionReplica {
    return new PartitionReplica(makeAddress(port), uuid);
}

function makePartition(replicas: (PartitionReplica | null)[]): InternalPartition {
    return {
        isLocal: () => true,
        getPartitionId: () => 0,
        getOwnerOrNull: () => replicas[0]?.address() ?? null,
        isMigrating: () => false,
        getReplicaAddress: (i: number) => replicas[i]?.address() ?? null,
        isOwnerOrBackupAddress: () => false,
        isOwnerOrBackupReplica: () => false,
        version: () => 1,
        getOwnerReplicaOrNull: () => replicas[0] ?? null,
        getReplicaIndex: () => -1,
        getReplica: (i: number) => replicas[i] ?? null,
        getReplicasCopy: () => [...replicas],
    };
}

class StubVersionManager implements BackupReplicaVersionManager {
    stale = false;
    updated = false;
    updatedPartitionId = -1;
    updatedVersions: bigint[] = [];
    updatedReplicaIndex = -1;

    isPartitionReplicaVersionStale(_partitionId: number, _replicaVersions: bigint[], _replicaIndex: number): boolean {
        return this.stale;
    }

    updatePartitionReplicaVersions(partitionId: number, replicaVersions: bigint[], replicaIndex: number): void {
        this.updated = true;
        this.updatedPartitionId = partitionId;
        this.updatedVersions = replicaVersions;
        this.updatedReplicaIndex = replicaIndex;
    }
}

class StubAckSender implements BackupAckSender {
    acks: { callerAddress: Address; callId: bigint }[] = [];
    localAcks: { callId: bigint }[] = [];

    sendBackupAck(callerAddress: Address, callId: bigint): void {
        this.acks.push({ callerAddress, callId });
    }

    notifyBackupCompleteLocal(callId: bigint): void {
        this.localAcks.push({ callId });
    }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Backup', () => {
    const localAddr = makeAddress(5701);
    const localReplica = makeReplica(5701, 'local-uuid');
    const remoteAddr = makeAddress(5702);
    const replicaVersions = [1n, 2n];

    let backupOp: StubBackupOp;
    let versionManager: StubVersionManager;
    let ackSender: StubAckSender;

    beforeEach(() => {
        backupOp = new StubBackupOp();
        versionManager = new StubVersionManager();
        ackSender = new StubAckSender();
    });

    function createBackup(opts: {
        sync?: boolean;
        originalCaller?: Address;
        replicaIndex?: number;
        partition?: InternalPartition;
    } = {}): Backup {
        const partition = opts.partition ?? makePartition([null, localReplica]);
        return new Backup(
            backupOp,
            opts.originalCaller ?? remoteAddr,
            replicaVersions,
            opts.sync ?? true,
            0, // partitionId
            opts.replicaIndex ?? 1,
            partition,
            localReplica,
            versionManager,
            ackSender,
        );
    }

    test('returnsResponse is false', () => {
        const backup = createBackup();
        expect(backup.returnsResponse()).toBe(false);
    });

    test('successful sync backup executes op and sends ack', async () => {
        const backup = createBackup({ sync: true, originalCaller: remoteAddr });
        await backup.beforeRun();
        await backup.run();
        await backup.afterRun();

        expect(backupOp.ran).toBe(true);
        expect(versionManager.updated).toBe(true);
        expect(ackSender.acks).toHaveLength(1);
        expect(ackSender.acks[0].callerAddress.equals(remoteAddr)).toBe(true);
    });

    test('successful async backup executes op but sends no ack', async () => {
        const backup = createBackup({ sync: false });
        await backup.beforeRun();
        await backup.run();
        await backup.afterRun();

        expect(backupOp.ran).toBe(true);
        expect(versionManager.updated).toBe(true);
        expect(ackSender.acks).toHaveLength(0);
        expect(ackSender.localAcks).toHaveLength(0);
    });

    test('ownership validation fails when local node is not the correct replica', async () => {
        const otherReplica = makeReplica(5703, 'other-uuid');
        const partition = makePartition([null, otherReplica]); // replica[1] is NOT local
        const backup = createBackup({ partition, replicaIndex: 1 });

        await backup.beforeRun();
        await backup.run();

        expect(backupOp.ran).toBe(false);
        expect(versionManager.updated).toBe(false);
    });

    test('stale version causes backup to be skipped', async () => {
        versionManager.stale = true;
        const backup = createBackup();

        await backup.beforeRun();
        await backup.run();

        expect(backupOp.ran).toBe(false);
        expect(versionManager.updated).toBe(false);
    });

    test('stale version still sends ack for sync backup', async () => {
        versionManager.stale = true;
        const backup = createBackup({ sync: true });

        await backup.beforeRun();
        await backup.run();
        await backup.afterRun();

        // Ack should still be sent even if backup was skipped, to unblock caller
        expect(ackSender.acks).toHaveLength(1);
    });

    test('version manager receives correct partitionId and replicaIndex', async () => {
        const partition = makePartition([null, null, localReplica]); // local at index 2
        const backup = createBackup({ replicaIndex: 2, partition });

        await backup.beforeRun();
        await backup.run();

        expect(versionManager.updatedPartitionId).toBe(0);
        expect(versionManager.updatedReplicaIndex).toBe(2);
        expect(versionManager.updatedVersions).toEqual(replicaVersions);
    });

    test('local caller gets local ack notification for sync backup', async () => {
        const backup = createBackup({ sync: true, originalCaller: localAddr });
        backup.setCallId(42n);

        await backup.beforeRun();
        await backup.run();
        await backup.afterRun();

        expect(ackSender.localAcks).toHaveLength(1);
        expect(ackSender.localAcks[0].callId).toBe(42n);
        expect(ackSender.acks).toHaveLength(0); // no remote ack
    });

    // ── H-11: Migration edge cases ──────────────────────────────────

    test('backup to old replica during migration executes successfully', async () => {
        // Old backup replica is still valid in partition table during migration
        const backup = createBackup();
        await backup.beforeRun();
        await backup.run();

        expect(backupOp.ran).toBe(true);
    });

    test('late backup after FinalizeMigration removes old replica is silently discarded', async () => {
        // After FinalizeMigration, partition table no longer has local node as replica
        const partition = makePartition([null, null]); // replica[1] is null (removed)
        const backup = createBackup({ partition, replicaIndex: 1 });

        await backup.beforeRun();
        await backup.run();

        expect(backupOp.ran).toBe(false);
        expect(versionManager.updated).toBe(false);
    });
});
