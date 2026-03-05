/**
 * Tests for Block 16.C2 — Invocation + PartitionInvocation + TargetInvocation.
 */
import { describe, test, expect } from 'bun:test';
import { Invocation } from '@helios/spi/impl/operationservice/Invocation';
import { PartitionInvocation } from '@helios/spi/impl/operationservice/PartitionInvocation';
import { TargetInvocation } from '@helios/spi/impl/operationservice/TargetInvocation';
import { RetryableException, WrongTargetException, PartitionMigratingException, TargetNotMemberException, MemberLeftException } from '@helios/spi/impl/operationservice/RetryableException';
import { Operation } from '@helios/spi/impl/operationservice/Operation';

import { InvocationRegistry } from '@helios/spi/impl/operationservice/InvocationRegistry';
import { Address } from '@helios/cluster/Address';
import type { NodeEngine } from '@helios/spi/NodeEngine';

// ── helpers ──────────────────────────────────────────────────────────────

class DummyOp extends Operation {
    public result: unknown = 'ok';
    async run(): Promise<void> {
        this.sendResponse(this.result);
    }
}

function createMockNodeEngine(overrides: Partial<NodeEngine> = {}): NodeEngine {
    return {
        getOperationService: () => { throw new Error('not wired'); },
        getProperties: () => ({ getInteger: () => 0, getBoolean: () => false, getLong: () => 0n, getString: () => '' } as any),
        getPartitionService: () => ({ getPartitionCount: () => 271 }),
        getSerializationService: () => ({ toData: (o: unknown) => o, toObject: (d: unknown) => d } as any),
        getLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, finest: () => {} } as any),
        isRunning: () => true,
        isStartCompleted: () => true,
        getService: () => { throw new Error('not wired'); },
        getServiceOrNull: () => null,
        toData: (o: unknown) => o as any,
        toObject: (d: unknown) => d as any,
        ...overrides,
    } as NodeEngine;
}

/** Stub partition owner lookup — returns a fixed address for any partition. */
function createMockNodeEngineWithPartitionOwner(ownerAddress: Address): NodeEngine {
    return createMockNodeEngine({
        getPartitionService: () => ({
            getPartitionCount: () => 271,
            getPartitionOwner: (pid: number) => ({ address: () => ownerAddress }),
        }) as any,
    });
}

const LOCAL_ADDRESS = new Address('127.0.0.1', 5701);

// ── Invocation base tests ────────────────────────────────────────────────

