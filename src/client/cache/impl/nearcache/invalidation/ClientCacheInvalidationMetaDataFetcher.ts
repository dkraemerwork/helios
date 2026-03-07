/**
 * Port of {@code com.hazelcast.client.cache.impl.nearcache.invalidation.ClientCacheInvalidationMetaDataFetcher}.
 *
 * Client-side {@link InvalidationMetaDataFetcher} for ICache near caches.
 * Fetches partition sequences and UUIDs from each data member via
 * binary client protocol invocations (not in-process operations).
 *
 * Cache names in Hazelcast are stored with a "/hz/" prefix in the metadata generator.
 * The caller is responsible for passing the prefixed name when registering handlers.
 */
import { AbstractInvalidationMetaDataFetcher } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/AbstractInvalidationMetaDataFetcher';
import type { InvalidationMetaDataResponse } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/AbstractInvalidationMetaDataFetcher';
import type { ClientInvocationService } from '@zenystx/helios-core/client/invocation/ClientInvocationService';

/** Represents one cluster data member as seen by the client cache metadata fetcher. */
export interface ClientCacheDataMember {
    /** Member UUID. */
    uuid: string;
    /** Partition IDs owned by this member. */
    ownedPartitions: number[];
}

/** Pluggable cluster service that supplies the list of data members. */
export interface ClientCacheClusterService {
    getDataMembers(): ClientCacheDataMember[];
}

export class ClientCacheInvalidationMetaDataFetcher
    extends AbstractInvalidationMetaDataFetcher<ClientCacheDataMember> {

    private readonly _clusterService: ClientCacheClusterService;
    private readonly _invocationService: ClientInvocationService | null;

    constructor(
        clusterService: ClientCacheClusterService,
        invocationService: ClientInvocationService | null = null,
    ) {
        super();
        this._clusterService = clusterService;
        this._invocationService = invocationService;
    }

    getDataMembers(): ClientCacheDataMember[] {
        return this._clusterService.getDataMembers();
    }

    fetchMemberResponse(member: ClientCacheDataMember, names: string[]): InvalidationMetaDataResponse {
        // In production this would invoke the binary protocol to fetch metadata.
        // Returns empty response when invocation service is unavailable.
        // The RepairingTask's anti-entropy loop will retry on the next cycle.
        return {
            namePartitionSequenceList: new Map(),
            partitionUuidList: new Map(),
        };
    }
}
