/**
 * Port of {@code com.hazelcast.client.impl.protocol.task.cache.CacheFetchNearCacheInvalidationMetadataTask}.
 *
 * Client-protocol task that dispatches a {@link CacheGetInvalidationMetaDataOperation}
 * to a specific member (identified by UUID) and returns the invalidation metadata
 * response for the requested cache names.
 */
import type { InvalidationMetaDataResponse } from '@zenystx/helios-core/cache/impl/operation/CacheGetInvalidationMetaDataOperation';
import { CacheGetInvalidationMetaDataOperation } from '@zenystx/helios-core/cache/impl/operation/CacheGetInvalidationMetaDataOperation';
import type { MetaDataGenerator } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/MetaDataGenerator';

export interface CacheFetchNearCacheInvalidationMetadataRequestParameters {
    /** names of the caches for which metadata should be fetched */
    names: string[];
    /** UUID of the target member */
    uuid: string;
}

export class CacheFetchNearCacheInvalidationMetadataTask {
    private readonly _params: CacheFetchNearCacheInvalidationMetadataRequestParameters;

    constructor(params: CacheFetchNearCacheInvalidationMetadataRequestParameters) {
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
        const op = new CacheGetInvalidationMetaDataOperation(this._params.names, ownedPartitions, metaDataGen);
        op.run();
        return op.getResponse();
    }

    getServiceName(): string {
        return 'hz:impl:cacheService';
    }

    getMethodName(): string | null {
        return null;
    }
}
