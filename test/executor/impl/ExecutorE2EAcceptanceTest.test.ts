/**
 * Block 17.INT — End-to-end rollout acceptance tests.
 *
 * Proves Phase 17 deliverable is rollout-ready within Tier 1's non-durable contract.
 * Covers: full lifecycle, burst throughput, bounded backpressure, cancellation (queued + running),
 * graceful shutdown with timeout, fingerprint mismatch, task timeout + pool recycling.
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { ExecutorConfig } from '@helios/config/ExecutorConfig.js';
import { ExecutorContainerService, TaskState } from '@helios/executor/impl/ExecutorContainerService.js';
import { TaskTypeRegistry } from '@helios/executor/impl/TaskTypeRegistry.js';
import { HeliosInstanceImpl } from '@helios/instance/impl/HeliosInstanceImpl.js';
import type { ExecutorOperationResult } from '@helios/executor/ExecutorOperationResult.js';

describe('Executor E2E Acceptance (Block 17.INT)', () => {

    const containers: ExecutorContainerService[] = [];

    afterEach(async () => {
        for (const c of containers) {
            if (!c.isShutdown()) await c.shutdown();
        }
        containers.length = 0;
    });

    function makeRegistry(): TaskTypeRegistry {
        return new TaskTypeRegistry();
    }

    function makeConfig(overrides?: Partial<{
        poolSize: number;
        queueCapacity: number;
        taskTimeoutMillis: number;
        shutdownTimeoutMillis: number;
        maxActiveTaskTypePools: number;
    }>): ExecutorConfig {
        const c = new ExecutorConfig('e2e');
        if (overrides?.poolSize) c.setPoolSize(overrides.poolSize);
        if (overrides?.queueCapacity) c.setQueueCapacity(overrides.queueCapacity);
        if (overrides?.taskTimeoutMillis !== undefined) c.setTaskTimeoutMillis(overrides.taskTimeoutMillis);
        if (overrides?.shutdownTimeoutMillis) c.setShutdownTimeoutMillis(overrides.shutdownTimeoutMillis);
        if (overrides?.maxActiveTaskTypePools) c.setMaxActiveTaskTypePools(overrides.maxActiveTaskTypePools);
        return c;
    }

    function makeContainer(config: ExecutorConfig, registry: TaskTypeRegistry): ExecutorContainerService {
        const c = new ExecutorContainerService('e2e', config, registry);
        containers.push(c);
        return c;
    }

    function taskRequest(taskType: string, input: unknown, fingerprint: string, opts?: { timeoutMillis?: number }): {
        taskUuid: string; taskType: string; registrationFingerprint: string;
        inputData: Buffer; executorName: string; submitterMemberUuid: string; timeoutMillis: number;
    } {
        return {
            taskUuid: crypto.randomUUID(),
            taskType,
            registrationFingerprint: fingerprint,
            inputData: Buffer.from(JSON.stringify(input)),
            executorName: 'e2e',
            submitterMemberUuid: 'member-1',
            timeoutMillis: opts?.timeoutMillis ?? 0,
        };
    }

    // ── 1. Full lifecycle: config → register → submit → execute → result ──

    test('full lifecycle: config → register → submit → execute → result', async () => {
        const registry = makeRegistry();
        const config = makeConfig({ poolSize: 2, queueCapacity: 10 });
        const container = makeContainer(config, registry);

        registry.register('double', (input: unknown) => (input as number) * 2);
        const desc = registry.get('double')!;

        const req = taskRequest('double', 21, desc.fingerprint);
        const result = await container.executeTask(req);

        expect(result.status).toBe('success');
        expect(result.taskUuid).toBe(req.taskUuid);
        expect(result.resultData).not.toBeNull();
        // Result is wrapped as HeapData; parse the JSON payload
        const buf = result.resultData!.toByteArray()!;
        // HeapData: 4 bytes partition hash + 4 bytes type id + 4 bytes json length + json
        const jsonLen = buf.readInt32BE(8);
        const json = buf.subarray(12, 12 + jsonLen).toString('utf8');
        expect(JSON.parse(json)).toBe(42);
    });

    // ── 2. Burst of tasks with all results correct ──

    test('burst of 100 tasks with all results correct', async () => {
        const registry = makeRegistry();
        const config = makeConfig({ poolSize: 16, queueCapacity: 200 });
        const container = makeContainer(config, registry);

        registry.register('square', (input: unknown) => (input as number) ** 2);
        const desc = registry.get('square')!;

        const promises: Promise<ExecutorOperationResult>[] = [];
        for (let i = 0; i < 100; i++) {
            promises.push(container.executeTask(taskRequest('square', i, desc.fingerprint)));
        }
        const results = await Promise.all(promises);

        for (let i = 0; i < 100; i++) {
            expect(results[i].status).toBe('success');
            const buf = results[i].resultData!.toByteArray()!;
            const jsonLen = buf.readInt32BE(8);
            const json = buf.subarray(12, 12 + jsonLen).toString('utf8');
            expect(JSON.parse(json)).toBe(i ** 2);
        }
    });

    // ── 3. Bounded queue / backpressure under overload ──

    test('bounded queue rejects when full — no silent growth', async () => {
        const registry = makeRegistry();
        const config = makeConfig({ poolSize: 1, queueCapacity: 2 });
        const container = makeContainer(config, registry);

        // Register a slow task to fill the pool
        let resolvers: Array<() => void> = [];
        registry.register('slow', (_input: unknown) =>
            new Promise<string>((resolve) => { resolvers.push(() => resolve('done')); }),
        );
        const desc = registry.get('slow')!;

        // Fill pool (1 active)
        const p1 = container.executeTask(taskRequest('slow', null, desc.fingerprint));

        // Fill queue (2 queued)
        const p2 = container.executeTask(taskRequest('slow', null, desc.fingerprint));
        const p3 = container.executeTask(taskRequest('slow', null, desc.fingerprint));

        // Next should be rejected
        const rejected = await container.executeTask(taskRequest('slow', null, desc.fingerprint));
        expect(rejected.status).toBe('rejected');
        expect(rejected.errorName).toBe('ExecutorRejectedExecutionException');
        expect(rejected.errorMessage).toContain('Queue full');

        // Cleanup: resolve running task, which drains queue
        resolvers[0]();
        await p1;
        // p2 now starts running — wait a tick then resolve
        await Bun.sleep(10);
        if (resolvers.length > 1) resolvers[1]();
        await p2;
        await Bun.sleep(10);
        if (resolvers.length > 2) resolvers[2]();
        await p3;
    });

    // ── 4. Cancel queued task returns cancellation and task never starts ──

    test('cancel queued task — task never starts', async () => {
        const registry = makeRegistry();
        const config = makeConfig({ poolSize: 1, queueCapacity: 10 });
        const container = makeContainer(config, registry);

        let runCount = 0;
        let resolvers: Array<() => void> = [];
        registry.register('track', (_input: unknown) =>
            new Promise<string>((resolve) => {
                runCount++;
                resolvers.push(() => resolve('ran'));
            }),
        );
        const desc = registry.get('track')!;

        // Fill pool
        const p1 = container.executeTask(taskRequest('track', null, desc.fingerprint));

        // Queue a task
        const req2 = taskRequest('track', null, desc.fingerprint);
        const p2 = container.executeTask(req2);

        // Cancel the queued task
        const cancelled = container.cancelTask(req2.taskUuid);
        expect(cancelled).toBe(true);

        // Resolve the first task
        resolvers[0]();
        const r1 = await p1;
        expect(r1.status).toBe('success');

        // The cancelled task's promise should resolve with cancelled status
        const r2 = await p2;
        expect(r2.status).toBe('cancelled');

        // Only 1 task should have actually run (the first one)
        expect(runCount).toBe(1);
    });

    // ── 5. Cancel running task — late result is dropped ──

    test('cancel running task — late result is dropped', async () => {
        const registry = makeRegistry();
        const config = makeConfig({ poolSize: 2, queueCapacity: 10 });
        const container = makeContainer(config, registry);

        let taskResolve: ((v: string) => void) | null = null;
        registry.register('cancellable', (_input: unknown) =>
            new Promise<string>((resolve) => { taskResolve = resolve; }),
        );
        const desc = registry.get('cancellable')!;

        const req = taskRequest('cancellable', null, desc.fingerprint);
        const promise = container.executeTask(req);

        // Wait for task to start running
        await Bun.sleep(10);
        expect(container.getTaskState(req.taskUuid)).toBe(TaskState.RUNNING);

        // Cancel while running
        const cancelled = container.cancelTask(req.taskUuid);
        expect(cancelled).toBe(true);

        const result = await promise;
        expect(result.status).toBe('cancelled');

        // Now resolve the original promise — this becomes a late result
        taskResolve!('late-value');
        await Bun.sleep(10);

        // The late result should be dropped (reflected in stats)
        const stats = container.getStats();
        expect(stats.lateResultsDropped).toBeGreaterThanOrEqual(1);
    });

    // ── 6. Graceful shutdown drains healthy tasks, respects timeout for stuck work ──

    test('graceful shutdown drains healthy tasks and respects timeout', async () => {
        const registry = makeRegistry();
        const config = makeConfig({ poolSize: 2, queueCapacity: 10, shutdownTimeoutMillis: 200 });
        const container = makeContainer(config, registry);

        const results: string[] = [];
        registry.register('quick', (_input: unknown) => {
            results.push('completed');
            return 'ok';
        });
        // A stuck task that never resolves
        registry.register('stuck', (_input: unknown) =>
            new Promise<string>(() => { /* never resolves */ }),
        );

        const quickDesc = registry.get('quick')!;
        const stuckDesc = registry.get('stuck')!;

        // Submit quick task
        const quickPromise = container.executeTask(taskRequest('quick', null, quickDesc.fingerprint));
        // Submit stuck task
        const stuckPromise = container.executeTask(taskRequest('stuck', null, stuckDesc.fingerprint));

        // Quick should complete
        const quickResult = await quickPromise;
        expect(quickResult.status).toBe('success');

        // Shutdown — should timeout waiting for stuck task
        const shutdownStart = Date.now();
        await container.shutdown();
        const elapsed = Date.now() - shutdownStart;

        // Shutdown should take approximately the timeout duration
        expect(elapsed).toBeGreaterThanOrEqual(100); // At least some of the timeout
        expect(container.isShutdown()).toBe(true);

        // Stuck task should have been rejected on shutdown
        const stuckResult = await stuckPromise;
        expect(stuckResult.status).toBe('rejected');
        expect(stuckResult.errorMessage).toContain('shutdown');
    });

    // ── 7. Fingerprint mismatch fails fast ──

    test('fingerprint mismatch between registrations fails fast', async () => {
        const registry = makeRegistry();
        const config = makeConfig();
        const container = makeContainer(config, registry);

        registry.register('compute', (input: unknown) => (input as number) + 1);

        // Submit with a wrong fingerprint
        const req = taskRequest('compute', 10, 'wrong-fingerprint-abc');
        const result = await container.executeTask(req);

        expect(result.status).toBe('rejected');
        expect(result.errorName).toBe('TaskRegistrationMismatchException');
        expect(result.errorMessage).toContain('mismatch');
    });

    // ── 8. Task timeout recycles pool and restores capacity ──

    test('task timeout recycles pool and restores capacity', async () => {
        const registry = makeRegistry();
        const config = makeConfig({ poolSize: 1, queueCapacity: 10, taskTimeoutMillis: 100 });
        const container = makeContainer(config, registry);

        registry.register('hang', (_input: unknown) =>
            new Promise<string>(() => { /* never resolves */ }),
        );
        const desc = registry.get('hang')!;

        // Submit a task that will timeout
        const req = taskRequest('hang', null, desc.fingerprint, { timeoutMillis: 100 });
        const result = await container.executeTask(req);

        expect(result.status).toBe('timeout');
        expect(result.errorName).toBe('ExecutorTaskTimeoutException');

        // Pool capacity should be restored — submit another quick task
        registry.register('quick', (_input: unknown) => 'fast-result');
        const quickDesc = registry.get('quick')!;
        const quickResult = await container.executeTask(taskRequest('quick', null, quickDesc.fingerprint));
        expect(quickResult.status).toBe('success');
    });

    // ── 9. HeliosInstance-level full round-trip ──

    test('HeliosInstance getExecutorService → submitLocal → result round-trip', async () => {
        const inst = new HeliosInstanceImpl();
        try {
            const exec = inst.getExecutorService('e2e-test');
            expect(exec).toBeDefined();

            // Register and submit inline
            const future = exec.submitLocal({
                taskType: '__inline__',
                input: 5,
                fn: (input: unknown) => (input as number) * 10,
            });
            const result = await future.get();
            expect(result).toBe(50);
        } finally {
            inst.shutdown();
        }
    });

    // ── 10. Executor shutdown rejects new submissions ──

    test('executor rejects submissions after shutdown', async () => {
        const registry = makeRegistry();
        const config = makeConfig();
        const container = makeContainer(config, registry);

        registry.register('noop', () => null);
        const desc = registry.get('noop')!;

        await container.shutdown();

        const result = await container.executeTask(taskRequest('noop', null, desc.fingerprint));
        expect(result.status).toBe('rejected');
        expect(result.errorMessage).toContain('shut down');
    });

    // ── 11. Stats are accurate after mixed workload ──

    test('stats reflect accurate counts after mixed workload', async () => {
        const registry = makeRegistry();
        const config = makeConfig({ poolSize: 2, queueCapacity: 5, taskTimeoutMillis: 50 });
        const container = makeContainer(config, registry);

        registry.register('ok', (input: unknown) => input);
        registry.register('fail', () => { throw new Error('boom'); });

        const okDesc = registry.get('ok')!;
        const failDesc = registry.get('fail')!;

        // 3 successful tasks
        await container.executeTask(taskRequest('ok', 1, okDesc.fingerprint));
        await container.executeTask(taskRequest('ok', 2, okDesc.fingerprint));
        await container.executeTask(taskRequest('ok', 3, okDesc.fingerprint));

        // 1 failing task
        await container.executeTask(taskRequest('fail', null, failDesc.fingerprint));

        // 1 rejected (wrong fingerprint)
        await container.executeTask(taskRequest('ok', null, 'bad'));

        const stats = container.getStats();
        expect(stats.completed).toBe(3);
        // 1 fingerprint mismatch is rejected pre-execution; the throwing task is started+completed (error envelope)
        expect(stats.rejected).toBeGreaterThanOrEqual(1);
        expect(stats.started).toBeGreaterThanOrEqual(4);
    });

    // ── 12. Multiple task types coexist with independent pools ──

    test('multiple task types coexist with independent pools', async () => {
        const registry = makeRegistry();
        const config = makeConfig({ poolSize: 2, queueCapacity: 10 });
        const container = makeContainer(config, registry);

        registry.register('add', (input: unknown) => (input as number) + 1);
        registry.register('mul', (input: unknown) => (input as number) * 2);

        const addDesc = registry.get('add')!;
        const mulDesc = registry.get('mul')!;

        const [addResult, mulResult] = await Promise.all([
            container.executeTask(taskRequest('add', 5, addDesc.fingerprint)),
            container.executeTask(taskRequest('mul', 5, mulDesc.fingerprint)),
        ]);

        expect(addResult.status).toBe('success');
        expect(mulResult.status).toBe('success');
        expect(container.getActivePoolCount()).toBe(2);
    });
});
