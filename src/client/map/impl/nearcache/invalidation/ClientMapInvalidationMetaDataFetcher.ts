/**
 * Port of {@code com.hazelcast.client.map.impl.nearcache.invalidation.ClientMapInvalidationMetaDataFetcher}.
 *
 * Client-side {@link InvalidationMetaDataFetcher} for IMap near caches.
 * Fetches partition sequences and UUIDs from each data member by executing
 * {@link MapGetInvalidationMetaDataOperation} in-process (single-node mode)
 * or via protocol task invocations (multi-node mode).
 */
import { AbstractInvalidationMetaDataFetcher } from '@helios/internal/nearcache/impl/invalidation/AbstractInvalidationMetaDataFetcher';
import type { InvalidationMetaDataResponse } from '@helios/internal/nearcache/impl/invalidation/AbstractInvalidationMetaDataFetcher';
import { MapGetInvalidationMetaDataOperation } from '@helios/map/impl/operation/MapGetInvalidationMetaDataOperation';
import type { MetaDataGenerator } from '@helios/internal/nearcache/impl/invalidation/MetaDataGenerator';

/** Represents one cluster data member as seen by the client map metadata fetcher. */
export interface ClientMapDataMember {
    /** Member UUID. */
    uuid: string;
    /** Partition IDs owned by this member. */
    ownedPartitions: number[];
    /** Server-side metadata generator for this member. */
    metaDataGenerator: MetaDataGenerator;
}

/** Pluggable cluster service that supplies the list of data members. */
export interface ClientMapClusterService {
    getDataMembers(): ClientMapDataMember[];
}

export class ClientMapInvalidationMetaDataFetcher
    extends AbstractInvalidationMetaDataFetcher<ClientMapDataMember> {

    private readonly _clusterService: ClientMapClusterService;

    constructor(clusterService: ClientMapClusterService) {
        super();
        this._clusterService = clusterService;
    }

    getDataMembers(): ClientMapDataMember[] {
        return this._clusterService.getDataMembers();
    }

    fetchMemberResponse(member: ClientMapDataMember, names: string[]): InvalidationMetaDataResponse {
        const op = new MapGetInvalidationMetaDataOperation(
            names,
            member.ownedPartitions,
            member.metaDataGenerator,
        );
        op.run();
        return op.getResponse();
    }
}
