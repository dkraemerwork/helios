/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.invalidation.StaleReadDetector}.
 *
 * Interface for detecting stale Near Cache data.
 */
import type { NearCacheRecord } from '@helios/internal/nearcache/NearCacheRecord';
import type { MetaDataContainer } from '@helios/internal/nearcache/impl/invalidation/MetaDataContainer';

export type { MetaDataContainer };

export interface StaleReadDetector {
    isStaleRead(key: unknown, record: NearCacheRecord): boolean;
    getPartitionId(key: unknown): number;
    getMetaDataContainer(partitionId: number): MetaDataContainer | null;
}

const alwaysFresh: StaleReadDetector = {
    isStaleRead(_key: unknown, _record: NearCacheRecord): boolean {
        return false;
    },
    getPartitionId(_key: unknown): number {
        return 0;
    },
    getMetaDataContainer(_partitionId: number): null {
        return null;
    },
};

export const ALWAYS_FRESH: StaleReadDetector = alwaysFresh;
