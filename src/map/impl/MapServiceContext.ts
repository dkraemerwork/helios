/**
 * Port of {@code com.hazelcast.map.impl.MapServiceContext} (minimal surface).
 *
 * Context object provided to map-related services and infrastructure.
 * Carries the NodeEngine, per-partition RecordStore access, and stats.
 */
import type { NodeEngine } from '@zenystx/core/spi/NodeEngine';
import type { RecordStore } from '@zenystx/core/map/impl/recordstore/RecordStore';
import type { PartitionIdSet } from '@zenystx/core/internal/util/collection/PartitionIdSet';
import type { LocalMapStatsProvider } from '@zenystx/core/map/impl/LocalMapStatsProvider';

export interface MapServiceContext {
    getNodeEngine(): NodeEngine;

    /**
     * Returns the RecordStore for the given (partitionId, mapName) pair.
     * Creates a new store if one does not yet exist.
     */
    getRecordStore(partitionId: number, mapName: string): RecordStore;

    /**
     * Returns the cached set of locally owned partition IDs.
     * Used by the query result size pre-check.
     */
    getCachedOwnedPartitions(): PartitionIdSet;

    /**
     * Returns the stats provider for per-map stats tracking.
     * May return null in contexts where stats are not needed.
     */
    getLocalMapStatsProvider(): LocalMapStatsProvider | null;
}
