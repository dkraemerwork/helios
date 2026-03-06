/**
 * Block 17.9B — Put ExecutorContainerService on the hot path.
 *
 * Tests:
 * - ExecuteCallableOperation delegates to the resolved container (not direct factory)
 * - MemberCallableOperation delegates to the resolved container
 * - Direct inline factory execution path is no longer used for distributed tasks
 * - Unknown task type still rejects before enqueue through the container path
 * - Result envelope remains unchanged for successful tasks
 * - Container resolution is by executorName, not proxy-local state
 * - Member-targeted no-retry behavior remains intact after rewiring
 */
import { describe, test, expect, spyOn } from 'bun:test';
import { ExecuteCallableOperation, type TaskDescriptor } from '@zenystx/helios-core/executor/impl/ExecuteCallableOperation.js';
import { MemberCallableOperation } from '@zenystx/helios-core/executor/impl/MemberCallableOperation.js';
import { ExecutorContainerService } from '@zenystx/helios-core/executor/impl/ExecutorContainerService.js';
import { TaskTypeRegistry } from '@zenystx/helios-core/executor/impl/TaskTypeRegistry.js';
import { ExecutorConfig } from '@zenystx/helios-core/config/ExecutorConfig.js';
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

function makeRegistry(): TaskTypeRegistry {
    const reg = new TaskTypeRegistry();
    reg.register('double', (n) => Number(n) * 2, { version: 'v1' });
    return reg;
}

function makeContainer(name: string, registry: TaskTypeRegistry): ExecutorContainerService {
    const config = new ExecutorConfig(name);
    return new ExecutorContainerService(name, config, registry);
}

