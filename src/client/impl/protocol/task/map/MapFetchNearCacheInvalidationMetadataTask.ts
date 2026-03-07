/**
 * Port of {@code com.hazelcast.client.impl.protocol.task.map.MapFetchNearCacheInvalidationMetadataTask}.
 *
 * Client-protocol task that dispatches a {@link MapGetInvalidationMetaDataOperation}
 * to a specific member (identified by UUID) and returns the invalidation metadata
 * response for the requested map names.
 *
 * In Helios this is a thin coordination wrapper: it holds the request parameters
 * and delegates execution to the operation when {@link execute} is called.
 */
import type { MetaDataGenerator } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/MetaDataGenerator';
import type { InvalidationMetaDataResponse } from '@zenystx/helios-core/map/impl/operation/MapGetInvalidationMetaDataOperation';
import { MapGetInvalidationMetaDataOperation } from '@zenystx/helios-core/map/impl/operation/MapGetInvalidationMetaDataOperation';

export interface MapFetchNearCacheInvalidationMetadataRequestParameters {
    /** names of the maps for which metadata should be fetched */
    names: string[];
    /** UUID of the target member */
    uuid: string;
}

export class MapFetchNearCacheInvalidationMetadataTask {
    private readonly _params: MapFetchNearCacheInvalidationMetadataRequestParameters;

    constructor(params: MapFetchNearCacheInvalidationMetadataRequestParameters) {
        this._params = params;
    }

    get targetUuid(): string {
        return this._params.uuid;
    }

    /**
     * Executes the underlying metadata operation against the given MetaDataGenerator
     * and owned partition list, returning the encoded response.
     */
    execute(
        ownedPartitions: number[],
        metaDataGen: MetaDataGenerator,
    ): InvalidationMetaDataResponse {
        const op = new MapGetInvalidationMetaDataOperation(this._params.names, ownedPartitions, metaDataGen);
        op.run();
        return op.getResponse();
    }

    getServiceName(): string {
        return 'hz:impl:mapService';
    }

    getMethodName(): string {
        return 'fetchNearCacheInvalidationMetadata';
    }
}
