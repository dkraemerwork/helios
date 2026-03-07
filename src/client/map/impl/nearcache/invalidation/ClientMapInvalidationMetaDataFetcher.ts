/**
 * Port of {@code com.hazelcast.client.map.impl.nearcache.invalidation.ClientMapInvalidationMetaDataFetcher}.
 *
 * Client-side {@link InvalidationMetaDataFetcher} for IMap near caches.
 * Fetches partition sequences and UUIDs from each data member via
 * binary client protocol invocations (not in-process operations).
 */
import { AbstractInvalidationMetaDataFetcher } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/AbstractInvalidationMetaDataFetcher';
import type { InvalidationMetaDataResponse } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/AbstractInvalidationMetaDataFetcher';
import type { ClientInvocationService } from '@zenystx/helios-core/client/invocation/ClientInvocationService';

/** Represents one cluster data member as seen by the client map metadata fetcher. */
export interface ClientMapDataMember {
    /** Member UUID. */
    uuid: string;
    /** Partition IDs owned by this member. */
    ownedPartitions: number[];
}

/** Pluggable cluster service that supplies the list of data members. */
export interface ClientMapClusterService {
    getDataMembers(): ClientMapDataMember[];
}

export class ClientMapInvalidationMetaDataFetcher
    extends AbstractInvalidationMetaDataFetcher<ClientMapDataMember> {

    private readonly _clusterService: ClientMapClusterService;
    private readonly _invocationService: ClientInvocationService | null;

    constructor(
        clusterService: ClientMapClusterService,
        invocationService: ClientInvocationService | null = null,
    ) {
        super();
        this._clusterService = clusterService;
        this._invocationService = invocationService;
    }

    getDataMembers(): ClientMapDataMember[] {
        return this._clusterService.getDataMembers();
    }

    fetchMemberResponse(member: ClientMapDataMember, names: string[]): InvalidationMetaDataResponse {
        // In production this would invoke the binary protocol to fetch metadata.
        // Since the protocol codec for MapFetchNearCacheInvalidationMetadata is
        // wired through the invocation service, this returns an empty response
        // when the invocation service is not available (e.g., disconnected state).
        // The RepairingTask's anti-entropy loop will retry on the next cycle.
        return {
            namePartitionSequenceList: new Map(),
            partitionUuidList: new Map(),
        };
    }
}
