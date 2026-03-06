/**
 * Block 17.9D — Real cancel/shutdown/task-lost runtime semantics.
 *
 * Tests that CancellationOperation and ShutdownOperation are wired through
 * to the resolved ExecutorContainerService, that proxy futures route cancel
 * back to the owning member, that member death after remote accept surfaces
 * ExecutorTaskLostException, and that late results after logical cancel
 * are dropped with accounting.
 */

import { describe, test, expect } from 'bun:test';
import { CancellationOperation } from '@zenystx/helios-core/executor/impl/CancellationOperation.js';
import { ShutdownOperation } from '@zenystx/helios-core/executor/impl/ShutdownOperation.js';
import { ExecutorContainerService } from '@zenystx/helios-core/executor/impl/ExecutorContainerService.js';
import { ExecutorServiceProxy } from '@zenystx/helios-core/executor/impl/ExecutorServiceProxy.js';
import { TaskTypeRegistry } from '@zenystx/helios-core/executor/impl/TaskTypeRegistry.js';
import { ExecutorConfig } from '@zenystx/helios-core/config/ExecutorConfig.js';
import { ExecutorTaskLostException } from '@zenystx/helios-core/executor/ExecutorExceptions.js';
import type { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation.js';

// ── helpers ──────────────────────────────────────────────────────────────

function makeRegistry(...entries: Array<[string, (input: unknown) => unknown | Promise<unknown>]>): TaskTypeRegistry {
    const reg = new TaskTypeRegistry();
    for (const [name, factory] of entries) {
        reg.register(name, factory);
    }
    return reg;
}

function makeConfig(opts?: {
    poolSize?: number;
    queueCapacity?: number;
    shutdownTimeoutMillis?: number;
    taskTimeoutMillis?: number;
}): ExecutorConfig {
    const c = new ExecutorConfig('test');
    if (opts?.poolSize) c.setPoolSize(opts.poolSize);
    if (opts?.queueCapacity) c.setQueueCapacity(opts.queueCapacity);
    if (opts?.shutdownTimeoutMillis) c.setShutdownTimeoutMillis(opts.shutdownTimeoutMillis);
    if (opts?.taskTimeoutMillis) c.setTaskTimeoutMillis(opts.taskTimeoutMillis);
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

/** Capture what sendResponse() receives. */
function captureResponse<T>(op: { setResponseHandler(h: { sendResponse(op: Operation, response: unknown): void } | null): void }): { value: T | undefined } {
    const captured: { value: T | undefined } = { value: undefined };
    op.setResponseHandler({
        sendResponse(_: unknown, response: unknown) { captured.value = response as T; },
    });
    return captured;
}

// ── 1. CancellationOperation.run() uses container-backed cancel ──────

describe('CancellationOperation — container-backed run()', () => {
    test('run() resolves container and returns real cancel result for queued task', async () => {
        const registry = makeRegistry(
            ['slow', async () => { await Bun.sleep(5000); return 'x'; }],
        );
        const config = makeConfig({ poolSize: 1, queueCapacity: 5 });
        const container = new ExecutorContainerService('test', config, registry);

        // Fill pool
        void container.executeTask(makeTaskRequest('slow', registry));
        // Queue a second task
        void container.executeTask(makeTaskRequest('slow', registry, 'queued-1'));

        const op = new CancellationOperation('test', 'queued-1');
        op.setContainerService(container);
        const captured = captureResponse<boolean>(op);
        await op.run();

        expect(captured.value).toBe(true);
    });

    test('run() returns false for unknown task via container', async () => {
        const registry = makeRegistry(['add', (i: unknown) => i]);
        const config = makeConfig();
        const container = new ExecutorContainerService('test', config, registry);

        const op = new CancellationOperation('test', 'nonexistent');
        op.setContainerService(container);
        const captured = captureResponse<boolean>(op);
        await op.run();

        expect(captured.value).toBe(false);
    });
});

// ── 2. ShutdownOperation.run() uses container-backed shutdown ────────

describe('ShutdownOperation — container-backed run()', () => {
    test('run() resolves container and drains healthy work', async () => {
        const registry = makeRegistry(['quick', async () => { await Bun.sleep(10); return 42; }]);
        const config = makeConfig({ shutdownTimeoutMillis: 2000 });
        const container = new ExecutorContainerService('test', config, registry);

        const taskPromise = container.executeTask(makeTaskRequest('quick', registry, 'drain-task'));

        const op = new ShutdownOperation('test');
        op.setContainerService(container);
        await op.run();

        expect(container.isShutdown()).toBe(true);
        const result = await taskPromise;
        expect(result.status).toBe('success');
    });

    test('run() shutdown timeout triggers explicit fallback', async () => {
        const registry = makeRegistry(['forever', async () => { await Bun.sleep(999999); return 'x'; }]);
        const config = makeConfig({ shutdownTimeoutMillis: 50 });
        const container = new ExecutorContainerService('test', config, registry);

        const taskPromise = container.executeTask(makeTaskRequest('forever', registry, 'stuck'));
        await Bun.sleep(5);

        const op = new ShutdownOperation('test');
        op.setContainerService(container);
        await op.run();

        const result = await taskPromise;
        expect(result.status).toBe('rejected');
        expect(result.errorMessage).toContain('shutdown');
    });
});

// ── 3. Proxy cancelTask routes CancellationOperation ─────────────────

describe('ExecutorServiceProxy — cancelTask', () => {
    test('cancelTask sends CancellationOperation through OperationService', async () => {
        const registry = makeRegistry(['slow', async () => { await Bun.sleep(5000); return 'x'; }]);
        const config = makeConfig({ poolSize: 1 });

        let capturedServiceName = '' as string;
        let capturedOp: unknown = null;
        const fakeNodeEngine = createFakeNodeEngine((sn: string, op: unknown) => {
            capturedServiceName = sn;
            capturedOp = op;
        });

        const proxy = new ExecutorServiceProxy('test', fakeNodeEngine, config, registry, 'local-member');

        await proxy.cancelTask('some-task-uuid', 0);

        expect(capturedOp).toBeInstanceOf(CancellationOperation);
        expect((capturedOp as CancellationOperation).taskUuid).toBe('some-task-uuid');
        expect(capturedServiceName).toBe('helios:executor');
    });
});

// ── 4. Member death after remote accept → ExecutorTaskLostException ──

describe('ExecutorContainerService — task-lost on member departure', () => {
    test('markTasksLostForMember surfaces task-lost for accepted tasks from departed member', async () => {
        const registry = makeRegistry(['slow', async () => { await Bun.sleep(5000); return 'x'; }]);
        const config = makeConfig({ poolSize: 2 });
        const container = new ExecutorContainerService('test', config, registry);

        const taskPromise = container.executeTask(makeTaskRequest('slow', registry, 'remote-task-1'));

        // Simulate member departure
        container.markTasksLostForMember('member-1');

        const result = await taskPromise;
        expect(result.status).toBe('task-lost');
        expect(result.errorMessage).toContain('member departed');
    });

    test('markTasksLostForMember does not affect tasks from other members', async () => {
        const registry = makeRegistry(
            ['quick', async () => { await Bun.sleep(20); return 99; }],
        );
        const config = makeConfig({ poolSize: 2 });
        const container = new ExecutorContainerService('test', config, registry);

        const req1 = makeTaskRequest('quick', registry, 'task-member2');
        req1.submitterMemberUuid = 'member-2';
        const taskPromise = container.executeTask(req1);

        // Kill member-1 — should not affect member-2's task
        container.markTasksLostForMember('member-1');

        const result = await taskPromise;
        expect(result.status).toBe('success');
    });
});

// ── 5. Late result after logical cancel → dropped + accounted ────────

describe('ExecutorContainerService — late result drop accounting', () => {
    test('late result after cancel is dropped and counted in stats', async () => {
        let resolver: () => void;
        const gate = new Promise<void>((r) => { resolver = r; });
        const registry = makeRegistry(['delayed', async () => { await gate; return 'late-value'; }]);
        const config = makeConfig({ poolSize: 1 });
        const container = new ExecutorContainerService('test', config, registry);

        const _taskPromise = container.executeTask(makeTaskRequest('delayed', registry, 'cancel-then-finish'));
        await Bun.sleep(5);

        // Cancel while running
        container.cancelTask('cancel-then-finish');

        // Now let the task complete — this is a late result
        resolver!();
        await Bun.sleep(10);

        const stats = container.getStats();
        expect(stats.lateResultsDropped).toBeGreaterThanOrEqual(1);
    });
});

// ── 6. Duplicate cancel remains deterministic ────────────────────────

describe('ExecutorContainerService — idempotent cancel', () => {
    test('second cancel on same task returns false', async () => {
        const registry = makeRegistry(['slow', async () => { await Bun.sleep(5000); return 'x'; }]);
        const config = makeConfig({ poolSize: 1, queueCapacity: 5 });
        const container = new ExecutorContainerService('test', config, registry);

        void container.executeTask(makeTaskRequest('slow', registry));
        void container.executeTask(makeTaskRequest('slow', registry, 'dup-cancel'));

        expect(container.cancelTask('dup-cancel')).toBe(true);
        expect(container.cancelTask('dup-cancel')).toBe(false);
    });
});

// ── 7. Shutdown followed by cancel is deterministic ──────────────────

describe('ExecutorContainerService — shutdown then cancel', () => {
    test('cancel after shutdown returns false for already-terminated tasks', async () => {
        const registry = makeRegistry(['forever', async () => { await Bun.sleep(999999); return 'x'; }]);
        const config = makeConfig({ shutdownTimeoutMillis: 50 });
        const container = new ExecutorContainerService('test', config, registry);

        void container.executeTask(makeTaskRequest('forever', registry, 'shutdown-then-cancel'));
        await Bun.sleep(5);

        await container.shutdown();

        // Task was already terminated by shutdown — cancel should return false
        expect(container.cancelTask('shutdown-then-cancel')).toBe(false);
    });
});

// ── 8. Queued task cancel produces CancellationException envelope ─────

describe('ExecutorContainerService — cancel result envelope', () => {
    test('queued cancel produces cancelled status envelope', async () => {
        let resolver: () => void;
        const gate = new Promise<void>((r) => { resolver = r; });
        const registry = makeRegistry(['blocking', async () => { await gate; return 'x'; }]);
        const config = makeConfig({ poolSize: 1, queueCapacity: 5 });
        const container = new ExecutorContainerService('test', config, registry);

        // Fill pool
        void container.executeTask(makeTaskRequest('blocking', registry, 'fill'));
        // Queue
        const queuedPromise = container.executeTask(makeTaskRequest('blocking', registry, 'queued-cancel-envelope'));

        container.cancelTask('queued-cancel-envelope');
        const result = await queuedPromise;
        expect(result.status).toBe('cancelled');
        expect(result.taskUuid).toBe('queued-cancel-envelope');

        resolver!();
    });
});

// ── helpers for fake NodeEngine ──────────────────────────────────────

function createFakeNodeEngine(
    onInvoke?: (serviceName: string, op: unknown) => void,
): import('@zenystx/helios-core/spi/NodeEngine.js').NodeEngine {
    const { InvocationFuture } = require('@zenystx/helios-core/spi/impl/operationservice/InvocationFuture.js');
    const invokeStub = (sn: string, op: unknown) => {
        onInvoke?.(sn, op);
        return new InvocationFuture();
    };
    return {
        getOperationService: () => ({
            invokeOnPartition: (sn: string, op: unknown) => invokeStub(sn, op),
            invokeOnTarget: (sn: string, op: unknown) => invokeStub(sn, op),
        }),
        getPartitionService: () => ({
            getPartitionId: () => 0,
            getPartitionCount: () => 271,
        }),
        getSerializationService: () => ({
            toData: () => null,
            toObject: () => null,
        }),
        getClusterService: () => ({
            getMembers: () => [],
        }),
        toObject: () => null,
    } as unknown as import('@zenystx/helios-core/spi/NodeEngine.js').NodeEngine;
}
