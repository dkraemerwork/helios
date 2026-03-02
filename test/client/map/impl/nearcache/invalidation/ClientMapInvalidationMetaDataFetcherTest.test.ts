/**
 * Port of {@code com.hazelcast.client.map.impl.nearcache.invalidation.ClientMapInvalidationMetaDataFetcherTest}.
 *
 * Tests that the client-side map metadata fetcher correctly fetches partition sequences
 * and UUIDs from a server-side MetaDataGenerator and propagates them into RepairingHandlers.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { ClientMapInvalidationMetaDataFetcher } from '@helios/client/map/impl/nearcache/invalidation/ClientMapInvalidationMetaDataFetcher';
import type { ClientMapClusterService, ClientMapDataMember } from '@helios/client/map/impl/nearcache/invalidation/ClientMapInvalidationMetaDataFetcher';
import { RepairingHandler } from '@helios/internal/nearcache/impl/invalidation/RepairingHandler';
import { MetaDataGenerator } from '@helios/internal/nearcache/impl/invalidation/MetaDataGenerator';
import type { MinimalPartitionService } from '@helios/internal/nearcache/impl/invalidation/MinimalPartitionService';
import type { NearCache } from '@helios/internal/nearcache/NearCache';
import type { SerializationService } from '@helios/internal/serialization/SerializationService';

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
        getStatsJson: () => ({}),
        prefixedName: () => 'testMap',
    } as unknown as NearCache<unknown, unknown>;
}

function makeSerialization(): SerializationService {
    return { toObject: (d: unknown) => d } as unknown as SerializationService;
}

const logger = { finest: () => {}, isFinestEnabled: () => false } as never;

describe('ClientMapInvalidationMetaDataFetcherTest', () => {
    afterEach(() => {
        // no cluster to tear down — tests are purely in-process
    });

    /**
     * Port of {@code fetches_sequence_and_uuid}.
     *
     * Distorts a specific partition's sequence and UUID on the "server-side"
     * MetaDataGenerator, then verifies that fetchMetadata() propagates those
     * values into the client-side RepairingHandler's MetaDataContainer.
     */
    it('fetches_sequence_and_uuid', () => {
        const mapName = 'test';
        const partition = 1;
        const givenSequence = 42 + Math.floor(Math.random() * 1000); // positive non-zero
        const givenUuid = crypto.randomUUID();

        // Set up the "server-side" state
        const metaDataGen = new MetaDataGenerator(PARTITION_COUNT);
        metaDataGen.setCurrentSequence(mapName, partition, givenSequence);
        metaDataGen.setUuid(partition, givenUuid);

        // Build the cluster service returning one member
        const member: ClientMapDataMember = {
            uuid: 'member-uuid-001',
            ownedPartitions: [partition],
            metaDataGenerator: metaDataGen,
        };
        const clusterService: ClientMapClusterService = {
            getDataMembers: () => [member],
        };

        // Create the fetcher
        const fetcher = new ClientMapInvalidationMetaDataFetcher(clusterService);

        // Create a RepairingHandler for the map (initially empty)
        const partitionService = makePartitionService();
        const handler = new RepairingHandler(
            logger,
            'local-member-uuid',
            mapName,
            makeNearCache(),
            makeSerialization(),
            partitionService,
        );

        const handlers = new Map([[mapName, handler]]);

        // Exercise: fetch metadata from the "server"
        fetcher.fetchMetadata(handlers);

        // Verify that the handler's MetaDataContainer was updated
        const metaDataContainer = handler.getMetaDataContainer(partition);
        expect(metaDataContainer.getSequence()).toBe(givenSequence);
        expect(metaDataContainer.getUuid()).toBe(givenUuid);
    });

    it('fetchMetadata_isNoOpForEmptyHandlers', () => {
        const metaDataGen = new MetaDataGenerator(PARTITION_COUNT);
        const member: ClientMapDataMember = {
            uuid: 'member-uuid-001',
            ownedPartitions: [0],
            metaDataGenerator: metaDataGen,
        };
        const fetcher = new ClientMapInvalidationMetaDataFetcher({
            getDataMembers: () => [member],
        });
        // Should not throw
        fetcher.fetchMetadata(new Map());
    });

    it('init_setsInitialUuidAndSequenceOnHandler', () => {
        const mapName = 'test-map';
        const partition = 0;
        const givenSequence = 77;
        const givenUuid = crypto.randomUUID();

        const metaDataGen = new MetaDataGenerator(PARTITION_COUNT);
        metaDataGen.setCurrentSequence(mapName, partition, givenSequence);
        metaDataGen.setUuid(partition, givenUuid);

        const member: ClientMapDataMember = {
            uuid: 'member-uuid-002',
            ownedPartitions: [partition],
            metaDataGenerator: metaDataGen,
        };
        const fetcher = new ClientMapInvalidationMetaDataFetcher({
            getDataMembers: () => [member],
        });

        const handler = new RepairingHandler(
            logger,
            'local-member-uuid',
            mapName,
            makeNearCache(),
            makeSerialization(),
            makePartitionService(),
        );

        const result = fetcher.init(handler);

        expect(result).toBe(true);
        expect(handler.getMetaDataContainer(partition).getSequence()).toBe(givenSequence);
        expect(handler.getMetaDataContainer(partition).getUuid()).toBe(givenUuid);
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
});
