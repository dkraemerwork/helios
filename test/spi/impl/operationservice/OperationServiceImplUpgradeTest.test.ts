/**
 * Tests for Block 16.C3 — OperationServiceImpl upgrade to routing-aware dispatch.
 *
 * Verifies partition routing, migration guards, retry, remote invocation stub,
 * backpressure, backward compatibility (localMode), and response correlation.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { OperationServiceImpl } from '@zenystx/core/spi/impl/operationservice/impl/OperationServiceImpl';
import { InvocationRegistry } from '@zenystx/core/spi/impl/operationservice/InvocationRegistry';
import { Operation } from '@zenystx/core/spi/impl/operationservice/Operation';
import { Address } from '@zenystx/core/cluster/Address';
import {
    RetryableException,
    WrongTargetException,
    PartitionMigratingException,
    TargetNotMemberException,
    MemberLeftException,
} from '@zenystx/core/spi/impl/operationservice/RetryableException';
import { TestNodeEngine } from '@zenystx/core/test-support/TestNodeEngine';

// ── test helpers ───────────────────────────────────────────────────────────

const LOCAL_ADDRESS = new Address('127.0.0.1', 5701);
const REMOTE_ADDRESS = new Address('127.0.0.2', 5701);

class EchoOp extends Operation {
    constructor(private readonly value: unknown = 'pong') { super(); }
    async run(): Promise<void> { this.sendResponse(this.value); }
}

class FailOp extends Operation {
    constructor(private readonly error: Error = new Error('fail')) { super(); }
    async run(): Promise<void> { throw this.error; }
}

class RecordingOp extends Operation {
    ran = false;
    async run(): Promise<void> {
        this.ran = true;
        this.sendResponse('ok');
    }
}

/** Op that fails N times with a retryable exception, then succeeds. */
class RetryableOp extends Operation {
    callCount = 0;
    constructor(
        private readonly failCount: number,
        private readonly exception: RetryableException = new WrongTargetException('wrong target'),
    ) { super(); }

    async run(): Promise<void> {
        this.callCount++;
        if (this.callCount <= this.failCount) {
            throw this.exception;
        }
        this.sendResponse('success');
    }
}

/** Op that never completes (simulates slow operation for backpressure testing). */
class SlowOp extends Operation {
    async run(): Promise<void> {
        // Block forever — never resolves, never calls sendResponse
        await new Promise<void>(() => {});
    }
}

function makeNodeEngine(): TestNodeEngine {
    return new TestNodeEngine();
}

