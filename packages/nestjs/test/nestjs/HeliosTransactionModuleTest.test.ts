/**
 * Tests for Block 6.3 — HeliosTransactionModule
 *
 * Ports the core semantics of TestSpringManagedHazelcastTransaction using
 * mock TransactionContext objects (no real Helios cluster needed).
 *
 * Java source:
 *   hazelcast-spring/src/main/java/com/hazelcast/spring/transaction/
 *   hazelcast-spring-tests/src/test/java/com/hazelcast/spring/transaction/
 */

import { Injectable } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { TransactionContext, TransactionalMap } from '@zenystx/helios-core/transaction/TransactionContext';
import { TransactionTimedOutException } from '@zenystx/helios-core/transaction/TransactionTimedOutException';
import type { TransactionContextFactory } from '@zenystx/helios-nestjs/HeliosTransactionManager';
import { HeliosTransactionManager } from '@zenystx/helios-nestjs/HeliosTransactionManager';
import { HeliosTransactionModule } from '@zenystx/helios-nestjs/HeliosTransactionModule';
import { ManagedTransactionalTaskContext } from '@zenystx/helios-nestjs/ManagedTransactionalTaskContext';
import { Propagation, Transactional } from '@zenystx/helios-nestjs/Transactional';
import {
    NoTransactionException,
    TransactionSuspensionNotSupportedException,
    TransactionSystemException,
} from '@zenystx/helios-nestjs/TransactionExceptions';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock TransactionContext builder
// ---------------------------------------------------------------------------

interface MockTransactionContext extends TransactionContext {
    beginCount: number;
    commitCount: number;
    rollbackCount: number;
    store: Map<unknown, unknown>;
    /** If set, commitTransaction() throws this error */
    commitError?: Error;
}

function makeMockContext(commitError?: Error): MockTransactionContext {
    const ctx: MockTransactionContext = {
        beginCount: 0,
        commitCount: 0,
        rollbackCount: 0,
        store: new Map(),
        commitError,
        beginTransaction(): void {
            ctx.beginCount++;
        },
        commitTransaction(): void {
            ctx.commitCount++;
            if (ctx.commitError) throw ctx.commitError;
        },
        rollbackTransaction(): void {
            ctx.rollbackCount++;
        },
        getMap<K, V>(name: string): TransactionalMap<K, V> {
            const store = ctx.store as Map<K, V>;
            return {
                put(key: K, value: V): V | undefined {
                    const prev = store.get(key);
                    store.set(key, value);
                    return prev;
                },
                get(key: K): V | undefined {
                    return store.get(key);
                },
                size(): number {
                    return store.size;
                },
            };
        },
    };
    return ctx;
}

function makeFactory(ctx?: MockTransactionContext): TransactionContextFactory & { lastCtx: MockTransactionContext | null } {
    const factory = {
        lastCtx: null as MockTransactionContext | null,
        create(): TransactionContext {
            const c = ctx ?? makeMockContext();
            factory.lastCtx = c;
            return c;
        },
    };
    return factory;
}

// ---------------------------------------------------------------------------
// HeliosTransactionManager unit tests
// ---------------------------------------------------------------------------

