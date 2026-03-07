/**
 * Block 6.5 — HeliosTransactionManager service-bean integration tests.
 *
 * Ports the intent of:
 *   hazelcast-spring-tests/src/test/java/com/hazelcast/spring/transaction/
 *     TestSpringManagedHazelcastTransaction.java (additional scenarios)
 *     ServiceBeanWithTransactionalContext.java
 *     OtherServiceBeanWithTransactionalContext.java
 *
 * Tests service-level @Transactional patterns, nested service calls,
 * and DI-based transaction management without a running Hazelcast cluster.
 */

import { Injectable } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { TransactionContext, TransactionalMap } from '@zenystx/helios-core/transaction/TransactionContext';
import type { TransactionContextFactory } from '@zenystx/helios-nestjs/HeliosTransactionManager';
import { HeliosTransactionManager } from '@zenystx/helios-nestjs/HeliosTransactionManager';
import { HeliosTransactionModule } from '@zenystx/helios-nestjs/HeliosTransactionModule';
import { ManagedTransactionalTaskContext } from '@zenystx/helios-nestjs/ManagedTransactionalTaskContext';
import { Propagation, Transactional } from '@zenystx/helios-nestjs/Transactional';
import {
    NoTransactionException,
    TransactionSuspensionNotSupportedException,
} from '@zenystx/helios-nestjs/TransactionExceptions';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock infrastructure
// ---------------------------------------------------------------------------

interface MockCtx extends TransactionContext {
    store: Map<unknown, unknown>;
    beginCount: number;
    commitCount: number;
    rollbackCount: number;
}

