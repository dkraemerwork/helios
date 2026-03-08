import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { ScheduledTaskScheduler } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledTaskScheduler.js';
import { ScheduledExecutorContainerService } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorContainerService.js';
import { ScheduledTaskDescriptor } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledTaskDescriptor.js';
import { ScheduledTaskState } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledTaskState.js';
import { ScheduledExecutorConfig } from '@zenystx/helios-core/config/ScheduledExecutorConfig.js';
import { CapacityPolicy } from '@zenystx/helios-core/config/CapacityPolicy.js';
import type { TaskDefinition } from '@zenystx/helios-core/scheduledexecutor/impl/TaskDefinition.js';

function makeDefinition(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
    return {
        type: 'SINGLE_RUN',
        name: overrides.name ?? 'test-task',
        command: overrides.command ?? 'test-handler',
        delay: overrides.delay ?? 0,
        period: overrides.period ?? 0,
        autoDisposable: overrides.autoDisposable ?? false,
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

describe('ScheduledTaskScheduler', () => {
    const EXECUTOR_NAME = 'myScheduler';
    const PARTITION_COUNT = 4;
    let containerService: ScheduledExecutorContainerService;
    let scheduler: ScheduledTaskScheduler;
    let config: ScheduledExecutorConfig;

    beforeEach(() => {
        config = new ScheduledExecutorConfig(EXECUTOR_NAME);
        containerService = new ScheduledExecutorContainerService(PARTITION_COUNT);
        containerService.init();
        containerService.createDistributedObject(EXECUTOR_NAME, config);
        // Stop built-in timer — ScheduledTaskScheduler takes over dispatch
        containerService.stopTimerCoordinator();

        // All partitions owned by this member
        const ownedPartitions = new Set([0, 1, 2, 3]);
        scheduler = new ScheduledTaskScheduler(containerService, () => ownedPartitions, 0);
    });

    afterEach(async () => {
        scheduler.stop();
        await containerService.shutdown();
    });

    // --- Single task fires at correct time ---

    test('single task fires at correct time', async () => {
        const def = makeDefinition({ name: 'task-1', delay: 50 });
        const descriptor = containerService.scheduleOnPartition(EXECUTOR_NAME, def, 0);

        scheduler.start();
        expect(descriptor.state).toBe(ScheduledTaskState.SCHEDULED);

        await sleep(120);

        expect(descriptor.state).toBe(ScheduledTaskState.DONE);
        expect(descriptor.runCount).toBe(1);
        expect(descriptor.getHistory().length).toBe(1);
        expect(descriptor.getHistory()[0]!.outcome).toBe('SUCCESS');
    });

    test('task does not fire before nextRunAt', async () => {
        const def = makeDefinition({ name: 'future-task', delay: 500 });
        const descriptor = containerService.scheduleOnPartition(EXECUTOR_NAME, def, 0);

        scheduler.start();
        await sleep(50);

        // Should still be scheduled
        expect(descriptor.state).toBe(ScheduledTaskState.SCHEDULED);
        expect(descriptor.runCount).toBe(0);
    });

    // --- Multiple tasks fire in order ---

    test('multiple tasks fire in order of nextRunAt', async () => {
        const def1 = makeDefinition({ name: 'first', delay: 30 });
        const def2 = makeDefinition({ name: 'second', delay: 80 });
        const def3 = makeDefinition({ name: 'third', delay: 130 });

        const d1 = containerService.scheduleOnPartition(EXECUTOR_NAME, def1, 0);
        const d2 = containerService.scheduleOnPartition(EXECUTOR_NAME, def2, 1);
        const d3 = containerService.scheduleOnPartition(EXECUTOR_NAME, def3, 2);

        scheduler.start();
        await sleep(200);

        expect(d1.state).toBe(ScheduledTaskState.DONE);
        expect(d2.state).toBe(ScheduledTaskState.DONE);
        expect(d3.state).toBe(ScheduledTaskState.DONE);

        // First task completed before the second and third
        expect(d1.lastRunCompletedAt).toBeLessThanOrEqual(d2.lastRunCompletedAt);
        expect(d2.lastRunCompletedAt).toBeLessThanOrEqual(d3.lastRunCompletedAt);
    });

    // --- Epoch mismatch rejects dispatch ---

    test('epoch mismatch rejects dispatch', async () => {
        const def = makeDefinition({ name: 'epoch-task', delay: 30 });
        const descriptor = containerService.scheduleOnPartition(EXECUTOR_NAME, def, 0);

        // Simulate an epoch change after scheduling but before firing
        // The scheduler records the ownerEpoch at schedule time;
        // if the descriptor's epoch is bumped externally, dispatch should reject
        scheduler.start();

        // Immediately bump the owner epoch to simulate partition migration
        descriptor.ownerEpoch = 99;

        await sleep(120);

        // Task should NOT have been dispatched — still SCHEDULED due to epoch mismatch
        expect(descriptor.state).toBe(ScheduledTaskState.SCHEDULED);
        expect(descriptor.runCount).toBe(0);
    });

    // --- Only owned partitions are scanned ---

    test('only scans owned partitions', async () => {
        // Scheduler only owns partitions 0 and 1
        const ownedPartitions = new Set([0, 1]);
        scheduler.stop();
        scheduler = new ScheduledTaskScheduler(containerService, () => ownedPartitions, 0);

        const def0 = makeDefinition({ name: 'owned-task', delay: 30 });
        const def2 = makeDefinition({ name: 'unowned-task', delay: 30 });

        const d0 = containerService.scheduleOnPartition(EXECUTOR_NAME, def0, 0);
        const d2 = containerService.scheduleOnPartition(EXECUTOR_NAME, def2, 2);

        scheduler.start();
        await sleep(120);

        // Owned partition task should fire
        expect(d0.state).toBe(ScheduledTaskState.DONE);
        // Unowned partition task should not fire
        expect(d2.state).toBe(ScheduledTaskState.SCHEDULED);
    });

    // --- Rehydration after restart ---

    test('rehydration rebuilds ready queue from store on start', async () => {
        // Schedule a task that is already past its nextRunAt
        const def = makeDefinition({ name: 'overdue-task', delay: 0 });
        const descriptor = containerService.scheduleOnPartition(EXECUTOR_NAME, def, 0);
        // Make it overdue
        descriptor.nextRunAt = Date.now() - 1000;

        // Start scheduler — should pick up the overdue task via rehydration
        scheduler.start();
        await sleep(80);

        expect(descriptor.state).toBe(ScheduledTaskState.DONE);
        expect(descriptor.runCount).toBe(1);
    });

    test('rehydration on partition promotion rebuilds from store', async () => {
        // Initially own no partitions
        let ownedPartitions = new Set<number>();
        scheduler.stop();
        scheduler = new ScheduledTaskScheduler(containerService, () => ownedPartitions, 0);

        const def = makeDefinition({ name: 'promoted-task', delay: 0 });
        const descriptor = containerService.scheduleOnPartition(EXECUTOR_NAME, def, 1);
        descriptor.nextRunAt = Date.now() - 100;

        scheduler.start();
        await sleep(80);

        // Should NOT have fired — partition not owned
        expect(descriptor.state).toBe(ScheduledTaskState.SCHEDULED);

        // Now promote: add partition 1 to owned set and rehydrate
        ownedPartitions = new Set([1]);
        scheduler.updateOwnedPartitions(ownedPartitions);

        await sleep(80);

        expect(descriptor.state).toBe(ScheduledTaskState.DONE);
        expect(descriptor.runCount).toBe(1);
    });

    // --- Capacity enforcement ---

    test('capacity enforcement rejects scheduling when at capacity (PER_NODE)', async () => {
        config.setCapacity(2);
        config.setCapacityPolicy(CapacityPolicy.PER_NODE);

        // Need a new scheduler that enforces capacity
        scheduler.stop();
        scheduler = new ScheduledTaskScheduler(containerService, () => new Set([0, 1, 2, 3]), 0);
        scheduler.start();

        // Schedule 2 tasks — should succeed
        const def1 = makeDefinition({ name: 'cap-1', delay: 5000 });
        const def2 = makeDefinition({ name: 'cap-2', delay: 5000 });
        containerService.scheduleOnPartition(EXECUTOR_NAME, def1, 0);
        containerService.scheduleOnPartition(EXECUTOR_NAME, def2, 1);

        // 3rd should be rejected by capacity check
        const def3 = makeDefinition({ name: 'cap-3', delay: 5000 });
        expect(() => {
            scheduler.enforceCapacity(EXECUTOR_NAME, 2);
        }).toThrow();
    });

    test('capacity enforcement allows scheduling when under capacity', () => {
        config.setCapacity(5);
        config.setCapacityPolicy(CapacityPolicy.PER_NODE);

        scheduler.start();

        const def1 = makeDefinition({ name: 'under-cap-1', delay: 5000 });
        containerService.scheduleOnPartition(EXECUTOR_NAME, def1, 0);

        // Should not throw — under capacity
        expect(() => {
            scheduler.enforceCapacity(EXECUTOR_NAME, 0);
        }).not.toThrow();
    });

    test('capacity zero means unlimited', () => {
        config.setCapacity(0);
        config.setCapacityPolicy(CapacityPolicy.PER_NODE);
        scheduler.start();

        // Schedule many tasks
        for (let i = 0; i < 200; i++) {
            const def = makeDefinition({ name: `unlimited-${i}`, delay: 5000 });
            containerService.scheduleOnPartition(EXECUTOR_NAME, def, i % PARTITION_COUNT);
        }

        // Should not throw
        expect(() => scheduler.enforceCapacity(EXECUTOR_NAME, 0)).not.toThrow();
    });

    // --- Fenced dispatch validates version and attemptId ---

    test('fenced dispatch generates unique attemptId per firing', async () => {
        const def = makeDefinition({ name: 'attempt-task', delay: 30 });
        const descriptor = containerService.scheduleOnPartition(EXECUTOR_NAME, def, 0);

        scheduler.start();
        await sleep(120);

        expect(descriptor.state).toBe(ScheduledTaskState.DONE);
        const history = descriptor.getHistory();
        expect(history.length).toBe(1);
        expect(history[0]!.attemptId).toBeTruthy();
        expect(typeof history[0]!.attemptId).toBe('string');
        expect(history[0]!.attemptId.length).toBeGreaterThan(0);
    });

    test('fenced dispatch records ownerEpoch in history', async () => {
        // Use a scheduler with expectedEpoch=5
        scheduler.stop();
        const epochScheduler = new ScheduledTaskScheduler(containerService, () => new Set([0, 1, 2, 3]), 5);

        const def = makeDefinition({ name: 'epoch-history-task', delay: 30 });
        const descriptor = containerService.scheduleOnPartition(EXECUTOR_NAME, def, 0);
        descriptor.ownerEpoch = 5;

        epochScheduler.start();
        await sleep(120);
        epochScheduler.stop();

        expect(descriptor.state).toBe(ScheduledTaskState.DONE);
        const history = descriptor.getHistory();
        expect(history[0]!.ownerEpoch).toBe(5);
    });

    // --- Wake-on-nearest-boundary ---

    test('wake-on-nearest-boundary re-arms timer to closest nextRunAt', async () => {
        // Schedule a task far in the future
        const def1 = makeDefinition({ name: 'far-task', delay: 5000 });
        containerService.scheduleOnPartition(EXECUTOR_NAME, def1, 0);

        scheduler.start();

        // Now schedule a closer task — scheduler should re-arm
        const def2 = makeDefinition({ name: 'close-task', delay: 30 });
        const d2 = containerService.scheduleOnPartition(EXECUTOR_NAME, def2, 0);
        scheduler.notifyNewTask();

        await sleep(120);

        expect(d2.state).toBe(ScheduledTaskState.DONE);
    });

    // --- Cancelled task is not dispatched ---

    test('cancelled task is not dispatched by scheduler', async () => {
        const def = makeDefinition({ name: 'cancel-me', delay: 80 });
        const descriptor = containerService.scheduleOnPartition(EXECUTOR_NAME, def, 0);

        scheduler.start();

        // Cancel before it fires
        containerService.cancelTask(EXECUTOR_NAME, 'cancel-me', 0);

        await sleep(200);

        expect(descriptor.state).toBe(ScheduledTaskState.CANCELLED);
        expect(descriptor.runCount).toBe(0);
    });

    // --- Disposed task is not dispatched ---

    test('disposed task is not dispatched by scheduler', async () => {
        const def = makeDefinition({ name: 'dispose-me', delay: 80 });
        containerService.scheduleOnPartition(EXECUTOR_NAME, def, 0);

        scheduler.start();

        // Dispose before it fires
        containerService.disposeTask(EXECUTOR_NAME, 'dispose-me', 0);

        await sleep(200);

        // Task is gone from store — scheduler can't dispatch it
        const store = containerService.getPartition(0).getOrCreateContainer(EXECUTOR_NAME);
        expect(store.get('dispose-me')).toBeUndefined();
    });

    // --- Version increment on dispatch ---

    test('version increments after dispatch completion', async () => {
        const def = makeDefinition({ name: 'version-task', delay: 30 });
        const descriptor = containerService.scheduleOnPartition(EXECUTOR_NAME, def, 0);
        const initialVersion = descriptor.version;

        scheduler.start();
        await sleep(120);

        expect(descriptor.version).toBeGreaterThan(initialVersion);
    });
});
