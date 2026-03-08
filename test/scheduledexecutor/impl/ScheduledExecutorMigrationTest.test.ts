/**
 * Tests for Block 22.10 — MigrationAwareService integration + epoch fencing.
 *
 * Validates that ScheduledExecutorContainerService correctly implements
 * MigrationAwareService lifecycle hooks: beforeMigration suspends tasks,
 * commitMigration promotes/discards, rollbackMigration restores, and
 * epoch fencing prevents duplicate firing after ownership change.
 */
import { describe, expect, test } from 'bun:test';
import { ScheduledExecutorContainerService } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorContainerService';
import { ScheduledTaskState } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledTaskState';
import { PartitionMigrationEvent } from '@zenystx/helios-core/internal/partition/PartitionMigrationEvent';
import { ScheduledTaskScheduler } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledTaskScheduler';
import type { ScheduledExecutorConfig } from '@zenystx/helios-core/config/ScheduledExecutorConfig';

// ── helpers ──

function makeConfig(name: string, capacity = 0, durability = 1): ScheduledExecutorConfig {
    return {
        getName: () => name,
        getPoolSize: () => 4,
        getCapacity: () => capacity,
        getCapacityPolicy: () => 'PER_NODE' as const,
        getDurability: () => durability,
        getMaxHistoryEntriesPerTask: () => 100,
        isStatisticsEnabled: () => false,
    } as ScheduledExecutorConfig;
}

function makeService(partitionCount = 4): ScheduledExecutorContainerService {
    const svc = new ScheduledExecutorContainerService(partitionCount);
    svc.init();
    return svc;
}

function scheduleTask(
    svc: ScheduledExecutorContainerService,
    executorName: string,
    taskName: string,
    partitionId: number,
    delayMs = 0,
) {
    return svc.scheduleOnPartition(executorName, {
        type: 'SINGLE_RUN',
        name: taskName,
        command: 'test-command',
        delay: delayMs,
        period: 0,
        autoDisposable: false,
    }, partitionId);
}

function sourceEvent(partitionId: number, currentReplicaIndex = 0, newReplicaIndex = -1): PartitionMigrationEvent {
    return new PartitionMigrationEvent(partitionId, null, null, 'MOVE', 'SOURCE', currentReplicaIndex, newReplicaIndex);
}

function destinationEvent(partitionId: number, currentReplicaIndex = -1, newReplicaIndex = 0): PartitionMigrationEvent {
    return new PartitionMigrationEvent(partitionId, null, null, 'MOVE', 'DESTINATION', currentReplicaIndex, newReplicaIndex);
}

// ── beforeMigration ──

describe('beforeMigration', () => {
    test('suspends all tasks on source when current replica is primary', () => {
        const svc = makeService();
        svc.createDistributedObject('exec1', makeConfig('exec1'));
        const d1 = scheduleTask(svc, 'exec1', 'task-a', 0);
        const d2 = scheduleTask(svc, 'exec1', 'task-b', 0);

        expect(d1.state).toBe(ScheduledTaskState.SCHEDULED);
        expect(d2.state).toBe(ScheduledTaskState.SCHEDULED);

        svc.beforeMigration(sourceEvent(0, 0));

        expect(d1.state).toBe(ScheduledTaskState.SUSPENDED);
        expect(d2.state).toBe(ScheduledTaskState.SUSPENDED);
    });

    test('does NOT suspend tasks on source when current replica is not primary', () => {
        const svc = makeService();
        svc.createDistributedObject('exec1', makeConfig('exec1'));
        const d1 = scheduleTask(svc, 'exec1', 'task-a', 0);

        svc.beforeMigration(sourceEvent(0, 1)); // replica index 1, not primary

        expect(d1.state).toBe(ScheduledTaskState.SCHEDULED);
    });

    test('does NOT suspend tasks on destination endpoint', () => {
        const svc = makeService();
        svc.createDistributedObject('exec1', makeConfig('exec1'));
        const d1 = scheduleTask(svc, 'exec1', 'task-a', 0);

        svc.beforeMigration(destinationEvent(0));

        expect(d1.state).toBe(ScheduledTaskState.SCHEDULED);
    });

    test('only suspends tasks in the migrating partition', () => {
        const svc = makeService();
        svc.createDistributedObject('exec1', makeConfig('exec1'));
        const d0 = scheduleTask(svc, 'exec1', 'task-p0', 0);
        const d1 = scheduleTask(svc, 'exec1', 'task-p1', 1);

        svc.beforeMigration(sourceEvent(0, 0));

        expect(d0.state).toBe(ScheduledTaskState.SUSPENDED);
        expect(d1.state).toBe(ScheduledTaskState.SCHEDULED); // partition 1 unaffected
    });
});

