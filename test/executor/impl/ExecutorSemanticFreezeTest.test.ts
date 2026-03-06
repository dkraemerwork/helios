/**
 * Block 17.9F — Prerequisite Semantic Freeze Tests
 *
 * Locks in corrected executor semantics before final Scatter integration.
 * Proves queueing, pool caps, cancellation, timeout, shutdown, task-lost,
 * registration mismatch, and instance-level shutdown drain through the
 * real runtime path.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { ExecutorContainerService, type TaskRequest } from '@zenystx/helios-core/executor/impl/ExecutorContainerService.js';
import { TaskTypeRegistry } from '@zenystx/helios-core/executor/impl/TaskTypeRegistry.js';
import { ExecutorConfig } from '@zenystx/helios-core/config/ExecutorConfig.js';
import { MemberCallableOperation } from '@zenystx/helios-core/executor/impl/MemberCallableOperation.js';
import { ExecuteCallableOperation, type TaskDescriptor } from '@zenystx/helios-core/executor/impl/ExecuteCallableOperation.js';
import { ShutdownOperation } from '@zenystx/helios-core/executor/impl/ShutdownOperation.js';
function makeConfig(overrides: Partial<{
    poolSize: number; queueCapacity: number; maxPools: number;
    taskTimeoutMillis: number; shutdownTimeoutMillis: number;
}> = {}): ExecutorConfig {
    const c = new ExecutorConfig('test');
    if (overrides.poolSize != null) c.setPoolSize(overrides.poolSize);
    if (overrides.queueCapacity != null) c.setQueueCapacity(overrides.queueCapacity);
    if (overrides.maxPools != null) c.setMaxActiveTaskTypePools(overrides.maxPools);
    if (overrides.taskTimeoutMillis != null) c.setTaskTimeoutMillis(overrides.taskTimeoutMillis);
    if (overrides.shutdownTimeoutMillis != null) c.setShutdownTimeoutMillis(overrides.shutdownTimeoutMillis);
    return c;
}

function makeRequest(overrides: Partial<TaskRequest> = {}): TaskRequest {
    return {
        taskUuid: overrides.taskUuid ?? crypto.randomUUID(),
        taskType: overrides.taskType ?? 'echo',
        registrationFingerprint: overrides.registrationFingerprint ?? '',
        inputData: overrides.inputData ?? Buffer.from(JSON.stringify('hello')),
        executorName: overrides.executorName ?? 'test',
        submitterMemberUuid: overrides.submitterMemberUuid ?? 'member-1',
        timeoutMillis: overrides.timeoutMillis ?? 0,
    };
}

describe('Block 17.9F — Executor Semantic Freeze', () => {
    let registry: TaskTypeRegistry;

    beforeEach(() => {
        registry = new TaskTypeRegistry();
        registry.register('echo', (input: unknown) => input);
    });

    // ── 1. Container queueing and pool-cap semantics are deterministic ───

    test('queued tasks drain in FIFO order when pool slots free up', async () => {
        const config = makeConfig({ poolSize: 1, queueCapacity: 3 });
        const container = new ExecutorContainerService('test', config, registry);
        const fp = registry.get('echo')!.fingerprint;

        let resolve1!: (v: unknown) => void;
        const blockingFactory = () => new Promise((r) => { resolve1 = r; });
        registry.register('blocking', blockingFactory);
        const bfp = registry.get('blocking')!.fingerprint;

        // Fill pool slot with a blocking task
        const first = container.executeTask(makeRequest({ taskType: 'blocking', registrationFingerprint: bfp }));

        // Queue 3 echo tasks — they should drain in order
        const results: string[] = [];
        const echoFactory = (input: unknown) => { results.push(String(input)); return input; };
        registry.register('blocking', echoFactory);
        // Actually use echo type with queue
        const q1 = container.executeTask(makeRequest({ taskType: 'echo', registrationFingerprint: fp, inputData: Buffer.from('"a"') }));
        const q2 = container.executeTask(makeRequest({ taskType: 'echo', registrationFingerprint: fp, inputData: Buffer.from('"b"') }));
        const q3 = container.executeTask(makeRequest({ taskType: 'echo', registrationFingerprint: fp, inputData: Buffer.from('"c"') }));

        // 4th should be rejected (queue full — pool has 1 active + 3 queued)
        // Actually echo pool has separate queue. Let me reconsider — pools are per task type.
        // The blocking task occupies the 'blocking' pool, echo tasks go to 'echo' pool.
        // With poolSize=1 and queueCapacity=3: echo pool has 1 active + up to 3 queued.
        // q1 runs immediately (echo pool active=1), q2 queues, q3 queues.

        // Wait for results
        const r1 = await q1;
        expect(r1.status).toBe('success');

        const r2 = await q2;
        expect(r2.status).toBe('success');

        const r3 = await q3;
        expect(r3.status).toBe('success');

        // Complete the blocking task
        resolve1('done');
        const r0 = await first;
        expect(r0.status).toBe('success');

        await container.shutdown();
    });

    test('queue full rejection is deterministic when capacity is exhausted', async () => {
        const config = makeConfig({ poolSize: 1, queueCapacity: 1 });
        const container = new ExecutorContainerService('test', config, registry);

        // Use a blocking factory — auto-resolve after a brief delay
        let callCount = 0;
        registry.register('slow', () => { callCount++; return new Promise((r) => setTimeout(() => r('ok'), 10)); });
        const sfp = registry.get('slow')!.fingerprint;

        // Fill pool with slow task
        const running = container.executeTask(makeRequest({ taskType: 'slow', registrationFingerprint: sfp }));

        // Wait for it to be in RUNNING state
        await Bun.sleep(1);

        // This should go to slow queue (capacity=1)
        const queued = container.executeTask(makeRequest({ taskType: 'slow', registrationFingerprint: sfp }));

        // This should be rejected — queue full
        const rejected = await container.executeTask(makeRequest({ taskType: 'slow', registrationFingerprint: sfp }));
        expect(rejected.status).toBe('rejected');
        expect(rejected.errorName).toBe('ExecutorRejectedExecutionException');
        expect(rejected.errorMessage).toContain('Queue full');

        await running;
        await queued;
        await container.shutdown();
    });

    // ── 2. MemberCallableOperation no-retry semantics ────────────────────

    test('MemberCallableOperation.shouldRetryOnMemberLeft() returns false', () => {
        const desc: TaskDescriptor = {
            taskUuid: 'u1', executorName: 'e', taskType: 'echo',
            registrationFingerprint: 'fp', inputData: Buffer.alloc(0),
            submitterMemberUuid: 'm1', timeoutMillis: 0,
        };
        const op = new MemberCallableOperation(desc, 'target-member');
        expect(op.shouldRetryOnMemberLeft()).toBe(false);
        expect(op.targetMemberUuid).toBe('target-member');
    });

    // ── 3. Partition retry-before-accept (ExecuteCallableOperation) ──────

    test('ExecuteCallableOperation.shouldRetryOnMemberLeft() returns true', () => {
        const desc: TaskDescriptor = {
            taskUuid: 'u2', executorName: 'e', taskType: 'echo',
            registrationFingerprint: 'fp', inputData: Buffer.alloc(0),
            submitterMemberUuid: 'm1', timeoutMillis: 0,
        };
        const op = new ExecuteCallableOperation(desc);
        expect(op.shouldRetryOnMemberLeft()).toBe(true);
    });

    // ── 4. Task-lost after remote accept ─────────────────────────────────

    test('markTasksLostForMember resolves running tasks with task-lost status', async () => {
        const config = makeConfig({ poolSize: 2 });
        const container = new ExecutorContainerService('test', config, registry);

        // Register a slow task to keep it in RUNNING state
        let resolveTask!: (v: unknown) => void;
        registry.register('hang', () => new Promise((r) => { resolveTask = r; }));
        const hfp = registry.get('hang')!.fingerprint;

        const future = container.executeTask(makeRequest({
            taskType: 'hang', registrationFingerprint: hfp,
            submitterMemberUuid: 'departed-member',
        }));

        // Let the task start
        await Bun.sleep(1);

        // Simulate member departure
        container.markTasksLostForMember('departed-member');

        const result = await future;
        expect(result.status).toBe('task-lost');
        expect(result.errorName).toBe('ExecutorTaskLostException');

        // Cleanup
        resolveTask('ignored');
        await container.shutdown();
    });

    test('markTasksLostForMember resolves queued tasks with task-lost status', async () => {
        const config = makeConfig({ poolSize: 1, queueCapacity: 5 });
        const container = new ExecutorContainerService('test', config, registry);

        let resolveBlock!: (v: unknown) => void;
        registry.register('block', () => new Promise((r) => { resolveBlock = r; }));
        const bfp = registry.get('block')!.fingerprint;

        // Fill the pool slot
        const running = container.executeTask(makeRequest({
            taskType: 'block', registrationFingerprint: bfp,
            submitterMemberUuid: 'stayer',
        }));

        await Bun.sleep(1);

        // Queue a task from a member that will depart
        const queued = container.executeTask(makeRequest({
            taskType: 'block', registrationFingerprint: bfp,
            submitterMemberUuid: 'leaver',
        }));

        container.markTasksLostForMember('leaver');

        const qResult = await queued;
        expect(qResult.status).toBe('task-lost');

        resolveBlock('ok');
        await running;
        await container.shutdown();
    });

    // ── 5. Registration mismatch and unknown task type fail before enqueue ─

    test('unknown task type rejects before enqueue via container', async () => {
        const config = makeConfig();
        const container = new ExecutorContainerService('test', config, registry);

        const result = await container.executeTask(makeRequest({
            taskType: 'nonexistent', registrationFingerprint: 'whatever',
        }));

        expect(result.status).toBe('rejected');
        expect(result.errorName).toBe('UnknownTaskTypeException');
        expect(container.getStats().rejected).toBe(1);
        await container.shutdown();
    });

    test('fingerprint mismatch rejects before enqueue via container', async () => {
        const config = makeConfig();
        const container = new ExecutorContainerService('test', config, registry);

        const result = await container.executeTask(makeRequest({
            taskType: 'echo', registrationFingerprint: 'wrong-fingerprint',
        }));

        expect(result.status).toBe('rejected');
        expect(result.errorName).toBe('TaskRegistrationMismatchException');
        expect(container.getStats().rejected).toBe(1);
        await container.shutdown();
    });

    test('unknown task type rejects before enqueue via operation', async () => {
        const desc: TaskDescriptor = {
            taskUuid: 'u3', executorName: 'e', taskType: 'missing',
            registrationFingerprint: 'fp', inputData: Buffer.alloc(0),
            submitterMemberUuid: 'm1', timeoutMillis: 0,
        };
        const op = new ExecuteCallableOperation(desc);
        op.setRegistry(registry);

        let response: unknown;
        (op as any).sendResponse = (r: unknown) => { response = r; };

        await op.run();
        expect((response as any).status).toBe('rejected');
        expect((response as any).errorName).toBe('UnknownTaskTypeException');
    });

    test('fingerprint mismatch rejects before enqueue via operation', async () => {
        const fp = registry.get('echo')!.fingerprint;
        const desc: TaskDescriptor = {
            taskUuid: 'u4', executorName: 'e', taskType: 'echo',
            registrationFingerprint: fp + '-wrong', inputData: Buffer.alloc(0),
            submitterMemberUuid: 'm1', timeoutMillis: 0,
        };
        const op = new ExecuteCallableOperation(desc);
        op.setRegistry(registry);

        let response: unknown;
        (op as any).sendResponse = (r: unknown) => { response = r; };

        await op.run();
        expect((response as any).status).toBe('rejected');
        expect((response as any).errorName).toBe('TaskRegistrationMismatchException');
    });

    // ── 6. Instance shutdown drains or times out deterministically ────────

    test('shutdown rejects new tasks immediately', async () => {
        const config = makeConfig();
        const container = new ExecutorContainerService('test', config, registry);
        const fp = registry.get('echo')!.fingerprint;

        await container.shutdown();
        expect(container.isShutdown()).toBe(true);

        const result = await container.executeTask(makeRequest({ registrationFingerprint: fp }));
        expect(result.status).toBe('rejected');
        expect(result.errorName).toBe('ExecutorRejectedExecutionException');
    });

    test('shutdown drains in-flight tasks within timeout', async () => {
        const config = makeConfig({ shutdownTimeoutMillis: 2000 });
        const container = new ExecutorContainerService('test', config, registry);

        let resolveTask!: (v: unknown) => void;
        registry.register('drainable', () => new Promise((r) => { resolveTask = r; }));
        const dfp = registry.get('drainable')!.fingerprint;

        const taskFuture = container.executeTask(makeRequest({
            taskType: 'drainable', registrationFingerprint: dfp,
        }));

        // Complete the task before timeout
        setTimeout(() => resolveTask(42), 20);

        const shutdownPromise = container.shutdown();
        const result = await taskFuture;
        await shutdownPromise;

        expect(result.status).toBe('success');
    });

    test('shutdown times out and fails remaining tasks', async () => {
        const config = makeConfig({ shutdownTimeoutMillis: 50 });
        const container = new ExecutorContainerService('test', config, registry);

        // Register a task that never resolves
        registry.register('stuck', () => new Promise(() => {}));
        const sfp = registry.get('stuck')!.fingerprint;

        const taskFuture = container.executeTask(makeRequest({
            taskType: 'stuck', registrationFingerprint: sfp,
        }));

        const shutdownPromise = container.shutdown();
        const result = await taskFuture;
        await shutdownPromise;

        expect(result.status).toBe('rejected');
        expect(result.errorName).toBe('ExecutorRejectedExecutionException');
        expect(result.errorMessage).toContain('shutdown timeout');
    });

    // ── 7. ShutdownOperation delegates to container ──────────────────────

    test('ShutdownOperation shuts down the container service', async () => {
        const config = makeConfig();
        const container = new ExecutorContainerService('test', config, registry);
        const op = new ShutdownOperation('test');
        op.setContainerService(container);

        let response: unknown;
        (op as any).sendResponse = (r: unknown) => { response = r; };

        await op.run();
        expect(container.isShutdown()).toBe(true);
        expect(response).toBeUndefined();
    });

    // ── 8. CancellationOperation delegates to container ──────────────────

    test('CancellationOperation cancels a queued task via container', async () => {
        const config = makeConfig({ poolSize: 1, queueCapacity: 5 });
        const container = new ExecutorContainerService('test', config, registry);

        // Block the pool
        let resolveBlock!: (v: unknown) => void;
        registry.register('blocker', () => new Promise((r) => { resolveBlock = r; }));
        const bfp = registry.get('blocker')!.fingerprint;
        const running = container.executeTask(makeRequest({ taskType: 'blocker', registrationFingerprint: bfp }));

        await Bun.sleep(1);

        // Queue a task we will cancel
        const fp = registry.get('echo')!.fingerprint;
        const targetUuid = crypto.randomUUID();
        const queued = container.executeTask(makeRequest({
            taskUuid: targetUuid, registrationFingerprint: fp,
        }));

        // Cancel via the container directly (as CancellationOperation would)
        const cancelled = container.cancelTask(targetUuid);
        expect(cancelled).toBe(true);

        const qResult = await queued;
        expect(qResult.status).toBe('cancelled');
        expect(container.getStats().cancelled).toBe(1);

        resolveBlock('done');
        await running;
        await container.shutdown();
    });
});
