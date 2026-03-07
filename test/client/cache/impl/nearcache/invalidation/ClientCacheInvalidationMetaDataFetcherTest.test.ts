/**
 * Tests for {@code ClientCacheInvalidationMetaDataFetcher}.
 *
 * The client-side metadata fetcher now uses binary protocol invocations
 * (not in-process CacheGetInvalidationMetaDataOperation). These tests verify:
 * - getDataMembers delegation to cluster service
 * - fetchMemberResponse returns empty response when disconnected
 * - init and fetchMetadata work with empty member lists
 */
import { describe, it, expect } from 'bun:test';
import { ClientCacheInvalidationMetaDataFetcher } from '@zenystx/helios-core/client/cache/impl/nearcache/invalidation/ClientCacheInvalidationMetaDataFetcher';
import type { ClientCacheClusterService, ClientCacheDataMember } from '@zenystx/helios-core/client/cache/impl/nearcache/invalidation/ClientCacheInvalidationMetaDataFetcher';
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

function makeNearCache(name = 'testCache'): NearCache<unknown, unknown> {
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
        getName: () => name,
        getNearCacheRecordStore: () => ({ setStaleReadDetector: () => {} }) as never,
        unwrap: () => null as never,
    } as unknown as NearCache<unknown, unknown>;
}

function makeSerialization(): SerializationService {
    return { toObject: (d: unknown) => d } as unknown as SerializationService;
}

const logger = { finest: () => {}, isFinestEnabled: () => false } as never;

describe('ClientCacheInvalidationMetaDataFetcherTest', () => {
    it('getDataMembers delegates to cluster service', () => {
        const member: ClientCacheDataMember = {
            uuid: 'member-uuid-001',
            ownedPartitions: [0, 1, 2],
        };
        const clusterService: ClientCacheClusterService = {
            getDataMembers: () => [member],
        };

        const fetcher = new ClientCacheInvalidationMetaDataFetcher(clusterService);
        expect(fetcher.getDataMembers()).toEqual([member]);
    });

    it('fetchMemberResponse returns empty response (protocol-based, disconnected)', () => {
        const member: ClientCacheDataMember = {
            uuid: 'member-uuid-001',
            ownedPartitions: [0],
        };
        const fetcher = new ClientCacheInvalidationMetaDataFetcher({
            getDataMembers: () => [member],
        });

        const response = fetcher.fetchMemberResponse(member, ['test']);
        expect(response.namePartitionSequenceList.size).toBe(0);
        expect(response.partitionUuidList.size).toBe(0);
    });

    it('fetchMetadata_isNoOpForEmptyHandlers', () => {
        const fetcher = new ClientCacheInvalidationMetaDataFetcher({
            getDataMembers: () => [],
        });
        // Should not throw
        fetcher.fetchMetadata(new Map());
    });

    it('init_returnsTrueWhenNoMembers', () => {
        const fetcher = new ClientCacheInvalidationMetaDataFetcher({
            getDataMembers: () => [],
        });
        const handler = new RepairingHandler(
            logger,
            'local-member-uuid',
            '/hz/my-cache',
            makeNearCache('/hz/my-cache'),
            makeSerialization(),
            makePartitionService(),
        );
        expect(fetcher.init(handler)).toBe(true);
    });

    it('does not import CacheGetInvalidationMetaDataOperation', async () => {
        const src = await Bun.file(
            'src/client/cache/impl/nearcache/invalidation/ClientCacheInvalidationMetaDataFetcher.ts',
        ).text();
        expect(src).not.toContain('CacheGetInvalidationMetaDataOperation');
    });
});
