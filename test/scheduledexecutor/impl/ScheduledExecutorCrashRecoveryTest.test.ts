/**
 * Tests for Block 22.12 — Crash recovery + at-least-once replay.
 *
 * Validates that promoted owners correctly recover scheduled tasks after owner crash:
 * - Promoted owner fences retired owner epoch before replay
 * - One-shot tasks not durably completed are eligible for re-run (at-least-once)
 * - Periodic catch-up coalesces to one immediate run, then next aligned slot
 * - Version/attempt fencing rejects stale completion commits
 * - Crash-loop validation: no orphaned records or runaway re-runs
 */
import { describe, expect, test } from 'bun:test';
import { ScheduledExecutorContainerService } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorContainerService';
import { ScheduledExecutorPartition } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorPartition';
import { ScheduledTaskDescriptor } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledTaskDescriptor';
import { ScheduledTaskState } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledTaskState';
import {
    CrashRecoveryService,
    type CompletionCommit,
} from '@zenystx/helios-core/scheduledexecutor/impl/CrashRecoveryService';

// ── helpers ──

function makeDescriptor(overrides: Partial<{
    taskName: string;
    executorName: string;
    scheduleKind: 'ONE_SHOT' | 'FIXED_RATE';
    state: ScheduledTaskState;
    ownerEpoch: number;
    version: number;
    attemptId: string;
    nextRunAt: number;
    periodMillis: number;
    initialDelayMillis: number;
    partitionId: number;
    runCount: number;
    completedDurably: boolean;
}>): ScheduledTaskDescriptor {
    const desc = new ScheduledTaskDescriptor({
        taskName: overrides.taskName ?? 'task-1',
        handlerId: `handler-${overrides.taskName ?? 'task-1'}`,
        executorName: overrides.executorName ?? 'exec1',
        taskType: 'test-command',
        scheduleKind: overrides.scheduleKind ?? 'ONE_SHOT',
        ownerKind: 'PARTITION',
        partitionId: overrides.partitionId ?? 0,
        initialDelayMillis: overrides.initialDelayMillis ?? 0,
        periodMillis: overrides.periodMillis ?? 0,
        nextRunAt: overrides.nextRunAt ?? Date.now() + 60_000,
        ownerEpoch: overrides.ownerEpoch ?? 0,
        version: overrides.version ?? 0,
        attemptId: overrides.attemptId ?? '',
    });
    if (overrides.runCount !== undefined) {
        desc.runCount = overrides.runCount;
    }
    if (overrides.completedDurably) {
        desc.completedDurably = true;
    }
    if (overrides.state && overrides.state !== ScheduledTaskState.SCHEDULED) {
        desc.transitionTo(overrides.state);
    }
    return desc;
}

// ── epoch fencing on promotion ──

describe('promoted owner fences retired epoch before replay', () => {
    test('recovery plan rejects tasks with epoch lower than promoted epoch', () => {
        const svc = new CrashRecoveryService();
        const promotedEpoch = 5;

        const tasks = [
            makeDescriptor({ taskName: 'stale', ownerEpoch: 3, state: ScheduledTaskState.SUSPENDED }),
            makeDescriptor({ taskName: 'current', ownerEpoch: 5, state: ScheduledTaskState.SUSPENDED }),
        ];

        const plan = svc.planRecovery(tasks, promotedEpoch);
        expect(plan.eligibleForReplay.map(t => t.taskName)).toEqual(['current']);
        expect(plan.fencedOut.map(t => t.taskName)).toEqual(['stale']);
    });

    test('recovery plan sets all replayed tasks to promoted epoch', () => {
        const svc = new CrashRecoveryService();
        const promotedEpoch = 7;

        const tasks = [
            makeDescriptor({ taskName: 'task-a', ownerEpoch: 7, state: ScheduledTaskState.SUSPENDED }),
            makeDescriptor({ taskName: 'task-b', ownerEpoch: 7, state: ScheduledTaskState.SUSPENDED }),
        ];

        const plan = svc.planRecovery(tasks, promotedEpoch);
        expect(plan.eligibleForReplay.length).toBe(2);
        svc.applyRecovery(plan, promotedEpoch);
        for (const task of plan.eligibleForReplay) {
            expect(task.ownerEpoch).toBe(promotedEpoch);
        }
    });

    test('epoch fencing increments epoch on promoted partition before recovery', () => {
        const partition = new ScheduledExecutorPartition(0);
        const store = partition.getOrCreateContainer('exec1');

        const desc = makeDescriptor({ taskName: 'task-1', ownerEpoch: 3, state: ScheduledTaskState.SUSPENDED });
        store.schedule(desc);

        partition.incrementEpoch();
        partition.promoteSuspended();

        expect(desc.ownerEpoch).toBe(4);
        expect(desc.state).toBe(ScheduledTaskState.SCHEDULED);
    });
});

