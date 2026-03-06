/**
 * Unit tests for MapNearCacheManager.
 *
 * Tests lifecycle management (create, destroy, reset, shutdown),
 * invalidator selection, and repairing handler registration.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { MapNearCacheManager } from '@zenystx/helios-core/map/impl/nearcache/MapNearCacheManager';
import { NearCacheConfig } from '@zenystx/helios-core/config/NearCacheConfig';
import { InMemoryFormat } from '@zenystx/helios-core/config/InMemoryFormat';
import type { MapNearCacheNodeEngine } from '@zenystx/helios-core/map/impl/nearcache/MapNearCacheManager';

function makeNodeEngine(overrides: Partial<MapNearCacheNodeEngine> = {}): MapNearCacheNodeEngine {
    const partitionService = {
        getPartitionCount: () => 271,
        getPartitionId: (_key: unknown) => 0,
    };
    const eventService = {
        getRegistrations: (_sn: string, _name: string) => [],
        publishEvent: () => {},
    };
    const logger = {
        finest: () => {},
        isFinestEnabled: () => false,
        warning: () => {},
        fine: () => {},
        info: () => {},
    };
    const scheduledHandle = { cancel: () => {} };
    const scheduler = {
        schedule: (_fn: () => void, _delay: number) => scheduledHandle,
        scheduleWithRepetition: (_name: string, _fn: () => void, _i: number, _p: number) => scheduledHandle,
    };
    const ss = {
        toData: (v: unknown) => v,
        toObject: (d: unknown) => d,
    } as never;
    const defaultProps = {
        getInteger: (p: { defaultValue: string }) => parseInt(p.defaultValue, 10),
        getString: (p: { defaultValue: string }) => p.defaultValue,
    };

    return {
        getLogger: (_cls: unknown) => logger,
        getPartitionService: () => partitionService,
        getSerializationService: () => ss,
        getProperties: () => defaultProps,
        getEventService: () => eventService,
        getLocalMemberUuid: () => 'member-uuid-001',
        getTaskScheduler: () => scheduler,
        ...overrides,
    } as MapNearCacheNodeEngine;
}

function makeNearCacheConfig(name = 'testMap'): NearCacheConfig {
    return new NearCacheConfig(name)
        .setInMemoryFormat(InMemoryFormat.OBJECT);
}

describe('MapNearCacheManager', () => {
    let manager: MapNearCacheManager;

    beforeEach(() => {
        manager = new MapNearCacheManager(makeNodeEngine());
    });

    it('can be created with default node engine', () => {
        expect(manager).toBeDefined();
    });

    it('getInvalidator returns a non-null invalidator', () => {
        const invalidator = manager.getInvalidator();
        expect(invalidator).not.toBeNull();
    });

    it('getRepairingTask returns a non-null repairing task', () => {
        const task = manager.getRepairingTask();
        expect(task).not.toBeNull();
    });

    it('getOrCreateNearCache returns a near cache', () => {
        const nc = manager.getOrCreateNearCache('myMap', makeNearCacheConfig('myMap'));
        expect(nc).not.toBeNull();
        expect(nc.getName()).toBe('myMap');
    });

    it('getOrCreateNearCache returns same instance on repeated calls', () => {
        const config = makeNearCacheConfig('mapX');
        const nc1 = manager.getOrCreateNearCache('mapX', config);
        const nc2 = manager.getOrCreateNearCache('mapX', config);
        expect(nc1).toBe(nc2);
    });

    it('getNearCache returns null before creation', () => {
        expect(manager.getNearCache('nonExistentMap')).toBeNull();
    });

    it('getNearCache returns the near cache after creation', () => {
        manager.getOrCreateNearCache('myMap2', makeNearCacheConfig('myMap2'));
        expect(manager.getNearCache('myMap2')).not.toBeNull();
    });

    it('destroyNearCache removes the near cache', () => {
        manager.getOrCreateNearCache('mapD', makeNearCacheConfig('mapD'));
        const removed = manager.destroyNearCache('mapD');
        expect(removed).toBe(true);
        expect(manager.getNearCache('mapD')).toBeNull();
    });

    it('destroyNearCache returns false for unknown map', () => {
        expect(manager.destroyNearCache('noSuchMap')).toBe(false);
    });

    it('reset clears all near caches', () => {
        const nc = manager.getOrCreateNearCache('mapR', makeNearCacheConfig('mapR'));
        nc.put('key1', null, 'value1', null);
        expect(nc.size()).toBe(1);
        manager.reset();
        // after reset the cache is cleared but still exists
        expect(nc.size()).toBe(0);
    });

    it('shutdown removes all near caches', () => {
        manager.getOrCreateNearCache('mapS', makeNearCacheConfig('mapS'));
        manager.shutdown();
        expect(manager.getNearCache('mapS')).toBeNull();
    });

    it('newRepairingHandler returns a non-null handler', () => {
        const nc = manager.getOrCreateNearCache('mapH', makeNearCacheConfig('mapH'));
        const handler = manager.newRepairingHandler('mapH', nc);
        expect(handler).not.toBeNull();
        expect(handler.getName()).toBe('mapH');
    });

    it('deregisterRepairingHandler removes the handler', () => {
        const nc = manager.getOrCreateNearCache('mapDR', makeNearCacheConfig('mapDR'));
        manager.newRepairingHandler('mapDR', nc);
        // deregister should not throw
        expect(() => manager.deregisterRepairingHandler('mapDR')).not.toThrow();
    });
});
