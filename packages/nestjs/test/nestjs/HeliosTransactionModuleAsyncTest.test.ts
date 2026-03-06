/**
 * Tests for Block 9.3 — HeliosTransactionModule.registerAsync
 *
 * Verifies async registration patterns: useFactory, inject, useClass.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { Test, TestingModule } from '@nestjs/testing';
import { Injectable, Module } from '@nestjs/common';
import {
    HeliosTransactionModule,
    type HeliosTransactionModuleOptions,
    type HeliosTransactionModuleOptionsFactory,
} from '@zenystx/nestjs/HeliosTransactionModule';
import { HeliosTransactionManager } from '@zenystx/nestjs/HeliosTransactionManager';
import { ManagedTransactionalTaskContext } from '@zenystx/nestjs/ManagedTransactionalTaskContext';
import type { TransactionContext } from '@zenystx/core/transaction/TransactionContext';
import type { TransactionContextFactory } from '@zenystx/nestjs/HeliosTransactionManager';

// ---------------------------------------------------------------------------
// Minimal mock factory
// ---------------------------------------------------------------------------

function makeMockFactory(): TransactionContextFactory {
    return {
        create(): TransactionContext {
            return {
                beginTransaction() {},
                commitTransaction() {},
                rollbackTransaction() {},
                getMap() {
                    return { put() { return undefined; }, get() { return undefined; }, size() { return 0; } };
                },
            };
        },
    };
}

describe('HeliosTransactionModule.registerAsync', () => {
    let module: TestingModule;

    afterEach(async () => {
        HeliosTransactionManager.setCurrent(null);
        if (module) await module.close();
    });

    // Test 1 — useFactory provides HeliosTransactionManager
    it('registerAsync with useFactory provides HeliosTransactionManager', async () => {
        const factory = makeMockFactory();

        module = await Test.createTestingModule({
            imports: [
                HeliosTransactionModule.registerAsync({
                    useFactory: () => ({ factory }),
                }),
            ],
        }).compile();

        const txMgr = module.get(HeliosTransactionManager);
        expect(txMgr).toBeInstanceOf(HeliosTransactionManager);
    });

    // Test 2 — useFactory provides ManagedTransactionalTaskContext
    it('registerAsync with useFactory provides ManagedTransactionalTaskContext', async () => {
        const factory = makeMockFactory();

        module = await Test.createTestingModule({
            imports: [
                HeliosTransactionModule.registerAsync({
                    useFactory: () => ({ factory }),
                }),
            ],
        }).compile();

        const taskCtx = module.get(ManagedTransactionalTaskContext);
        expect(taskCtx).toBeInstanceOf(ManagedTransactionalTaskContext);
    });

    // Test 3 — inject resolves deps from imports
    it('registerAsync with inject resolves factory from imported module', async () => {
        const TX_FACTORY_TOKEN = 'TX_FACTORY_TOKEN';
        const factory = makeMockFactory();

        @Module({
            providers: [{ provide: TX_FACTORY_TOKEN, useValue: factory }],
            exports: [TX_FACTORY_TOKEN],
        })
        class FactoryModule {}

        module = await Test.createTestingModule({
            imports: [
                HeliosTransactionModule.registerAsync({
                    imports: [FactoryModule],
                    useFactory: (f: TransactionContextFactory) => ({ factory: f }),
                    inject: [TX_FACTORY_TOKEN],
                }),
            ],
        }).compile();

        const txMgr = module.get(HeliosTransactionManager);
        expect(txMgr).toBeInstanceOf(HeliosTransactionManager);
    });

    // Test 4 — module-registered manager can commit a transaction
    it('registerAsync module can commit a transaction', async () => {
        let committed = false;
        const factory: TransactionContextFactory = {
            create(): TransactionContext {
                return {
                    beginTransaction() {},
                    commitTransaction() { committed = true; },
                    rollbackTransaction() {},
                    getMap() {
                        return { put() { return undefined; }, get() { return undefined; }, size() { return 0; } };
                    },
                };
            },
        };

        module = await Test.createTestingModule({
            imports: [
                HeliosTransactionModule.registerAsync({
                    useFactory: () => ({ factory }),
                }),
            ],
        }).compile();

        const txMgr = module.get(HeliosTransactionManager);
        await txMgr.run(() => { /* no-op */ });
        expect(committed).toBe(true);
    });

    // Test 5 — useClass pattern
    it('registerAsync with useClass provides HeliosTransactionManager', async () => {
        const factory = makeMockFactory();

        @Injectable()
        class MyTxOptionsFactory implements HeliosTransactionModuleOptionsFactory {
            createHeliosTransactionOptions(): HeliosTransactionModuleOptions {
                return { factory };
            }
        }

        module = await Test.createTestingModule({
            imports: [
                HeliosTransactionModule.registerAsync({
                    useClass: MyTxOptionsFactory,
                }),
            ],
        }).compile();

        const txMgr = module.get(HeliosTransactionManager);
        expect(txMgr).toBeInstanceOf(HeliosTransactionManager);
    });

    // Test 6 — async useFactory
    it('registerAsync with async useFactory resolves promise options', async () => {
        const factory = makeMockFactory();

        module = await Test.createTestingModule({
            imports: [
                HeliosTransactionModule.registerAsync({
                    useFactory: async () => {
                        await Promise.resolve();
                        return { factory };
                    },
                }),
            ],
        }).compile();

        const txMgr = module.get(HeliosTransactionManager);
        expect(txMgr).toBeInstanceOf(HeliosTransactionManager);
    });

    // Test 7 — returns DynamicModule with correct module reference
    it('registerAsync returns a DynamicModule', () => {
        const factory = makeMockFactory();
        const dm = HeliosTransactionModule.registerAsync({
            useFactory: () => ({ factory }),
        });
        expect(dm.module).toBe(HeliosTransactionModule);
    });
});