// ── commitMigration ──

describe('commitMigration', () => {
    test('on source: discards partition state when new replica index is -1 (lost ownership)', () => {
        const svc = makeService();
        svc.createDistributedObject('exec1', makeConfig('exec1'));
        scheduleTask(svc, 'exec1', 'task-a', 0);

        svc.beforeMigration(sourceEvent(0, 0, -1));
        svc.commitMigration(sourceEvent(0, 0, -1));

        const store = svc.getPartition(0).getOrCreateContainer('exec1');
        expect(store.size()).toBe(0);
    });

    test('on destination as new primary: promotes suspended tasks with epoch increment', () => {
        const svc = makeService();
        svc.createDistributedObject('exec1', makeConfig('exec1'));

        // Simulate replicated task arriving suspended
        svc.enqueueSuspendedFromSnapshot('exec1', {
            taskName: 'task-migrated',
            handlerId: 'handler-1',
            executorName: 'exec1',
            taskType: 'test-command',
            scheduleKind: 'ONE_SHOT',
            ownerKind: 'PARTITION',
            partitionId: 0,
            memberUuid: null,
            initialDelayMillis: 0,
            periodMillis: 0,
            nextRunAt: Date.now() + 1000,
            durabilityReplicaCount: 1,
            ownerEpoch: 5,
            version: 3,
            maxHistoryEntries: 100,
        }, 0);

        const store = svc.getPartition(0).getOrCreateContainer('exec1');
        const desc = store.get('task-migrated')!;
        expect(desc.state).toBe(ScheduledTaskState.SUSPENDED);
        expect(desc.ownerEpoch).toBe(5);

        svc.commitMigration(destinationEvent(0, -1, 0)); // becoming primary

        expect(desc.state).toBe(ScheduledTaskState.SCHEDULED);
        expect(desc.ownerEpoch).toBe(6); // epoch incremented
    });

    test('on destination as non-primary: does not promote', () => {
        const svc = makeService();
        svc.createDistributedObject('exec1', makeConfig('exec1'));

        svc.enqueueSuspendedFromSnapshot('exec1', {
            taskName: 'task-backup',
            handlerId: 'handler-2',
            executorName: 'exec1',
            taskType: 'test-command',
            scheduleKind: 'ONE_SHOT',
            ownerKind: 'PARTITION',
            partitionId: 0,
            memberUuid: null,
            initialDelayMillis: 0,
            periodMillis: 0,
            nextRunAt: Date.now() + 1000,
            durabilityReplicaCount: 1,
            ownerEpoch: 5,
            version: 3,
            maxHistoryEntries: 100,
        }, 0);

        const store = svc.getPartition(0).getOrCreateContainer('exec1');
        const desc = store.get('task-backup')!;

        svc.commitMigration(destinationEvent(0, -1, 1)); // replica 1, not primary

        expect(desc.state).toBe(ScheduledTaskState.SUSPENDED); // still suspended
        expect(desc.ownerEpoch).toBe(5); // no epoch increment
    });
});

// ── rollbackMigration ──

describe('rollbackMigration', () => {
    test('on source as primary: re-promotes suspended tasks', () => {
        const svc = makeService();
        svc.createDistributedObject('exec1', makeConfig('exec1'));
        const d1 = scheduleTask(svc, 'exec1', 'task-a', 0);

        svc.beforeMigration(sourceEvent(0, 0));
        expect(d1.state).toBe(ScheduledTaskState.SUSPENDED);

        svc.rollbackMigration(sourceEvent(0, 0));

        expect(d1.state).toBe(ScheduledTaskState.SCHEDULED);
    });

    test('on destination: discards replicated partition state', () => {
        const svc = makeService();
        svc.createDistributedObject('exec1', makeConfig('exec1'));

        svc.enqueueSuspendedFromSnapshot('exec1', {
            taskName: 'task-migrated',
            handlerId: 'handler-1',
            executorName: 'exec1',
            taskType: 'test-command',
            scheduleKind: 'ONE_SHOT',
            ownerKind: 'PARTITION',
            partitionId: 0,
            memberUuid: null,
            initialDelayMillis: 0,
            periodMillis: 0,
            nextRunAt: Date.now() + 1000,
            durabilityReplicaCount: 1,
            ownerEpoch: 5,
            version: 3,
            maxHistoryEntries: 100,
        }, 0);

        svc.rollbackMigration(destinationEvent(0, -1, 0));

        const store = svc.getPartition(0).getOrCreateContainer('exec1');
        expect(store.size()).toBe(0);
    });
});