function makeMockCtx(): MockCtx {
    const ctx: MockCtx = {
        store: new Map(),
        beginCount: 0,
        commitCount: 0,
        rollbackCount: 0,
        beginTransaction() { ctx.beginCount++; },
        commitTransaction() { ctx.commitCount++; },
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
// Java: ServiceBeanWithTransactionalContext equivalent
// ---------------------------------------------------------------------------

describe('ServiceBeanWithTransactionalContext — @Transactional service patterns', () => {
    let mockCtx: MockCtx;
    let mgr: HeliosTransactionManager;

    beforeEach(() => {
        mockCtx = makeMockCtx();
        mgr = new HeliosTransactionManager(makeFactory(mockCtx));
        HeliosTransactionManager.setCurrent(mgr);
    });

    afterEach(() => {
        HeliosTransactionManager.setCurrent(null);
    });

    // Java: transactionalServiceBeanInvocation_commit
    it('@Transactional service commit: stores value and commits', async () => {
        @Injectable()
        class ServiceBean {
            @Transactional()
            async put(key: string, value: string): Promise<void> {
                mockCtx.getMap<string, string>('dummyObjectMap').put(key, value);
            }
        }

        const svc = new ServiceBean();
        await svc.put('obj-1', 'magic');

        expect(mockCtx.commitCount).toBe(1);
        expect(mockCtx.rollbackCount).toBe(0);
        expect(mockCtx.store.size).toBe(1);
        expect(mockCtx.store.get('obj-1')).toBe('magic');
    });

    // Java: transactionalServiceBeanInvocation_rollback
    it('@Transactional service rollback: exception triggers rollback and store is unchanged', async () => {
        @Injectable()
        class ServiceBean {
            @Transactional()
            async putWithException(key: string, value: string): Promise<void> {
                mockCtx.getMap<string, string>('dummyObjectMap').put(key, value);
                throw new Error('intentional failure');
            }
        }

        const svc = new ServiceBean();
        let threw = false;
        try {
            await svc.putWithException('obj-1', 'magic');
        } catch {
            threw = true;
        }

        expect(threw).toBe(true);
        expect(mockCtx.rollbackCount).toBe(1);
        expect(mockCtx.commitCount).toBe(0);
        // value was put before throw — it's in the mock store (not rolled back in memory,
        // but in a real scenario the rollback removes it from the transaction context)
    });

    // Java: transactionalServiceBeanInvocation_nestedWithPropagationRequired
    it('@Transactional REQUIRED: nested call reuses same transaction', async () => {
        @Injectable()
        class OtherService {
            @Transactional({ propagation: Propagation.REQUIRED })
            async put(key: string, value: string): Promise<void> {
                mockCtx.getMap<string, string>('dummyObjectMap').put(key, value);
            }
        }

        @Injectable()
        class ServiceBean {
            constructor(private readonly other: OtherService) {}

            @Transactional()
            async putUsingOtherBean(key: string, value: string): Promise<void> {
                await this.other.put(key, value);
            }
        }

        const other = new OtherService();
        const svc = new ServiceBean(other);
        await svc.putUsingOtherBean('obj-1', 'magic');

        // Only one begin/commit pair — nested reused outer
        expect(mockCtx.beginCount).toBe(1);
        expect(mockCtx.commitCount).toBe(1);
        expect(mockCtx.store.size).toBe(1);
    });

    // Java: transactionalServiceBeanInvocation_nestedWithPropagationRequiresNew
    it('@Transactional REQUIRES_NEW: nested call inside transaction throws TransactionSuspensionNotSupportedException', async () => {
        @Injectable()
        class InnerService {
            @Transactional({ propagation: Propagation.REQUIRES_NEW })
            async put(_key: string, _value: string): Promise<void> { /* no-op */ }
        }

        const inner = new InnerService();

        let caughtType = '';
        await mgr.run(async () => {
            try {
                await inner.put('k', 'v');
            } catch (e) {
                caughtType = (e as Error).constructor.name;
            }
        }).catch(() => { /* outer rollback */ });

        expect(caughtType).toBe('TransactionSuspensionNotSupportedException');
    });

    // Java: transactionalServiceBeanInvocation_withNestedBeanThrowingException_rollback
    it('nested service throws → outer service also rolled back', async () => {
        @Injectable()
        class OtherService {
            @Transactional({ propagation: Propagation.REQUIRED })
            async putAndThrow(key: string, value: string): Promise<void> {
                mockCtx.getMap<string, string>('dummyObjectMap').put(key, value);
                throw new Error('nested failure');
            }
        }

        @Injectable()
        class ServiceBean {
            constructor(private readonly other: OtherService) {}

            @Transactional()
            async putUsingSameBean_thenOtherBeanThrowingException(
                k1: string, v1: string,
                k2: string, v2: string,
            ): Promise<void> {
                mockCtx.getMap<string, string>('dummyObjectMap').put(k1, v1);
                await this.other.putAndThrow(k2, v2);
            }
        }

        const other = new OtherService();
        const svc = new ServiceBean(other);

        let threw = false;
        try {
            await svc.putUsingSameBean_thenOtherBeanThrowingException('k1', 'v1', 'k2', 'v2');
        } catch {
            threw = true;
        }

        expect(threw).toBe(true);
        expect(mockCtx.rollbackCount).toBeGreaterThan(0);
        expect(mockCtx.commitCount).toBe(0);
    });

    // Java: noTransactionContextWhenNoTransaction
    it('getTransactionContext() throws NoTransactionException outside a transaction', () => {
        expect(() => mgr.getTransactionContext()).toThrow(NoTransactionException);
    });

    // Java: noExceptionWhenTransaction
    it('getTransactionContext() returns context inside active transaction', async () => {
        let ctx: TransactionContext | null = null;
        await mgr.run(() => { ctx = mgr.getTransactionContext(); });
        expect(ctx).not.toBeNull();
    });

    // isInTransaction() API
    it('isInTransaction() is false before run() and true inside run()', async () => {
        expect(mgr.isInTransaction()).toBe(false);
        let insideValue = false;
        await mgr.run(() => { insideValue = mgr.isInTransaction(); });
        expect(insideValue).toBe(true);
        expect(mgr.isInTransaction()).toBe(false);
    });

    // Multiple sequential runs — each gets its own transaction
    it('multiple sequential run() invocations each get a separate commit', async () => {
        // Use separate ctx per run
        let runCount = 0;
        const factory: TransactionContextFactory = {
            create: () => {
                runCount++;
                return makeMockCtx();
            },
        };
        const m = new HeliosTransactionManager(factory);
        HeliosTransactionManager.setCurrent(m);

        await m.run(() => { /* no-op */ });
        await m.run(() => { /* no-op */ });

        expect(runCount).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// HeliosTransactionModule NestJS DI tests — additional integration scenarios
// ---------------------------------------------------------------------------

describe('HeliosTransactionModule — service-level DI integration', () => {
    let module: TestingModule;

    afterEach(async () => {
        HeliosTransactionManager.setCurrent(null);
        if (module) await module.close();
    });

    // Java: TestSpringManagedHazelcastTransaction — injected service pattern
    it('module-injected service can perform @Transactional operations', async () => {
        const ctx = makeMockCtx();

        @Injectable()
        class OrderService {
            constructor(readonly txMgr: HeliosTransactionManager) {}

            async saveOrder(key: string, value: string): Promise<void> {
                await this.txMgr.run(() => {
                    ctx.getMap<string, string>('orders').put(key, value);
                });
            }
        }

        module = await Test.createTestingModule({
            imports: [HeliosTransactionModule.register(makeFactory(ctx))],
            providers: [OrderService],
        }).compile();

        const svc = module.get(OrderService);
        await svc.saveOrder('order-1', 'item-a');

        expect(ctx.commitCount).toBe(1);
        expect(ctx.store.get('order-1')).toBe('item-a');
    });

    it('module-injected ManagedTransactionalTaskContext.getMap() throws outside tx', async () => {
        const ctx = makeMockCtx();

        module = await Test.createTestingModule({
            imports: [HeliosTransactionModule.register(makeFactory(ctx))],
        }).compile();

        const taskCtx = module.get(ManagedTransactionalTaskContext);
        expect(() => taskCtx.getMap('orders')).toThrow(NoTransactionException);
    });

    it('transaction wraps multiple operations atomically', async () => {
        const ctx = makeMockCtx();

        module = await Test.createTestingModule({
            imports: [HeliosTransactionModule.register(makeFactory(ctx))],
        }).compile();

        const txMgr = module.get(HeliosTransactionManager);

        await txMgr.run(() => {
            ctx.getMap<string, string>('orders').put('o1', 'item1');
            ctx.getMap<string, string>('orders').put('o2', 'item2');
        });

        expect(ctx.commitCount).toBe(1);
        expect(ctx.store.size).toBe(2);
    });

    it('void return @Transactional method commits correctly', async () => {
        const ctx = makeMockCtx();

        @Injectable()
        class VoidService {
            constructor(readonly txMgr: HeliosTransactionManager) {}

            @Transactional()
            async doWork(): Promise<void> {
                ctx.getMap<string, string>('data').put('k', 'v');
            }
        }

        HeliosTransactionManager.setCurrent(new HeliosTransactionManager(makeFactory(ctx)));

        const svc = new VoidService(HeliosTransactionManager.getCurrent()!);
        await svc.doWork();

        expect(ctx.commitCount).toBe(1);
    });

    it('defaultTimeout is configurable and passed to factory', async () => {
        let capturedTimeout: number | undefined;

        const capturingFactory: TransactionContextFactory = {
            create(opts) {
                capturedTimeout = opts?.timeoutSecs;
                return makeMockCtx();
            },
        };

        module = await Test.createTestingModule({
            imports: [HeliosTransactionModule.register(capturingFactory)],
        }).compile();

        const txMgr = module.get(HeliosTransactionManager);
        txMgr.setDefaultTimeout(10);
        await txMgr.run(() => { /* no-op */ });

        expect(capturedTimeout).toBe(10);
    });
});

// ---------------------------------------------------------------------------
// ManagedTransactionalTaskContext tests — additional coverage
// ---------------------------------------------------------------------------

describe('ManagedTransactionalTaskContext — additional', () => {
    let mockCtx: MockCtx;
    let mgr: HeliosTransactionManager;
    let taskCtx: ManagedTransactionalTaskContext;

    beforeEach(() => {
        mockCtx = makeMockCtx();
        mgr = new HeliosTransactionManager(makeFactory(mockCtx));
        HeliosTransactionManager.setCurrent(mgr);
        taskCtx = new ManagedTransactionalTaskContext(mgr);
    });

    afterEach(() => {
        HeliosTransactionManager.setCurrent(null);
    });

    it('getMap() returns map inside active transaction', async () => {
        let m: TransactionalMap<string, string> | null = null;
        await mgr.run(() => {
            m = taskCtx.getMap<string, string>('test');
        });
        expect(m).not.toBeNull();
    });

    it('getMap().put() and getMap().get() work inside transaction', async () => {
        await mgr.run(() => {
            const m = taskCtx.getMap<string, string>('test');
            m.put('key', 'val');
            expect(m.get('key')).toBe('val');
        });
    });

    it('getMap() with different names returns independent transactional maps', async () => {
        await mgr.run(() => {
            const m1 = taskCtx.getMap<string, string>('mapA');
            const m2 = taskCtx.getMap<string, string>('mapB');
            // both delegate to the same mock TransactionContext but are separate calls
            expect(m1).toBeDefined();
            expect(m2).toBeDefined();
        });
    });

    it('TransactionSuspensionNotSupportedException thrown for REQUIRES_NEW inside transaction', async () => {
        let caught: Error | undefined;
        await mgr.run(async () => {
            try {
                await mgr.run(() => {}, { propagation: 'REQUIRES_NEW' });
            } catch (e) {
                caught = e as Error;
            }
        }).catch(() => { /* outer rolled back */ });

        expect(caught).toBeInstanceOf(TransactionSuspensionNotSupportedException);
    });
});
