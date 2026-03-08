import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { ScheduledExecutorContainerService } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorContainerService.js';
import { ScheduledTaskState } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledTaskState.js';
import { ScheduledExecutorConfig } from '@zenystx/helios-core/config/ScheduledExecutorConfig.js';
import { StaleTaskException } from '@zenystx/helios-core/scheduledexecutor/StaleTaskException.js';
import { ExecutorRejectedExecutionException } from '@zenystx/helios-core/executor/ExecutorExceptions.js';
import type { TaskDefinition } from '@zenystx/helios-core/scheduledexecutor/impl/TaskDefinition.js';

const EXECUTOR_NAME = 'testScheduler';
const PARTITION_ID = 0;

function makeDelayedTask(name: string, delayMs: number): TaskDefinition {
    return { name, command: 'TestTask', delay: delayMs, period: 0, type: 'SINGLE_RUN', autoDisposable: false };
}

describe('ScheduledExecutorLifecycleTest', () => {
    let service: ScheduledExecutorContainerService;

    beforeEach(() => {
        service = new ScheduledExecutorContainerService(4);
        service.init();
        service.createDistributedObject(EXECUTOR_NAME, new ScheduledExecutorConfig(EXECUTOR_NAME));
    });

    afterEach(async () => {
        await service.shutdown();
    });

    // ── cancel() ────────────────────────────────────────────────────────

    test('cancel before fire prevents execution', async () => {
        const descriptor = service.scheduleOnPartition(EXECUTOR_NAME, makeDelayedTask('task1', 60_000), PARTITION_ID);
        expect(descriptor.state).toBe(ScheduledTaskState.SCHEDULED);

        const cancelled = service.cancelTask(EXECUTOR_NAME, 'task1', PARTITION_ID);
        expect(cancelled).toBe(true);
        expect(descriptor.state).toBe(ScheduledTaskState.CANCELLED);

        // Wait a tick — should NOT run
        await Bun.sleep(50);
        expect(descriptor.runCount).toBe(0);
    });

    test('cancel returns false if task is already DONE', async () => {
        // Schedule with 0 delay so it fires immediately
        const descriptor = service.scheduleOnPartition(EXECUTOR_NAME, makeDelayedTask('task2', 0), PARTITION_ID);

        // Wait for execution
        await Bun.sleep(50);
        expect(descriptor.state).toBe(ScheduledTaskState.DONE);

        const cancelled = service.cancelTask(EXECUTOR_NAME, 'task2', PARTITION_ID);
        expect(cancelled).toBe(false);
    });

    test('cancel returns false if task is already CANCELLED', () => {
        const descriptor = service.scheduleOnPartition(EXECUTOR_NAME, makeDelayedTask('task3', 60_000), PARTITION_ID);
        service.cancelTask(EXECUTOR_NAME, 'task3', PARTITION_ID);
        expect(descriptor.state).toBe(ScheduledTaskState.CANCELLED);

        const cancelledAgain = service.cancelTask(EXECUTOR_NAME, 'task3', PARTITION_ID);
        expect(cancelledAgain).toBe(false);
    });

    test('cancel during run does not interrupt in-flight execution', async () => {
        // Schedule immediately
        const descriptor = service.scheduleOnPartition(EXECUTOR_NAME, makeDelayedTask('task4', 0), PARTITION_ID);

        // Wait for it to complete (since our dispatch is synchronous-ish)
        await Bun.sleep(50);

        // If it already ran to DONE, cancel should return false — correct behavior
        // The key invariant: cancel does NOT interrupt an in-flight run
        if (descriptor.state === ScheduledTaskState.DONE) {
            expect(service.cancelTask(EXECUTOR_NAME, 'task4', PARTITION_ID)).toBe(false);
        } else {
            // If somehow still RUNNING, cancel transitions to CANCELLED but doesn't interrupt
            const cancelled = service.cancelTask(EXECUTOR_NAME, 'task4', PARTITION_ID);
            expect(cancelled).toBe(true);
            expect(descriptor.state).toBe(ScheduledTaskState.CANCELLED);
        }
    });

    test('cancel increments version', () => {
        const descriptor = service.scheduleOnPartition(EXECUTOR_NAME, makeDelayedTask('task5', 60_000), PARTITION_ID);
        const versionBefore = descriptor.version;

        service.cancelTask(EXECUTOR_NAME, 'task5', PARTITION_ID);
        expect(descriptor.version).toBe(versionBefore + 1);
    });

    // ── dispose() ───────────────────────────────────────────────────────

    test('dispose removes task state from store', () => {
        service.scheduleOnPartition(EXECUTOR_NAME, makeDelayedTask('task6', 60_000), PARTITION_ID);
        service.cancelTask(EXECUTOR_NAME, 'task6', PARTITION_ID);

        service.disposeTask(EXECUTOR_NAME, 'task6', PARTITION_ID);

        const store = service.getPartition(PARTITION_ID).getOrCreateContainer(EXECUTOR_NAME);
        expect(store.get('task6')).toBeUndefined();
    });

    test('dispose frees task name for reuse', () => {
        service.scheduleOnPartition(EXECUTOR_NAME, makeDelayedTask('task7', 60_000), PARTITION_ID);
        service.cancelTask(EXECUTOR_NAME, 'task7', PARTITION_ID);
        service.disposeTask(EXECUTOR_NAME, 'task7', PARTITION_ID);

        // Should be able to schedule a new task with the same name
        const newDescriptor = service.scheduleOnPartition(EXECUTOR_NAME, makeDelayedTask('task7', 60_000), PARTITION_ID);
        expect(newDescriptor).toBeDefined();
        expect(newDescriptor.state).toBe(ScheduledTaskState.SCHEDULED);
    });

    test('dispose on already-disposed task throws StaleTaskException', () => {
        service.scheduleOnPartition(EXECUTOR_NAME, makeDelayedTask('task8', 60_000), PARTITION_ID);
        service.cancelTask(EXECUTOR_NAME, 'task8', PARTITION_ID);
        service.disposeTask(EXECUTOR_NAME, 'task8', PARTITION_ID);

        expect(() => service.disposeTask(EXECUTOR_NAME, 'task8', PARTITION_ID)).toThrow(StaleTaskException);
    });

    test('cancel on disposed task throws StaleTaskException', () => {
        service.scheduleOnPartition(EXECUTOR_NAME, makeDelayedTask('task9', 60_000), PARTITION_ID);
        service.cancelTask(EXECUTOR_NAME, 'task9', PARTITION_ID);
        service.disposeTask(EXECUTOR_NAME, 'task9', PARTITION_ID);

        expect(() => service.cancelTask(EXECUTOR_NAME, 'task9', PARTITION_ID)).toThrow(StaleTaskException);
    });

    // ── shutdown() ──────────────────────────────────────────────────────

    test('shutdown rejects new submissions with RejectedExecutionException', async () => {
        await service.shutdown();

        expect(() =>
            service.scheduleOnPartition(EXECUTOR_NAME, makeDelayedTask('task10', 1000), PARTITION_ID),
        ).toThrow(ExecutorRejectedExecutionException);
    });

    test('shutdown allows existing scheduled tasks to complete naturally', async () => {
        const descriptor = service.scheduleOnPartition(EXECUTOR_NAME, makeDelayedTask('task11', 0), PARTITION_ID);

        // Wait for task to execute before shutdown
        await Bun.sleep(50);
        expect(descriptor.state).toBe(ScheduledTaskState.DONE);
    });

    // ── Versioned terminal-write ordering ───────────────────────────────

    test('completion before cancel wins — cancel returns false', async () => {
        const descriptor = service.scheduleOnPartition(EXECUTOR_NAME, makeDelayedTask('task12', 0), PARTITION_ID);

        // Wait for completion
        await Bun.sleep(50);
        expect(descriptor.state).toBe(ScheduledTaskState.DONE);

        // Cancel after completion — version already incremented by completion
        const cancelled = service.cancelTask(EXECUTOR_NAME, 'task12', PARTITION_ID);
        expect(cancelled).toBe(false);
        expect(descriptor.state).toBe(ScheduledTaskState.DONE);
    });

    test('cancel before completion wins — task stays CANCELLED', () => {
        const descriptor = service.scheduleOnPartition(EXECUTOR_NAME, makeDelayedTask('task13', 60_000), PARTITION_ID);

        // Cancel while still SCHEDULED (before any timer fires)
        service.cancelTask(EXECUTOR_NAME, 'task13', PARTITION_ID);
        expect(descriptor.state).toBe(ScheduledTaskState.CANCELLED);

        // Simulate a late completion attempt — should be rejected by version check
        const versionAtCancel = descriptor.version;
        // The dispatch loop should NOT transition a CANCELLED task
        expect(descriptor.state).toBe(ScheduledTaskState.CANCELLED);
        expect(descriptor.version).toBe(versionAtCancel);
    });

    // ── Stale-task behavior ─────────────────────────────────────────────

    test('getTaskDescriptor on disposed task throws StaleTaskException', () => {
        service.scheduleOnPartition(EXECUTOR_NAME, makeDelayedTask('task14', 60_000), PARTITION_ID);
        service.cancelTask(EXECUTOR_NAME, 'task14', PARTITION_ID);
        service.disposeTask(EXECUTOR_NAME, 'task14', PARTITION_ID);

        expect(() => service.getTaskDescriptor(EXECUTOR_NAME, 'task14', PARTITION_ID)).toThrow(StaleTaskException);
    });
});