// ── migration preserves task metadata ──

describe('migration preserves task metadata', () => {
    test('suspended task retains handler, executor name, timing after suspend+promote', () => {
        const svc = makeService();
        svc.createDistributedObject('exec1', makeConfig('exec1'));
        const nextRun = Date.now() + 5000;
        const d = svc.scheduleOnPartition('exec1', {
            type: 'SINGLE_RUN',
            name: 'meta-task',
            command: 'cmd',
            delay: 5000,
            period: 0,
            autoDisposable: false,
        }, 0);
        const originalHandler = d.handlerId;
        const originalVersion = d.version;

        // Suspend and then promote
        svc.beforeMigration(sourceEvent(0, 0));
        expect(d.state).toBe(ScheduledTaskState.SUSPENDED);

        // Simulate rollback promoting it back
        svc.rollbackMigration(sourceEvent(0, 0));

        expect(d.handlerId).toBe(originalHandler);
        expect(d.executorName).toBe('exec1');
        expect(d.taskName).toBe('meta-task');
        expect(d.version).toBe(originalVersion);
    });
});

// ── epoch fencing ──

describe('epoch fencing', () => {
    test('epoch increments on every ownership change (commitMigration as new primary)', () => {
        const svc = makeService();
        svc.createDistributedObject('exec1', makeConfig('exec1'));

        // First migration: epoch 0 -> 1
        svc.enqueueSuspendedFromSnapshot('exec1', {
            taskName: 'task-epoch',
            handlerId: 'h1',
            executorName: 'exec1',
            taskType: 'cmd',
            scheduleKind: 'ONE_SHOT',
            ownerKind: 'PARTITION',
            partitionId: 0,
            memberUuid: null,
            initialDelayMillis: 0,
            periodMillis: 0,
            nextRunAt: Date.now() + 60_000,
            durabilityReplicaCount: 1,
            ownerEpoch: 0,
            version: 0,
            maxHistoryEntries: 100,
        }, 0);

        svc.commitMigration(destinationEvent(0, -1, 0));
        const store = svc.getPartition(0).getOrCreateContainer('exec1');
        const desc = store.get('task-epoch')!;
        expect(desc.ownerEpoch).toBe(1);
    });

    test('old owner cannot fire after fence — stale epoch rejected by scheduler', () => {
        const svc = makeService();
        svc.createDistributedObject('exec1', makeConfig('exec1'));

        const d = scheduleTask(svc, 'exec1', 'fenced-task', 0);
        d.nextRunAt = Date.now() - 100; // overdue
        d.ownerEpoch = 5; // task has epoch 5

        // Scheduler expects epoch 6 (new owner)
        const fired: string[] = [];
        const ownedPartitions = new Set([0]);
        const scheduler = new ScheduledTaskScheduler(svc, () => ownedPartitions, 6);
        scheduler.setTaskExecutor((desc) => {
            fired.push(desc.taskName);
        });
        scheduler.start();

        // Give the scheduler a tick
        return new Promise<void>((resolve) => {
            setTimeout(() => {
                scheduler.stop();
                expect(fired).not.toContain('fenced-task');
                resolve();
            }, 80);
        });
    });

    test('new owner fires overdue task with matching epoch', () => {
        const svc = makeService();
        svc.createDistributedObject('exec1', makeConfig('exec1'));

        const d = scheduleTask(svc, 'exec1', 'overdue-task', 0);
        d.nextRunAt = Date.now() - 100; // overdue
        d.ownerEpoch = 3;

        // Scheduler with matching epoch
        const fired: string[] = [];
        const ownedPartitions = new Set([0]);
        const scheduler = new ScheduledTaskScheduler(svc, () => ownedPartitions, 3);
        scheduler.setTaskExecutor((desc) => {
            fired.push(desc.taskName);
        });
        scheduler.start();

        return new Promise<void>((resolve) => {
            setTimeout(() => {
                scheduler.stop();
                expect(fired).toContain('overdue-task');
                resolve();
            }, 80);
        });
    });

    test('promoted owner fires overdue task after commitMigration bumps epoch', () => {
        const svc = makeService();
        svc.createDistributedObject('exec1', makeConfig('exec1'));

        svc.enqueueSuspendedFromSnapshot('exec1', {
            taskName: 'overdue-promoted',
            handlerId: 'hp1',
            executorName: 'exec1',
            taskType: 'cmd',
            scheduleKind: 'ONE_SHOT',
            ownerKind: 'PARTITION',
            partitionId: 0,
            memberUuid: null,
            initialDelayMillis: 0,
            periodMillis: 0,
            nextRunAt: Date.now() - 200, // overdue
            durabilityReplicaCount: 1,
            ownerEpoch: 7,
            version: 1,
            maxHistoryEntries: 100,
        }, 0);

        // commitMigration promotes and bumps epoch 7 -> 8
        svc.commitMigration(destinationEvent(0, -1, 0));

        const store = svc.getPartition(0).getOrCreateContainer('exec1');
        const desc = store.get('overdue-promoted')!;
        expect(desc.ownerEpoch).toBe(8);
        expect(desc.state).toBe(ScheduledTaskState.SCHEDULED);

        // Scheduler with epoch 8 should fire it
        const fired: string[] = [];
        const ownedPartitions = new Set([0]);
        const scheduler = new ScheduledTaskScheduler(svc, () => ownedPartitions, 8);
        scheduler.setTaskExecutor((desc) => {
            fired.push(desc.taskName);
        });
        scheduler.start();

        return new Promise<void>((resolve) => {
            setTimeout(() => {
                scheduler.stop();
                expect(fired).toContain('overdue-promoted');
                resolve();
            }, 80);
        });
    });
});

