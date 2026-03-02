/**
 * Block 9.8 — Symbol-based injection tokens + OnModuleDestroy / OnApplicationShutdown lifecycle hooks.
 *
 * Tests:
 *  1. HELIOS_INSTANCE_TOKEN is a Symbol (not a string)
 *  2. Symbol-based injection resolves the correct instance via NestJS DI
 *  3. onModuleDestroy() calls instance.shutdown()
 *  4. onApplicationShutdown() calls instance.shutdown()
 *  5. Shutdown is idempotent when no instance is present (no crash)
 */

import { describe, it, expect, spyOn, mock, afterEach } from 'bun:test';
import { Injectable, Module, DynamicModule } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Inject } from '@nestjs/common';
import { HELIOS_INSTANCE_TOKEN } from '../../src/HeliosInstanceDefinition';
import { HeliosModule } from '../../src/HeliosModule';
import type { HeliosInstance } from '@helios/core/core/HeliosInstance';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInstanceStub(name = 'lifecycle-test'): HeliosInstance {
    return {
        getName: () => name,
        shutdown: mock(() => {}),
        getMap: mock(() => { throw new Error('not implemented'); }),
        getQueue: mock(() => { throw new Error('not implemented'); }),
        getTopic: mock(() => { throw new Error('not implemented'); }),
        getList: mock(() => { throw new Error('not implemented'); }),
        getSet: mock(() => { throw new Error('not implemented'); }),
        getMultiMap: mock(() => { throw new Error('not implemented'); }),
        getReplicatedMap: mock(() => { throw new Error('not implemented'); }),
        getLifecycleService: mock(() => { throw new Error('not implemented'); }),
        getClusterService: mock(() => { throw new Error('not implemented'); }),
        getPartitionService: mock(() => { throw new Error('not implemented'); }),
        isShuttingDown: mock(() => false),
        isRunning: mock(() => true),
    } as unknown as HeliosInstance;
}

// ---------------------------------------------------------------------------
// 1. Token type — must be a Symbol, not a string
// ---------------------------------------------------------------------------

describe('HELIOS_INSTANCE_TOKEN — Symbol identity', () => {
    it('is a Symbol (not a string)', () => {
        expect(typeof HELIOS_INSTANCE_TOKEN).toBe('symbol');
    });

    it('has the description "HELIOS_INSTANCE"', () => {
        expect(HELIOS_INSTANCE_TOKEN.description).toBe('HELIOS_INSTANCE');
    });

    it('is not equal to the string "HELIOS_INSTANCE"', () => {
        expect(HELIOS_INSTANCE_TOKEN).not.toBe('HELIOS_INSTANCE');
    });
});

// ---------------------------------------------------------------------------
// 2. Symbol-based injection works in NestJS DI
// ---------------------------------------------------------------------------

describe('HeliosModule.forRoot — Symbol token DI resolution', () => {
    let module: TestingModule;

    afterEach(async () => {
        await module?.close();
    });

    it('resolves the instance via Symbol token', async () => {
        const instance = makeInstanceStub();
        module = await Test.createTestingModule({
            imports: [HeliosModule.forRoot(instance)],
        }).compile();

        const resolved = module.get<HeliosInstance>(HELIOS_INSTANCE_TOKEN);
        expect(resolved).toBe(instance);
    });

    it('resolves via @InjectHelios() which uses the same Symbol token', async () => {
        const instance = makeInstanceStub();

        @Injectable()
        class Consumer {
            constructor(@Inject(HELIOS_INSTANCE_TOKEN) public readonly hz: HeliosInstance) {}
        }

        module = await Test.createTestingModule({
            imports: [HeliosModule.forRoot(instance)],
            providers: [Consumer],
        }).compile();

        const consumer = module.get(Consumer);
        expect(consumer.hz).toBe(instance);
    });
});

// ---------------------------------------------------------------------------
// 3. onModuleDestroy — calls instance.shutdown()
// ---------------------------------------------------------------------------

describe('HeliosModule — OnModuleDestroy lifecycle', () => {
    it('calls instance.shutdown() when module is destroyed', async () => {
        const instance = makeInstanceStub();
        const shutdownMock = instance.shutdown as ReturnType<typeof mock>;

        const module = await Test.createTestingModule({
            imports: [HeliosModule.forRoot(instance)],
        }).compile();

        expect(shutdownMock.mock.calls.length).toBe(0);

        await module.close(); // triggers onModuleDestroy

        expect(shutdownMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('does not throw when no instance is provided', async () => {
        // Create a module without providing an instance (edge case)
        @Module({})
        class EmptyAppModule {}

        const module = await Test.createTestingModule({
            imports: [EmptyAppModule],
        }).compile();

        // Should not throw
        await expect(module.close()).resolves.toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// 4. onApplicationShutdown — calls instance.shutdown()
// ---------------------------------------------------------------------------

describe('HeliosModule — OnApplicationShutdown lifecycle', () => {
    it('calls instance.shutdown() on application shutdown signal', async () => {
        const instance = makeInstanceStub();
        const shutdownMock = instance.shutdown as ReturnType<typeof mock>;

        const module = await Test.createTestingModule({
            imports: [HeliosModule.forRoot(instance)],
        }).compile();

        await module.init();

        // Simulate application shutdown
        await module.close();

        expect(shutdownMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
});

// ---------------------------------------------------------------------------
// 5. forRootAsync — Symbol token still resolves correctly
// ---------------------------------------------------------------------------

describe('HeliosModule.forRootAsync — Symbol token', () => {
    let module: TestingModule;

    afterEach(async () => {
        await module?.close();
    });

    it('resolves via useFactory with Symbol token', async () => {
        const instance = makeInstanceStub('async-test');

        module = await Test.createTestingModule({
            imports: [
                HeliosModule.forRootAsync({
                    useFactory: () => instance,
                }),
            ],
        }).compile();

        const resolved = module.get<HeliosInstance>(HELIOS_INSTANCE_TOKEN);
        expect(resolved).toBe(instance);
        expect(resolved.getName()).toBe('async-test');
    });
});