// ── one-shot at-least-once replay ──

describe('one-shot recovery after crash (at-least-once)', () => {
    test('one-shot task in SUSPENDED state (not completed) is eligible for re-run', () => {
        const svc = new CrashRecoveryService();
        const promotedEpoch = 2;

        const tasks = [
            makeDescriptor({ taskName: 'undone-oneshot', scheduleKind: 'ONE_SHOT', ownerEpoch: 2, state: ScheduledTaskState.SUSPENDED }),
        ];

        const plan = svc.planRecovery(tasks, promotedEpoch);
        expect(plan.eligibleForReplay.length).toBe(1);
        expect(plan.eligibleForReplay[0]!.taskName).toBe('undone-oneshot');
    });

    test('one-shot task with durable completion is NOT eligible for re-run', () => {
        const svc = new CrashRecoveryService();
        const promotedEpoch = 2;

        const desc = makeDescriptor({
            taskName: 'done-oneshot',
            scheduleKind: 'ONE_SHOT',
            ownerEpoch: 2,
            runCount: 1,
            completedDurably: true,
        });
        desc.transitionTo(ScheduledTaskState.SUSPENDED);

        const plan = svc.planRecovery([desc], promotedEpoch);
        expect(plan.durablyCompleted.map(t => t.taskName)).toEqual(['done-oneshot']);
        expect(plan.eligibleForReplay.length).toBe(0);
    });

    test('one-shot task crashed mid-execution (SUSPENDED from RUNNING) is eligible for re-run', () => {
        const svc = new CrashRecoveryService();
        const promotedEpoch = 2;

        const desc = makeDescriptor({ taskName: 'running-oneshot', scheduleKind: 'ONE_SHOT', ownerEpoch: 2 });
        desc.transitionTo(ScheduledTaskState.RUNNING);
        desc.transitionTo(ScheduledTaskState.SUSPENDED);

        const plan = svc.planRecovery([desc], promotedEpoch);
        expect(plan.eligibleForReplay.length).toBe(1);
        expect(plan.eligibleForReplay[0]!.taskName).toBe('running-oneshot');
    });
});

// ── periodic recovery with catch-up ──

