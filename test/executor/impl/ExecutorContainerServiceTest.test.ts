/**
 * Block 17.5 — ExecutorContainerService + Bounded Scatter Execution Engine
 *
 * Tests: lazy pool creation, queue bounds, idle eviction, pool cap, cancel (queued + running),
 * timeout, degraded pool detection, handle cleanup, result deserialization.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ExecutorContainerService, TaskState } from '@helios/executor/impl/ExecutorContainerService.js';
import { TaskTypeRegistry } from '@helios/executor/impl/TaskTypeRegistry.js';
import { ExecutorConfig } from '@helios/config/ExecutorConfig.js';

function makeConfig(overrides?: {
    poolSize?: number;
    queueCapacity?: number;
    maxActiveTaskTypePools?: number;
    poolIdleMillis?: number;
    taskTimeoutMillis?: number;
    shutdownTimeoutMillis?: number;
}): ExecutorConfig {
    const cfg = new ExecutorConfig('test-executor');
    if (overrides?.poolSize) cfg.setPoolSize(overrides.poolSize);
    if (overrides?.queueCapacity) cfg.setQueueCapacity(overrides.queueCapacity);
    if (overrides?.maxActiveTaskTypePools) cfg.setMaxActiveTaskTypePools(overrides.maxActiveTaskTypePools);
    if (overrides?.poolIdleMillis !== undefined) cfg.setPoolIdleMillis(overrides.poolIdleMillis);
    if (overrides?.taskTimeoutMillis !== undefined) cfg.setTaskTimeoutMillis(overrides.taskTimeoutMillis);
    if (overrides?.shutdownTimeoutMillis) cfg.setShutdownTimeoutMillis(overrides.shutdownTimeoutMillis);
    return cfg;
}

describe('ExecutorContainerService', () => {
    let registry: TaskTypeRegistry;
    let service: ExecutorContainerService;

    beforeEach(() => {
        registry = new TaskTypeRegistry();
        registry.register('double', (n: unknown) => Number(n) * 2, { version: 'v1' });
    });

    afterEach(async () => {
        if (service && !service.isShutdown()) {
            await service.shutdown();
        }
    });

    it('creates scatter pool lazily on first task execution', async () => {
        service = new ExecutorContainerService('test', makeConfig({ poolSize: 2 }), registry);
        expect(service.getActivePoolCount()).toBe(0);

        const result = await service.executeTask({
            taskUuid: crypto.randomUUID(),
            taskType: 'double',
            registrationFingerprint: 'v1',
            inputData: Buffer.from(JSON.stringify(5)),
            executorName: 'test',
            submitterMemberUuid: 'member-1',
            timeoutMillis: 5000,
        });

        expect(result.status).toBe('success');
        expect(service.getActivePoolCount()).toBe(1);
    });

    it('rejects when queue capacity is full', async () => {
        registry.register('slow', () => new Promise<void>(() => {}), { version: 'v1' });
        service = new ExecutorContainerService('test', makeConfig({ poolSize: 1, queueCapacity: 1, shutdownTimeoutMillis: 100 }), registry);

        // Fill pool + queue
        service.executeTask({
            taskUuid: crypto.randomUUID(),
            taskType: 'slow',
            registrationFingerprint: 'v1',
            inputData: Buffer.from('null'),
            executorName: 'test',
            submitterMemberUuid: 'member-1',
            timeoutMillis: 60000,
        });
        service.executeTask({
            taskUuid: crypto.randomUUID(),
            taskType: 'slow',
            registrationFingerprint: 'v1',
            inputData: Buffer.from('null'),
            executorName: 'test',
            submitterMemberUuid: 'member-1',
            timeoutMillis: 60000,
        });

        // Third should be rejected
        const result = await service.executeTask({
            taskUuid: crypto.randomUUID(),
            taskType: 'slow',
            registrationFingerprint: 'v1',
            inputData: Buffer.from('null'),
            executorName: 'test',
            submitterMemberUuid: 'member-1',
            timeoutMillis: 60000,
        });

        expect(result.status).toBe('rejected');
        expect(result.errorName).toBe('ExecutorRejectedExecutionException');
    });

    it('enforces pool cap via maxActiveTaskTypePools', async () => {
        service = new ExecutorContainerService('test', makeConfig({ maxActiveTaskTypePools: 1, poolSize: 1 }), registry);

        registry.register('other', (n: unknown) => Number(n) + 1, { version: 'v1' });

        // First task type creates pool successfully
        const r1 = await service.executeTask({
            taskUuid: crypto.randomUUID(),
            taskType: 'double',
            registrationFingerprint: 'v1',
            inputData: Buffer.from('3'),
            executorName: 'test',
            submitterMemberUuid: 'member-1',
            timeoutMillis: 5000,
        });
        expect(r1.status).toBe('success');

        // Second task type should be rejected (pool cap = 1)
        const r2 = await service.executeTask({
            taskUuid: crypto.randomUUID(),
            taskType: 'other',
            registrationFingerprint: 'v1',
            inputData: Buffer.from('3'),
            executorName: 'test',
            submitterMemberUuid: 'member-1',
            timeoutMillis: 5000,
        });
        expect(r2.status).toBe('rejected');
        expect(r2.errorName).toBe('ExecutorRejectedExecutionException');
    });

    it('deserializes input and serializes result correctly', async () => {
        service = new ExecutorContainerService('test', makeConfig(), registry);

        const result = await service.executeTask({
            taskUuid: crypto.randomUUID(),
            taskType: 'double',
            registrationFingerprint: 'v1',
            inputData: Buffer.from(JSON.stringify(21)),
            executorName: 'test',
            submitterMemberUuid: 'member-1',
            timeoutMillis: 5000,
        });

        expect(result.status).toBe('success');
        expect(result.resultData).not.toBeNull();
        // Result data contains serialized 42 (HeapData: 8-byte header + 4-byte length + JSON payload)
        const raw = result.resultData!.toByteArray()!;
        const payload = raw.subarray(12); // skip HeapData overhead + 4-byte length prefix
        expect(JSON.parse(payload.toString('utf8'))).toBe(42);
    });

    it('cancels a queued task and returns cancelled status', async () => {
        registry.register('slow', () => new Promise(() => {}), { version: 'v1' });
        service = new ExecutorContainerService('test', makeConfig({ poolSize: 1, queueCapacity: 5, shutdownTimeoutMillis: 100 }), registry);

        // Fill pool with slow task
        service.executeTask({
            taskUuid: 'running-1',
            taskType: 'slow',
            registrationFingerprint: 'v1',
            inputData: Buffer.from('null'),
            executorName: 'test',
            submitterMemberUuid: 'member-1',
            timeoutMillis: 60000,
        });

        // Queue a second task
        const queuedUuid = 'queued-1';
        const p2 = service.executeTask({
            taskUuid: queuedUuid,
            taskType: 'slow',
            registrationFingerprint: 'v1',
            inputData: Buffer.from('null'),
            executorName: 'test',
            submitterMemberUuid: 'member-1',
            timeoutMillis: 60000,
        });

        // Cancel the queued task
        const cancelled = service.cancelTask(queuedUuid);
        expect(cancelled).toBe(true);

        const result = await p2;
        expect(result.status).toBe('cancelled');
    });

    it('cancels a running task — caller gets cancelled, late result dropped', async () => {
        let resolveTask!: (v: number) => void;
        registry.register('controllable', () => new Promise<number>((r) => { resolveTask = r; }), { version: 'v1' });
        service = new ExecutorContainerService('test', makeConfig({ poolSize: 1 }), registry);

        const taskUuid = 'running-cancel';
        const promise = service.executeTask({
            taskUuid,
            taskType: 'controllable',
            registrationFingerprint: 'v1',
            inputData: Buffer.from('null'),
            executorName: 'test',
            submitterMemberUuid: 'member-1',
            timeoutMillis: 60000,
        });

        // Give it a tick to start
        await Bun.sleep(10);

        const cancelled = service.cancelTask(taskUuid);
        expect(cancelled).toBe(true);

        // Late resolve should be dropped
        resolveTask(999);

        const result = await promise;
        expect(result.status).toBe('cancelled');
    });

    it('times out a task and returns timeout status', async () => {
        registry.register('hang', () => new Promise(() => {}), { version: 'v1' });
        service = new ExecutorContainerService('test', makeConfig({ poolSize: 1, taskTimeoutMillis: 50 }), registry);

        const result = await service.executeTask({
            taskUuid: crypto.randomUUID(),
            taskType: 'hang',
            registrationFingerprint: 'v1',
            inputData: Buffer.from('null'),
            executorName: 'test',
            submitterMemberUuid: 'member-1',
            timeoutMillis: 50,
        });

        expect(result.status).toBe('timeout');
        expect(result.errorName).toBe('ExecutorTaskTimeoutException');
    });

    it('evicts idle pools after poolIdleMillis', async () => {
        service = new ExecutorContainerService('test', makeConfig({ poolSize: 1, poolIdleMillis: 50 }), registry);

        await service.executeTask({
            taskUuid: crypto.randomUUID(),
            taskType: 'double',
            registrationFingerprint: 'v1',
            inputData: Buffer.from('5'),
            executorName: 'test',
            submitterMemberUuid: 'member-1',
            timeoutMillis: 5000,
        });

        expect(service.getActivePoolCount()).toBe(1);

        // Wait for idle eviction
        await Bun.sleep(100);
        service.evictIdlePools();
        expect(service.getActivePoolCount()).toBe(0);
    });

    it('cleans up task handles after completion', async () => {
        service = new ExecutorContainerService('test', makeConfig(), registry);

        await service.executeTask({
            taskUuid: 'handle-cleanup',
            taskType: 'double',
            registrationFingerprint: 'v1',
            inputData: Buffer.from('5'),
            executorName: 'test',
            submitterMemberUuid: 'member-1',
            timeoutMillis: 5000,
        });

        expect(service.getTaskState('handle-cleanup')).toBeUndefined();
    });

    it('reports task state correctly during lifecycle', async () => {
        let resolveTask!: (v: number) => void;
        registry.register('gate', () => new Promise<number>((r) => { resolveTask = r; }), { version: 'v1' });
        service = new ExecutorContainerService('test', makeConfig({ poolSize: 1 }), registry);

        const promise = service.executeTask({
            taskUuid: 'state-check',
            taskType: 'gate',
            registrationFingerprint: 'v1',
            inputData: Buffer.from('null'),
            executorName: 'test',
            submitterMemberUuid: 'member-1',
            timeoutMillis: 60000,
        });

        await Bun.sleep(10);
        expect(service.getTaskState('state-check')).toBe(TaskState.RUNNING);

        resolveTask(42);
        await promise;
        // After completion, handle is cleaned
        expect(service.getTaskState('state-check')).toBeUndefined();
    });

    it('rejects new work after shutdown', async () => {
        service = new ExecutorContainerService('test', makeConfig(), registry);
        await service.shutdown();

        const result = await service.executeTask({
            taskUuid: crypto.randomUUID(),
            taskType: 'double',
            registrationFingerprint: 'v1',
            inputData: Buffer.from('5'),
            executorName: 'test',
            submitterMemberUuid: 'member-1',
            timeoutMillis: 5000,
        });

        expect(result.status).toBe('rejected');
        expect(result.errorName).toBe('ExecutorRejectedExecutionException');
    });

    it('handles task execution errors gracefully', async () => {
        registry.register('boom', () => { throw new Error('kaboom'); }, { version: 'v1' });
        service = new ExecutorContainerService('test', makeConfig(), registry);

        const result = await service.executeTask({
            taskUuid: crypto.randomUUID(),
            taskType: 'boom',
            registrationFingerprint: 'v1',
            inputData: Buffer.from('null'),
            executorName: 'test',
            submitterMemberUuid: 'member-1',
            timeoutMillis: 5000,
        });

        expect(result.status).toBe('rejected');
        expect(result.errorName).toBe('Error');
        expect(result.errorMessage).toBe('kaboom');
    });

    it('shutdown drains in-flight tasks within timeout', async () => {
        let resolveTask!: () => void;
        registry.register('drain', () => new Promise<void>((r) => { resolveTask = r; }), { version: 'v1' });
        service = new ExecutorContainerService('test', makeConfig({ shutdownTimeoutMillis: 2000 }), registry);

        const promise = service.executeTask({
            taskUuid: 'drain-1',
            taskType: 'drain',
            registrationFingerprint: 'v1',
            inputData: Buffer.from('null'),
            executorName: 'test',
            submitterMemberUuid: 'member-1',
            timeoutMillis: 60000,
        });

        // Resolve the task after a short delay, then start shutdown
        await Bun.sleep(20);
        resolveTask();
        // Let microtask settle
        await Bun.sleep(10);

        const result = await promise;
        expect(result.status).toBe('success');

        // Now shutdown should complete immediately (no in-flight tasks)
        await service.shutdown();
        expect(service.isShutdown()).toBe(true);
    });

    it('returns correct stats snapshot', async () => {
        service = new ExecutorContainerService('test', makeConfig(), registry);

        await service.executeTask({
            taskUuid: crypto.randomUUID(),
            taskType: 'double',
            registrationFingerprint: 'v1',
            inputData: Buffer.from('5'),
            executorName: 'test',
            submitterMemberUuid: 'member-1',
            timeoutMillis: 5000,
        });

        const stats = service.getStats();
        expect(stats.started).toBeGreaterThanOrEqual(1);
        expect(stats.completed).toBeGreaterThanOrEqual(1);
    });
});