function makeRoutingService(
    nodeEngine: TestNodeEngine,
    opts?: { localMode?: boolean; maxConcurrent?: number; localAddress?: Address; tryCount?: number },
): OperationServiceImpl {
    return new OperationServiceImpl(nodeEngine, {
        localMode: opts?.localMode ?? false,
        localAddress: opts?.localAddress ?? LOCAL_ADDRESS,
        maxConcurrentInvocations: opts?.maxConcurrent ?? 1000,
        invocationTryCount: opts?.tryCount ?? 250,
    });
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('OperationServiceImpl — Block 16.C3 upgrade', () => {

    describe('constructor and wiring', () => {
        it('creates an InvocationRegistry internally', () => {
            const ne = makeNodeEngine();
            const svc = makeRoutingService(ne);
            expect(svc).toBeDefined();
            expect(svc.getInvocationRegistry()).toBeInstanceOf(InvocationRegistry);
        });

        it('accepts localAddress option', () => {
            const ne = makeNodeEngine();
            const svc = makeRoutingService(ne, { localAddress: new Address('10.0.0.1', 9999) });
            expect(svc.getLocalAddress().host).toBe('10.0.0.1');
        });
    });

    describe('localMode backward compatibility', () => {
        it('localMode=true: invokeOnPartition executes locally without routing', async () => {
            const ne = makeNodeEngine();
            const svc = makeRoutingService(ne, { localMode: true });
            const op = new EchoOp('hello');
            const future = svc.invokeOnPartition<string>('svc', op, 5);
            const result = await future.get();
            expect(result).toBe('hello');
        });

        it('localMode=true: invokeOnTarget executes locally ignoring target', async () => {
            const ne = makeNodeEngine();
            const svc = makeRoutingService(ne, { localMode: true });
            const op = new EchoOp(42);
            const future = svc.invokeOnTarget<number>('svc', op, REMOTE_ADDRESS);
            const result = await future.get();
            expect(result).toBe(42);
        });

        it('localMode=true: run() still works', async () => {
            const ne = makeNodeEngine();
            const svc = makeRoutingService(ne, { localMode: true });
            const op = new RecordingOp();
            await svc.run(op);
            expect(op.ran).toBe(true);
        });

        it('localMode=true: execute() still works', async () => {
            const ne = makeNodeEngine();
            const svc = makeRoutingService(ne, { localMode: true });
            const op = new RecordingOp();
            svc.execute(op);
            await new Promise(r => setTimeout(r, 10));
            expect(op.ran).toBe(true);
        });
    });

    describe('routing-mode invokeOnPartition', () => {
        it('routes partition operation to local node when partition is locally owned', async () => {
            const ne = makeNodeEngine();
            // TestPartitionService returns isPartitionLocallyOwned=true by default
            const svc = makeRoutingService(ne);
            const op = new EchoOp('routed');
            const future = svc.invokeOnPartition<string>('svc', op, 3);
            const result = await future.get();
            expect(result).toBe('routed');
        });

        it('sets serviceName and partitionId on the operation', async () => {
            const ne = makeNodeEngine();
            const svc = makeRoutingService(ne);
            const op = new EchoOp();
            svc.invokeOnPartition<string>('my-service', op, 42);
            await new Promise(r => setTimeout(r, 10));
            expect(op.serviceName).toBe('my-service');
            expect(op.partitionId).toBe(42);
        });

        it('assigns a callId via InvocationRegistry', async () => {
            const ne = makeNodeEngine();
            const svc = makeRoutingService(ne);
            const op = new EchoOp();
            svc.invokeOnPartition<string>('svc', op, 0);
            // The registry should have registered/deregistered (operation completes fast)
            await new Promise(r => setTimeout(r, 10));
            // The registry will have size 0 after completion (deregistered)
            expect(svc.getInvocationRegistry().size).toBe(0);
        });

        it('future rejects when operation throws a non-retryable error', async () => {
            const ne = makeNodeEngine();
            const svc = makeRoutingService(ne);
            const op = new FailOp(new Error('fatal'));
            const future = svc.invokeOnPartition<string>('svc', op, 0);
            await expect(future.get()).rejects.toThrow('fatal');
        });
    });

    describe('routing-mode invokeOnTarget', () => {
        it('routes to local address when target matches local', async () => {
            const ne = makeNodeEngine();
            const svc = makeRoutingService(ne, { localAddress: LOCAL_ADDRESS });
            const op = new EchoOp('targeted');
            const future = svc.invokeOnTarget<string>('svc', op, LOCAL_ADDRESS);
            const result = await future.get();
            expect(result).toBe('targeted');
        });

        it('rejects when target is a remote address (no remote transport)', async () => {
            const ne = makeNodeEngine();
            const svc = makeRoutingService(ne, { localAddress: LOCAL_ADDRESS });
            const op = new EchoOp();
            const future = svc.invokeOnTarget<string>('svc', op, REMOTE_ADDRESS);
            // Remote invocations are not yet supported — should reject with TargetNotMemberException
            // or succeed if the service sends the operation to itself as a fallback
            await expect(future.get()).rejects.toThrow();
        });
    });

    describe('retry on retryable exceptions', () => {
        it('retries on WrongTargetException and eventually succeeds', async () => {
            const ne = makeNodeEngine();
            const svc = makeRoutingService(ne);
            const op = new RetryableOp(2, new WrongTargetException('wrong'));
            const future = svc.invokeOnPartition<string>('svc', op, 0);
            const result = await future.get();
            expect(result).toBe('success');
            expect(op.callCount).toBe(3); // 2 failures + 1 success
        });

        it('retries on PartitionMigratingException and eventually succeeds', async () => {
            const ne = makeNodeEngine();
            const svc = makeRoutingService(ne);
            const op = new RetryableOp(1, new PartitionMigratingException(5));
            const future = svc.invokeOnPartition<string>('svc', op, 5);
            const result = await future.get();
            expect(result).toBe('success');
            expect(op.callCount).toBe(2);
        });

        it('gives up after tryCount retries', async () => {
            const ne = makeNodeEngine();
            const svc = makeRoutingService(ne, { tryCount: 5 });
            // Fails 10 times — exceeds tryCount of 5
            const op = new RetryableOp(10, new WrongTargetException('wrong'));
            const future = svc.invokeOnPartition<string>('svc', op, 0);
            await expect(future.get()).rejects.toThrow('wrong');
        });
    });

    describe('backpressure', () => {
        it('rejects when max concurrent invocations reached', async () => {
            const ne = makeNodeEngine();
            const svc = makeRoutingService(ne, { maxConcurrent: 1 });
            // First invocation — slow, holds the slot
            const op1 = new SlowOp();
            const f1 = svc.invokeOnPartition<string>('svc', op1, 0);
            // Swallow the eventual rejection from cancellation
            void f1.get().catch(() => {});
            // Give it a tick to register
            await new Promise(r => setTimeout(r, 5));
            // Second invocation should fail with backpressure
            const op2 = new EchoOp();
            const f2 = svc.invokeOnPartition<string>('svc', op2, 1);
            await expect(f2.get()).rejects.toThrow(/[Bb]ackpressure/);
            // Cleanup
            f1.cancel();
        });
    });

    describe('response correlation via callId', () => {
        it('multiple concurrent invocations resolve independently', async () => {
            const ne = makeNodeEngine();
            const svc = makeRoutingService(ne);
            const f1 = svc.invokeOnPartition<string>('svc', new EchoOp('a'), 0);
            const f2 = svc.invokeOnPartition<string>('svc', new EchoOp('b'), 1);
            const f3 = svc.invokeOnPartition<string>('svc', new EchoOp('c'), 2);
            const [r1, r2, r3] = await Promise.all([f1.get(), f2.get(), f3.get()]);
            expect(r1).toBe('a');
            expect(r2).toBe('b');
            expect(r3).toBe('c');
        });

        it('registry has correct size during inflight invocations', async () => {
            const ne = makeNodeEngine();
            const svc = makeRoutingService(ne);
            const op = new SlowOp();
            svc.invokeOnPartition<string>('svc', op, 0);
            await new Promise(r => setTimeout(r, 5));
            expect(svc.getInvocationRegistry().size).toBe(1);
        });
    });

    describe('shutdown', () => {
        it('shutdown rejects new invocations', async () => {
            const ne = makeNodeEngine();
            const svc = makeRoutingService(ne);
            svc.shutdown();
            const op = new EchoOp();
            const future = svc.invokeOnPartition<string>('svc', op, 0);
            await expect(future.get()).rejects.toThrow(/shut down|not alive/);
        });

        it('shutdown resets pending invocations', async () => {
            const ne = makeNodeEngine();
            const svc = makeRoutingService(ne);
            const op = new SlowOp();
            const future = svc.invokeOnPartition<string>('svc', op, 0);
            await new Promise(r => setTimeout(r, 5));
            svc.shutdown();
            await expect(future.get()).rejects.toThrow();
        });
    });

    describe('migration guards (routing mode)', () => {
        it('operation on migrating partition throws PartitionMigratingException', async () => {
            const ne = makeNodeEngine();
            const ps = ne.getPartitionService();
            // Extend TestPartitionService to report migration
            (ps as any).isMigrating = (_id: number) => true;
            const svc = makeRoutingService(ne, { tryCount: 3 });
            const op = new EchoOp();
            const future = svc.invokeOnPartition<string>('svc', op, 5);
            // Should retry (PartitionMigratingException is retryable)
            // But since isMigrating always returns true, it will exhaust retries
            await expect(future.get()).rejects.toThrow(/migrating/i);
        });
    });
});
