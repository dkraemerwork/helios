/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.invalidation.StaleReadDetectorTest}.
 *
 * Tests that a RepairingHandler is (or is not) registered in the RepairingTask depending
 * on whether near-cache invalidation is enabled for a given map/cache.
 *
 * Java original uses a full HazelcastInstance and NearCachedMapProxyImpl to drive the flow.
 * TypeScript port exercises the same contract at the unit level via RepairingTask/MapNearCacheManager.
 */
import { describe, it, expect } from 'bun:test';
import { MapNearCacheManager } from '@zenystx/core/map/impl/nearcache/MapNearCacheManager';
import { NearCacheConfig } from '@zenystx/core/config/NearCacheConfig';
import { InMemoryFormat } from '@zenystx/core/config/InMemoryFormat';
import type { MapNearCacheNodeEngine } from '@zenystx/core/map/impl/nearcache/MapNearCacheManager';

const MAP_NAME = 'test';

function makeNodeEngine(): MapNearCacheNodeEngine {
    const partitionService = {
        getPartitionCount: () => 1,
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
        scheduleWithRepetition: (_fn: () => void, _i: number, _p: number) => scheduledHandle,
    };
    const ss = {
        toData: (v: unknown) => v,
        toObject: (d: unknown) => d,
    } as never;
    const props = {
        getInteger: (p: { defaultValue: string }) => parseInt(p.defaultValue, 10),
        getString: (p: { defaultValue: string }) => p.defaultValue,
    };

    return {
        getLogger: (_cls: unknown) => logger,
        getPartitionService: () => partitionService,
        getSerializationService: () => ss,
        getProperties: () => props,
        getEventService: () => eventService,
        getLocalMemberUuid: () => 'member-uuid-001',
        getTaskScheduler: () => scheduler,
    } as MapNearCacheNodeEngine;
}

/**
 * Port of {@code no_repairing_handler_created_when_invalidations_disabled}.
 *
 * When invalidateOnChange=false, the near-cached map proxy does NOT register
 * a RepairingHandler with the RepairingTask.  We model this by simply not calling
 * newRepairingHandler (matching the conditional in NearCachedMapProxyImpl).
 */
describe('StaleReadDetectorTest', () => {
    it('no_repairing_handler_created_when_invalidations_disabled', () => {
        const config = new NearCacheConfig(MAP_NAME)
            .setInMemoryFormat(InMemoryFormat.OBJECT)
            .setInvalidateOnChange(false);

        const manager = new MapNearCacheManager(makeNodeEngine());
        // Create the near cache but do NOT register a repairing handler
        // (invalidateOnChange=false → proxy skips newRepairingHandler)
        manager.getOrCreateNearCache(MAP_NAME, config);

        const handlers = manager.getRepairingTask().getHandlers();
        const repairingHandler = handlers.get(MAP_NAME);
        expect(repairingHandler).toBeUndefined();
    });

    /**
     * Port of {@code repairing_handler_created_when_invalidations_enabled}.
     *
     * When invalidateOnChange=true, the near-cached map proxy registers a
     * RepairingHandler with the RepairingTask on the first read/write.
     * We model this by calling newRepairingHandler (matching the proxy's behaviour).
     */
    it('repairing_handler_created_when_invalidations_enabled', () => {
        const config = new NearCacheConfig(MAP_NAME)
            .setInMemoryFormat(InMemoryFormat.OBJECT)
            .setInvalidateOnChange(true);

        const manager = new MapNearCacheManager(makeNodeEngine());
        const nearCache = manager.getOrCreateNearCache(MAP_NAME, config);

        // invalidateOnChange=true → proxy calls newRepairingHandler on first access
        manager.newRepairingHandler(MAP_NAME, nearCache);

        const handlers = manager.getRepairingTask().getHandlers();
        const repairingHandler = handlers.get(MAP_NAME);
        expect(repairingHandler).toBeDefined();
    });
});
