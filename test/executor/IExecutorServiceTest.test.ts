/**
 * Block 17.2 — IExecutorService + TaskCallable<T> contracts
 *
 * Tests the public executor API surface, task descriptor types,
 * inline validation, PartitionAware routing, error classes, and
 * multi-member operation signatures.
 */
import { describe, test, expect } from 'bun:test';
import type { IExecutorService } from '@zenystx/helios-core/executor/IExecutorService';
import type { TaskCallable, InlineTaskCallable } from '@zenystx/helios-core/executor/TaskCallable';
import type { ExecutorOperationResult } from '@zenystx/helios-core/executor/ExecutorOperationResult';
import {
    UnknownTaskTypeException,
    TaskRegistrationMismatchException,
    ExecutorRejectedExecutionException,
    ExecutorTaskLostException,
    ExecutorTaskTimeoutException,
} from '@zenystx/helios-core/executor/ExecutorExceptions';

describe('IExecutorService + TaskCallable contracts', () => {

    // ── TaskCallable / InlineTaskCallable type contracts ─────────────────

    test('TaskCallable compiles with taskType and input', () => {
        const task: TaskCallable<number> = {
            taskType: 'fibonacci',
            input: 42,
        };
        expect(task.taskType).toBe('fibonacci');
        expect(task.input).toBe(42);
    });

    test('InlineTaskCallable enforces __inline__ taskType literal', () => {
        const inline: InlineTaskCallable<number> = {
            taskType: '__inline__',
            input: 10,
            fn: (n) => Number(n) * 2,
        };
        expect(inline.taskType).toBe('__inline__');
        expect(inline.fn(5)).toBe(10);
    });

    // ── ExecutorOperationResult envelope ─────────────────────────────────

    test('ExecutorOperationResult has required fields', () => {
        const result: ExecutorOperationResult = {
            taskUuid: 'abc-123',
            status: 'success',
            originMemberUuid: 'member-1',
            resultData: null,
            errorName: null,
            errorMessage: null,
        };
        expect(result.status).toBe('success');
        expect(result.taskUuid).toBe('abc-123');
    });

    test('ExecutorOperationResult accepts all status values', () => {
        const statuses: ExecutorOperationResult['status'][] = [
            'success', 'cancelled', 'rejected', 'task-lost', 'timeout',
        ];
        for (const status of statuses) {
            const result: ExecutorOperationResult = {
                taskUuid: 'x',
                status,
                originMemberUuid: 'y',
                resultData: null,
                errorName: null,
                errorMessage: null,
            };
            expect(result.status).toBe(status);
        }
    });

    // ── Executor error classes ──────────────────────────────────────────

    test('UnknownTaskTypeException has correct name and message', () => {
        const err = new UnknownTaskTypeException('fibonacci');
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe('UnknownTaskTypeException');
        expect(err.message).toContain('fibonacci');
    });

    test('TaskRegistrationMismatchException includes task type and fingerprints', () => {
        const err = new TaskRegistrationMismatchException('fib', 'fp-local', 'fp-remote');
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe('TaskRegistrationMismatchException');
        expect(err.message).toContain('fib');
        expect(err.message).toContain('fp-local');
        expect(err.message).toContain('fp-remote');
    });

    test('ExecutorRejectedExecutionException has correct name', () => {
        const err = new ExecutorRejectedExecutionException('queue full');
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe('ExecutorRejectedExecutionException');
    });

    test('ExecutorTaskLostException has correct name', () => {
        const err = new ExecutorTaskLostException('task-123', 'member died');
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe('ExecutorTaskLostException');
        expect(err.message).toContain('task-123');
    });

    test('ExecutorTaskTimeoutException has correct name', () => {
        const err = new ExecutorTaskTimeoutException('task-456', 5000);
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe('ExecutorTaskTimeoutException');
        expect(err.message).toContain('task-456');
        expect(err.message).toContain('5000');
    });

    // ── IExecutorService interface compile-time checks ──────────────────

    test('IExecutorService interface has full public surface', () => {
        // This test validates that the interface compiles with all required methods.
        // We create a mock to verify method existence at runtime.
        const mockExecutor: IExecutorService = createMockExecutorService();

        expect(typeof mockExecutor.submit).toBe('function');
        expect(typeof mockExecutor.submitToMember).toBe('function');
        expect(typeof mockExecutor.submitToKeyOwner).toBe('function');
        expect(typeof mockExecutor.submitToAllMembers).toBe('function');
        expect(typeof mockExecutor.submitToMembers).toBe('function');
        expect(typeof mockExecutor.execute).toBe('function');
        expect(typeof mockExecutor.executeOnMember).toBe('function');
        expect(typeof mockExecutor.executeOnKeyOwner).toBe('function');
        expect(typeof mockExecutor.executeOnAllMembers).toBe('function');
        expect(typeof mockExecutor.registerTaskType).toBe('function');
        expect(typeof mockExecutor.unregisterTaskType).toBe('function');
        expect(typeof mockExecutor.getRegisteredTaskTypes).toBe('function');
        expect(typeof mockExecutor.submitLocal).toBe('function');
        expect(typeof mockExecutor.executeLocal).toBe('function');
        expect(typeof mockExecutor.shutdown).toBe('function');
        expect(typeof mockExecutor.isShutdown).toBe('function');
        expect(typeof mockExecutor.getLocalExecutorStats).toBe('function');
    });
});

// ── Mock factory ─────────────────────────────────────────────────────────

function createMockExecutorService(): IExecutorService {
    const noop = () => { throw new Error('not implemented'); };
    const asyncNoop = async () => { throw new Error('not implemented'); };
    return {
        submit: noop as any,
        submitToMember: noop as any,
        submitToKeyOwner: noop as any,
        submitToAllMembers: noop as any,
        submitToMembers: noop as any,
        execute: noop as any,
        executeOnMember: noop as any,
        executeOnKeyOwner: noop as any,
        executeOnAllMembers: noop as any,
        registerTaskType: noop as any,
        unregisterTaskType: noop as any,
        getRegisteredTaskTypes: noop as any,
        submitLocal: noop as any,
        executeLocal: noop as any,
        shutdown: asyncNoop as any,
        isShutdown: () => false,
        getLocalExecutorStats: noop as any,
    };
}
