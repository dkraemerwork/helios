/**
 * Block 9.4 — DI-based @Transactional resolution tests.
 *
 * Verifies that the @Transactional() decorator can resolve the
 * HeliosTransactionManager from a DI-injected constructor property on `this`,
 * rather than relying on the global static singleton.
 *
 * This enables:
 * - Test isolation: each test module uses its own manager
 * - Multi-instance support: two Helios instances → two independent managers
 * - No global side-effects from HeliosTransactionManager.setCurrent()
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { Test, TestingModule } from '@nestjs/testing';
import { Injectable } from '@nestjs/common';
import { HeliosTransactionManager } from '@helios/nestjs/HeliosTransactionManager';
import { Transactional, Propagation } from '@helios/nestjs/Transactional';
import { HeliosTransactionModule } from '@helios/nestjs/HeliosTransactionModule';
import {
    TransactionSuspensionNotSupportedException,
} from '@helios/nestjs/TransactionExceptions';
import type { TransactionContext, TransactionalMap } from '@helios/core/transaction/TransactionContext';
import type { TransactionContextFactory } from '@helios/nestjs/HeliosTransactionManager';

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
// Block 9.4 — DI-based @Transactional resolution
// ---------------------------------------------------------------------------

describe('@Transactional — DI-based resolution (Block 9.4)', () => {
    // Ensure no static leak from these tests
    afterEach(() => {
        HeliosTransactionManager.setCurrent(null);
    });

    // Test 1: @Transactional uses DI-injected manager — no static singleton required
    it('resolves manager from DI-injected property without static singleton', async () => {
        const ctx = makeMockCtx();
        const mgr = new HeliosTransactionManager(makeFactory(ctx));
        // Deliberately NOT calling HeliosTransactionManager.setCurrent(mgr)

        @Injectable()
        class MyService {
            constructor(readonly txMgr: HeliosTransactionManager) {}

            @Transactional()
            async doWork(): Promise<void> {
                ctx.getMap<string, string>('test').put('key', 'val');
            }
        }

        const svc = new MyService(mgr);
        await svc.doWork();

        expect(ctx.commitCount).toBe(1);
        expect(ctx.rollbackCount).toBe(0);
        expect(ctx.store.get('key')).toBe('val');
    });

    // Test 2: DI-injected manager takes precedence over the static singleton
    it('DI-injected manager takes precedence over static singleton', async () => {
        const ctxDI = makeMockCtx();      // manager injected via DI
        const ctxStatic = makeMockCtx();  // manager registered as static
        const diMgr = new HeliosTransactionManager(makeFactory(ctxDI));
        const staticMgr = new HeliosTransactionManager(makeFactory(ctxStatic));

        HeliosTransactionManager.setCurrent(staticMgr);

        @Injectable()
        class MyService {
            constructor(readonly txMgr: HeliosTransactionManager) {}

            @Transactional()
            async doWork(): Promise<void> {
                ctxDI.getMap<string, string>('test').put('k', 'v');
            }
        }

        const svc = new MyService(diMgr);
        await svc.doWork();

        // DI manager was used; static manager was NOT used
        expect(ctxDI.commitCount).toBe(1);
        expect(ctxStatic.commitCount).toBe(0);
    });

    // Test 3: Two services with different DI managers are completely isolated
    it('two services with different DI managers operate independently', async () => {
        const ctx1 = makeMockCtx();
        const ctx2 = makeMockCtx();
        const mgr1 = new HeliosTransactionManager(makeFactory(ctx1));
        const mgr2 = new HeliosTransactionManager(makeFactory(ctx2));

        @Injectable()
        class ServiceA {
            constructor(readonly txMgr: HeliosTransactionManager) {}

            @Transactional()
            async doA(): Promise<void> {
                ctx1.getMap<string, string>('data').put('a', '1');
            }
        }

        @Injectable()
        class ServiceB {
            constructor(readonly txMgr: HeliosTransactionManager) {}

            @Transactional()
            async doB(): Promise<void> {
                ctx2.getMap<string, string>('data').put('b', '2');
            }
        }

        const svcA = new ServiceA(mgr1);
        const svcB = new ServiceB(mgr2);

        await svcA.doA();
        await svcB.doB();

        expect(ctx1.commitCount).toBe(1);
        expect(ctx2.commitCount).toBe(1);
        expect(ctx1.store.get('a')).toBe('1');
        expect(ctx2.store.get('b')).toBe('2');
        // ctx2 untouched by svcA, ctx1 untouched by svcB
        expect(ctx1.store.has('b')).toBe(false);
        expect(ctx2.store.has('a')).toBe(false);
    });

    // Test 4: NestJS module-compiled service uses DI manager via @Transactional
    it('NestJS module-compiled service resolves manager via DI @Transactional', async () => {
        const ctx = makeMockCtx();
        let module: TestingModule | null = null;

        try {
            @Injectable()
            class TxService {
                constructor(readonly txMgr: HeliosTransactionManager) {}

                @Transactional()
                async storeValue(key: string, value: string): Promise<void> {
                    ctx.getMap<string, string>('data').put(key, value);
                }
            }

            module = await Test.createTestingModule({
                imports: [HeliosTransactionModule.register(makeFactory(ctx))],
                providers: [TxService],
            }).compile();

            const svc = module.get(TxService);
            await svc.storeValue('hello', 'world');

            expect(ctx.commitCount).toBe(1);
            expect(ctx.store.get('hello')).toBe('world');
        } finally {
            if (module) await module.close();
        }
    });

    // Test 5: DI-based @Transactional respects timeout option
    it('@Transactional({ timeout }) is forwarded when using DI-resolved manager', async () => {
        let capturedTimeout: number | undefined;

        const capturingFactory: TransactionContextFactory = {
            create(opts) {
                capturedTimeout = opts?.timeoutSecs;
                return makeMockCtx();
            },
        };

        const mgr = new HeliosTransactionManager(capturingFactory);

        @Injectable()
        class TimeoutService {
            constructor(readonly txMgr: HeliosTransactionManager) {}

            @Transactional({ timeout: 7 })
            async doWork(): Promise<void> { /* no-op */ }
        }

        const svc = new TimeoutService(mgr);
        await svc.doWork();

        expect(capturedTimeout).toBe(7);
    });

    // Test 6: DI-resolved @Transactional rolls back on error
    it('@Transactional via DI rolls back when method throws', async () => {
        const ctx = makeMockCtx();
        const mgr = new HeliosTransactionManager(makeFactory(ctx));

        @Injectable()
        class FailService {
            constructor(readonly txMgr: HeliosTransactionManager) {}

            @Transactional()
            async doFail(): Promise<void> {
                ctx.getMap<string, string>('data').put('k', 'v');
                throw new Error('DI fail');
            }
        }

        const svc = new FailService(mgr);
        let threw = false;
        try {
            await svc.doFail();
        } catch {
            threw = true;
        }

        expect(threw).toBe(true);
        expect(ctx.rollbackCount).toBe(1);
        expect(ctx.commitCount).toBe(0);
    });

    // Test 7: DI-based @Transactional respects REQUIRES_NEW propagation
    it('@Transactional(REQUIRES_NEW) throws when DI-resolved manager is already in a transaction', async () => {
        const ctx = makeMockCtx();
        const mgr = new HeliosTransactionManager(makeFactory(ctx));

        @Injectable()
        class InnerService {
            constructor(readonly txMgr: HeliosTransactionManager) {}

            @Transactional({ propagation: Propagation.REQUIRES_NEW })
            async doWork(): Promise<void> { /* no-op */ }
        }

        const inner = new InnerService(mgr);

        let caughtType = '';
        await mgr.run(async () => {
            try {
                await inner.doWork();
            } catch (e) {
                caughtType = (e as Error).constructor.name;
            }
        }).catch(() => { /* outer rollback on nested throw */ });

        expect(caughtType).toBe('TransactionSuspensionNotSupportedException');
    });
});