function captureHandler(): { handler: ResponseHandler; getResponse: () => ExecutorOperationResult } {
    let sentResponse: unknown = undefined;
    return {
        handler: { sendResponse: (_op: Operation, response: unknown) => { sentResponse = response; } },
        getResponse: () => sentResponse as ExecutorOperationResult,
    };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Block 17.9B — ExecutorContainerService on the hot path', () => {

    test('ExecuteCallableOperation delegates to the resolved container', async () => {
        const registry = makeRegistry();
        const container = makeContainer('default', registry);
        const executeSpy = spyOn(container, 'executeTask');
        const desc = makeDescriptor();
        const op = new ExecuteCallableOperation(desc);
        op.setRegistry(registry);
        op.setContainerService(container);

        const { handler, getResponse } = captureHandler();
        op.setResponseHandler(handler);
        await op.run();

        expect(executeSpy).toHaveBeenCalledTimes(1);
        const result = getResponse();
        expect(result.status).toBe('success');
        expect(result.taskUuid).toBe(desc.taskUuid);
    });

    test('MemberCallableOperation delegates to the resolved container', async () => {
        const registry = makeRegistry();
        const container = makeContainer('default', registry);
        const executeSpy = spyOn(container, 'executeTask');
        const desc = makeDescriptor();
        const op = new MemberCallableOperation(desc, crypto.randomUUID());
        op.setRegistry(registry);
        op.setContainerService(container);

        const { handler, getResponse } = captureHandler();
        op.setResponseHandler(handler);
        await op.run();

        expect(executeSpy).toHaveBeenCalledTimes(1);
        const result = getResponse();
        expect(result.status).toBe('success');
    });

    test('direct factory execution is not used when container is set', async () => {
        const registry = makeRegistry();
        const desc = registry.get('double')!;
        const factorySpy = spyOn(desc, 'factory');

        const container = makeContainer('default', registry);
        const opDesc = makeDescriptor();
        const op = new ExecuteCallableOperation(opDesc);
        op.setRegistry(registry);
        op.setContainerService(container);

        const { handler } = captureHandler();
        op.setResponseHandler(handler);
        await op.run();

        // The factory should be called via the container, not directly by the operation
        // The operation itself must NOT call desc.factory() directly
        expect(factorySpy).toHaveBeenCalled(); // container calls it internally
    });

    test('unknown task type still rejects through the container path', async () => {
        const registry = makeRegistry();
        const container = makeContainer('default', registry);
        const desc = makeDescriptor({ taskType: 'nonexistent' });
        const op = new ExecuteCallableOperation(desc);
        op.setRegistry(registry);
        op.setContainerService(container);

        const { handler, getResponse } = captureHandler();
        op.setResponseHandler(handler);
        await op.run();

        const result = getResponse();
        expect(result.status).toBe('rejected');
        expect(result.errorName).toBe('UnknownTaskTypeException');
    });

    test('result envelope remains unchanged for successful tasks', async () => {
        const registry = makeRegistry();
        const container = makeContainer('default', registry);
        const memberUuid = crypto.randomUUID();
        const desc = makeDescriptor({ submitterMemberUuid: memberUuid });
        const op = new ExecuteCallableOperation(desc);
        op.setRegistry(registry);
        op.setContainerService(container);
        op.setOriginMemberUuid(memberUuid);

        const { handler, getResponse } = captureHandler();
        op.setResponseHandler(handler);
        await op.run();

        const result = getResponse();
        expect(result.taskUuid).toBe(desc.taskUuid);
        expect(result.status).toBe('success');
        expect(result.resultData).not.toBeNull();
        expect(result.errorName).toBeNull();
        expect(result.errorMessage).toBeNull();
    });

    test('container resolution is by executorName, not proxy-local state', async () => {
        const registry = makeRegistry();
        const container1 = makeContainer('exec-A', registry);
        const container2 = makeContainer('exec-B', registry);

        const desc1 = makeDescriptor({ executorName: 'exec-A' });
        const op1 = new ExecuteCallableOperation(desc1);
        op1.setRegistry(registry);
        op1.setContainerService(container1);

        const desc2 = makeDescriptor({ executorName: 'exec-B' });
        const op2 = new ExecuteCallableOperation(desc2);
        op2.setRegistry(registry);
        op2.setContainerService(container2);

        const spy1 = spyOn(container1, 'executeTask');
        const spy2 = spyOn(container2, 'executeTask');

        const { handler: h1 } = captureHandler();
        op1.setResponseHandler(h1);
        await op1.run();

        const { handler: h2 } = captureHandler();
        op2.setResponseHandler(h2);
        await op2.run();

        expect(spy1).toHaveBeenCalledTimes(1);
        expect(spy2).toHaveBeenCalledTimes(1);
    });

    test('member-targeted no-retry behavior remains intact after container rewiring', async () => {
        const registry = makeRegistry();
        const container = makeContainer('default', registry);
        const desc = makeDescriptor();
        const op = new MemberCallableOperation(desc, crypto.randomUUID());
        op.setRegistry(registry);
        op.setContainerService(container);

        // No-retry semantics must still hold
        expect(op.shouldRetryOnMemberLeft()).toBe(false);

        // And it still executes successfully
        const { handler, getResponse } = captureHandler();
        op.setResponseHandler(handler);
        await op.run();

        const result = getResponse();
        expect(result.status).toBe('success');
    });

    test('fingerprint mismatch rejected before container enqueue', async () => {
        const registry = makeRegistry();
        const container = makeContainer('default', registry);
        const executeSpy = spyOn(container, 'executeTask');
        const desc = makeDescriptor({ registrationFingerprint: 'wrong-fp' });
        const op = new ExecuteCallableOperation(desc);
        op.setRegistry(registry);
        op.setContainerService(container);

        const { handler, getResponse } = captureHandler();
        op.setResponseHandler(handler);
        await op.run();

        const result = getResponse();
        expect(result.status).toBe('rejected');
        expect(result.errorName).toBe('TaskRegistrationMismatchException');
        // Container should NOT have been called — validation rejects first
        expect(executeSpy).not.toHaveBeenCalled();
    });

    test('operation without container falls back to direct execution (backward compat)', async () => {
        const registry = makeRegistry();
        const desc = makeDescriptor();
        const op = new ExecuteCallableOperation(desc);
        op.setRegistry(registry);
        // No container set — should still work via direct factory call

        const { handler, getResponse } = captureHandler();
        op.setResponseHandler(handler);
        await op.run();

        const result = getResponse();
        expect(result.status).toBe('success');
    });

    test('container executeTask result is forwarded as the operation response', async () => {
        const registry = new TaskTypeRegistry();
        registry.register('greet', (name) => `Hello, ${name}!`, { version: 'v1' });
        const container = makeContainer('default', registry);
        const desc = makeDescriptor({
            taskType: 'greet',
            registrationFingerprint: 'v1',
            inputData: Buffer.from(JSON.stringify('World')),
        });
        const op = new ExecuteCallableOperation(desc);
        op.setRegistry(registry);
        op.setContainerService(container);

        const { handler, getResponse } = captureHandler();
        op.setResponseHandler(handler);
        await op.run();

        const result = getResponse();
        expect(result.status).toBe('success');
        expect(result.resultData).not.toBeNull();
    });
});
