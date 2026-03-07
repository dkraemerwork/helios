/**
 * Tests for AntiEntropyTask + PartitionBackupReplicaAntiEntropyOp (Block 16.E2).
 *
 * Validates:
 * - AntiEntropyTask iterates locally-owned partitions and sends anti-entropy ops to backup replicas
 * - PartitionBackupReplicaAntiEntropyOp compares primary versions to local versions
 * - Version match → no action
 * - Version mismatch → triggers replica sync
 */
import { AntiEntropyTask } from '@zenystx/helios-core/internal/partition/impl/AntiEntropyTask';
import { PartitionReplicaManager } from '@zenystx/helios-core/internal/partition/impl/PartitionReplicaManager';
import { MAX_REPLICA_COUNT } from '@zenystx/helios-core/internal/partition/InternalPartition';
import { PartitionBackupReplicaAntiEntropyOp } from '@zenystx/helios-core/internal/partition/operation/PartitionBackupReplicaAntiEntropyOp';
import { describe, expect, test } from 'bun:test';

describe('PartitionBackupReplicaAntiEntropyOp', () => {
    const PARTITION_COUNT = 4;
    const MAX_PARALLEL = 5;

    test('no action when versions match', () => {
        const replicaManager = new PartitionReplicaManager(PARTITION_COUNT, MAX_PARALLEL);
        // Both primary and backup have same versions (all 0n) — no sync needed
        const primaryVersions = replicaManager.getPartitionReplicaVersions(0);
        const op = new PartitionBackupReplicaAntiEntropyOp(0, primaryVersions);
        const result = op.execute(replicaManager);

        expect(result.syncTriggered).toBe(false);
    });

    test('triggers sync when primary version is ahead of backup', () => {
        const replicaManager = new PartitionReplicaManager(PARTITION_COUNT, MAX_PARALLEL);
        // Simulate primary having incremented versions (backup hasn't received backup ops)
        const primaryVersions = new Array<bigint>(MAX_REPLICA_COUNT).fill(0n);
        primaryVersions[1] = 5n; // Primary says replica index 1 should be at version 5

        const op = new PartitionBackupReplicaAntiEntropyOp(0, primaryVersions);
        const result = op.execute(replicaManager);

        expect(result.syncTriggered).toBe(true);
    });

    test('triggers sync when backup version is ahead (unexpected — marks dirty)', () => {
        const replicaManager = new PartitionReplicaManager(PARTITION_COUNT, MAX_PARALLEL);
        // Backup somehow ahead — still a mismatch, should trigger sync
        replicaManager.incrementPartitionReplicaVersions(0, 1);
        replicaManager.incrementPartitionReplicaVersions(0, 1);

        const primaryVersions = new Array<bigint>(MAX_REPLICA_COUNT).fill(0n);
        primaryVersions[1] = 1n; // Primary is behind backup

        const op = new PartitionBackupReplicaAntiEntropyOp(0, primaryVersions);
        const result = op.execute(replicaManager);

        // Mismatch detected — sync triggered
        expect(result.syncTriggered).toBe(true);
    });

    test('checks all replica indices for mismatch', () => {
        const replicaManager = new PartitionReplicaManager(PARTITION_COUNT, MAX_PARALLEL);
        // Match at index 1, mismatch at index 2
        const primaryVersions = new Array<bigint>(MAX_REPLICA_COUNT).fill(0n);
        primaryVersions[2] = 3n;

        const op = new PartitionBackupReplicaAntiEntropyOp(0, primaryVersions);
        const result = op.execute(replicaManager);

        expect(result.syncTriggered).toBe(true);
    });
});

describe('AntiEntropyTask', () => {
    const PARTITION_COUNT = 4;
    const MAX_PARALLEL = 5;

    test('generates anti-entropy ops for locally-owned partitions', () => {
        const replicaManager = new PartitionReplicaManager(PARTITION_COUNT, MAX_PARALLEL);
        // Simulate: partitions 0, 2 are locally owned with backupCount=1
        const localPartitions = [0, 2];
        const backupCount = 1;

        const task = new AntiEntropyTask(replicaManager);
        const ops = task.generateOps(localPartitions, backupCount);

        // Each local partition should generate backupCount ops (one per backup replica)
        expect(ops).toHaveLength(2); // 2 partitions × 1 backup each
        expect(ops[0].partitionId).toBe(0);
        expect(ops[1].partitionId).toBe(2);
    });

    test('generates multiple ops per partition when backupCount > 1', () => {
        const replicaManager = new PartitionReplicaManager(PARTITION_COUNT, MAX_PARALLEL);
        const localPartitions = [1];
        const backupCount = 3;

        const task = new AntiEntropyTask(replicaManager);
        const ops = task.generateOps(localPartitions, backupCount);

        // 1 partition × 3 backups = 3 ops
        expect(ops).toHaveLength(3);
        expect(ops[0].partitionId).toBe(1);
        expect(ops[0].targetReplicaIndex).toBe(1);
        expect(ops[1].targetReplicaIndex).toBe(2);
        expect(ops[2].targetReplicaIndex).toBe(3);
    });

    test('carries correct primary version vector in generated ops', () => {
        const replicaManager = new PartitionReplicaManager(PARTITION_COUNT, MAX_PARALLEL);
        // Increment versions for partition 0
        replicaManager.incrementPartitionReplicaVersions(0, 1);
        replicaManager.incrementPartitionReplicaVersions(0, 1);

        const task = new AntiEntropyTask(replicaManager);
        const ops = task.generateOps([0], 1);

        expect(ops).toHaveLength(1);
        // Op should carry the current primary versions
        expect(ops[0].primaryVersions[1]).toBe(2n);
    });

    test('no ops generated for empty local partitions', () => {
        const replicaManager = new PartitionReplicaManager(PARTITION_COUNT, MAX_PARALLEL);
        const task = new AntiEntropyTask(replicaManager);
        const ops = task.generateOps([], 1);

        expect(ops).toHaveLength(0);
    });

    test('no ops generated when backupCount is 0', () => {
        const replicaManager = new PartitionReplicaManager(PARTITION_COUNT, MAX_PARALLEL);
        const task = new AntiEntropyTask(replicaManager);
        const ops = task.generateOps([0, 1], 0);

        expect(ops).toHaveLength(0);
    });
});
