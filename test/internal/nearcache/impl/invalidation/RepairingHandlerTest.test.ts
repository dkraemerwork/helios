/**
 * Unit tests for RepairingHandler.
 * Port of core invalidation handling behavior.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { RepairingHandler } from '@helios/internal/nearcache/impl/invalidation/RepairingHandler';
import type { MinimalPartitionService } from '@helios/internal/nearcache/impl/invalidation/MinimalPartitionService';
import type { NearCache } from '@helios/internal/nearcache/NearCache';
import type { SerializationService } from '@helios/internal/serialization/SerializationService';

const PARTITION_COUNT = 10;

function makePartitionService(): MinimalPartitionService {
    return {
        getPartitionCount: () => PARTITION_COUNT,
        getPartitionId: (key: unknown) => {
            if (key === null || key === undefined) throw new Error('null key');
            if (typeof key === 'number') return key % PARTITION_COUNT;
            return 0;
        },
    };
}

function makeNearCache(): NearCache<unknown, unknown> {
    return {
        isSerializeKeys: () => false,
        clear: () => {},
        invalidate: (_key: unknown) => {},
        get: (_key: unknown) => null,
        put: (_key: unknown, _keyData: unknown, _value: unknown, _expiryPolicy?: unknown) => -1,
        tryReserveForUpdate: (_key: unknown, _keyData: unknown) => -1,
        tryPublishReserved: (_key: unknown, _value: unknown, _id: number) => null,
        size: () => 0,
        destroy: () => {},
        getName: () => 'testCache',
        getNearCacheRecordStore: () => ({ setStaleReadDetector: () => {} }) as never,
        unwrap: (_cls: unknown) => null as never,
        getStatsJson: () => ({}),
        prefixedName: () => 'testCache',
    } as unknown as NearCache<unknown, unknown>;
}

function makeSerialization(): SerializationService {
    return {
        toObject: (data: unknown) => data,
    } as unknown as SerializationService;
}

describe('RepairingHandlerTest', () => {
    let handler: RepairingHandler;

    beforeEach(() => {
        const ps = makePartitionService();
        const nc = makeNearCache();
        const ss = makeSerialization();
        const localUuid = 'local-uuid-1234';
        const logger = { finest: () => {}, isFinestEnabled: () => false } as never;
        handler = new RepairingHandler(logger, localUuid, 'testMap', nc, ss, ps);
    });

    it('getMetaDataContainer_returnsContainerForEveryPartition', () => {
        for (let i = 0; i < PARTITION_COUNT; i++) {
            const container = handler.getMetaDataContainer(i);
            expect(container).not.toBeNull();
            expect(container.getSequence()).toBe(0);
        }
    });

    it('checkOrRepairUuid_setsUuidOnFirstCall', () => {
        const uuid = 'partition-uuid-abc';
        handler.checkOrRepairUuid(0, uuid);
        expect(handler.getMetaDataContainer(0).getUuid()).toBe(uuid);
    });

    it('checkOrRepairUuid_resetsSequenceOnUuidChange', () => {
        handler.checkOrRepairUuid(0, 'uuid-one');
        const container = handler.getMetaDataContainer(0);
        container.setSequence(100);
        // Changing UUID should reset the sequence
        handler.checkOrRepairUuid(0, 'uuid-two');
        expect(container.getSequence()).toBe(0);
        expect(container.getUuid()).toBe('uuid-two');
    });

    it('checkOrRepairSequence_updatesSequenceForward', () => {
        handler.checkOrRepairUuid(0, 'some-uuid');
        handler.checkOrRepairSequence(0, 5, false);
        expect(handler.getMetaDataContainer(0).getSequence()).toBe(5);
    });

    it('checkOrRepairSequence_doesNotGoBackward', () => {
        handler.checkOrRepairUuid(0, 'some-uuid');
        handler.checkOrRepairSequence(0, 10, false);
        handler.checkOrRepairSequence(0, 5, false);
        expect(handler.getMetaDataContainer(0).getSequence()).toBe(10);
    });

    it('updateLastKnownStaleSequence_setsStaleToCurrentSequence', () => {
        handler.checkOrRepairUuid(0, 'some-uuid');
        handler.checkOrRepairSequence(0, 7, false);
        const container = handler.getMetaDataContainer(0);
        handler.updateLastKnownStaleSequence(container, 0);
        expect(container.getStaleSequence()).toBe(7);
    });

    it('getName_returnsDataStructureName', () => {
        expect(handler.getName()).toBe('testMap');
    });
});
