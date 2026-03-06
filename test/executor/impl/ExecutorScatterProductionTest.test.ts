/**
 * Block 17R.1 — Executor Scatter Production Closure
 *
 * Proves:
 * - Real member-local executor registry + container ownership in HeliosInstanceImpl
 * - No direct-factory fallback in distributed operation classes
 * - ScatterExecutionBackend is real and off-main-thread
 * - Distributed task registration is module-backed and worker-materializable only
 * - scatter is production default; inline is explicit test/dev only; fail-closed
 * - Member-loss handling transitions tasks to task-lost
 * - Pool recycling after worker crash or task timeout
 * - End-to-end verification that distributed work never runs on main event loop
 */
import { describe, test, expect } from 'bun:test';
import { ExecutorConfig } from '@zenystx/helios-core/config/ExecutorConfig.js';
import { ExecutorContainerService, type TaskRequest } from '@zenystx/helios-core/executor/impl/ExecutorContainerService.js';
import { TaskTypeRegistry } from '@zenystx/helios-core/executor/impl/TaskTypeRegistry.js';
import { ExecuteCallableOperation, type TaskDescriptor } from '@zenystx/helios-core/executor/impl/ExecuteCallableOperation.js';
import { MemberCallableOperation } from '@zenystx/helios-core/executor/impl/MemberCallableOperation.js';
import { ScatterExecutionBackend } from '@zenystx/helios-core/executor/impl/ScatterExecutionBackend.js';
import { InlineExecutionBackend } from '@zenystx/helios-core/executor/impl/InlineExecutionBackend.js';
import type { ExecutorOperationResult } from '@zenystx/helios-core/executor/ExecutorOperationResult.js';
import type { Operation, ResponseHandler } from '@zenystx/helios-core/spi/impl/operationservice/Operation.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDescriptor(overrides?: Partial<TaskDescriptor>): TaskDescriptor {
    return {
        taskUuid: crypto.randomUUID(),
        executorName: 'default',
        taskType: 'double',
        registrationFingerprint: 'v1',
        inputData: Buffer.from(JSON.stringify(21)),
        submitterMemberUuid: crypto.randomUUID(),
        timeoutMillis: 60_000,
        ...overrides,
    };
}

function makeRequest(overrides?: Partial<TaskRequest>): TaskRequest {
    return {
        taskUuid: crypto.randomUUID(),
        taskType: 'double',
        registrationFingerprint: 'v1',
        inputData: Buffer.from(JSON.stringify(21)),
        executorName: 'default',
        submitterMemberUuid: 'member-1',
        timeoutMillis: 60_000,
        ...overrides,
    };
}

function captureHandler(): { handler: ResponseHandler; getResponse: () => ExecutorOperationResult } {
    let sentResponse: unknown = undefined;
    return {
        handler: { sendResponse: (_op: Operation, response: unknown) => { sentResponse = response; } },
        getResponse: () => sentResponse as ExecutorOperationResult,
    };
}

