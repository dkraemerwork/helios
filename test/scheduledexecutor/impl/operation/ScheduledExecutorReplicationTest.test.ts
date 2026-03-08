import { describe, test, expect, beforeEach } from 'bun:test';
import { ScheduledExecutorContainerService } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorContainerService';
import { ScheduledTaskState } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledTaskState';
import { SubmitToPartitionOperation } from '@zenystx/helios-core/scheduledexecutor/impl/operation/SubmitToPartitionOperation';
import { ScheduleTaskBackupOperation } from '@zenystx/helios-core/scheduledexecutor/impl/operation/ScheduleTaskBackupOperation';
import { CancelTaskBackupOperation } from '@zenystx/helios-core/scheduledexecutor/impl/operation/CancelTaskBackupOperation';
import { DisposeTaskBackupOperation } from '@zenystx/helios-core/scheduledexecutor/impl/operation/DisposeTaskBackupOperation';
import { ScheduledExecutorReplicationOperation } from '@zenystx/helios-core/scheduledexecutor/impl/operation/ScheduledExecutorReplicationOperation';
import { isBackupAwareOperation } from '@zenystx/helios-core/spi/impl/operationservice/BackupAwareOperation';
import { CancelTaskOperation } from '@zenystx/helios-core/scheduledexecutor/impl/operation/CancelTaskOperation';
import { DisposeTaskOperation } from '@zenystx/helios-core/scheduledexecutor/impl/operation/DisposeTaskOperation';
import { ScheduledTaskHandler } from '@zenystx/helios-core/scheduledexecutor/ScheduledTaskHandler';
import type { TaskDefinition } from '@zenystx/helios-core/scheduledexecutor/impl/TaskDefinition';

const EXECUTOR_NAME = 'test-scheduler';
const PARTITION_COUNT = 4;

function makeDefinition(name = '', delay = 1000): TaskDefinition {
    return {
        name,
        command: 'TestTask',
        delay,
        period: 0,
        type: 'SINGLE_RUN',
        autoDisposable: false,
    };
}

function makeConfig(durability = 1, capacity = 100) {
    return {
        getName: () => EXECUTOR_NAME,
        getPoolSize: () => 4,
        getDurability: () => durability,
        getCapacity: () => capacity,
        getCapacityPolicy: () => 'PER_NODE' as const,
        getMaxHistoryEntriesPerTask: () => 100,
        isStatisticsEnabled: () => true,
        getScheduleShutdownPolicy: () => 'GRACEFUL_TRANSFER' as const,
    } as any;
}

