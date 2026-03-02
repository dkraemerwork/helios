/**
 * Port of {@code com.hazelcast.map.impl.MapServiceContext} (minimal surface).
 *
 * Context object provided to map-related services and infrastructure.
 * Carries the NodeEngine, per-partition RecordStore access, and stats.
 */
import type { NodeEngine } from '@helios/spi/NodeEngine';
import type { RecordStore } from '@helios/map/impl/recordstore/RecordStore';
import type { PartitionIdSet } from '@helios/internal/util/collection/PartitionIdSet';
import type { LocalMapStatsProvider } from '@helios/map/impl/LocalMapStatsProvider';

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
