/**
 * Port of {@code com.hazelcast.map.impl.MapServiceContext} (minimal surface).
 *
 * Context object provided to map-related services and infrastructure.
 * Carries the NodeEngine, per-partition RecordStore access, and stats.
 */
import type { PartitionIdSet } from '@zenystx/helios-core/internal/util/collection/PartitionIdSet';
import type { LocalMapStatsProvider } from '@zenystx/helios-core/map/impl/LocalMapStatsProvider';
import type { RecordStore } from '@zenystx/helios-core/map/impl/recordstore/RecordStore';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine';

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