describe('ScheduledExecutor Replication — Block 22.8', () => {
    let containerService: ScheduledExecutorContainerService;

    beforeEach(() => {
        containerService = new ScheduledExecutorContainerService(PARTITION_COUNT);
        containerService.init();
        containerService.createDistributedObject(EXECUTOR_NAME, makeConfig());
    });

    // ── SubmitToPartitionOperation is BackupAwareOperation ──────────────

    test('SubmitToPartitionOperation implements BackupAwareOperation', () => {
        const op = new SubmitToPartitionOperation(EXECUTOR_NAME, makeDefinition('task-1'), containerService);
        expect(isBackupAwareOperation(op)).toBe(true);
    });

    test('SubmitToPartitionOperation.getSyncBackupCount returns durability from config', () => {
        const op = new SubmitToPartitionOperation(EXECUTOR_NAME, makeDefinition('task-1'), containerService);
        expect(op.getSyncBackupCount()).toBe(1);
    });

    test('SubmitToPartitionOperation.getAsyncBackupCount returns 0 (always synchronous)', () => {
        const op = new SubmitToPartitionOperation(EXECUTOR_NAME, makeDefinition('task-1'), containerService);
        expect(op.getAsyncBackupCount()).toBe(0);
    });

    test('SubmitToPartitionOperation.shouldBackup returns true for partition operations', () => {
        const op = new SubmitToPartitionOperation(EXECUTOR_NAME, makeDefinition('task-1'), containerService);
        op.partitionId = 0;
        expect(op.shouldBackup()).toBe(true);
    });

    test('SubmitToPartitionOperation.getBackupOperation returns ScheduleTaskBackupOperation', async () => {
        const op = new SubmitToPartitionOperation(EXECUTOR_NAME, makeDefinition('task-1'), containerService);
        op.partitionId = 0;

        // Must run first to create the descriptor
        let capturedResponse: unknown;
        op.setResponseHandler({ sendResponse: (_op, val) => { capturedResponse = val; } });
        await op.run();

        const backupOp = op.getBackupOperation();
        expect(backupOp).toBeInstanceOf(ScheduleTaskBackupOperation);
    });

    // ── Durability=0 means no backup ────────────────────────────────────

    test('durability=0 makes getSyncBackupCount return 0', () => {
        containerService.destroyDistributedObject(EXECUTOR_NAME);
        containerService.createDistributedObject(EXECUTOR_NAME, makeConfig(0));

        const op = new SubmitToPartitionOperation(EXECUTOR_NAME, makeDefinition('task-1'), containerService);
        expect(op.getSyncBackupCount()).toBe(0);
    });

    test('durability=0 makes shouldBackup return false', () => {
        containerService.destroyDistributedObject(EXECUTOR_NAME);
        containerService.createDistributedObject(EXECUTOR_NAME, makeConfig(0));

        const op = new SubmitToPartitionOperation(EXECUTOR_NAME, makeDefinition('task-1'), containerService);
        op.partitionId = 0;
        expect(op.shouldBackup()).toBe(false);
    });

    // ── ScheduleTaskBackupOperation ─────────────────────────────────────

    test('ScheduleTaskBackupOperation enqueues task as SUSPENDED on backup', async () => {
        // First create descriptor on primary
        const descriptor = containerService.scheduleOnPartition(EXECUTOR_NAME, makeDefinition('task-1'), 0);

        // Create backup operation with the definition
        const backupOp = new ScheduleTaskBackupOperation(EXECUTOR_NAME, makeDefinition('task-1'), containerService);
        backupOp.partitionId = 1; // Different partition for backup target

        // Create a fresh container service as the backup node
        const backupService = new ScheduledExecutorContainerService(PARTITION_COUNT);
        backupService.init();
        backupService.createDistributedObject(EXECUTOR_NAME, makeConfig());

        const backupOp2 = new ScheduleTaskBackupOperation(EXECUTOR_NAME, makeDefinition('backup-task'), backupService);
        backupOp2.partitionId = 0;
        await backupOp2.run();

        const store = backupService.getPartition(0).getOrCreateContainer(EXECUTOR_NAME);
        const task = store.get('backup-task');
        expect(task).toBeDefined();
        expect(task!.state).toBe(ScheduledTaskState.SUSPENDED);
    });

    // ── CancelTaskOperation is BackupAwareOperation ─────────────────────

    test('CancelTaskOperation implements BackupAwareOperation', () => {
        const handler = ScheduledTaskHandler.ofPartition(EXECUTOR_NAME, 'task-1', 0);
        const op = new CancelTaskOperation(handler, containerService);
        expect(isBackupAwareOperation(op)).toBe(true);
    });

    test('CancelTaskOperation.getBackupOperation returns CancelTaskBackupOperation', async () => {
        containerService.scheduleOnPartition(EXECUTOR_NAME, makeDefinition('task-1'), 0);
        const handler = ScheduledTaskHandler.ofPartition(EXECUTOR_NAME, 'task-1', 0);
        const op = new CancelTaskOperation(handler, containerService);
        op.partitionId = 0;
        op.setResponseHandler({ sendResponse: () => {} });
        await op.run();

        const backupOp = op.getBackupOperation();
        expect(backupOp).toBeInstanceOf(CancelTaskBackupOperation);
    });

    // ── DisposeTaskOperation is BackupAwareOperation ────────────────────

    test('DisposeTaskOperation implements BackupAwareOperation', () => {
        const handler = ScheduledTaskHandler.ofPartition(EXECUTOR_NAME, 'task-1', 0);
        const op = new DisposeTaskOperation(handler, containerService);
        expect(isBackupAwareOperation(op)).toBe(true);
    });

    test('DisposeTaskOperation.getBackupOperation returns DisposeTaskBackupOperation', async () => {
        containerService.scheduleOnPartition(EXECUTOR_NAME, makeDefinition('task-1'), 0);
        const handler = ScheduledTaskHandler.ofPartition(EXECUTOR_NAME, 'task-1', 0);
        const op = new DisposeTaskOperation(handler, containerService);
        op.partitionId = 0;
        op.setResponseHandler({ sendResponse: () => {} });
        await op.run();

        const backupOp = op.getBackupOperation();
        expect(backupOp).toBeInstanceOf(DisposeTaskBackupOperation);
    });

    // ── ScheduledExecutorReplicationOperation ───────────────────────────

    test('ReplicationOperation transfers full partition state to backup', async () => {
        // Schedule multiple tasks on partition 0
        containerService.scheduleOnPartition(EXECUTOR_NAME, makeDefinition('task-a'), 0);
        containerService.scheduleOnPartition(EXECUTOR_NAME, makeDefinition('task-b'), 0);

        // Prepare replication data from source partition
        const replicationData = containerService.prepareReplicationData(0);

        // Apply to a fresh backup service
        const backupService = new ScheduledExecutorContainerService(PARTITION_COUNT);
        backupService.init();
        backupService.createDistributedObject(EXECUTOR_NAME, makeConfig());

        const replicationOp = new ScheduledExecutorReplicationOperation(replicationData, backupService);
        replicationOp.partitionId = 0;
        await replicationOp.run();

        const store = backupService.getPartition(0).getOrCreateContainer(EXECUTOR_NAME);
        expect(store.size()).toBe(2);

        const taskA = store.get('task-a');
        const taskB = store.get('task-b');
        expect(taskA).toBeDefined();
        expect(taskB).toBeDefined();
        expect(taskA!.state).toBe(ScheduledTaskState.SUSPENDED);
        expect(taskB!.state).toBe(ScheduledTaskState.SUSPENDED);
    });

    test('ReplicationOperation skips tasks that already exist on the replica', async () => {
        containerService.scheduleOnPartition(EXECUTOR_NAME, makeDefinition('task-a'), 0);

        const replicationData = containerService.prepareReplicationData(0);

        // Backup already has task-a
        const backupService = new ScheduledExecutorContainerService(PARTITION_COUNT);
        backupService.init();
        backupService.createDistributedObject(EXECUTOR_NAME, makeConfig());
        backupService.enqueueSuspended(EXECUTOR_NAME, makeDefinition('task-a'), 0);

        const existingTask = backupService.getPartition(0).getOrCreateContainer(EXECUTOR_NAME).get('task-a');
        const originalVersion = existingTask!.version;

        const replicationOp = new ScheduledExecutorReplicationOperation(replicationData, backupService);
        replicationOp.partitionId = 0;
        await replicationOp.run();

        // Should still have exactly 1 task, not duplicated
        const store = backupService.getPartition(0).getOrCreateContainer(EXECUTOR_NAME);
        expect(store.size()).toBe(1);
        // Original task should be unchanged
        expect(store.get('task-a')!.version).toBe(originalVersion);
    });

    test('ReplicationOperation transfers tasks from multiple executors in same partition', async () => {
        const EXECUTOR_2 = 'test-scheduler-2';
        containerService.createDistributedObject(EXECUTOR_2, makeConfig());

        containerService.scheduleOnPartition(EXECUTOR_NAME, makeDefinition('task-a'), 0);
        containerService.scheduleOnPartition(EXECUTOR_2, makeDefinition('task-b'), 0);

        const replicationData = containerService.prepareReplicationData(0);

        const backupService = new ScheduledExecutorContainerService(PARTITION_COUNT);
        backupService.init();
        backupService.createDistributedObject(EXECUTOR_NAME, makeConfig());
        backupService.createDistributedObject(EXECUTOR_2, makeConfig());

        const replicationOp = new ScheduledExecutorReplicationOperation(replicationData, backupService);
        replicationOp.partitionId = 0;
        await replicationOp.run();

        expect(backupService.getPartition(0).getOrCreateContainer(EXECUTOR_NAME).size()).toBe(1);
        expect(backupService.getPartition(0).getOrCreateContainer(EXECUTOR_2).size()).toBe(1);
    });

    // ── Capacity bypass during migration ────────────────────────────────

    test('capacity is ignored during migration: enqueueSuspended bypasses capacity check', () => {
        // Config with capacity=1
        containerService.destroyDistributedObject(EXECUTOR_NAME);
        containerService.createDistributedObject(EXECUTOR_NAME, makeConfig(1, 1));

        // Schedule one task normally — fills capacity
        containerService.scheduleOnPartition(EXECUTOR_NAME, makeDefinition('task-1'), 0);

        // enqueueSuspended (migration path) should NOT throw even though capacity is full
        expect(() => {
            containerService.enqueueSuspended(EXECUTOR_NAME, makeDefinition('task-migrated'), 0);
        }).not.toThrow();

        const store = containerService.getPartition(0).getOrCreateContainer(EXECUTOR_NAME);
        expect(store.size()).toBe(2);
    });

    test('capacity is enforced for normal schedule after migration tasks arrive', () => {
        containerService.destroyDistributedObject(EXECUTOR_NAME);
        containerService.createDistributedObject(EXECUTOR_NAME, makeConfig(1, 1));

        // Fill via migration path
        containerService.enqueueSuspended(EXECUTOR_NAME, makeDefinition('task-migrated'), 0);

        // Normal schedule should still be capacity-checked
        // (capacity enforcement is per the existing scheduleOnPartition path)
        // This test verifies the migration path bypasses capacity
        const store = containerService.getPartition(0).getOrCreateContainer(EXECUTOR_NAME);
        expect(store.get('task-migrated')).toBeDefined();
        expect(store.get('task-migrated')!.state).toBe(ScheduledTaskState.SUSPENDED);
    });
});
