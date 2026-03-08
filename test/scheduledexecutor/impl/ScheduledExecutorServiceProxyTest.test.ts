import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { ScheduledExecutorContainerService } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorContainerService.js';
import { ScheduledExecutorServiceProxy } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorServiceProxy.js';
import { ScheduledExecutorConfig } from '@zenystx/helios-core/config/ScheduledExecutorConfig.js';
import { ScheduledTaskHandler } from '@zenystx/helios-core/scheduledexecutor/ScheduledTaskHandler.js';
import { StaleTaskException } from '@zenystx/helios-core/scheduledexecutor/StaleTaskException.js';
import { ExecutorRejectedExecutionException } from '@zenystx/helios-core/executor/ExecutorExceptions.js';
import type { IScheduledFuture } from '@zenystx/helios-core/scheduledexecutor/IScheduledFuture.js';
import type { TaskCallable } from '@zenystx/helios-core/executor/TaskCallable.js';

const EXECUTOR_NAME = 'testScheduler';
const PARTITION_COUNT = 4;

function task(taskType = 'TestTask'): TaskCallable<unknown> {
    return { taskType, input: null };
}

describe('ScheduledExecutorServiceProxyTest', () => {
    let containerService: ScheduledExecutorContainerService;
    let proxy: ScheduledExecutorServiceProxy;
    const config = new ScheduledExecutorConfig(EXECUTOR_NAME);

    beforeEach(() => {
        containerService = new ScheduledExecutorContainerService(PARTITION_COUNT);
        containerService.init();
        containerService.createDistributedObject(EXECUTOR_NAME, config);
        proxy = new ScheduledExecutorServiceProxy(EXECUTOR_NAME, containerService, config, PARTITION_COUNT);
    });

    afterEach(async () => {
        await proxy.shutdown();
        await containerService.shutdown();
    });

    // ── Proxy routes to correct partition ────────────────────────────────

    test('schedule routes task to container service and returns future', async () => {
        const future = await proxy.schedule(task(), 60_000);

        expect(future).toBeDefined();
        const handler = future.getHandler();
        expect(handler.getSchedulerName()).toBe(EXECUTOR_NAME);
        expect(handler.isAssignedToPartition()).toBe(true);
        expect(handler.getPartitionId()).toBeGreaterThanOrEqual(0);
        expect(handler.getPartitionId()).toBeLessThan(PARTITION_COUNT);
    });

    test('schedule with zero delay creates a future that completes', async () => {
        const future = await proxy.schedule(task(), 0);

        expect(future).toBeDefined();
        // Wait for the timer coordinator to fire
        await Bun.sleep(50);
        expect(await future.isDone()).toBe(true);
    });

    // ── Handler reacquisition ───────────────────────────────────────────

    test('getScheduledFuture creates a new future proxy from handler', async () => {
        const original = await proxy.schedule(task(), 60_000);
        const handler = original.getHandler();

        const reacquired: IScheduledFuture<unknown> = proxy.getScheduledFuture(handler);

        expect(reacquired).toBeDefined();
        expect(reacquired.getHandler().toUrn()).toBe(handler.toUrn());
        expect(await reacquired.isCancelled()).toBe(false);
    });

    test('getScheduledFuture with partition handler routes correctly', () => {
        const handler = ScheduledTaskHandler.ofPartition(EXECUTOR_NAME, 'myTask', 2);
        const future = proxy.getScheduledFuture(handler);

        expect(future).toBeDefined();
        expect(future.getHandler().getPartitionId()).toBe(2);
        expect(future.getHandler().getTaskName()).toBe('myTask');
    });

    test('getScheduledFuture with member handler routes correctly', () => {
        const memberUuid = 'member-uuid-123';
        const handler = ScheduledTaskHandler.ofMember(EXECUTOR_NAME, 'memberTask', memberUuid);
        const future = proxy.getScheduledFuture(handler);

        expect(future).toBeDefined();
        expect(future.getHandler().getMemberUuid()).toBe(memberUuid);
        expect(future.getHandler().isAssignedToMember()).toBe(true);
    });

    // ── getAllScheduledFutures fan-out ───────────────────────────────────

    test('getAllScheduledFutures returns all scheduled tasks across partitions', async () => {
        await proxy.schedule(task(), 60_000);
        await proxy.schedule(task(), 60_000);
        await proxy.schedule(task(), 60_000);

        const allFutures = await proxy.getAllScheduledFutures();

        let totalFutures = 0;
        for (const [, futures] of allFutures) {
            totalFutures += futures.length;
        }
        expect(totalFutures).toBe(3);
    });

    test('getAllScheduledFutures returns empty map when no tasks', async () => {
        const allFutures = await proxy.getAllScheduledFutures();
        let totalFutures = 0;
        for (const [, futures] of allFutures) {
            totalFutures += futures.length;
        }
        expect(totalFutures).toBe(0);
    });

    // ── Instance wiring resolves proxy ──────────────────────────────────

    test('proxy name matches executor name', () => {
        expect(proxy.getName()).toBe(EXECUTOR_NAME);
    });

    // ── Shutdown cleans up ─────────────────────────────────────────────

    test('shutdown rejects new submissions', async () => {
        await proxy.shutdown();
        await expect(proxy.schedule(task(), 1000)).rejects.toThrow(ExecutorRejectedExecutionException);
    });

    test('shutdown is idempotent', async () => {
        await proxy.shutdown();
        await proxy.shutdown();
        expect(proxy.isShutdown()).toBe(true);
    });

    test('isShutdown reflects proxy state', () => {
        expect(proxy.isShutdown()).toBe(false);
    });

    // ── Future lifecycle through proxy ──────────────────────────────────

    test('cancel through reacquired future cancels the task', async () => {
        const future = await proxy.schedule(task(), 60_000);
        const handler = future.getHandler();

        const reacquired = proxy.getScheduledFuture<unknown>(handler);
        const cancelled = await reacquired.cancel(false);
        expect(cancelled).toBe(true);
        expect(await reacquired.isCancelled()).toBe(true);
    });

    test('dispose through proxy removes the task', async () => {
        const future = await proxy.schedule(task(), 60_000);
        const handler = future.getHandler();

        await future.cancel(false);
        await future.dispose();

        const reacquired = proxy.getScheduledFuture<unknown>(handler);
        await expect(reacquired.isDone()).rejects.toThrow(StaleTaskException);
    });
});
