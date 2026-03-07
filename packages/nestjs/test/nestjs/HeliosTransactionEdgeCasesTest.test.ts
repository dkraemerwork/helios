/**
 * Block 6.5 — HeliosTransactionManager edge-case and module-level tests.
 *
 * Additional coverage for scenarios from:
 *   hazelcast-spring-tests/.../transaction/TestSpringManagedHazelcastTransaction.java
 *     noExceptionWithoutTimeoutValue
 *     transactionTimeoutTakesPrecedenceOverTransactionManagerDefaultTimeout
 *     @DirtiesContext scenarios
 */

import { Test, TestingModule } from '@nestjs/testing';
import type { TransactionContext, TransactionalMap } from '@zenystx/helios-core/transaction/TransactionContext';
import { TransactionTimedOutException } from '@zenystx/helios-core/transaction/TransactionTimedOutException';
import type { TransactionContextFactory } from '@zenystx/helios-nestjs/HeliosTransactionManager';
import { HeliosTransactionManager } from '@zenystx/helios-nestjs/HeliosTransactionManager';
import { HeliosTransactionModule } from '@zenystx/helios-nestjs/HeliosTransactionModule';
import { ManagedTransactionalTaskContext } from '@zenystx/helios-nestjs/ManagedTransactionalTaskContext';
import { NoTransactionException, TransactionSystemException } from '@zenystx/helios-nestjs/TransactionExceptions';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock infrastructure
// ---------------------------------------------------------------------------

interface MockCtx extends TransactionContext {
    store: Map<unknown, unknown>;
    beginCount: number;
    commitCount: number;
    rollbackCount: number;
    commitError?: Error;
}

function makeMockCtx(commitError?: Error): MockCtx {
    const ctx: MockCtx = {
        store: new Map(),
        beginCount: 0,
        commitCount: 0,
        rollbackCount: 0,
        commitError,
        beginTransaction() { ctx.beginCount++; },
        commitTransaction() {
            ctx.commitCount++;
            if (ctx.commitError) throw ctx.commitError;
        },
        rollbackTransaction() { ctx.rollbackCount++; },
        getMap<K, V>(_name: string): TransactionalMap<K, V> {
            const s = ctx.store as Map<K, V>;
            return {
                put: (k, v) => { const prev = s.get(k); s.set(k, v); return prev; },
                get: k => s.get(k),
                size: () => s.size,
            };
        },
    };
    return ctx;
}

function makeFactory(ctx: MockCtx): TransactionContextFactory {
    return { create: () => ctx };
}

// ---------------------------------------------------------------------------
// Java: noExceptionWithoutTimeoutValue — transaction completes with no timeout
// ---------------------------------------------------------------------------

describe('HeliosTransactionManager — no-timeout scenarios', () => {
    let mgr: HeliosTransactionManager;
    let ctx: MockCtx;

    beforeEach(() => {
        ctx = makeMockCtx();
        mgr = new HeliosTransactionManager(makeFactory(ctx));
        HeliosTransactionManager.setCurrent(mgr);
    });

    afterEach(() => {
        HeliosTransactionManager.setCurrent(null);
    });

    // Java: noExceptionWithoutTimeoutValue
    it('transaction completes successfully with no timeout configured', async () => {
        await mgr.run(() => {
            ctx.getMap<string, string>('orders').put('k', 'v');
        });
        expect(ctx.commitCount).toBe(1);
        expect(ctx.store.size).toBe(1);
    });

    // Java: transactionTimeoutTakesPrecedenceOverTransactionManagerDefaultTimeout
    it('per-run timeout overrides manager default timeout', async () => {
        let capturedTimeout: number | undefined;
        const capturingFactory: TransactionContextFactory = {
            create(opts) {
                capturedTimeout = opts?.timeoutSecs;
                return makeMockCtx();
            },
        };
        const m = new HeliosTransactionManager(capturingFactory);
        m.setDefaultTimeout(30); // manager default
        HeliosTransactionManager.setCurrent(m);

        await m.run(() => { /* no-op */ }, { timeout: 5 }); // method-level wins

        expect(capturedTimeout).toBe(5);
    });

    // Java: transactionTimedOutExceptionWhenTimeoutValueIsSetForTransaction
    it('TransactionTimedOutException from commit is wrapped in TransactionSystemException', async () => {
        const timeoutErr = new TransactionTimedOutException('Transaction is timed-out!');
        const errorCtx = makeMockCtx(timeoutErr);
        const m = new HeliosTransactionManager(makeFactory(errorCtx));
        HeliosTransactionManager.setCurrent(m);

        let caught: Error | undefined;
        try {
            await m.run(() => { /* no-op */ });
        } catch (e) {
            caught = e as Error;
        }

        expect(caught).toBeInstanceOf(TransactionSystemException);
        expect((caught as TransactionSystemException).cause).toBeInstanceOf(TransactionTimedOutException);
        expect((caught as TransactionSystemException).cause?.message).toBe('Transaction is timed-out!');
    });

    // Manager default timeout = -1 means no timeout
    it('getDefaultTimeout() returns -1 by default (no timeout)', () => {
        const m = new HeliosTransactionManager(makeFactory(ctx));
        expect(m.getDefaultTimeout()).toBe(-1);
    });

    // Updating default timeout
    it('setDefaultTimeout() updates the default timeout value', () => {
        mgr.setDefaultTimeout(60);
        expect(mgr.getDefaultTimeout()).toBe(60);
    });
});