describe('periodic recovery with catch-up coalescing', () => {
    test('overdue periodic task gets one immediate run then next aligned slot', () => {
        const svc = new CrashRecoveryService();
        const promotedEpoch = 3;
        const now = Date.now();
        const period = 1000;
        const overdueDue = now - 5 * period;

        const desc = makeDescriptor({
            taskName: 'periodic-overdue',
            scheduleKind: 'FIXED_RATE',
            ownerEpoch: 3,
            periodMillis: period,
            nextRunAt: overdueDue,
            state: ScheduledTaskState.SUSPENDED,
        });

        const plan = svc.planRecovery([desc], promotedEpoch);
        expect(plan.eligibleForReplay.length).toBe(1);

        svc.applyRecovery(plan, promotedEpoch);

        expect(desc.state).toBe(ScheduledTaskState.SCHEDULED);
        // Coalesced: nextRunAt <= now (immediate catch-up)
        expect(desc.nextRunAt).toBeLessThanOrEqual(Date.now());
    });

    test('periodic task not overdue resumes at its original nextRunAt', () => {
        const svc = new CrashRecoveryService();
        const promotedEpoch = 3;
        const futureRunAt = Date.now() + 30_000;

        const desc = makeDescriptor({
            taskName: 'periodic-future',
            scheduleKind: 'FIXED_RATE',
            ownerEpoch: 3,
            periodMillis: 1000,
            nextRunAt: futureRunAt,
            state: ScheduledTaskState.SUSPENDED,
        });

        const plan = svc.planRecovery([desc], promotedEpoch);
        svc.applyRecovery(plan, promotedEpoch);

        expect(desc.nextRunAt).toBe(futureRunAt);
        expect(desc.state).toBe(ScheduledTaskState.SCHEDULED);
    });

    test('periodic catch-up does NOT replay multiple missed runs', () => {
        const svc = new CrashRecoveryService();
        const promotedEpoch = 3;
        const now = Date.now();
        const period = 100;
        const overdueDue = now - 20 * period;

        const desc = makeDescriptor({
            taskName: 'periodic-many-missed',
            scheduleKind: 'FIXED_RATE',
            ownerEpoch: 3,
            periodMillis: period,
            nextRunAt: overdueDue,
            state: ScheduledTaskState.SUSPENDED,
        });

        const plan = svc.planRecovery([desc], promotedEpoch);
        svc.applyRecovery(plan, promotedEpoch);

        expect(desc.state).toBe(ScheduledTaskState.SCHEDULED);
        expect(desc.nextRunAt).toBeLessThanOrEqual(Date.now());
        expect(desc.runCount).toBe(0);
    });
});

// ── version/attempt fencing ──

describe('version/attempt fencing rejects stale completions', () => {
    test('stale completion from old owner epoch is rejected', () => {
        const svc = new CrashRecoveryService();

        const desc = makeDescriptor({
            taskName: 'task-1',
            ownerEpoch: 5,
            version: 10,
            attemptId: 'current-attempt',
        });
        desc.transitionTo(ScheduledTaskState.RUNNING);

        const staleCommit: CompletionCommit = {
            taskName: 'task-1',
            ownerEpoch: 3,
            version: 8,
            attemptId: 'old-attempt',
            outcome: 'SUCCESS',
        };

        const result = svc.tryCommitCompletion(desc, staleCommit);
        expect(result.accepted).toBe(false);
        expect(result.reason).toBe('epoch-fenced');
        expect(desc.state).toBe(ScheduledTaskState.RUNNING);
    });

    test('stale completion with old attemptId is rejected', () => {
        const svc = new CrashRecoveryService();

        const desc = makeDescriptor({
            taskName: 'task-1',
            ownerEpoch: 5,
            version: 10,
            attemptId: 'current-attempt',
        });
        desc.transitionTo(ScheduledTaskState.RUNNING);

        const staleCommit: CompletionCommit = {
            taskName: 'task-1',
            ownerEpoch: 5,
            version: 10,
            attemptId: 'wrong-attempt',
            outcome: 'SUCCESS',
        };

        const result = svc.tryCommitCompletion(desc, staleCommit);
        expect(result.accepted).toBe(false);
        expect(result.reason).toBe('attempt-fenced');
    });

    test('stale completion with old version is rejected', () => {
        const svc = new CrashRecoveryService();

        const desc = makeDescriptor({
            taskName: 'task-1',
            ownerEpoch: 5,
            version: 10,
            attemptId: 'current-attempt',
        });
        desc.transitionTo(ScheduledTaskState.RUNNING);

        const staleCommit: CompletionCommit = {
            taskName: 'task-1',
            ownerEpoch: 5,
            version: 7,
            attemptId: 'current-attempt',
            outcome: 'SUCCESS',
        };

        const result = svc.tryCommitCompletion(desc, staleCommit);
        expect(result.accepted).toBe(false);
        expect(result.reason).toBe('version-fenced');
    });

    test('valid completion commit is accepted', () => {
        const svc = new CrashRecoveryService();

        const desc = makeDescriptor({
            taskName: 'task-1',
            ownerEpoch: 5,
            version: 10,
            attemptId: 'current-attempt',
        });
        desc.transitionTo(ScheduledTaskState.RUNNING);

        const validCommit: CompletionCommit = {
            taskName: 'task-1',
            ownerEpoch: 5,
            version: 10,
            attemptId: 'current-attempt',
            outcome: 'SUCCESS',
        };

        const result = svc.tryCommitCompletion(desc, validCommit);
        expect(result.accepted).toBe(true);
        expect(desc.state).toBe(ScheduledTaskState.DONE);
    });
});

