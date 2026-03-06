/**
 * Block 17.7 — CancellationOperation + ShutdownOperation tests.
 */

import { describe, test, expect } from 'bun:test';
import { CancellationOperation } from '@zenystx/core/executor/impl/CancellationOperation.js';
import { ShutdownOperation } from '@zenystx/core/executor/impl/ShutdownOperation.js';
import { ExecutorContainerService } from '@zenystx/core/executor/impl/ExecutorContainerService.js';
import { TaskTypeRegistry } from '@zenystx/core/executor/impl/TaskTypeRegistry.js';
import { ExecutorConfig } from '@zenystx/core/config/ExecutorConfig.js';

function makeRegistry(...entries: Array<[string, (input: unknown) => unknown | Promise<unknown>]>): TaskTypeRegistry {
    const reg = new TaskTypeRegistry();
    for (const [name, factory] of entries) {
        reg.register(name, factory);
    }
    return reg;
}

function makeConfig(opts?: { poolSize?: number; queueCapacity?: number; shutdownTimeoutMillis?: number }): ExecutorConfig {
    const c = new ExecutorConfig('test');
    if (opts?.poolSize) c.setPoolSize(opts.poolSize);
    if (opts?.queueCapacity) c.setQueueCapacity(opts.queueCapacity);
    if (opts?.shutdownTimeoutMillis) c.setShutdownTimeoutMillis(opts.shutdownTimeoutMillis);
    return c;
}

function makeTaskRequest(taskType: string, registry: TaskTypeRegistry, uuid?: string) {
    const desc = registry.get(taskType)!;
    return {
        taskUuid: uuid ?? crypto.randomUUID(),
        taskType,
        registrationFingerprint: desc.fingerprint,
        inputData: Buffer.from(JSON.stringify({ a: 1, b: 2 })),
        executorName: 'test',
        submitterMemberUuid: 'member-1',
        timeoutMillis: 0,
    };
}

describe('CancellationOperation', () => {
    test('cancel known queued task returns true', async () => {
        const registry = makeRegistry(
            ['slow', async () => { await Bun.sleep(5000); return 'x'; }],
            ['add', (input: unknown) => { const { a, b } = input as { a: number; b: number }; return a + b; }],
        );
        const config = makeConfig({ poolSize: 1, queueCapacity: 5 });
        const container = new ExecutorContainerService('test', config, registry);

        // Fill pool with slow task
        const _slow = container.executeTask(makeTaskRequest('slow', registry));
        // Queue an add task
        const _queued = container.executeTask(makeTaskRequest('add', registry, 'queued-task-1'));

        const op = new CancellationOperation('test', 'queued-task-1');
        expect(op.cancelOn(container)).toBe(true);
    });

    test('cancel unknown task returns false', () => {
        const registry = makeRegistry(['add', (i: unknown) => i]);
        const config = makeConfig();
        const container = new ExecutorContainerService('test', config, registry);

        const op = new CancellationOperation('test', 'nonexistent-uuid');
        expect(op.cancelOn(container)).toBe(false);
    });

    test('cancel already-completed task returns false', async () => {
        const registry = makeRegistry(['add', (input: unknown) => {
            const { a, b } = input as { a: number; b: number };
            return a + b;
        }]);
        const config = makeConfig();
        const container = new ExecutorContainerService('test', config, registry);

        await container.executeTask(makeTaskRequest('add', registry, 'completed-task'));

        const op = new CancellationOperation('test', 'completed-task');
        expect(op.cancelOn(container)).toBe(false);
    });

    test('cancel running task returns true (logical cancel)', async () => {
        const registry = makeRegistry(['slow', async () => { await Bun.sleep(5000); return 'x'; }]);
        const config = makeConfig();
        const container = new ExecutorContainerService('test', config, registry);

        const _promise = container.executeTask(makeTaskRequest('slow', registry, 'running-task'));
        await Bun.sleep(5);

        const op = new CancellationOperation('test', 'running-task');
        expect(op.cancelOn(container)).toBe(true);
    });
});

describe('ShutdownOperation', () => {
    test('shutdown marks executor closed and rejects new work', async () => {
        const registry = makeRegistry(['add', (input: unknown) => {
            const { a, b } = input as { a: number; b: number };
            return a + b;
        }]);
        const config = makeConfig({ shutdownTimeoutMillis: 100 });
        const container = new ExecutorContainerService('test', config, registry);

        const op = new ShutdownOperation('test');
        await op.shutdownOn(container);

        expect(container.isShutdown()).toBe(true);

        const result = await container.executeTask(makeTaskRequest('add', registry));
        expect(result.status).toBe('rejected');
        expect(result.errorName).toBe('ExecutorRejectedExecutionException');
    });

    test('shutdown timeout triggers pool terminate fallback', async () => {
        const registry = makeRegistry(['forever', async () => { await Bun.sleep(999999); return 'x'; }]);
        const config = makeConfig({ shutdownTimeoutMillis: 50 });
        const container = new ExecutorContainerService('test', config, registry);

        const taskPromise = container.executeTask(makeTaskRequest('forever', registry, 'forever-task'));
        await Bun.sleep(5);

        const op = new ShutdownOperation('test');
        await op.shutdownOn(container);

        const result = await taskPromise;
        expect(result.status).toBe('rejected');
        expect(result.errorMessage).toContain('shutdown');
    });

    test('duplicate shutdown is idempotent', async () => {
        const registry = makeRegistry(['add', (i: unknown) => i]);
        const config = makeConfig({ shutdownTimeoutMillis: 50 });
        const container = new ExecutorContainerService('test', config, registry);

        await new ShutdownOperation('test').shutdownOn(container);
        expect(container.isShutdown()).toBe(true);

        await new ShutdownOperation('test').shutdownOn(container);
        expect(container.isShutdown()).toBe(true);
    });

    test('shutdown drains pending tasks within timeout', async () => {
        const registry = makeRegistry(['quick', async () => { await Bun.sleep(10); return 42; }]);
        const config = makeConfig({ shutdownTimeoutMillis: 2000 });
        const container = new ExecutorContainerService('test', config, registry);

        const taskPromise = container.executeTask(makeTaskRequest('quick', registry, 'draining-task'));

        const op = new ShutdownOperation('test');
        await op.shutdownOn(container);

        const result = await taskPromise;
        expect(result.status).toBe('success');
    });
});