describe('HeliosTransactionManager', () => {

    let mgr: HeliosTransactionManager;
    let factory: ReturnType<typeof makeFactory>;

    beforeEach(() => {
        factory = makeFactory();
        mgr = new HeliosTransactionManager(factory);
        HeliosTransactionManager.setCurrent(mgr);
    });

    afterEach(() => {
        HeliosTransactionManager.setCurrent(null);
    });

    // Test 1 (Java: noTransactionContextWhenNoTransaction)
    it('throws NoTransactionException when no active transaction', () => {
        expect(() => mgr.getTransactionContext()).toThrow(NoTransactionException);
    });

    // Test 2 (Java: noExceptionWhenTransaction)
    it('returns transaction context within active run()', async () => {
        let ctx: TransactionContext | null = null;
        await mgr.run(() => {
            ctx = mgr.getTransactionContext();
        });
        expect(ctx).not.toBeNull();
    });

    // Test 3 (Java: transactionalServiceBeanInvocation_commit)
    it('run() commits transaction on success', async () => {
        const mockCtx = makeMockContext();
        const f = makeFactory(mockCtx);
        const m = new HeliosTransactionManager(f);
        HeliosTransactionManager.setCurrent(m);

        await m.run(() => {
            mockCtx.getMap('test').put('k', 'v');
        });

        expect(mockCtx.beginCount).toBe(1);
        expect(mockCtx.commitCount).toBe(1);
        expect(mockCtx.rollbackCount).toBe(0);
        expect(mockCtx.store.size).toBe(1);
    });

    // Test 4 (Java: transactionalServiceBeanInvocation_rollback)
    it('run() rolls back transaction on exception and rethrows', async () => {
        const mockCtx = makeMockContext();
        const f = makeFactory(mockCtx);
        const m = new HeliosTransactionManager(f);
        HeliosTransactionManager.setCurrent(m);

        let thrown = false;
        try {
            await m.run(() => {
                mockCtx.getMap('test').put('k', 'v');
                throw new Error('oops');
            });
        } catch {
            thrown = true;
        }

        expect(thrown).toBe(true);
        expect(mockCtx.commitCount).toBe(0);
        expect(mockCtx.rollbackCount).toBe(1);
        expect(mockCtx.store.size).toBe(1); // value was put before the throw
    });

    // Test 5 (Java: transactionTimedOutException via commit failure)
    it('wraps TransactionTimedOutException in TransactionSystemException on commit', async () => {
        const timeoutError = new TransactionTimedOutException('Transaction is timed-out!');
        const mockCtx = makeMockContext(timeoutError);
        const f = makeFactory(mockCtx);
        const m = new HeliosTransactionManager(f);
        HeliosTransactionManager.setCurrent(m);

        let caught: Error | undefined;
        try {
            await m.run(() => {/* no-op */});
        } catch (e) {
            caught = e as Error;
        }

        expect(caught).toBeInstanceOf(TransactionSystemException);
        const root = (caught as TransactionSystemException).cause;
        expect(root).toBeInstanceOf(TransactionTimedOutException);
        expect(root?.message).toBe('Transaction is timed-out!');
    });

    // Test 6 (Java: transactionalServiceBeanInvocation_nestedWithPropagationRequired)
    it('REQUIRED propagation reuses existing transaction', async () => {
        const mockCtx = makeMockContext();
        const f = makeFactory(mockCtx);
        const m = new HeliosTransactionManager(f);
        HeliosTransactionManager.setCurrent(m);

        await m.run(async () => {
            // nested REQUIRED — should NOT begin a new transaction
            await m.run(
                () => { mockCtx.getMap('test').put('k', 'v'); },
                { propagation: Propagation.REQUIRED },
            );
        });

        // Only one begin/commit pair (outer)
        expect(mockCtx.beginCount).toBe(1);
        expect(mockCtx.commitCount).toBe(1);
        expect(mockCtx.rollbackCount).toBe(0);
    });

    // Test 7 (Java: transactionalServiceBeanInvocation_nestedWithPropagationRequiresNew)
    it('REQUIRES_NEW propagation throws when already in a transaction', async () => {
        const mockCtx = makeMockContext();
        const f = makeFactory(mockCtx);
        const m = new HeliosTransactionManager(f);
        HeliosTransactionManager.setCurrent(m);

        let thrown = false;
        try {
            await m.run(async () => {
                await m.run(
                    () => {},
                    { propagation: Propagation.REQUIRES_NEW },
                );
            });
        } catch (e) {
            thrown = e instanceof TransactionSuspensionNotSupportedException;
        }

        expect(thrown).toBe(true);
        // Outer was rolled back because nested threw
        expect(mockCtx.rollbackCount).toBeGreaterThan(0);
    });

    // Test 8 — default timeout is passed through to factory
    it('respects defaultTimeoutSecs when set on manager', async () => {
        let capturedTimeoutSecs: number | undefined;
        const captureFactory: TransactionContextFactory & { lastCtx: MockTransactionContext | null } = {
            lastCtx: null,
            create(opts) {
                capturedTimeoutSecs = opts?.timeoutSecs;
                const c = makeMockContext();
                captureFactory.lastCtx = c;
                return c;
            },
        };
        const m = new HeliosTransactionManager(captureFactory);
        m.setDefaultTimeout(3);
        HeliosTransactionManager.setCurrent(m);

        await m.run(() => {/* no-op */});

        expect(capturedTimeoutSecs).toBe(3);
    });

    // Test 9 — method-level timeout takes precedence
    it('method-level timeout takes precedence over manager default', async () => {
        let capturedTimeoutSecs: number | undefined;
        const captureFactory: TransactionContextFactory & { lastCtx: MockTransactionContext | null } = {
            lastCtx: null,
            create(opts) {
                capturedTimeoutSecs = opts?.timeoutSecs;
                const c = makeMockContext();
                captureFactory.lastCtx = c;
                return c;
            },
        };
        const m = new HeliosTransactionManager(captureFactory);
        m.setDefaultTimeout(5); // manager default = 5s
        HeliosTransactionManager.setCurrent(m);

        await m.run(() => {/* no-op */}, { timeout: 2 }); // method-level = 2s

        expect(capturedTimeoutSecs).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// @Transactional decorator tests
// ---------------------------------------------------------------------------

describe('@Transactional decorator', () => {

    let mockCtx: MockTransactionContext;
    let mgr: HeliosTransactionManager;

    beforeEach(() => {
        mockCtx = makeMockContext();
        const f = makeFactory(mockCtx);
        mgr = new HeliosTransactionManager(f);
        HeliosTransactionManager.setCurrent(mgr);
    });

    afterEach(() => {
        HeliosTransactionManager.setCurrent(null);
    });

    // Test 10 (Java: @Transactional service commit)
    it('@Transactional wraps method in transaction and commits', async () => {
        @Injectable()
        class MyService {
            @Transactional()
            async doWork(): Promise<void> {
                mockCtx.getMap('test').put('key', 'val');
            }
        }

        const svc = new MyService();
        await svc.doWork();

        expect(mockCtx.beginCount).toBe(1);
        expect(mockCtx.commitCount).toBe(1);
        expect(mockCtx.rollbackCount).toBe(0);
        expect(mockCtx.store.get('key')).toBe('val');
    });

    // Test 11 (Java: @Transactional service rollback)
    it('@Transactional rolls back when method throws', async () => {
        @Injectable()
        class MyService {
            @Transactional()
            async doWork(): Promise<void> {
                mockCtx.getMap('test').put('key', 'val');
                throw new Error('app error');
            }
        }

        const svc = new MyService();
        let threw = false;
        try {
            await svc.doWork();
        } catch {
            threw = true;
        }

        expect(threw).toBe(true);
        expect(mockCtx.rollbackCount).toBe(1);
        expect(mockCtx.commitCount).toBe(0);
    });

    // Test 12 — @Transactional REQUIRES_NEW inside existing transaction
    it('@Transactional(REQUIRES_NEW) throws when called from within a transaction', async () => {
        @Injectable()
        class InnerService {
            @Transactional({ propagation: Propagation.REQUIRES_NEW })
            async doWork(): Promise<void> { /* no-op */ }
        }

        const inner = new InnerService();

        let caughtType = '';
        await mgr.run(async () => {
            try {
                await inner.doWork();
            } catch (e) {
                caughtType = (e as Error).constructor.name;
            }
        }).catch(() => {/* outer rollback on nested throw is OK */});

        expect(caughtType).toBe('TransactionSuspensionNotSupportedException');
    });
});

// ---------------------------------------------------------------------------
// ManagedTransactionalTaskContext tests
// ---------------------------------------------------------------------------

describe('ManagedTransactionalTaskContext', () => {

    let mockCtx: MockTransactionContext;
    let mgr: HeliosTransactionManager;
    let taskCtx: ManagedTransactionalTaskContext;

    beforeEach(() => {
        mockCtx = makeMockContext();
        const f = makeFactory(mockCtx);
        mgr = new HeliosTransactionManager(f);
        HeliosTransactionManager.setCurrent(mgr);
        taskCtx = new ManagedTransactionalTaskContext(mgr);
    });

    afterEach(() => {
        HeliosTransactionManager.setCurrent(null);
    });

    // Test 13 (Java: noTransactionContextWhenNoTransaction on getMap)
    it('getMap throws NoTransactionException outside transaction', () => {
        expect(() => taskCtx.getMap('test')).toThrow(NoTransactionException);
    });

    // Test 14 (Java: noExceptionWhenTransaction on getMap)
    it('getMap returns map proxy inside active transaction', async () => {
        let result: TransactionalMap<unknown, unknown> | null = null;
        await mgr.run(() => {
            result = taskCtx.getMap('dummyObjectMap');
        });
        expect(result).not.toBeNull();
    });
});

// ---------------------------------------------------------------------------
// HeliosTransactionModule NestJS integration tests
// ---------------------------------------------------------------------------

describe('HeliosTransactionModule', () => {

    let module: TestingModule;

    afterEach(async () => {
        HeliosTransactionManager.setCurrent(null);
        if (module) await module.close();
    });

    // Test 15
    it('provides HeliosTransactionManager', async () => {
        const ctx = makeMockContext();
        const f = makeFactory(ctx);

        module = await Test.createTestingModule({
            imports: [HeliosTransactionModule.register(f)],
        }).compile();

        const txMgr = module.get(HeliosTransactionManager);
        expect(txMgr).toBeInstanceOf(HeliosTransactionManager);
    });

    // Test 16
    it('provides ManagedTransactionalTaskContext', async () => {
        const ctx = makeMockContext();
        const f = makeFactory(ctx);

        module = await Test.createTestingModule({
            imports: [HeliosTransactionModule.register(f)],
        }).compile();

        const taskCtx = module.get(ManagedTransactionalTaskContext);
        expect(taskCtx).toBeInstanceOf(ManagedTransactionalTaskContext);
    });

    // Test 17 — registered manager works end-to-end
    it('module-registered manager can commit a transaction', async () => {
        const mockCtx = makeMockContext();
        const f = makeFactory(mockCtx);

        module = await Test.createTestingModule({
            imports: [HeliosTransactionModule.register(f)],
        }).compile();

        const txMgr = module.get(HeliosTransactionManager);
        await txMgr.run(() => {
            mockCtx.getMap('test').put('k', 'v');
        });

        expect(mockCtx.commitCount).toBe(1);
        expect(mockCtx.store.get('k')).toBe('v');
    });
});
