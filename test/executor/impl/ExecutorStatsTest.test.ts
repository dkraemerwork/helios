/**
 * Tests for Block 17.9 — ExecutorStats + monitoring.
 *
 * Validates that LocalExecutorStats tracks all lifecycle counters,
 * latency accumulators, and pool health snapshots correctly.
 */

import { ExecutorConfig } from '@zenystx/helios-core/config/ExecutorConfig.js';
import type { LocalExecutorStats } from '@zenystx/helios-core/executor/IExecutorService.js';
import { ExecutorContainerService } from '@zenystx/helios-core/executor/impl/ExecutorContainerService.js';
import { TaskTypeRegistry } from '@zenystx/helios-core/executor/impl/TaskTypeRegistry.js';
import { describe, expect, test } from 'bun:test';

function makeRegistry(): TaskTypeRegistry {
    const reg = new TaskTypeRegistry();
    reg.register('echo', (input: unknown) => input, {});
    return reg;
}

function makeSlowRegistry(ms: number): TaskTypeRegistry {
    const reg = new TaskTypeRegistry();
    reg.register('slow', async (input: unknown) => {
        await Bun.sleep(ms);
        return input;
    }, {});
    return reg;
}

function makeConfig(overrides: Partial<{
    poolSize: number;
    queueCapacity: number;
    taskTimeoutMillis: number;
    shutdownTimeoutMillis: number;
    maxActiveTaskTypePools: number;
    poolIdleMillis: number;
}> = {}): ExecutorConfig {
    const cfg = new ExecutorConfig('test');
    if (overrides.poolSize !== undefined) cfg.setPoolSize(overrides.poolSize);
    if (overrides.queueCapacity !== undefined && overrides.queueCapacity > 0) cfg.setQueueCapacity(overrides.queueCapacity);
    if (overrides.taskTimeoutMillis !== undefined) cfg.setTaskTimeoutMillis(overrides.taskTimeoutMillis);
    if (overrides.shutdownTimeoutMillis !== undefined && overrides.shutdownTimeoutMillis > 0) cfg.setShutdownTimeoutMillis(overrides.shutdownTimeoutMillis);
    if (overrides.maxActiveTaskTypePools !== undefined) cfg.setMaxActiveTaskTypePools(overrides.maxActiveTaskTypePools);
    if (overrides.poolIdleMillis !== undefined) cfg.setPoolIdleMillis(overrides.poolIdleMillis);
    return cfg;
}

function makeRequest(taskType: string, registry: TaskTypeRegistry, uuid?: string): {
    taskUuid: string;
    taskType: string;
    registrationFingerprint: string;
    inputData: Buffer;
    executorName: string;
    submitterMemberUuid: string;
    timeoutMillis: number;
} {
    return {
        taskUuid: uuid ?? crypto.randomUUID(),
        taskType,
        registrationFingerprint: registry.get(taskType)!.fingerprint,
        inputData: Buffer.from(JSON.stringify({ value: 42 })),
        executorName: 'test-executor',
        submitterMemberUuid: 'member-1',
        timeoutMillis: 5000,
    };
}

