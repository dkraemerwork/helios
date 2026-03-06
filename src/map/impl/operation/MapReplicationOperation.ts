/**
 * Port of {@code com.hazelcast.map.impl.operation.MapReplicationOperation}.
 *
 * Composes MapReplicationStateHolder, WriteBehindStateHolder, and
 * MapNearCacheStateHolder to perform full partition replication for maps.
 */
import type { PartitionContainer } from '@zenystx/core/internal/partition/impl/PartitionContainer';
import type { MetaDataGenerator } from '@zenystx/core/internal/nearcache/impl/invalidation/MetaDataGenerator';
import type { WriteBehindStore } from '@zenystx/core/map/impl/mapstore/writebehind/WriteBehindStore';
import type { MapReplicationStateHolder } from '@zenystx/core/map/impl/operation/MapReplicationStateHolder';
import type { WriteBehindStateHolder } from '@zenystx/core/map/impl/operation/WriteBehindStateHolder';
import type { MapNearCacheStateHolder } from '@zenystx/core/map/impl/operation/MapNearCacheStateHolder';

export class MapReplicationOperation {
    readonly partitionId: number;
    readonly replicaIndex: number;
    readonly mapReplicationStateHolder: MapReplicationStateHolder;
    readonly writeBehindStateHolder: WriteBehindStateHolder;
    readonly mapNearCacheStateHolder: MapNearCacheStateHolder;

    constructor(
        partitionId: number,
        replicaIndex: number,
        mapReplicationStateHolder: MapReplicationStateHolder,
        writeBehindStateHolder: WriteBehindStateHolder,
        mapNearCacheStateHolder: MapNearCacheStateHolder,
    ) {
        this.partitionId = partitionId;
        this.replicaIndex = replicaIndex;
        this.mapReplicationStateHolder = mapReplicationStateHolder;
        this.writeBehindStateHolder = writeBehindStateHolder;
        this.mapNearCacheStateHolder = mapNearCacheStateHolder;
    }

    /**
     * Applies all captured state to the destination:
     * 1. Map records (always)
     * 2. Write-behind queues (always)
     * 3. Near cache metadata (only for primary replica, replicaIndex === 0)
     */
    run(
        container: PartitionContainer,
        writeBehindStores: Map<string, WriteBehindStore<unknown, unknown>>,
        metaDataGenerator: MetaDataGenerator | null,
    ): void {
        this.mapReplicationStateHolder.applyState(container);
        this.writeBehindStateHolder.applyState(writeBehindStores);

        if (this.replicaIndex === 0 && metaDataGenerator !== null) {
            this.mapNearCacheStateHolder.applyState(this.partitionId, metaDataGenerator);
        }
    }
}
