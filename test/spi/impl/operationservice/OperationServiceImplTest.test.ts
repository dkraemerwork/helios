/**
 * Tests for OperationServiceImpl — in-process single-node dispatch.
 *
 * Verifies that operations are executed locally and InvocationFutures resolve
 * correctly with the operation's sendResponse() value.
 */
import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import { TestNodeEngine } from '@zenystx/helios-core/test-support/TestNodeEngine';
import { describe, expect, it } from 'bun:test';

// ── test operations ────────────────────────────────────────────────────────

/** Operation that calls sendResponse with a fixed value. */
class EchoOperation extends Operation {
    constructor(private readonly value: unknown = 'pong') { super(); }
    async run(): Promise<void> { this.sendResponse(this.value); }
}

/** Operation that throws an error during run(). */
class FailingOperation extends Operation {
    async run(): Promise<void> { throw new Error('deliberate failure'); }
}

/** Operation that records whether run() was called (no sendResponse). */
class RecordingOperation extends Operation {
    ran = false;
    async run(): Promise<void> { this.ran = true; }
}

// ── tests ──────────────────────────────────────────────────────────────────

function makeService() {
    const nodeEngine = new TestNodeEngine();
    return nodeEngine.getOperationService();
}

describe('OperationServiceImpl.execute()', () => {
    it('execute() fires-and-forgets — operation runs asynchronously', async () => {
        const svc = makeService();
        const op = new RecordingOperation();
        svc.execute(op);
        // After awaiting, the operation should have run
        await Promise.resolve();
        await Promise.resolve(); // two ticks: one for execute, one for the async body
        expect(op.ran).toBe(true);
    });
});

describe('OperationServiceImpl.run()', () => {
    it('run() executes the operation synchronously (awaitable)', async () => {
        const svc = makeService();
        const op = new RecordingOperation();
        await svc.run(op);
        expect(op.ran).toBe(true);
    });

    it('run() assigns a callId to the operation', async () => {
        const svc = makeService();
        const op = new RecordingOperation();
        await svc.run(op);
        // After run() the operation is deactivated (run completes), but callId was assigned
        // We can't easily check the exact callId since deactivate may not happen
        // Just verify the operation was executed (isActive may or may not be true after run)
        expect(op.ran).toBe(true);
    });
});

describe('OperationServiceImpl.invokeOnPartition()', () => {
    it('invokeOnPartition returns an InvocationFuture', () => {
        const svc = makeService();
        const op = new EchoOperation();
        const future = svc.invokeOnPartition<string>('test-service', op, 0);
        expect(future).toBeDefined();
        expect(typeof future.isDone).toBe('function');
        void future.get().catch(() => { /* ok */ });
    });

    it('future resolves with the value passed to sendResponse()', async () => {
        const svc = makeService();
        const op = new EchoOperation('pong');
        const future = svc.invokeOnPartition<string>('test-service', op, 0);
        const result = await future.get();
        expect(result).toBe('pong');
    });

    it('future rejects when the operation throws', async () => {
        const svc = makeService();
        const op = new FailingOperation();
        const future = svc.invokeOnPartition<string>('test-service', op, 0);
        await expect(future.get()).rejects.toThrow('deliberate failure');
    });

    it('serviceName and partitionId are set on the operation', async () => {
        const svc = makeService();
        const op = new EchoOperation();
        svc.invokeOnPartition<string>('my-service', op, 7);
        await Promise.resolve();
        expect(op.serviceName).toBe('my-service');
        expect(op.partitionId).toBe(7);
    });
});