describe('ExecutorStats (Block 17.9)', () => {
    test('counters move correctly through task lifecycle', async () => {
        const registry = makeRegistry();
        const config = makeConfig();
        const svc = new ExecutorContainerService('test', config, registry);

        const result = await svc.executeTask(makeRequest('echo', registry));
        expect(result.status).toBe('success');

        const stats: LocalExecutorStats = svc.getStats();
        expect(stats.started).toBe(1);
        expect(stats.completed).toBe(1);
        expect(stats.pending).toBe(0);
        expect(stats.cancelled).toBe(0);
        expect(stats.rejected).toBe(0);
        expect(stats.timedOut).toBe(0);
        expect(stats.taskLost).toBe(0);
    });

    test('start latency and execution time accumulate correctly', async () => {
        const registry = makeSlowRegistry(50);
        const config = makeConfig();
        const svc = new ExecutorContainerService('test', config, registry);

        await svc.executeTask(makeRequest('slow', registry));
        await svc.executeTask(makeRequest('slow', registry));

        const stats = svc.getStats();
        expect(stats.totalStartLatencyMs).toBeGreaterThanOrEqual(0);
        expect(stats.totalExecutionTimeMs).toBeGreaterThanOrEqual(80); // ~50ms * 2, with some tolerance
    });

    test('queue rejection increments rejected', async () => {
        // Use unknown task type to trigger rejection without needing pool contention
        const registry = makeRegistry();
        const config = makeConfig();
        const svc = new ExecutorContainerService('test', config, registry);

        const result = await svc.executeTask({
            taskUuid: crypto.randomUUID(),
            taskType: 'nonexistent',
            registrationFingerprint: 'wrong',
            inputData: Buffer.from('{}'),
            executorName: 'test',
            submitterMemberUuid: 'member-1',
            timeoutMillis: 5000,
        });

        expect(result.status).toBe('rejected');
        const stats = svc.getStats();
        expect(stats.rejected).toBe(1);
    });

    test('queue full rejection increments rejected', async () => {
        const registry = new TaskTypeRegistry();
        let releaseHold!: () => void;
        const holdPromise = new Promise<void>((r) => { releaseHold = r; });
        registry.register('hold', async () => {
            await holdPromise;
            return 'done';
        }, {});
        // Pool size 1, queue capacity 1 — third task gets rejected (1 running + 1 queued = full)
        const config = makeConfig({ poolSize: 1, queueCapacity: 1 });
        const svc = new ExecutorContainerService('test', config, registry);

        const req = () => ({ ...makeRequest('hold', registry), timeoutMillis: 0 });
        // First task runs immediately (pool.activeCount = 1)
        const p1 = svc.executeTask(req());
        // Second task queues (pool full, queue has room)
        const p2 = svc.executeTask(req());
        // Third task should be rejected (pool full, queue full)
        const result = await svc.executeTask(req());

        expect(result.status).toBe('rejected');
        expect(result.errorName).toBe('ExecutorRejectedExecutionException');
        const stats = svc.getStats();
        expect(stats.rejected).toBe(1);

        releaseHold();
        await Promise.all([p1, p2]);
    });

    test('timeout increments timedOut', async () => {
        const slowReg = new TaskTypeRegistry();
        slowReg.register('slow', async () => {
            await Bun.sleep(500);
            return 'done';
        }, {});
        const config = makeConfig({ taskTimeoutMillis: 50 });
        const svc = new ExecutorContainerService('test', config, slowReg);

        const result = await svc.executeTask({
            ...makeRequest('slow', slowReg),
            timeoutMillis: 50,
        });

        expect(result.status).toBe('timeout');
        const stats = svc.getStats();
        expect(stats.timedOut).toBe(1);
    });

    test('late result after cancel increments lateResultsDropped', async () => {
        const slowReg = new TaskTypeRegistry();
        slowReg.register('slow', async () => {
            await Bun.sleep(200);
            return 'done';
        }, {});
        const config = makeConfig();
        const svc = new ExecutorContainerService('test', config, slowReg);

        const uuid = crypto.randomUUID();
        void svc.executeTask({ ...makeRequest('slow', slowReg), taskUuid: uuid });

        // Let the task start executing
        await Bun.sleep(10);
        const cancelled = svc.cancelTask(uuid);
        expect(cancelled).toBe(true);

        // Wait for the actual task to complete (its result should be dropped)
        await Bun.sleep(250);

        const stats = svc.getStats();
        expect(stats.cancelled).toBe(1);
        expect(stats.lateResultsDropped).toBeGreaterThanOrEqual(1);
    });

    test('snapshot is immutable from caller perspective', async () => {
        const registry = makeRegistry();
        const config = makeConfig();
        const svc = new ExecutorContainerService('test', config, registry);

        await svc.executeTask(makeRequest('echo', registry));

        const stats1 = svc.getStats();
        const stats2 = svc.getStats();

        // Different objects
        expect(stats1).not.toBe(stats2);
        // Same values
        expect(stats1).toEqual(stats2);

        // Mutating the snapshot doesn't affect future snapshots
        (stats1 as any).completed = 999;
        const stats3 = svc.getStats();
        expect(stats3.completed).toBe(1);
    });

    test('activeWorkers reflects currently running tasks', async () => {
        const slowReg = new TaskTypeRegistry();
        slowReg.register('slow', async () => {
            await Bun.sleep(200);
            return 'done';
        }, {});
        const config = makeConfig({ poolSize: 4 });
        const svc = new ExecutorContainerService('test', config, slowReg);

        const p1 = svc.executeTask(makeRequest('slow', slowReg));
        const p2 = svc.executeTask(makeRequest('slow', slowReg));

        await Bun.sleep(10); // let them start

        const stats = svc.getStats();
        expect(stats.activeWorkers).toBe(2);

        await Promise.all([p1, p2]);

        const statsAfter = svc.getStats();
        expect(statsAfter.activeWorkers).toBe(0);
    });

    test('multiple task types accumulate stats independently into aggregate', async () => {
        const registry = new TaskTypeRegistry();
        registry.register('typeA', (input: unknown) => input, {});
        registry.register('typeB', (input: unknown) => input, {});
        const config = makeConfig();
        const svc = new ExecutorContainerService('test', config, registry);

        await svc.executeTask(makeRequest('typeA', registry));
        await svc.executeTask(makeRequest('typeA', registry));
        await svc.executeTask(makeRequest('typeB', registry));

        const stats = svc.getStats();
        expect(stats.started).toBe(3);
        expect(stats.completed).toBe(3);
    });

    test('all stats fields are present and numeric', async () => {
        const registry = makeRegistry();
        const config = makeConfig();
        const svc = new ExecutorContainerService('test', config, registry);

        const stats = svc.getStats();

        // Validate all expected fields exist and are numbers
        const requiredFields: (keyof LocalExecutorStats)[] = [
            'pending', 'started', 'completed', 'cancelled', 'rejected',
            'timedOut', 'taskLost', 'lateResultsDropped',
            'totalStartLatencyMs', 'totalExecutionTimeMs', 'activeWorkers',
        ];

        for (const field of requiredFields) {
            expect(typeof stats[field]).toBe('number');
        }
    });
});
