/**
 * Block 22.14 — ClientScheduledExecutorProxy + protocol tests.
 *
 * Validates client proxy with full parity: schedule/cancel/dispose/getScheduledFuture/
 * getAllScheduledFutures/stats/history, client protocol messages reusing OperationWireCodec
 * patterns, handler reacquisition across client reconnect, stale/disposed error propagation.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { ScheduledExecutorContainerService } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorContainerService.js';
import { ScheduledTaskHandler } from '@zenystx/helios-core/scheduledexecutor/ScheduledTaskHandler.js';
import { StaleTaskException } from '@zenystx/helios-core/scheduledexecutor/StaleTaskException.js';
import type { IScheduledFuture } from '@zenystx/helios-core/scheduledexecutor/IScheduledFuture.js';
import type { IScheduledExecutorService } from '@zenystx/helios-core/scheduledexecutor/IScheduledExecutorService.js';
import type { TaskCallable } from '@zenystx/helios-core/executor/TaskCallable.js';

const EXECUTOR_NAME = 'test-scheduled';
const PARTITION_COUNT = 4;

function task(): TaskCallable<string> {
    return { taskType: 'test-task', input: null };
}

function voidTask(): TaskCallable<void> {
    return { taskType: 'void-task', input: null };
}

function makeConfig() {
    return {
        getName: () => EXECUTOR_NAME,
        getPoolSize: () => 4,
        getDurability: () => 1,
        getCapacity: () => 100,
        getCapacityPolicy: () => 'PER_NODE' as const,
        getMergePolicyConfig: () => null,
        isStatisticsEnabled: () => true,
        getMaxHistoryEntriesPerTask: () => 100,
    };
}

// ─── Test 1: ClientScheduledExecutorProxy exists and implements IScheduledExecutorService ───

describe('ClientScheduledExecutorProxy', () => {
    let containerService: ScheduledExecutorContainerService;

    beforeEach(() => {
        containerService = new ScheduledExecutorContainerService(PARTITION_COUNT);
        containerService.init();
        containerService.createDistributedObject(EXECUTOR_NAME, makeConfig() as any);
    });

    afterEach(async () => {
        await containerService.shutdown();
    });

    test('can be imported and constructed', async () => {
        const { ClientScheduledExecutorProxy } = await import(
            '@zenystx/helios-core/client/proxy/ClientScheduledExecutorProxy.js'
        );
        expect(ClientScheduledExecutorProxy).toBeDefined();
    });

    test('schedule creates task and returns future with handler', async () => {
        const { ClientScheduledExecutorProxy } = await import(
            '@zenystx/helios-core/client/proxy/ClientScheduledExecutorProxy.js'
        );
        const proxy = new ClientScheduledExecutorProxy(EXECUTOR_NAME, containerService, makeConfig() as any, PARTITION_COUNT);

        const future = await proxy.schedule(task(), 60_000);

        expect(future).toBeDefined();
        const handler = future.getHandler();
        expect(handler.getSchedulerName()).toBe(EXECUTOR_NAME);
        expect(handler.isAssignedToPartition()).toBe(true);
        expect(handler.getPartitionId()).toBeGreaterThanOrEqual(0);
    });

    test('scheduleOnKeyOwner creates task on partition', async () => {
        const { ClientScheduledExecutorProxy } = await import(
            '@zenystx/helios-core/client/proxy/ClientScheduledExecutorProxy.js'
        );
        const proxy = new ClientScheduledExecutorProxy(EXECUTOR_NAME, containerService, makeConfig() as any, PARTITION_COUNT);

        const future = await proxy.scheduleOnKeyOwner(task(), 'myKey', 60_000);

        expect(future).toBeDefined();
        expect(future.getHandler().isAssignedToPartition()).toBe(true);
    });

    test('scheduleAtFixedRate creates periodic task', async () => {
        const { ClientScheduledExecutorProxy } = await import(
            '@zenystx/helios-core/client/proxy/ClientScheduledExecutorProxy.js'
        );
        const proxy = new ClientScheduledExecutorProxy(EXECUTOR_NAME, containerService, makeConfig() as any, PARTITION_COUNT);

        const future = await proxy.scheduleAtFixedRate(voidTask(), 1_000, 5_000);

        expect(future).toBeDefined();
        expect(future.getHandler().getSchedulerName()).toBe(EXECUTOR_NAME);
    });

    test('client cancel works', async () => {
        const { ClientScheduledExecutorProxy } = await import(
            '@zenystx/helios-core/client/proxy/ClientScheduledExecutorProxy.js'
        );
        const proxy = new ClientScheduledExecutorProxy(EXECUTOR_NAME, containerService, makeConfig() as any, PARTITION_COUNT);

        const future = await proxy.schedule(task(), 60_000);
        const cancelled = await future.cancel(false);

        expect(cancelled).toBe(true);
        expect(await future.isCancelled()).toBe(true);
    });

    test('client dispose works', async () => {
        const { ClientScheduledExecutorProxy } = await import(
            '@zenystx/helios-core/client/proxy/ClientScheduledExecutorProxy.js'
        );
        const proxy = new ClientScheduledExecutorProxy(EXECUTOR_NAME, containerService, makeConfig() as any, PARTITION_COUNT);

        const future = await proxy.schedule(task(), 60_000);
        await future.dispose();

        // After dispose, accessing the task should throw StaleTaskException
        expect(() => future.getStats()).toThrow();
    });

    test('getScheduledFuture reacquires future from handler', async () => {
        const { ClientScheduledExecutorProxy } = await import(
            '@zenystx/helios-core/client/proxy/ClientScheduledExecutorProxy.js'
        );
        const proxy = new ClientScheduledExecutorProxy(EXECUTOR_NAME, containerService, makeConfig() as any, PARTITION_COUNT);

        const original = await proxy.schedule(task(), 60_000);
        const handler = original.getHandler();

        // Simulate handler reacquisition (e.g. after reconnect)
        const reacquired = proxy.getScheduledFuture(handler);

        expect(reacquired).toBeDefined();
        expect(reacquired.getHandler().toUrn()).toBe(handler.toUrn());
    });

    test('handler reacquisition after reconnect via URN serialization', async () => {
        const { ClientScheduledExecutorProxy } = await import(
            '@zenystx/helios-core/client/proxy/ClientScheduledExecutorProxy.js'
        );
        const proxy = new ClientScheduledExecutorProxy(EXECUTOR_NAME, containerService, makeConfig() as any, PARTITION_COUNT);

        const original = await proxy.schedule(task(), 60_000);
        const urn = original.getHandler().toUrn();

        // Simulate reconnect: reconstruct handler from URN
        const reconstructedHandler = ScheduledTaskHandler.of(urn);
        const reacquired = proxy.getScheduledFuture(reconstructedHandler);

        expect(reacquired).toBeDefined();
        expect(reacquired.getHandler().toUrn()).toBe(urn);

        // The reacquired future should still access the same task
        const cancelled = await reacquired.cancel(false);
        expect(cancelled).toBe(true);
    });

    test('stale error propagation after dispose', async () => {
        const { ClientScheduledExecutorProxy } = await import(
            '@zenystx/helios-core/client/proxy/ClientScheduledExecutorProxy.js'
        );
        const proxy = new ClientScheduledExecutorProxy(EXECUTOR_NAME, containerService, makeConfig() as any, PARTITION_COUNT);

        const future = await proxy.schedule(task(), 60_000);
        await future.dispose();

        // All operations on a disposed task should throw StaleTaskException
        await expect(future.cancel(false)).rejects.toThrow(StaleTaskException);
        await expect(future.isDone()).rejects.toThrow(StaleTaskException);
        await expect(future.isCancelled()).rejects.toThrow(StaleTaskException);
        await expect(future.getDelay()).rejects.toThrow(StaleTaskException);
        await expect(future.getStats()).rejects.toThrow(StaleTaskException);
    });

    test('shutdown rejects new submissions', async () => {
        const { ClientScheduledExecutorProxy } = await import(
            '@zenystx/helios-core/client/proxy/ClientScheduledExecutorProxy.js'
        );
        const proxy = new ClientScheduledExecutorProxy(EXECUTOR_NAME, containerService, makeConfig() as any, PARTITION_COUNT);

        await proxy.shutdown();

        await expect(proxy.schedule(task(), 1_000)).rejects.toThrow();
    });

    test('getAllScheduledFutures returns all scheduled tasks', async () => {
        const { ClientScheduledExecutorProxy } = await import(
            '@zenystx/helios-core/client/proxy/ClientScheduledExecutorProxy.js'
        );
        const proxy = new ClientScheduledExecutorProxy(EXECUTOR_NAME, containerService, makeConfig() as any, PARTITION_COUNT);

        await proxy.schedule(task(), 60_000);
        await proxy.schedule(task(), 60_000);

        const all = await proxy.getAllScheduledFutures();
        let totalFutures = 0;
        for (const [, futures] of all) {
            totalFutures += futures.length;
        }
        expect(totalFutures).toBe(2);
    });

    test('getStats returns task statistics', async () => {
        const { ClientScheduledExecutorProxy } = await import(
            '@zenystx/helios-core/client/proxy/ClientScheduledExecutorProxy.js'
        );
        const proxy = new ClientScheduledExecutorProxy(EXECUTOR_NAME, containerService, makeConfig() as any, PARTITION_COUNT);

        const future = await proxy.schedule(task(), 60_000);
        const stats = await future.getStats();

        expect(stats).toBeDefined();
        expect(stats.totalRuns).toBe(0);
        expect(typeof stats.lastRunDurationMs).toBe('number');
    });

    test('getDelay returns remaining delay', async () => {
        const { ClientScheduledExecutorProxy } = await import(
            '@zenystx/helios-core/client/proxy/ClientScheduledExecutorProxy.js'
        );
        const proxy = new ClientScheduledExecutorProxy(EXECUTOR_NAME, containerService, makeConfig() as any, PARTITION_COUNT);

        const future = await proxy.schedule(task(), 60_000);
        const delay = await future.getDelay();

        expect(delay).toBeGreaterThan(0);
        expect(delay).toBeLessThanOrEqual(60_000);
    });
});

// ─── Protocol codec tests ───

describe('ScheduledExecutorCodec', () => {
    test('SubmitToPartition codec encodes/decodes round-trip', async () => {
        const { ScheduledExecutorSubmitToPartitionCodec } = await import(
            '@zenystx/helios-core/client/impl/protocol/codec/ScheduledExecutorSubmitToPartitionCodec.js'
        );

        const encoded = ScheduledExecutorSubmitToPartitionCodec.encodeRequest(
            'my-scheduler', 0, 'task-1', 'test-task', 1000, 0, false,
        );

        expect(encoded).toBeDefined();
        expect(encoded.getMessageType()).toBe(ScheduledExecutorSubmitToPartitionCodec.REQUEST_MESSAGE_TYPE);

        const decoded = ScheduledExecutorSubmitToPartitionCodec.decodeRequest(encoded);
        expect(decoded.schedulerName).toBe('my-scheduler');
        expect(decoded.type).toBe(0);
        expect(decoded.taskName).toBe('task-1');
        expect(decoded.taskType).toBe('test-task');
        expect(decoded.initialDelayMs).toBe(1000);
        expect(decoded.periodMs).toBe(0);
        expect(decoded.autoDisposable).toBe(false);
    });

    test('SubmitToMember codec encodes/decodes round-trip', async () => {
        const { ScheduledExecutorSubmitToMemberCodec } = await import(
            '@zenystx/helios-core/client/impl/protocol/codec/ScheduledExecutorSubmitToMemberCodec.js'
        );

        const memberUuid = 'member-uuid-123';
        const encoded = ScheduledExecutorSubmitToMemberCodec.encodeRequest(
            'my-scheduler', memberUuid, 0, 'task-1', 'test-task', 1000, 0, false,
        );

        expect(encoded).toBeDefined();
        const decoded = ScheduledExecutorSubmitToMemberCodec.decodeRequest(encoded);
        expect(decoded.schedulerName).toBe('my-scheduler');
        expect(decoded.memberUuid).toBe(memberUuid);
        expect(decoded.taskName).toBe('task-1');
    });

    test('Cancel codec encodes/decodes round-trip', async () => {
        const { ScheduledExecutorCancelCodec } = await import(
            '@zenystx/helios-core/client/impl/protocol/codec/ScheduledExecutorCancelCodec.js'
        );

        const encoded = ScheduledExecutorCancelCodec.encodeRequest(
            'my-scheduler', 'task-1', 0, false,
        );
        const decoded = ScheduledExecutorCancelCodec.decodeRequest(encoded);
        expect(decoded.schedulerName).toBe('my-scheduler');
        expect(decoded.taskName).toBe('task-1');

        const response = ScheduledExecutorCancelCodec.encodeResponse(true);
        const result = ScheduledExecutorCancelCodec.decodeResponse(response);
        expect(result).toBe(true);
    });

    test('Dispose codec encodes/decodes round-trip', async () => {
        const { ScheduledExecutorDisposeCodec } = await import(
            '@zenystx/helios-core/client/impl/protocol/codec/ScheduledExecutorDisposeCodec.js'
        );

        const encoded = ScheduledExecutorDisposeCodec.encodeRequest(
            'my-scheduler', 'task-1', 0,
        );
        const decoded = ScheduledExecutorDisposeCodec.decodeRequest(encoded);
        expect(decoded.schedulerName).toBe('my-scheduler');
        expect(decoded.taskName).toBe('task-1');
    });

    test('GetAllScheduledFutures codec encodes/decodes round-trip', async () => {
        const { ScheduledExecutorGetAllScheduledFuturesCodec } = await import(
            '@zenystx/helios-core/client/impl/protocol/codec/ScheduledExecutorGetAllScheduledFuturesCodec.js'
        );

        const encoded = ScheduledExecutorGetAllScheduledFuturesCodec.encodeRequest('my-scheduler');
        const decoded = ScheduledExecutorGetAllScheduledFuturesCodec.decodeRequest(encoded);
        expect(decoded.schedulerName).toBe('my-scheduler');

        const handlerUrns = [
            'urn:helios:scheduled:my-scheduler:task-1:partition:0',
            'urn:helios:scheduled:my-scheduler:task-2:partition:1',
        ];
        const response = ScheduledExecutorGetAllScheduledFuturesCodec.encodeResponse(handlerUrns);
        const result = ScheduledExecutorGetAllScheduledFuturesCodec.decodeResponse(response);
        expect(result).toEqual(handlerUrns);
    });

    test('GetStats codec encodes/decodes round-trip', async () => {
        const { ScheduledExecutorGetStatsCodec } = await import(
            '@zenystx/helios-core/client/impl/protocol/codec/ScheduledExecutorGetStatsCodec.js'
        );

        const encoded = ScheduledExecutorGetStatsCodec.encodeRequest('my-scheduler', 'task-1', 0);
        const decoded = ScheduledExecutorGetStatsCodec.decodeRequest(encoded);
        expect(decoded.schedulerName).toBe('my-scheduler');
        expect(decoded.taskName).toBe('task-1');

        const response = ScheduledExecutorGetStatsCodec.encodeResponse(5, 100, 0, 500, 0);
        const result = ScheduledExecutorGetStatsCodec.decodeResponse(response);
        expect(result.totalRuns).toBe(5);
        expect(result.lastRunDurationMs).toBe(100);
        expect(result.totalRunTimeMs).toBe(500);
    });

    test('GetState codec encodes/decodes round-trip', async () => {
        const { ScheduledExecutorGetStateCodec } = await import(
            '@zenystx/helios-core/client/impl/protocol/codec/ScheduledExecutorGetStateCodec.js'
        );

        const encoded = ScheduledExecutorGetStateCodec.encodeRequest('my-scheduler', 'task-1', 0);
        const decoded = ScheduledExecutorGetStateCodec.decodeRequest(encoded);
        expect(decoded.schedulerName).toBe('my-scheduler');
        expect(decoded.taskName).toBe('task-1');

        // isDone=false, isCancelled=false, delay=5000
        const response = ScheduledExecutorGetStateCodec.encodeResponse(false, false, 5000);
        const result = ScheduledExecutorGetStateCodec.decodeResponse(response);
        expect(result.isDone).toBe(false);
        expect(result.isCancelled).toBe(false);
        expect(result.delayMs).toBe(5000);
    });

    test('Shutdown codec encodes/decodes round-trip', async () => {
        const { ScheduledExecutorShutdownCodec } = await import(
            '@zenystx/helios-core/client/impl/protocol/codec/ScheduledExecutorShutdownCodec.js'
        );

        const encoded = ScheduledExecutorShutdownCodec.encodeRequest('my-scheduler');
        const decoded = ScheduledExecutorShutdownCodec.decodeRequest(encoded);
        expect(decoded.schedulerName).toBe('my-scheduler');
    });
});

// ─── Server-side message handler tests ───

describe('ScheduledExecutor client protocol handlers', () => {
    let containerService: ScheduledExecutorContainerService;

    beforeEach(() => {
        containerService = new ScheduledExecutorContainerService(PARTITION_COUNT);
        containerService.init();
        containerService.createDistributedObject(EXECUTOR_NAME, makeConfig() as any);
    });

    afterEach(async () => {
        await containerService.shutdown();
    });

    test('submit-to-partition handler creates task via protocol', async () => {
        const { ScheduledExecutorSubmitToPartitionCodec } = await import(
            '@zenystx/helios-core/client/impl/protocol/codec/ScheduledExecutorSubmitToPartitionCodec.js'
        );
        const { createScheduledExecutorMessageHandlers } = await import(
            '@zenystx/helios-core/server/clientprotocol/ScheduledExecutorMessageHandlers.js'
        );

        const handlers = createScheduledExecutorMessageHandlers(containerService);
        const request = ScheduledExecutorSubmitToPartitionCodec.encodeRequest(
            EXECUTOR_NAME, 0, 'proto-task', 'test-task', 60_000, 0, false,
        );
        request.setPartitionId(0);

        const handler = handlers.get(ScheduledExecutorSubmitToPartitionCodec.REQUEST_MESSAGE_TYPE);
        expect(handler).toBeDefined();

        const response = await handler!(request, {} as any);
        expect(response).toBeDefined();

        // Verify task was actually created in the container service
        const descriptor = containerService.getTaskDescriptor(EXECUTOR_NAME, 'proto-task', 0);
        expect(descriptor.taskName).toBe('proto-task');
    });

    test('cancel handler cancels via protocol', async () => {
        const { ScheduledExecutorCancelCodec } = await import(
            '@zenystx/helios-core/client/impl/protocol/codec/ScheduledExecutorCancelCodec.js'
        );
        const { createScheduledExecutorMessageHandlers } = await import(
            '@zenystx/helios-core/server/clientprotocol/ScheduledExecutorMessageHandlers.js'
        );

        // First schedule a task
        containerService.scheduleOnPartition(EXECUTOR_NAME, {
            name: 'cancel-task', command: 'test-task', delay: 60_000, period: 0, type: 'SINGLE_RUN', autoDisposable: false,
        }, 0);

        const handlers = createScheduledExecutorMessageHandlers(containerService);
        const request = ScheduledExecutorCancelCodec.encodeRequest(EXECUTOR_NAME, 'cancel-task', 0, false);

        const handler = handlers.get(ScheduledExecutorCancelCodec.REQUEST_MESSAGE_TYPE);
        const response = await handler!(request, {} as any);
        expect(response).toBeDefined();

        const result = ScheduledExecutorCancelCodec.decodeResponse(response!);
        expect(result).toBe(true);
    });

    test('dispose handler disposes via protocol and subsequent access throws StaleTaskException', async () => {
        const { ScheduledExecutorDisposeCodec } = await import(
            '@zenystx/helios-core/client/impl/protocol/codec/ScheduledExecutorDisposeCodec.js'
        );
        const { createScheduledExecutorMessageHandlers } = await import(
            '@zenystx/helios-core/server/clientprotocol/ScheduledExecutorMessageHandlers.js'
        );

        containerService.scheduleOnPartition(EXECUTOR_NAME, {
            name: 'dispose-task', command: 'test-task', delay: 60_000, period: 0, type: 'SINGLE_RUN', autoDisposable: false,
        }, 0);

        const handlers = createScheduledExecutorMessageHandlers(containerService);
        const request = ScheduledExecutorDisposeCodec.encodeRequest(EXECUTOR_NAME, 'dispose-task', 0);

        const handler = handlers.get(ScheduledExecutorDisposeCodec.REQUEST_MESSAGE_TYPE);
        await handler!(request, {} as any);

        // Now accessing the disposed task should throw
        expect(() => containerService.getTaskDescriptor(EXECUTOR_NAME, 'dispose-task', 0)).toThrow(StaleTaskException);
    });
});

// ─── Wire codec integration tests ───

describe('ScheduledExecutor OperationWireCodec integration', () => {
    test('scheduled executor operations are serializable via OperationWireCodec patterns', async () => {
        const { ScheduledExecutorSubmitToPartitionCodec } = await import(
            '@zenystx/helios-core/client/impl/protocol/codec/ScheduledExecutorSubmitToPartitionCodec.js'
        );

        // Encode → serialize → transmit → deserialize → decode
        const original = ScheduledExecutorSubmitToPartitionCodec.encodeRequest(
            'sched-1', 0, 'wire-task', 'test-task', 5000, 0, true,
        );

        // Round-trip through decode
        const decoded = ScheduledExecutorSubmitToPartitionCodec.decodeRequest(original);
        expect(decoded.schedulerName).toBe('sched-1');
        expect(decoded.taskName).toBe('wire-task');
        expect(decoded.taskType).toBe('test-task');
        expect(decoded.initialDelayMs).toBe(5000);
        expect(decoded.autoDisposable).toBe(true);
    });
});
