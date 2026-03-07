/**
 * Block 7.3 — HeliosInstance interface expansion tests.
 *
 * Verifies that:
 *  - HeliosInstanceImpl satisfies the expanded HeliosInstance interface
 *  - getMap() returns an IMap<K,V>
 *  - getReplicatedMap() creates and caches ReplicatedMap instances
 *  - getLifecycleService() returns a working LifecycleService
 *  - getCluster() returns a Cluster with member info
 *  - getConfig() returns the HeliosConfig
 *  - getDistributedObject() dispatches by service name
 *  - NestJS injection works with the expanded HeliosInstance interface
 */
import { Inject, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Cluster } from '@zenystx/helios-core/cluster/Cluster';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import type { HeliosInstance } from '@zenystx/helios-core/core/HeliosInstance';
import { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import type { LifecycleService } from '@zenystx/helios-core/instance/lifecycle/LifecycleService';
import type { IMap } from '@zenystx/helios-core/map/IMap';
import type { ReplicatedMap } from '@zenystx/helios-core/replicatedmap/ReplicatedMap';
import { HELIOS_INSTANCE_TOKEN } from '@zenystx/helios-nestjs/HeliosInstanceDefinition';
import { HeliosModule } from '@zenystx/helios-nestjs/HeliosModule';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

type HeliosInstanceWithReplicatedMap = HeliosInstance & {
    getReplicatedMap<K, V>(name: string): ReplicatedMap<K, V>;
};

// ── helpers ────────────────────────────────────────────────────────────────

@Injectable()
class TestService {
    constructor(
        @Inject(HELIOS_INSTANCE_TOKEN) public readonly hz: HeliosInstance,
    ) {}
}

// ── describe blocks ────────────────────────────────────────────────────────

describe('Block 7.3 — HeliosInstance interface expansion', () => {
    let impl: HeliosInstanceImpl;
    let hz: HeliosInstance;
    let memberHz: HeliosInstanceWithReplicatedMap;

    beforeEach(() => {
        impl = new HeliosInstanceImpl();
        // Assign to the interface type — compile-time check that the impl satisfies the interface
        hz = impl;
        memberHz = impl as HeliosInstanceWithReplicatedMap;
    });

    afterEach(() => {
        if (impl.isRunning()) impl.shutdown();
    });

    // ── Interface assignment ────────────────────────────────────────────────

    describe('interface compliance', () => {
        it('HeliosInstanceImpl should be assignable to HeliosInstance', () => {
            const i: HeliosInstance = impl;
            expect(i).toBeDefined();
            expect(i.getName()).toBe('helios');
        });

        it('expanded interface is accessible through HeliosInstance type', () => {
            const map: IMap<string, number> = hz.getMap('compliance-map');
            expect(map).toBeDefined();
        });
    });

    // ── IMap via interface ──────────────────────────────────────────────────

    describe('getMap() via HeliosInstance', () => {
        it('should return an IMap that supports put/get', async () => {
            const map: IMap<string, string> = hz.getMap('imap-test');
            await map.put('hello', 'world');
            expect(await map.get('hello')).toBe('world');
        });

        it('should return the same IMap for the same name', () => {
            expect(hz.getMap('same')).toBe(hz.getMap('same'));
        });

        it('should return different IMaps for different names', () => {
            expect(hz.getMap('a')).not.toBe(hz.getMap('b'));
        });
    });

    // ── ReplicatedMap ───────────────────────────────────────────────────────

    describe('getReplicatedMap()', () => {
        it('should return a ReplicatedMap', () => {
            const rm: ReplicatedMap<string, number> = memberHz.getReplicatedMap('rm1');
            expect(rm).toBeDefined();
        });

        it('should support put and get', () => {
            const rm = memberHz.getReplicatedMap<string, number>('rm-put');
            rm.put('x', 42);
            expect(rm.get('x')).toBe(42);
        });

        it('should return the same instance for the same name', () => {
            expect(memberHz.getReplicatedMap('rmap')).toBe(memberHz.getReplicatedMap('rmap'));
        });

        it('should return different instances for different names', () => {
            expect(memberHz.getReplicatedMap('r1')).not.toBe(memberHz.getReplicatedMap('r2'));
        });

        it('should support remove, size, isEmpty, containsKey, clear', () => {
            const rm = memberHz.getReplicatedMap<string, string>('rm-ops');
            expect(rm.isEmpty()).toBe(true);
            rm.put('k', 'v');
            expect(rm.size()).toBe(1);
            expect(rm.containsKey('k')).toBe(true);
            rm.remove('k');
            expect(rm.isEmpty()).toBe(true);
        });

        it('should return the name via getName()', () => {
            expect(memberHz.getReplicatedMap('named-rm').getName()).toBe('named-rm');
        });
    });

    // ── LifecycleService ───────────────────────────────────────────────────

    describe('getLifecycleService()', () => {
        it('should return a LifecycleService', () => {
            const ls: LifecycleService = hz.getLifecycleService();
            expect(ls).toBeDefined();
        });

        it('should report isRunning() = true before shutdown', () => {
            expect(hz.getLifecycleService().isRunning()).toBe(true);
        });

        it('should report isRunning() = false after shutdown', () => {
            const ls = hz.getLifecycleService();
            impl.shutdown();
            expect(ls.isRunning()).toBe(false);
        });

        it('should fire lifecycle listeners on shutdown', () => {
            const events: string[] = [];
            const ls = hz.getLifecycleService();
            ls.addLifecycleListener({ stateChanged: e => events.push(e.getState()) });
            impl.shutdown();
            expect(events).toContain('SHUTTING_DOWN');
            expect(events).toContain('SHUTDOWN');
        });

        it('should return the same LifecycleService on repeated calls', () => {
            expect(hz.getLifecycleService()).toBe(hz.getLifecycleService());
        });
    });

    // ── Cluster ────────────────────────────────────────────────────────────

    describe('getCluster()', () => {
        it('should return a Cluster', () => {
            const cluster: Cluster = hz.getCluster();
            expect(cluster).toBeDefined();
        });

        it('should report at least one local member', () => {
            const members = hz.getCluster().getMembers();
            expect(members.length).toBeGreaterThanOrEqual(1);
        });

        it('should return the same Cluster on repeated calls', () => {
            expect(hz.getCluster()).toBe(hz.getCluster());
        });
    });

    // ── Config ─────────────────────────────────────────────────────────────

    describe('getConfig()', () => {
        it('should return the HeliosConfig', () => {
            const config = hz.getConfig();
            expect(config).toBeDefined();
        });

        it('should return config with the instance name', () => {
            const cfg = new HeliosConfig('my-node');
            const inst = new HeliosInstanceImpl(cfg);
            const returned = inst.getConfig();
            expect(returned.getName()).toBe('my-node');
            inst.shutdown();
        });

        it('should return the same config on repeated calls', () => {
            expect(hz.getConfig()).toBe(hz.getConfig());
        });
    });

    // ── getDistributedObject ───────────────────────────────────────────────

    describe('getDistributedObject()', () => {
        it('should return a map object for the map service name', () => {
            const obj = hz.getDistributedObject('hz:impl:mapService', 'do-map');
            expect(obj).toBeDefined();
            expect(obj.getName()).toBe('do-map');
        });

        it('should throw for unknown service names', () => {
            expect(() => hz.getDistributedObject('unknown:service', 'foo')).toThrow();
        });
    });

    // ── NestJS injection with expanded interface ────────────────────────────

    describe('NestJS injection', () => {
        it('should inject HeliosInstance and call getMap()', async () => {
            const heliosInstance = new HeliosInstanceImpl();
            const moduleRef = await Test.createTestingModule({
                imports: [HeliosModule.forRoot(heliosInstance)],
                providers: [TestService],
            }).compile();

            const svc = moduleRef.get(TestService);
            const map = svc.hz.getMap('nestjs-map');
            expect(map).toBeDefined();
            await moduleRef.close();
            heliosInstance.shutdown();
        });

        it('should inject HeliosInstance and call getReplicatedMap()', async () => {
            const heliosInstance = new HeliosInstanceImpl();
            const moduleRef = await Test.createTestingModule({
                imports: [HeliosModule.forRoot(heliosInstance)],
                providers: [TestService],
            }).compile();

            const svc = moduleRef.get(TestService);
            const rm = (svc.hz as HeliosInstanceWithReplicatedMap).getReplicatedMap<string, string>('nestjs-rm');
            rm.put('key', 'val');
            expect(rm.get('key')).toBe('val');
            await moduleRef.close();
            heliosInstance.shutdown();
        });

        it('should inject HeliosInstance and call getConfig()', async () => {
            const cfg = new HeliosConfig('nest-cluster');
            const heliosInstance = new HeliosInstanceImpl(cfg);
            const moduleRef = await Test.createTestingModule({
                imports: [HeliosModule.forRoot(heliosInstance)],
                providers: [TestService],
            }).compile();

            const svc = moduleRef.get(TestService);
            expect(svc.hz.getConfig().getName()).toBe('nest-cluster');
            await moduleRef.close();
            heliosInstance.shutdown();
        });
    });
});
