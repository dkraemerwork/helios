/**
 * Port of {@code com.hazelcast.client.cache.impl.nearcache.invalidation.ClientCacheInvalidationMetaDataFetcherTest}.
 *
 * Tests that the client-side cache metadata fetcher correctly fetches partition sequences
 * and UUIDs from a server-side MetaDataGenerator and propagates them into RepairingHandlers.
 *
 * Note: Cache names in Hazelcast are prefixed with "/hz/" in the metadata generator.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { ClientCacheInvalidationMetaDataFetcher } from '@helios/client/cache/impl/nearcache/invalidation/ClientCacheInvalidationMetaDataFetcher';
import type { ClientCacheClusterService, ClientCacheDataMember } from '@helios/client/cache/impl/nearcache/invalidation/ClientCacheInvalidationMetaDataFetcher';
import { RepairingHandler } from '@helios/internal/nearcache/impl/invalidation/RepairingHandler';
import { MetaDataGenerator } from '@helios/internal/nearcache/impl/invalidation/MetaDataGenerator';
import type { MinimalPartitionService } from '@helios/internal/nearcache/impl/invalidation/MinimalPartitionService';
import type { NearCache } from '@helios/internal/nearcache/NearCache';
import type { SerializationService } from '@helios/internal/serialization/SerializationService';

const PARTITION_COUNT = 271;

function getPrefixedName(cacheName: string): string {
    return `/hz/${cacheName}`;
}

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
        getStatsJson: () => ({}),
        prefixedName: () => name,
    } as unknown as NearCache<unknown, unknown>;
}

function makeSerialization(): SerializationService {
    return { toObject: (d: unknown) => d } as unknown as SerializationService;
}

const logger = { finest: () => {}, isFinestEnabled: () => false } as never;

describe('ClientCacheInvalidationMetaDataFetcherTest', () => {
    afterEach(() => {
        // no cluster to tear down — tests are purely in-process
    });

    /**
     * Port of {@code fetches_sequence_and_uuid}.
     *
     * Distorts a specific partition's sequence and UUID on the "server-side"
     * MetaDataGenerator using the prefixed cache name, then verifies that
     * fetchMetadata() propagates those values into the client-side RepairingHandler.
     */
    it('fetches_sequence_and_uuid', () => {
        const cacheName = 'test';
        const prefixedName = getPrefixedName(cacheName);
        const partition = 1;
        const givenSequence = 100 + Math.floor(Math.random() * 1000); // positive non-zero
        const givenUuid = crypto.randomUUID();

        // Set up "server-side" state using the prefixed name (as Hazelcast does)
        const metaDataGen = new MetaDataGenerator(PARTITION_COUNT);
        metaDataGen.setCurrentSequence(prefixedName, partition, givenSequence);
        metaDataGen.setUuid(partition, givenUuid);

        const member: ClientCacheDataMember = {
            uuid: 'member-uuid-001',
            ownedPartitions: [partition],
            metaDataGenerator: metaDataGen,
        };
        const clusterService: ClientCacheClusterService = {
            getDataMembers: () => [member],
        };

        const fetcher = new ClientCacheInvalidationMetaDataFetcher(clusterService);

        // Create a RepairingHandler for the cache using the PREFIXED name
        const partitionService = makePartitionService();
        const handler = new RepairingHandler(
            logger,
            'local-member-uuid',
            prefixedName,
            makeNearCache(prefixedName),
            makeSerialization(),
            partitionService,
        );

        const handlers = new Map([[prefixedName, handler]]);

        // Exercise: fetch metadata from the "server"
        fetcher.fetchMetadata(handlers);

        // Verify the handler's MetaDataContainer was updated with server values
        const metaDataContainer = handler.getMetaDataContainer(partition);
        expect(metaDataContainer.getSequence()).toBe(givenSequence);
        expect(metaDataContainer.getUuid()).toBe(givenUuid);
    });

    it('fetchMetadata_isNoOpForEmptyHandlers', () => {
        const metaDataGen = new MetaDataGenerator(PARTITION_COUNT);
        const member: ClientCacheDataMember = {
            uuid: 'member-uuid-001',
            ownedPartitions: [0],
            metaDataGenerator: metaDataGen,
        };
        const fetcher = new ClientCacheInvalidationMetaDataFetcher({
            getDataMembers: () => [member],
        });
        // Should not throw
        fetcher.fetchMetadata(new Map());
    });

    it('init_setsInitialUuidAndSequenceOnHandler', () => {
        const cacheName = 'my-cache';
        const prefixedName = getPrefixedName(cacheName);
        const partition = 0;
        const givenSequence = 55;
        const givenUuid = crypto.randomUUID();

        const metaDataGen = new MetaDataGenerator(PARTITION_COUNT);
        metaDataGen.setCurrentSequence(prefixedName, partition, givenSequence);
        metaDataGen.setUuid(partition, givenUuid);

        const member: ClientCacheDataMember = {
            uuid: 'member-uuid-002',
            ownedPartitions: [partition],
            metaDataGenerator: metaDataGen,
        };
        const fetcher = new ClientCacheInvalidationMetaDataFetcher({
            getDataMembers: () => [member],
        });

        const handler = new RepairingHandler(
            logger,
            'local-member-uuid',
            prefixedName,
            makeNearCache(prefixedName),
            makeSerialization(),
            makePartitionService(),
        );

        const result = fetcher.init(handler);

        expect(result).toBe(true);
        expect(handler.getMetaDataContainer(partition).getSequence()).toBe(givenSequence);
        expect(handler.getMetaDataContainer(partition).getUuid()).toBe(givenUuid);
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
});