// ---------------------------------------------------------------------------
// HeliosTransactionModule — forRoot / lifecycle tests
// ---------------------------------------------------------------------------

describe('HeliosTransactionModule — module lifecycle and providers', () => {
    let module: TestingModule;

    afterEach(async () => {
        HeliosTransactionManager.setCurrent(null);
        if (module) await module.close();
    });

    it('module can be compiled and closed without error', async () => {
        const ctx = makeMockCtx();
        module = await Test.createTestingModule({
            imports: [HeliosTransactionModule.register(makeFactory(ctx))],
        }).compile();
        await module.close();
        // reset to allow afterEach to call close safely
        module = null as unknown as TestingModule;
    });

    it('two separate module compilations produce independent transaction managers', async () => {
        const ctx1 = makeMockCtx();
        const ctx2 = makeMockCtx();

        const mod1 = await Test.createTestingModule({
            imports: [HeliosTransactionModule.register(makeFactory(ctx1))],
        }).compile();

        const mod2 = await Test.createTestingModule({
            imports: [HeliosTransactionModule.register(makeFactory(ctx2))],
        }).compile();

        const mgr1 = mod1.get(HeliosTransactionManager);
        const mgr2 = mod2.get(HeliosTransactionManager);

        expect(mgr1).not.toBe(mgr2);

        await mgr1.run(() => {});
        await mgr2.run(() => {});

        expect(ctx1.commitCount).toBe(1);
        expect(ctx2.commitCount).toBe(1);

        await mod1.close();
        await mod2.close();
    });

    it('ManagedTransactionalTaskContext.getMap() works inside run()', async () => {
        const ctx = makeMockCtx();
        module = await Test.createTestingModule({
            imports: [HeliosTransactionModule.register(makeFactory(ctx))],
        }).compile();

        const txMgr = module.get(HeliosTransactionManager);
        const taskCtx = module.get(ManagedTransactionalTaskContext);

        let map: TransactionalMap<string, string> | null = null;
        await txMgr.run(() => {
            map = taskCtx.getMap<string, string>('test');
            map.put('hello', 'world');
        });

        expect(map).not.toBeNull();
        expect(ctx.store.get('hello')).toBe('world');
        expect(ctx.commitCount).toBe(1);
    });

    it('isInTransaction() false before any run()', async () => {
        const ctx = makeMockCtx();
        module = await Test.createTestingModule({
            imports: [HeliosTransactionModule.register(makeFactory(ctx))],
        }).compile();

        const txMgr = module.get(HeliosTransactionManager);
        expect(txMgr.isInTransaction()).toBe(false);
    });

    it('NoTransactionException thrown when getTransactionContext() called outside run()', async () => {
        const ctx = makeMockCtx();
        module = await Test.createTestingModule({
            imports: [HeliosTransactionModule.register(makeFactory(ctx))],
        }).compile();

        const txMgr = module.get(HeliosTransactionManager);
        expect(() => txMgr.getTransactionContext()).toThrow(NoTransactionException);
    });
});