describe('Invocation', () => {
    test('initial state — invokeCount 0, not done', () => {
        const op = new DummyOp();
        const registry = new InvocationRegistry(100);
        const inv = new Invocation(op, registry, createMockNodeEngine(), LOCAL_ADDRESS);
        expect(inv.invokeCount).toBe(0);
        expect(inv.future.isDone()).toBe(false);
    });

    test('notifyNormalResponse with 0 backupAcks resolves future immediately', async () => {
        const op = new DummyOp();
        const registry = new InvocationRegistry(100);
        const inv = new Invocation(op, registry, createMockNodeEngine(), LOCAL_ADDRESS);
        registry.register(inv);
        inv.notifyNormalResponse('hello', 0);
        expect(inv.future.isDone()).toBe(true);
        expect(await inv.future.get()).toBe('hello');
    });

    test('notifyNormalResponse with backupAcks > 0 does not resolve until acks arrive', async () => {
        const op = new DummyOp();
        const registry = new InvocationRegistry(100);
        const inv = new Invocation(op, registry, createMockNodeEngine(), LOCAL_ADDRESS);
        registry.register(inv);
        inv.notifyNormalResponse('value', 2);
        expect(inv.future.isDone()).toBe(false);

        inv.notifyBackupComplete();
        expect(inv.future.isDone()).toBe(false);

        inv.notifyBackupComplete();
        expect(inv.future.isDone()).toBe(true);
        expect(await inv.future.get()).toBe('value');
    });

    test('backupsAcksReceived increments correctly on each notifyBackupComplete', () => {
        const op = new DummyOp();
        const registry = new InvocationRegistry(100);
        const inv = new Invocation(op, registry, createMockNodeEngine(), LOCAL_ADDRESS);
        registry.register(inv);
        inv.notifyNormalResponse('v', 3);

        expect(inv.backupsAcksReceived).toBe(0);
        inv.notifyBackupComplete();
        expect(inv.backupsAcksReceived).toBe(1);
        inv.notifyBackupComplete();
        expect(inv.backupsAcksReceived).toBe(2);
    });

    test('notifyError with non-retryable error rejects future', async () => {
        const op = new DummyOp();
        const registry = new InvocationRegistry(100);
        const inv = new Invocation(op, registry, createMockNodeEngine(), LOCAL_ADDRESS);
        registry.register(inv);
        const err = new Error('fatal');
        inv.notifyError(err);
        expect(inv.future.isDone()).toBe(true);
        await expect(inv.future.get()).rejects.toThrow('fatal');
    });

    test('notifyError with retryable error retries (invokeCount increments)', async () => {
        const op = new DummyOp();
        const registry = new InvocationRegistry(100);
        const nodeEngine = createMockNodeEngine();
        const inv = new Invocation(op, registry, nodeEngine, LOCAL_ADDRESS, {
            tryCount: 5,
            tryPauseMillis: 0,
        });
        registry.register(inv);

        // First invoke to set invokeCount to 1
        inv.invokeCount = 1;

        const err = new RetryableException('transient');
        inv.notifyError(err);

        // Should not be rejected — should retry
        expect(inv.future.isDone()).toBe(false);
        expect(inv.invokeCount).toBeGreaterThan(1);
    });

    test('notifyError with retryable error exhausts retries then rejects', async () => {
        const op = new DummyOp();
        const registry = new InvocationRegistry(100);
        const inv = new Invocation(op, registry, createMockNodeEngine(), LOCAL_ADDRESS, {
            tryCount: 2,
            tryPauseMillis: 0,
        });
        registry.register(inv);
        inv.invokeCount = 2; // at limit

        const err = new RetryableException('transient');
        inv.notifyError(err);

        expect(inv.future.isDone()).toBe(true);
        await expect(inv.future.get()).rejects.toThrow('transient');
    });

    test('handleRetry — first 5 retries are immediate (MAX_FAST_INVOCATION_COUNT)', () => {
        const op = new DummyOp();
        const registry = new InvocationRegistry(100);
        const inv = new Invocation(op, registry, createMockNodeEngine(), LOCAL_ADDRESS, {
            tryCount: 250,
            tryPauseMillis: 500,
        });
        registry.register(inv);

        // invokeCount 1..5 should be fast retries
        for (let i = 1; i <= 5; i++) {
            inv.invokeCount = i;
            // handleRetry should not use setTimeout for fast retries
            expect(inv.getRetryDelayMs()).toBe(0);
        }
        // invokeCount 6+ should have delay
        inv.invokeCount = 6;
        expect(inv.getRetryDelayMs()).toBeGreaterThan(0);
    });

    test('deregister removes invocation from registry', () => {
        const op = new DummyOp();
        const registry = new InvocationRegistry(100);
        const inv = new Invocation(op, registry, createMockNodeEngine(), LOCAL_ADDRESS);
        registry.register(inv);
        expect(registry.size).toBe(1);

        inv.deregister();
        expect(registry.size).toBe(0);
    });
});

// ── RetryableException hierarchy ─────────────────────────────────────────

describe('RetryableException hierarchy', () => {
    test('RetryableException is instanceof Error', () => {
        const e = new RetryableException('test');
        expect(e).toBeInstanceOf(Error);
        expect(e).toBeInstanceOf(RetryableException);
    });

    test('WrongTargetException is retryable', () => {
        const e = new WrongTargetException('wrong target');
        expect(e).toBeInstanceOf(RetryableException);
    });

    test('PartitionMigratingException is retryable', () => {
        const e = new PartitionMigratingException(42);
        expect(e).toBeInstanceOf(RetryableException);
        expect(e.message).toContain('42');
    });

    test('TargetNotMemberException is retryable', () => {
        const e = new TargetNotMemberException(new Address('127.0.0.1', 5701));
        expect(e).toBeInstanceOf(RetryableException);
    });

    test('MemberLeftException is retryable', () => {
        const e = new MemberLeftException('member-uuid');
        expect(e).toBeInstanceOf(RetryableException);
    });
});

