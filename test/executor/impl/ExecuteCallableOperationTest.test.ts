/**
 * Block 17.4 — ExecuteCallableOperation + MemberCallableOperation tests.
 *
 * Tests operation serialization, result envelopes, retry boundaries,
 * and task-lost semantics.
 */
import { describe, it, expect } from 'bun:test';
import { ExecuteCallableOperation } from '@zenystx/helios-core/executor/impl/ExecuteCallableOperation.js';
import { MemberCallableOperation } from '@zenystx/helios-core/executor/impl/MemberCallableOperation.js';
import { TaskTypeRegistry } from '@zenystx/helios-core/executor/impl/TaskTypeRegistry.js';
import type { ExecutorOperationResult } from '@zenystx/helios-core/executor/ExecutorOperationResult.js';
import { ExecutorTaskLostException } from '@zenystx/helios-core/executor/ExecutorExceptions.js';
import type { Operation, ResponseHandler } from '@zenystx/helios-core/spi/impl/operationservice/Operation.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDescriptor(overrides?: Partial<ExecuteCallableOperation['descriptor']>) {
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

function captureHandler(): { handler: ResponseHandler; getResponse: () => ExecutorOperationResult } {
    let sentResponse: unknown = undefined;
    return {
        handler: { sendResponse: (_op: Operation, response: unknown) => { sentResponse = response; } },
        getResponse: () => sentResponse as ExecutorOperationResult,
    };
}

// ── ExecuteCallableOperation ─────────────────────────────────────────────────

describe('ExecuteCallableOperation', () => {
    it('stores descriptor fields and exposes them', () => {
        const desc = makeDescriptor();
        const op = new ExecuteCallableOperation(desc);
        expect(op.descriptor).toBe(desc);
        expect(op.descriptor.taskUuid).toBe(desc.taskUuid);
        expect(op.descriptor.executorName).toBe(desc.executorName);
        expect(op.descriptor.taskType).toBe(desc.taskType);
        expect(op.descriptor.registrationFingerprint).toBe(desc.registrationFingerprint);
    });

    it('validates against registry and returns success envelope', async () => {
        const desc = makeDescriptor();
        const registry = makeRegistry();
        const op = new ExecuteCallableOperation(desc);
        op.setRegistry(registry);

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

    it('returns rejection envelope for unknown task type', async () => {
        const desc = makeDescriptor({ taskType: 'nonexistent' });
        const registry = makeRegistry();
        const op = new ExecuteCallableOperation(desc);
        op.setRegistry(registry);

        const { handler, getResponse } = captureHandler();
        op.setResponseHandler(handler);
        await op.run();

        const result = getResponse();
        expect(result.status).toBe('rejected');
        expect(result.errorName).toBe('UnknownTaskTypeException');
    });

    it('returns rejection envelope for fingerprint mismatch', async () => {
        const desc = makeDescriptor({ registrationFingerprint: 'wrong-fp' });
        const registry = makeRegistry();
        const op = new ExecuteCallableOperation(desc);
        op.setRegistry(registry);

        const { handler, getResponse } = captureHandler();
        op.setResponseHandler(handler);
        await op.run();

        const result = getResponse();
        expect(result.status).toBe('rejected');
        expect(result.errorName).toBe('TaskRegistrationMismatchException');
    });

    it('returns error envelope when task factory throws', async () => {
        const registry = new TaskTypeRegistry();
        registry.register('fail', () => { throw new Error('boom'); }, { version: 'v1' });
        const desc = makeDescriptor({ taskType: 'fail', registrationFingerprint: 'v1' });
        const op = new ExecuteCallableOperation(desc);
        op.setRegistry(registry);

        const { handler, getResponse } = captureHandler();
        op.setResponseHandler(handler);
        await op.run();

        const result = getResponse();
        expect(result.status).toBe('rejected');
        expect(result.errorName).toBe('Error');
        expect(result.errorMessage).toBe('boom');
    });

    it('sends response exactly once per task UUID', async () => {
        const desc = makeDescriptor();
        const registry = makeRegistry();
        const op = new ExecuteCallableOperation(desc);
        op.setRegistry(registry);

        let callCount = 0;
        op.setResponseHandler({ sendResponse: () => { callCount++; } });

        await op.run();
        expect(callCount).toBe(1);
    });

    it('handles async task factory', async () => {
        const registry = new TaskTypeRegistry();
        registry.register('async-double', async (n) => {
            await new Promise(r => setTimeout(r, 1));
            return Number(n) * 2;
        }, { version: 'v1' });

        const desc = makeDescriptor({ taskType: 'async-double', registrationFingerprint: 'v1' });
        const op = new ExecuteCallableOperation(desc);
        op.setRegistry(registry);

        const { handler, getResponse } = captureHandler();
        op.setResponseHandler(handler);
        await op.run();

        const result = getResponse();
        expect(result.status).toBe('success');
        expect(result.resultData).not.toBeNull();
    });
});

// ── MemberCallableOperation ──────────────────────────────────────────────────

describe('MemberCallableOperation', () => {
    it('extends ExecuteCallableOperation with no-retry semantics', () => {
        const desc = makeDescriptor();
        const op = new MemberCallableOperation(desc);
        expect(op).toBeInstanceOf(ExecuteCallableOperation);
        expect(op.shouldRetryOnMemberLeft()).toBe(false);
    });

    it('shouldRetryOnMemberLeft returns false', () => {
        const op = new MemberCallableOperation(makeDescriptor());
        expect(op.shouldRetryOnMemberLeft()).toBe(false);
    });

    it('partition-targeted ExecuteCallableOperation allows retry by default', () => {
        const op = new ExecuteCallableOperation(makeDescriptor());
        expect(op.shouldRetryOnMemberLeft()).toBe(true);
    });

    it('operation carries target member UUID', () => {
        const targetUuid = crypto.randomUUID();
        const desc = makeDescriptor();
        const op = new MemberCallableOperation(desc, targetUuid);
        expect(op.targetMemberUuid).toBe(targetUuid);
    });
});

// ── Task descriptor wire format ──────────────────────────────────────────────

describe('TaskDescriptor wire format', () => {
    it('descriptor contains all required fields', () => {
        const desc = makeDescriptor();
        expect(desc.taskUuid).toBeDefined();
        expect(desc.executorName).toBeDefined();
        expect(desc.taskType).toBeDefined();
        expect(desc.registrationFingerprint).toBeDefined();
        expect(desc.inputData).toBeInstanceOf(Buffer);
        expect(desc.submitterMemberUuid).toBeDefined();
        expect(desc.timeoutMillis).toBeGreaterThan(0);
    });

    it('result envelope contains originMemberUuid from operation', async () => {
        const memberUuid = crypto.randomUUID();
        const desc = makeDescriptor();
        const registry = makeRegistry();
        const op = new ExecuteCallableOperation(desc);
        op.setRegistry(registry);
        op.setOriginMemberUuid(memberUuid);

        const { handler, getResponse } = captureHandler();
        op.setResponseHandler(handler);
        await op.run();

        const result = getResponse();
        expect(result.originMemberUuid).toBe(memberUuid);
    });
});

// ── Post-acceptance task-lost semantics ──────────────────────────────────────

describe('Post-acceptance task-lost', () => {
    it('ExecutorTaskLostException carries task UUID and reason', () => {
        const uuid = crypto.randomUUID();
        const err = new ExecutorTaskLostException(uuid, 'member departed');
        expect(err.name).toBe('ExecutorTaskLostException');
        expect(err.message).toContain(uuid);
        expect(err.message).toContain('member departed');
    });
});
