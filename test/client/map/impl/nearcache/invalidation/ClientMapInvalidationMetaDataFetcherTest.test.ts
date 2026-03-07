/**
 * Tests for {@code ClientMapInvalidationMetaDataFetcher}.
 *
 * The client-side metadata fetcher now uses binary protocol invocations
 * (not in-process MetaDataGenerator). These tests verify:
 * - getDataMembers delegation to cluster service
 * - fetchMemberResponse returns empty response when disconnected
 * - init and fetchMetadata work with empty member lists
 */
import { describe, it, expect } from 'bun:test';
import { ClientMapInvalidationMetaDataFetcher } from '@zenystx/helios-core/client/map/impl/nearcache/invalidation/ClientMapInvalidationMetaDataFetcher';
import type { ClientMapClusterService, ClientMapDataMember } from '@zenystx/helios-core/client/map/impl/nearcache/invalidation/ClientMapInvalidationMetaDataFetcher';
import { RepairingHandler } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/RepairingHandler';
import type { MinimalPartitionService } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/MinimalPartitionService';
import type { NearCache } from '@zenystx/helios-core/internal/nearcache/NearCache';
import type { SerializationService } from '@zenystx/helios-core/internal/serialization/SerializationService';

const PARTITION_COUNT = 271;

function makePartitionService(): MinimalPartitionService {
    return {
        getPartitionCount: () => PARTITION_COUNT,
        getPartitionId: () => 0,
    };
}

function makeNearCache(): NearCache<unknown, unknown> {
    return {
        isSerializeKeys: () => false,
        clear: () => {},
        invalidate: () => {},
        get: () => null,
        put: () => -1,
        tryReserveForUpdate: () => -1,
        tryPublishReserved: () => null,
        size: () => 0,
        destroy: () => {},
        getName: () => 'testMap',
        getNearCacheRecordStore: () => ({ setStaleReadDetector: () => {} }) as never,
        unwrap: () => null as never,
    } as unknown as NearCache<unknown, unknown>;
}

function makeSerialization(): SerializationService {
    return { toObject: (d: unknown) => d } as unknown as SerializationService;
}

const logger = { finest: () => {}, isFinestEnabled: () => false } as never;

describe('ClientMapInvalidationMetaDataFetcherTest', () => {
    it('getDataMembers delegates to cluster service', () => {
        const member: ClientMapDataMember = {
            uuid: 'member-uuid-001',
            ownedPartitions: [0, 1, 2],
        };
        const clusterService: ClientMapClusterService = {
            getDataMembers: () => [member],
        };

        const fetcher = new ClientMapInvalidationMetaDataFetcher(clusterService);
        expect(fetcher.getDataMembers()).toEqual([member]);
    });

    it('fetchMemberResponse returns empty response (protocol-based, disconnected)', () => {
        const member: ClientMapDataMember = {
            uuid: 'member-uuid-001',
            ownedPartitions: [0],
        };
        const fetcher = new ClientMapInvalidationMetaDataFetcher({
            getDataMembers: () => [member],
        });

        const response = fetcher.fetchMemberResponse(member, ['test']);
        expect(response.namePartitionSequenceList.size).toBe(0);
        expect(response.partitionUuidList.size).toBe(0);
    });

    it('fetchMetadata_isNoOpForEmptyHandlers', () => {
        const fetcher = new ClientMapInvalidationMetaDataFetcher({
            getDataMembers: () => [],
        });
        // Should not throw
        fetcher.fetchMetadata(new Map());
    });

    it('init_returnsTrueWhenNoMembers', () => {
        const fetcher = new ClientMapInvalidationMetaDataFetcher({
            getDataMembers: () => [],
        });
        const handler = new RepairingHandler(
            logger,
            'local-member-uuid',
            'my-map',
            makeNearCache(),
            makeSerialization(),
            makePartitionService(),
        );
        expect(fetcher.init(handler)).toBe(true);
    });

    it('does not import MapGetInvalidationMetaDataOperation', async () => {
        const src = await Bun.file(
            'src/client/map/impl/nearcache/invalidation/ClientMapInvalidationMetaDataFetcher.ts',
        ).text();
        expect(src).not.toContain('MapGetInvalidationMetaDataOperation');
    });
});