// ── rollback deterministic ──

describe('rollback deterministic', () => {
    test('rollback after beforeMigration restores exact pre-migration state', () => {
        const svc = makeService();
        svc.createDistributedObject('exec1', makeConfig('exec1'));

        const d1 = scheduleTask(svc, 'exec1', 'task-1', 0, 1000);
        const d2 = scheduleTask(svc, 'exec1', 'task-2', 0, 2000);
        const originalEpoch1 = d1.ownerEpoch;
        const originalEpoch2 = d2.ownerEpoch;

        svc.beforeMigration(sourceEvent(0, 0));
        svc.rollbackMigration(sourceEvent(0, 0));

        expect(d1.state).toBe(ScheduledTaskState.SCHEDULED);
        expect(d2.state).toBe(ScheduledTaskState.SCHEDULED);
        expect(d1.ownerEpoch).toBe(originalEpoch1);
        expect(d2.ownerEpoch).toBe(originalEpoch2);

        const store = svc.getPartition(0).getOrCreateContainer('exec1');
        expect(store.size()).toBe(2);
    });
});

// ── no migration path silently drops or duplicates ──

describe('no silent drop or duplication', () => {
    test('suspend → commit cycle does not duplicate tasks', () => {
        const svc = makeService();
        svc.createDistributedObject('exec1', makeConfig('exec1'));
        scheduleTask(svc, 'exec1', 'task-a', 0);
        scheduleTask(svc, 'exec1', 'task-b', 0);

        svc.beforeMigration(sourceEvent(0, 0, -1));
        svc.commitMigration(sourceEvent(0, 0, -1));

        // Source discarded → 0 tasks on source
        const store = svc.getPartition(0).getOrCreateContainer('exec1');
        expect(store.size()).toBe(0);
    });

    test('multiple executors on same partition are all suspended and promoted', () => {
        const svc = makeService();
        svc.createDistributedObject('exec1', makeConfig('exec1'));
        svc.createDistributedObject('exec2', makeConfig('exec2'));

        const d1 = scheduleTask(svc, 'exec1', 'task-x', 0);
        const d2 = scheduleTask(svc, 'exec2', 'task-y', 0);

        svc.beforeMigration(sourceEvent(0, 0));

        expect(d1.state).toBe(ScheduledTaskState.SUSPENDED);
        expect(d2.state).toBe(ScheduledTaskState.SUSPENDED);

        // rollback promotes both
        svc.rollbackMigration(sourceEvent(0, 0));

        expect(d1.state).toBe(ScheduledTaskState.SCHEDULED);
        expect(d2.state).toBe(ScheduledTaskState.SCHEDULED);
    });
});