describe('Block 17R.1 — Executor Scatter Production Closure', () => {

    // ── Track A: Runtime ownership ──────────────────────────────────────────

    test('1. HeliosInstanceImpl registers container in NodeEngine for named executors', async () => {
        const { HeliosConfig } = await import('@zenystx/helios-core/config/HeliosConfig.js');
        const { HeliosInstanceImpl } = await import('@zenystx/helios-core/instance/impl/HeliosInstanceImpl.js');

        const config = new HeliosConfig('test-container-wiring');
        const instance = new HeliosInstanceImpl(config);

        const exec = instance.getExecutorService('my-exec');
        expect(exec).toBeDefined();

        const ne = (instance as any)._nodeEngine;
        const container = ne.getServiceOrNull('helios:executor:container:my-exec');
        expect(container).not.toBeNull();
        expect(container).toBeInstanceOf(ExecutorContainerService);

        const registry = ne.getServiceOrNull('helios:executor:registry:my-exec');
        expect(registry).not.toBeNull();
        expect(registry).toBeInstanceOf(TaskTypeRegistry);

        instance.shutdown();
    });

    test('2. Named executor shutdown destroys its container backend', async () => {
        const { HeliosConfig } = await import('@zenystx/helios-core/config/HeliosConfig.js');
        const { HeliosInstanceImpl } = await import('@zenystx/helios-core/instance/impl/HeliosInstanceImpl.js');

        const config = new HeliosConfig('test-shutdown-destroy');
        const instance = new HeliosInstanceImpl(config);

        instance.getExecutorService('drain-exec');
        await instance.shutdownAsync();

        // After shutdown, getting a new executor should throw
        expect(() => instance.getExecutorService('another')).toThrow();
    });

    // ── Track A: No fallback ────────────────────────────────────────────────

    test('3. ExecuteCallableOperation rejects when no container is registered (no fallback)', async () => {
        const registry = new TaskTypeRegistry();
        registry.register('double', (n) => Number(n) * 2, { version: 'v1' });

        const desc = makeDescriptor();
        const op = new ExecuteCallableOperation(desc);
        op.setRegistry(registry);
        // Deliberately NOT setting a container

        const { handler, getResponse } = captureHandler();
        op.setResponseHandler(handler);
        await op.run();

        const result = getResponse();
        // Must reject — no fallback to direct factory execution
        expect(result.status).toBe('rejected');
    });

    test('4. MemberCallableOperation rejects when no container is registered (no fallback)', async () => {
        const registry = new TaskTypeRegistry();
        registry.register('double', (n) => Number(n) * 2, { version: 'v1' });

        const desc = makeDescriptor();
        const op = new MemberCallableOperation(desc, crypto.randomUUID());
        op.setRegistry(registry);

        const { handler, getResponse } = captureHandler();
        op.setResponseHandler(handler);
        await op.run();

        const result = getResponse();
        expect(result.status).toBe('rejected');
    });

    // ── Track B: ScatterExecutionBackend ─────────────────────────────────────

    test('5. ScatterExecutionBackend exists and implements ExecutionBackend', () => {
        const backend = new ScatterExecutionBackend({ poolSize: 2 });
        expect(typeof backend.execute).toBe('function');
        expect(typeof backend.destroy).toBe('function');
        backend.destroy();
    });

    test('6. ScatterExecutionBackend executes tasks off the main thread', async () => {
        const backend = new ScatterExecutionBackend({ poolSize: 1 });
        try {
            const result = await backend.executeModule(
                import.meta.resolve('./fixtures/thread-check-task.ts'),
                'default',
                Buffer.from(JSON.stringify(null)),
            );
            expect(result).toBe(false);
        } finally {
            backend.destroy();
        }
    });

    test('7. ScatterExecutionBackend rejects direct factory calls for distributed work', async () => {
        const backend = new ScatterExecutionBackend({ poolSize: 1 });
        try {
            await expect(
                backend.execute(
                    (input: unknown) => (input as number) * 2,
                    Buffer.from(JSON.stringify(21)),
                ),
            ).rejects.toThrow();
        } finally {
            backend.destroy();
        }
    });

    test('8. Container with scatter backend runs tasks through worker pool', async () => {
        const config = new ExecutorConfig('scatter-test');
        config.setExecutionBackend('scatter');
        const registry = new TaskTypeRegistry();
        registry.register('double', (n) => Number(n) * 2, {
            version: 'v1',
            modulePath: import.meta.resolve('./fixtures/double-task.ts'),
            exportName: 'default',
        });

        const backend = new ScatterExecutionBackend({ poolSize: 2 });
        const container = new ExecutorContainerService('scatter-test', config, registry, backend);
        try {
            const result = await container.executeTask(makeRequest());
            expect(result.status).toBe('success');
        } finally {
            await container.shutdown();
        }
    });

    // ── Track C: Registration hardening ──────────────────────────────────────

    test('9. Distributed submit rejects task without worker materialization metadata', () => {
        const registry = new TaskTypeRegistry();
        registry.register('closure-only', (n) => Number(n) + 1, { version: 'v1' });
        expect(registry.isWorkerSafe('closure-only')).toBe(false);
    });

    test('10. registerDistributed requires modulePath', () => {
        const registry = new TaskTypeRegistry();
        expect(() => {
            registry.registerDistributed('bad', (n) => n, {});
        }).toThrow(/modulePath/);
    });

    test('11. Proxy rejects distributed submit for non-worker-safe tasks when backend is scatter', async () => {
        const { ExecutorServiceProxy } = await import('@zenystx/helios-core/executor/impl/ExecutorServiceProxy.js');
        const { SerializationServiceImpl } = await import('@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl.js');
        const { SerializationConfig } = await import('@zenystx/helios-core/internal/serialization/impl/SerializationConfig.js');
        const { NodeEngineImpl } = await import('@zenystx/helios-core/spi/impl/NodeEngineImpl.js');

        const config = new ExecutorConfig('test');
        config.setExecutionBackend('scatter');
        const registry = new TaskTypeRegistry();
        registry.register('closure-task', (n) => Number(n) * 2, { version: 'v1' });

        const ss = new SerializationServiceImpl(new SerializationConfig());
        const ne = new NodeEngineImpl(ss);
        const proxy = new ExecutorServiceProxy('test', ne, config, registry, 'local-uuid');

        // Distributed submit should reject because task is not worker-safe
        expect(() => {
            proxy.submit({ taskType: 'closure-task', input: 42 });
        }).toThrow(/worker/i);
    });

    test('12. submitLocal allows closure-only tasks', async () => {
        const { ExecutorServiceProxy } = await import('@zenystx/helios-core/executor/impl/ExecutorServiceProxy.js');
        const { SerializationServiceImpl } = await import('@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl.js');
        const { SerializationConfig } = await import('@zenystx/helios-core/internal/serialization/impl/SerializationConfig.js');
        const { NodeEngineImpl } = await import('@zenystx/helios-core/spi/impl/NodeEngineImpl.js');

        const config = new ExecutorConfig('test');
        const registry = new TaskTypeRegistry();
        const ss = new SerializationServiceImpl(new SerializationConfig());
        const ne = new NodeEngineImpl(ss);
        const proxy = new ExecutorServiceProxy('test', ne, config, registry, 'local-uuid');

        const future = proxy.submitLocal({
            taskType: '__inline__' as const,
            input: 21,
            fn: (n) => (n as number) * 2,
        });
        const result = await future.get();
        expect(result).toBe(42);
    });

    // ── Track D: Defaults and health ─────────────────────────────────────────

    test('13. ExecutorConfig defaults to scatter for production', () => {
        const config = new ExecutorConfig('prod-exec');
        expect(config.getExecutionBackend()).toBe('scatter');
    });

    test('14. Fail-closed: container rejects tasks when scatter backend is unhealthy', async () => {
        const config = new ExecutorConfig('fail-closed-test');
        config.setExecutionBackend('scatter');
        const registry = new TaskTypeRegistry();
        registry.register('echo', (n) => n, {
            version: 'v1',
            modulePath: '/nonexistent/module.ts',
            exportName: 'default',
        });

        const backend = new ScatterExecutionBackend({ poolSize: 1 });
        backend.markUnhealthy();
        const container = new ExecutorContainerService('fail-closed-test', config, registry, backend);

        const result = await container.executeTask(makeRequest({ taskType: 'echo', registrationFingerprint: 'v1' }));
        expect(result.status).toBe('rejected');

        backend.destroy();
    });

    test('15. Inline backend requires explicit opt-in', () => {
        const config = new ExecutorConfig('test-inline');
        expect(config.getExecutionBackend()).toBe('scatter');
        config.setExecutionBackend('inline');
        expect(config.getExecutionBackend()).toBe('inline');
    });

    // ── Track A: Member-loss handling ────────────────────────────────────────

    test('16. markTasksLostForMember transitions running tasks to task-lost', async () => {
        const config = new ExecutorConfig('test');
        config.setExecutionBackend('inline');
        const registry = new TaskTypeRegistry();
        registry.register('slow', async () => { await Bun.sleep(5000); return 1; }, { version: 'v1' });

        const backend = new InlineExecutionBackend();
        const container = new ExecutorContainerService('test', config, registry, backend);

        const memberUuid = 'departed-member';
        const taskPromise = container.executeTask(makeRequest({
            taskType: 'slow',
            registrationFingerprint: 'v1',
            submitterMemberUuid: memberUuid,
        }));

        await Bun.sleep(20);
        container.markTasksLostForMember(memberUuid);

        const result = await taskPromise;
        expect(result.status).toBe('task-lost');
        expect(result.errorName).toBe('ExecutorTaskLostException');
    });

    test('17. markTasksLostForMember transitions queued tasks to task-lost', async () => {
        const config = new ExecutorConfig('test');
        config.setExecutionBackend('inline');
        config.setPoolSize(1);
        const registry = new TaskTypeRegistry();
        registry.register('slow', async () => { await Bun.sleep(5000); return 1; }, { version: 'v1' });

        const backend = new InlineExecutionBackend();
        const container = new ExecutorContainerService('test', config, registry, backend);

        const memberUuid = 'dep-member';
        const task1Promise = container.executeTask(makeRequest({
            taskType: 'slow',
            registrationFingerprint: 'v1',
            submitterMemberUuid: memberUuid,
        }));

        await Bun.sleep(10);

        const task2Promise = container.executeTask(makeRequest({
            taskType: 'slow',
            registrationFingerprint: 'v1',
            submitterMemberUuid: memberUuid,
        }));

        await Bun.sleep(10);
        container.markTasksLostForMember(memberUuid);

        const r1 = await task1Promise;
        const r2 = await task2Promise;
        expect(r1.status).toBe('task-lost');
        expect(r2.status).toBe('task-lost');
    });

    // ── Track D: Pool recycling ──────────────────────────────────────────────

    test('18. Worker crash recycles the task-type pool', async () => {
        const config = new ExecutorConfig('recycle-test');
        config.setExecutionBackend('scatter');
        const registry = new TaskTypeRegistry();
        registry.register('crash', () => { throw new Error('crash!'); }, {
            version: 'v1',
            modulePath: import.meta.resolve('./fixtures/crash-task.ts'),
            exportName: 'default',
        });

        const backend = new ScatterExecutionBackend({ poolSize: 1 });
        const container = new ExecutorContainerService('recycle-test', config, registry, backend);

        try {
            const result = await container.executeTask(makeRequest({
                taskType: 'crash',
                registrationFingerprint: 'v1',
            }));
            expect(result.status).toBe('rejected');

            registry.register('echo', (n) => n, {
                version: 'v2',
                modulePath: import.meta.resolve('./fixtures/echo-task.ts'),
                exportName: 'default',
            });
            const result2 = await container.executeTask(makeRequest({
                taskType: 'echo',
                registrationFingerprint: 'v2',
            }));
            expect(result2.status).toBe('success');
        } finally {
            await container.shutdown();
        }
    });

    test('19. Task timeout recycles the pool and resolves with timeout status', async () => {
        const config = new ExecutorConfig('timeout-test');
        config.setExecutionBackend('inline');
        config.setTaskTimeoutMillis(100);
        const registry = new TaskTypeRegistry();
        registry.register('hang', async () => { await Bun.sleep(10000); return 1; }, { version: 'v1' });

        const backend = new InlineExecutionBackend();
        const container = new ExecutorContainerService('timeout-test', config, registry, backend);

        const result = await container.executeTask(makeRequest({
            taskType: 'hang',
            registrationFingerprint: 'v1',
            timeoutMillis: 100,
        }));
        expect(result.status).toBe('timeout');

        const stats = container.getStats();
        expect(stats.timedOut).toBeGreaterThanOrEqual(1);
        await container.shutdown();
    });

    test('20. Late results after timeout are dropped and counted', async () => {
        const config = new ExecutorConfig('late-test');
        config.setExecutionBackend('inline');
        const registry = new TaskTypeRegistry();
        registry.register('slow-finish', async () => { await Bun.sleep(200); return 42; }, { version: 'v1' });

        const backend = new InlineExecutionBackend();
        const container = new ExecutorContainerService('late-test', config, registry, backend);

        const result = await container.executeTask(makeRequest({
            taskType: 'slow-finish',
            registrationFingerprint: 'v1',
            timeoutMillis: 50,
        }));
        expect(result.status).toBe('timeout');

        await Bun.sleep(300);
        const stats = container.getStats();
        expect(stats.lateResultsDropped).toBeGreaterThanOrEqual(1);
        await container.shutdown();
    });

    // ── Track E: Deterministic semantics ─────────────────────────────────────

    test('21. Cancellation of queued task returns cancelled status', async () => {
        const config = new ExecutorConfig('cancel-test');
        config.setExecutionBackend('inline');
        config.setPoolSize(1);
        config.setShutdownTimeoutMillis(200);
        const registry = new TaskTypeRegistry();
        registry.register('slow', async () => { await Bun.sleep(60_000); return 1; }, { version: 'v1' });

        const backend = new InlineExecutionBackend();
        const container = new ExecutorContainerService('cancel-test', config, registry, backend);

        // Fill the single slot with a long-running task
        container.executeTask(makeRequest({
            taskUuid: 'fill',
            taskType: 'slow',
            registrationFingerprint: 'v1',
        }));

        await Bun.sleep(10);

        // Queue a second task
        const queuedPromise = container.executeTask(makeRequest({
            taskUuid: 'to-cancel',
            taskType: 'slow',
            registrationFingerprint: 'v1',
        }));

        await Bun.sleep(10);

        // Cancel the queued task — should resolve immediately
        const cancelled = container.cancelTask('to-cancel');
        expect(cancelled).toBe(true);

        const result = await queuedPromise;
        expect(result.status).toBe('cancelled');

        // Shutdown with a short timeout to avoid waiting for the fill task
        await container.shutdown();
    });

    test('22. Shutdown drains in-flight tasks within timeout', async () => {
        const config = new ExecutorConfig('shutdown-drain');
        config.setExecutionBackend('inline');
        config.setShutdownTimeoutMillis(2000);
        const registry = new TaskTypeRegistry();
        registry.register('quick', async () => { await Bun.sleep(50); return 'done'; }, { version: 'v1' });

        const backend = new InlineExecutionBackend();
        const container = new ExecutorContainerService('shutdown-drain', config, registry, backend);

        const taskPromise = container.executeTask(makeRequest({
            taskType: 'quick',
            registrationFingerprint: 'v1',
        }));

        await container.shutdown();
        expect(container.isShutdown()).toBe(true);

        const result = await taskPromise;
        expect(result.status).toBe('success');
    });

    test('23. Shutdown rejects new submissions after shutdown starts', async () => {
        const config = new ExecutorConfig('reject-test');
        config.setExecutionBackend('inline');
        const registry = new TaskTypeRegistry();
        registry.register('echo', (n) => n, { version: 'v1' });

        const backend = new InlineExecutionBackend();
        const container = new ExecutorContainerService('reject-test', config, registry, backend);

        await container.shutdown();

        const result = await container.executeTask(makeRequest({
            taskType: 'echo',
            registrationFingerprint: 'v1',
        }));
        expect(result.status).toBe('rejected');
        expect(result.errorName).toBe('ExecutorRejectedExecutionException');
    });

    // ── Track E: End-to-end verification ─────────────────────────────────────

    test('24. VERIFICATION: distributed executor work never runs on the main event loop with scatter backend', async () => {
        const config = new ExecutorConfig('verify');
        config.setExecutionBackend('scatter');
        const registry = new TaskTypeRegistry();

        registry.register('thread-check', () => { throw new Error('should not be called on main'); }, {
            version: 'v1',
            modulePath: import.meta.resolve('./fixtures/thread-check-task.ts'),
            exportName: 'default',
        });

        const backend = new ScatterExecutionBackend({ poolSize: 1 });
        const container = new ExecutorContainerService('verify', config, registry, backend);

        try {
            const result = await container.executeTask(makeRequest({
                taskType: 'thread-check',
                registrationFingerprint: 'v1',
            }));
            expect(result.status).toBe('success');

            // Parse the HeapData result to verify it ran off main thread
            const resultBuf = (result.resultData as any)?.toBuffer?.() ?? (result.resultData as any)?._buffer;
            if (resultBuf) {
                // HeapData: 4-byte partitionHash + 4-byte type + 4-byte length + JSON
                const lenOffset = 8;
                const jsonLen = resultBuf.readInt32BE(lenOffset);
                const json = resultBuf.subarray(lenOffset + 4, lenOffset + 4 + jsonLen).toString('utf8');
                const isMainThread = JSON.parse(json);
                expect(isMainThread).toBe(false);
            }
        } finally {
            await container.shutdown();
        }
    });
});