// ── PartitionInvocation tests ────────────────────────────────────────────

describe('PartitionInvocation', () => {
    test('sets partitionId on operation', () => {
        const op = new DummyOp();
        const registry = new InvocationRegistry(100);
        const inv = new PartitionInvocation(op, registry, createMockNodeEngine(), LOCAL_ADDRESS, 42);
        expect(op.partitionId).toBe(42);
    });

    test('initInvocationTarget sets targetAddress from partition owner', () => {
        const ownerAddr = new Address('10.0.0.1', 5701);
        const op = new DummyOp();
        const registry = new InvocationRegistry(100);
        const nodeEngine = createMockNodeEngineWithPartitionOwner(ownerAddr);
        const inv = new PartitionInvocation(op, registry, nodeEngine, LOCAL_ADDRESS, 7);
        inv.initInvocationTarget();
        expect(inv.targetAddress).not.toBeNull();
        expect(inv.targetAddress!.equals(ownerAddr)).toBe(true);
    });
});

// ── TargetInvocation tests ───────────────────────────────────────────────

describe('TargetInvocation', () => {
    test('sets targetAddress to the provided address', () => {
        const op = new DummyOp();
        const registry = new InvocationRegistry(100);
        const target = new Address('10.0.0.2', 5702);
        const inv = new TargetInvocation(op, registry, createMockNodeEngine(), LOCAL_ADDRESS, target);
        expect(inv.targetAddress).not.toBeNull();
        expect(inv.targetAddress!.equals(target)).toBe(true);
    });

    test('initInvocationTarget keeps the fixed target address', () => {
        const op = new DummyOp();
        const registry = new InvocationRegistry(100);
        const target = new Address('10.0.0.3', 5703);
        const inv = new TargetInvocation(op, registry, createMockNodeEngine(), LOCAL_ADDRESS, target);
        const before = inv.targetAddress;
        inv.initInvocationTarget();
        expect(inv.targetAddress).toBe(before);
    });
});

// ── Backup ack timeout tests ─────────────────────────────────────────────

describe('Invocation backup ack timeout', () => {
    test('backup ack timeout fires resetAndReInvoke when primary gone', async () => {
        const op = new DummyOp();
        const registry = new InvocationRegistry(100);
        // nodeEngine where isRunning returns true but no member lookup
        const inv = new Invocation(op, registry, createMockNodeEngine(), LOCAL_ADDRESS, {
            tryCount: 250,
            tryPauseMillis: 0,
            backupAckTimeoutMillis: 50,
        });
        registry.register(inv);
        // simulate primary gone by having a different target than local
        inv.targetAddress = new Address('10.0.0.99', 5701);

        inv.notifyNormalResponse('value', 1);
        expect(inv.future.isDone()).toBe(false);

        // Wait for the backup ack timeout to fire
        await new Promise(r => setTimeout(r, 100));

        // Should have re-invoked (future still pending or resolved depending on re-invoke path)
        // The key invariant: the invocation was reset for re-invocation
        expect(inv.invokeCount).toBeGreaterThanOrEqual(1);
    });

    test('backup ack timeout resolves immediately when primary still alive (local)', async () => {
        const op = new DummyOp();
        const registry = new InvocationRegistry(100);
        const inv = new Invocation(op, registry, createMockNodeEngine(), LOCAL_ADDRESS, {
            tryCount: 250,
            tryPauseMillis: 0,
            backupAckTimeoutMillis: 50,
        });
        registry.register(inv);
        // target is local — primary is alive
        inv.targetAddress = LOCAL_ADDRESS;

        inv.notifyNormalResponse('value', 1);
        expect(inv.future.isDone()).toBe(false);

        // Wait for backup ack timeout
        await new Promise(r => setTimeout(r, 100));

        // Should complete with value since primary is alive
        expect(inv.future.isDone()).toBe(true);
        expect(await inv.future.get()).toBe('value');
    });
});
