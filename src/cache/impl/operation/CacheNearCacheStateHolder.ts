/**
 * Port of {@code com.hazelcast.cache.impl.operation.CacheNearCacheStateHolder}.
 *
 * Holds Near Cache metadata snapshot (partitionUuid + cacheNameSequencePairs) for a
 * single partition during cache replication/migration. Produced by {@link prepare}
 * before migration and consumed by {@link applyState} on the target member.
 */
import type { MetaDataGenerator } from '@helios/internal/nearcache/impl/invalidation/MetaDataGenerator';

export class CacheNearCacheStateHolder {
    /** UUID of the partition at snapshot time, or null if not yet assigned. */
    partitionUuid: string | null = null;

    /**
     * Interleaved [cacheName, sequence, cacheName, sequence, …] list.
     * Encoded as alternating string and number entries.
     */
    cacheNameSequencePairs: Array<string | number> = [];

    /**
     * Snapshot metadata for the given partition from {@code metaDataGen}.
     *
     * @param partitionId   the partition to snapshot
     * @param names         cache names whose sequences should be captured
     * @param metaDataGen   the source MetaDataGenerator
     */
    prepare(partitionId: number, names: string[], metaDataGen: MetaDataGenerator): void {
        this.partitionUuid = metaDataGen.getOrCreateUuid(partitionId);

        const pairs: Array<string | number> = [];
        for (const name of names) {
            pairs.push(name);
            pairs.push(metaDataGen.currentSequence(name, partitionId));
        }
        this.cacheNameSequencePairs = pairs;
    }

    /**
     * Restores the snapshot into {@code metaDataGen} for the given partition.
     *
     * @param partitionId   the target partition
     * @param metaDataGen   the target MetaDataGenerator to restore into
     */
    applyState(partitionId: number, metaDataGen: MetaDataGenerator): void {
        if (this.partitionUuid !== null) {
            metaDataGen.setUuid(partitionId, this.partitionUuid);
        }

        for (let i = 0; i < this.cacheNameSequencePairs.length; ) {
            const name = this.cacheNameSequencePairs[i++] as string;
            const seq = this.cacheNameSequencePairs[i++] as number;
            metaDataGen.setCurrentSequence(name, partitionId, seq);
        }
    }
}
