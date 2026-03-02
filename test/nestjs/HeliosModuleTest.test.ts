/**
 * Tests for HeliosModule — NestJS DynamicModule with forRoot / forRootAsync.
 * Corresponds to hazelcast-spring NestJS integration (Block 6.1).
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Test, TestingModule } from '@nestjs/testing';
import { Inject, Injectable } from '@nestjs/common';
import { HeliosModule } from '@helios/nestjs/HeliosModule';
import { HELIOS_INSTANCE_TOKEN } from '@helios/nestjs/HeliosInstanceDefinition';
import type { HeliosInstance } from '@helios/core/HeliosInstance';
import type { IMap } from '@helios/map/IMap';
import type { IQueue } from '@helios/collection/IQueue';
import type { IList } from '@helios/collection/IList';
import type { ISet } from '@helios/collection/ISet';
import type { ITopic } from '@helios/topic/ITopic';
import type { MultiMap } from '@helios/multimap/MultiMap';
import type { ReplicatedMap } from '@helios/replicatedmap/ReplicatedMap';
import type { DistributedObject } from '@helios/core/DistributedObject';
import type { LifecycleService } from '@helios/instance/lifecycle/LifecycleService';
import type { Cluster } from '@helios/cluster/Cluster';
import type { HeliosConfig } from '@helios/config/HeliosConfig';

// ---------------------------------------------------------------------------
// Minimal stub implementing HeliosInstance for tests
// ---------------------------------------------------------------------------

class StubHeliosInstance implements HeliosInstance {
    constructor(readonly name: string) {}
    getName(): string { return this.name; }
    shutdown(): void {}
    getMap<K, V>(_n: string): IMap<K, V> { return null!; }
    getQueue<E>(_n: string): IQueue<E> { return null!; }
    getList<E>(_n: string): IList<E> { return null!; }
    getSet<E>(_n: string): ISet<E> { return null!; }
    getTopic<E>(_n: string): ITopic<E> { return null!; }
    getMultiMap<K, V>(_n: string): MultiMap<K, V> { return null!; }
    getReplicatedMap<K, V>(_n: string): ReplicatedMap<K, V> { return null!; }
    getDistributedObject(_s: string, _n: string): DistributedObject { return null!; }
    getLifecycleService(): LifecycleService { return null!; }
    getCluster(): Cluster { return null!; }
    getConfig(): HeliosConfig { return null!; }
}

// ---------------------------------------------------------------------------
// forRoot tests
// ---------------------------------------------------------------------------

describe('HeliosModule.forRoot', () => {
    let module: TestingModule;

    afterEach(async () => {
        if (module) await module.close();
    });

    it('provides the instance under HELIOS_INSTANCE_TOKEN', async () => {
        const instance = new StubHeliosInstance('test-node');

        module = await Test.createTestingModule({
            imports: [HeliosModule.forRoot(instance)],
        }).compile();

        const resolved = module.get<HeliosInstance>(HELIOS_INSTANCE_TOKEN);
        expect(resolved).toBe(instance);
    });

    it('is global — child module can inject instance without re-importing', async () => {
        @Injectable()
        class ConsumerService {
            constructor(
                @Inject(HELIOS_INSTANCE_TOKEN) readonly hz: HeliosInstance,
            ) {}
        }

        const instance = new StubHeliosInstance('global-test');

        module = await Test.createTestingModule({
            imports: [HeliosModule.forRoot(instance)],
            providers: [ConsumerService],
        }).compile();

        const svc = module.get(ConsumerService);
        expect(svc.hz).toBe(instance);
    });

    it('returns a DynamicModule with module property set to HeliosModule', async () => {
        const dm = HeliosModule.forRoot(new StubHeliosInstance('x'));
        expect(dm.module).toBe(HeliosModule);
    });

    it('exports HELIOS_INSTANCE_TOKEN so consumer modules can inject it', async () => {
        const dm = HeliosModule.forRoot(new StubHeliosInstance('x'));
        expect(dm.exports).toBeDefined();
        const exports = dm.exports as unknown[];
        expect(exports).toContain(HELIOS_INSTANCE_TOKEN);
    });
});

// ---------------------------------------------------------------------------
// forRootAsync tests
// ---------------------------------------------------------------------------

describe('HeliosModule.forRootAsync', () => {
    let module: TestingModule;

    afterEach(async () => {
        if (module) await module.close();
    });

    it('useFactory: provides the instance asynchronously', async () => {
        const instance = new StubHeliosInstance('async-node');

        module = await Test.createTestingModule({
            imports: [
                HeliosModule.forRootAsync({
                    useFactory: async () => instance,
                }),
            ],
        }).compile();

        const resolved = module.get<HeliosInstance>(HELIOS_INSTANCE_TOKEN);
        expect(resolved).toBe(instance);
    });

    it('useFactory with inject: injects dependency into factory', async () => {
        const CONFIG_TOKEN = 'CONFIG_TOKEN';
        const instance = new StubHeliosInstance('injected-factory');

        module = await Test.createTestingModule({
            imports: [
                HeliosModule.forRootAsync({
                    inject: [CONFIG_TOKEN],
                    useFactory: (config: { name: string }) =>
                        new StubHeliosInstance(config.name),
                    extraProviders: [
                        { provide: CONFIG_TOKEN, useValue: { name: 'injected-factory' } },
                    ],
                }),
            ],
        }).compile();

        const resolved = module.get<HeliosInstance>(HELIOS_INSTANCE_TOKEN);
        expect(resolved.getName()).toBe('injected-factory');
    });

    it('returns a DynamicModule with module property set to HeliosModule', () => {
        const dm = HeliosModule.forRootAsync({ useFactory: async () => new StubHeliosInstance('x') });
        expect(dm.module).toBe(HeliosModule);
    });

    it('exports HELIOS_INSTANCE_TOKEN so consumer modules can inject it', () => {
        const dm = HeliosModule.forRootAsync({ useFactory: async () => new StubHeliosInstance('x') });
        const exports = dm.exports as unknown[];
        expect(exports).toContain(HELIOS_INSTANCE_TOKEN);
    });
});