// ── crash-loop validation ──

describe('crash-loop validation', () => {
    test('repeated crash/promote cycles do not accumulate orphaned task records', () => {
        const service = new ScheduledExecutorContainerService(4);
        service.init();

        const config = {
            getName: () => 'exec1',
            getCapacity: () => 0,
            getDurability: () => 1,
            getMaxHistoryEntriesPerTask: () => 100,
            getPoolSize: () => 4,
        } as any;
        service.createDistributedObject('exec1', config);

        const partitionId = 0;

        service.scheduleOnPartition('exec1', {
            name: 'crash-loop-task',
            command: 'test',
            type: 'SINGLE_RUN',
            delay: 60_000,
            period: 0,
            autoDisposable: false,
        }, partitionId);

        const partition = service.getPartition(partitionId);
        const store = partition.getOrCreateContainer('exec1');
        expect(store.size()).toBe(1);

        for (let i = 0; i < 5; i++) {
            partition.suspendTasks();
            partition.incrementEpoch();
            partition.promoteSuspended();
        }

        expect(store.size()).toBe(1);
        const desc = store.get('crash-loop-task')!;
        expect(desc).toBeDefined();
        expect(desc.ownerEpoch).toBe(5);
        expect(desc.state).toBe(ScheduledTaskState.SCHEDULED);
    });

    test('crash-loop does not cause runaway re-runs for periodic tasks', () => {
        const svc = new CrashRecoveryService();
        const now = Date.now();

        const desc = makeDescriptor({
            taskName: 'periodic-crash-loop',
            scheduleKind: 'FIXED_RATE',
            ownerEpoch: 0,
            periodMillis: 1000,
            nextRunAt: now - 3000,
            state: ScheduledTaskState.SUSPENDED,
        });

        for (let epoch = 1; epoch <= 3; epoch++) {
            desc.ownerEpoch = epoch;
            if (desc.state !== ScheduledTaskState.SUSPENDED) {
                desc.transitionTo(ScheduledTaskState.SUSPENDED);
            }

            const plan = svc.planRecovery([desc], epoch);
            svc.applyRecovery(plan, epoch);

            expect(desc.state).toBe(ScheduledTaskState.SCHEDULED);
        }

        expect(desc.runCount).toBe(0);
        expect(desc.ownerEpoch).toBe(3);
    });

    test('no orphaned metadata after crash-loop with mixed task types', () => {
        const service = new ScheduledExecutorContainerService(4);
        service.init();

        const config = {
            getName: () => 'exec1',
            getCapacity: () => 0,
            getDurability: () => 1,
            getMaxHistoryEntriesPerTask: () => 100,
            getPoolSize: () => 4,
        } as any;
        service.createDistributedObject('exec1', config);

        const partitionId = 0;

        service.scheduleOnPartition('exec1', {
            name: 'oneshot-a',
            command: 'test',
            type: 'SINGLE_RUN',
            delay: 60_000,
            period: 0,
            autoDisposable: false,
        }, partitionId);

        service.scheduleOnPartition('exec1', {
            name: 'periodic-b',
            command: 'test',
            type: 'AT_FIXED_RATE',
            delay: 1000,
            period: 5000,
            autoDisposable: false,
        }, partitionId);

        const partition = service.getPartition(partitionId);
        const store = partition.getOrCreateContainer('exec1');
        expect(store.size()).toBe(2);

        for (let i = 0; i < 3; i++) {
            partition.suspendTasks();
            partition.incrementEpoch();
            partition.promoteSuspended();
        }

        expect(store.size()).toBe(2);
        const oneshotA = store.get('oneshot-a')!;
        const periodicB = store.get('periodic-b')!;
        expect(oneshotA.state).toBe(ScheduledTaskState.SCHEDULED);
        expect(periodicB.state).toBe(ScheduledTaskState.SCHEDULED);
        expect(oneshotA.ownerEpoch).toBe(3);
        expect(periodicB.ownerEpoch).toBe(3);
    });
});
