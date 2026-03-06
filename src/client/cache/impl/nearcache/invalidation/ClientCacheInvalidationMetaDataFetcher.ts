/**
 * Port of {@code com.hazelcast.client.cache.impl.nearcache.invalidation.ClientCacheInvalidationMetaDataFetcher}.
 *
 * Client-side {@link InvalidationMetaDataFetcher} for ICache near caches.
 * Structurally identical to {@link ClientMapInvalidationMetaDataFetcher} but uses
 * {@link CacheGetInvalidationMetaDataOperation} instead of the map variant.
 *
 * Cache names in Hazelcast are stored with a "/hz/" prefix in the metadata generator.
 * The caller is responsible for passing the prefixed name when registering handlers.
 */
import { AbstractInvalidationMetaDataFetcher } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/AbstractInvalidationMetaDataFetcher';
import type { InvalidationMetaDataResponse } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/AbstractInvalidationMetaDataFetcher';
import { CacheGetInvalidationMetaDataOperation } from '@zenystx/helios-core/cache/impl/operation/CacheGetInvalidationMetaDataOperation';
import type { MetaDataGenerator } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/MetaDataGenerator';

/** Represents one cluster data member as seen by the client cache metadata fetcher. */
export interface ClientCacheDataMember {
    /** Member UUID. */
    uuid: string;
    /** Partition IDs owned by this member. */
    ownedPartitions: number[];
    /** Server-side metadata generator for this member. */
    metaDataGenerator: MetaDataGenerator;
}

/** Pluggable cluster service that supplies the list of data members. */
export interface ClientCacheClusterService {
    getDataMembers(): ClientCacheDataMember[];
}

export class ClientCacheInvalidationMetaDataFetcher
    extends AbstractInvalidationMetaDataFetcher<ClientCacheDataMember> {

    private readonly _clusterService: ClientCacheClusterService;

    constructor(clusterService: ClientCacheClusterService) {
        super();
        this._clusterService = clusterService;
    }

    getDataMembers(): ClientCacheDataMember[] {
        return this._clusterService.getDataMembers();
    }

    fetchMemberResponse(member: ClientCacheDataMember, names: string[]): InvalidationMetaDataResponse {
        const op = new CacheGetInvalidationMetaDataOperation(
            names,
            member.ownedPartitions,
            member.metaDataGenerator,
        );
        op.run();
        return op.getResponse();
    }
}
