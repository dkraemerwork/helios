/**
 * Port of {@code com.hazelcast.map.impl.operation.MapReplicationStateHolder}.
 *
 * Captures record store data for all maps in a partition during replication,
 * and applies the captured state to a destination partition container.
 *
 * Note: putOrUpdateReplicatedRecord only updates the record store — it does NOT
 * trigger write-behind. Write-behind state is restored separately via
 * WriteBehindStateHolder.applyState().
 */
import type { Data } from '@helios/internal/serialization/Data';
import type { PartitionContainer } from '@helios/internal/partition/impl/PartitionContainer';

/** A captured (key, value) pair from a record store. */
export interface ReplicatedRecord {
    readonly key: Data;
    readonly value: Data;
}

export class MapReplicationStateHolder {
    /** Per-map captured records: mapName → array of (key, value) pairs. */
    readonly mapData = new Map<string, ReplicatedRecord[]>();

    /**
     * Captures all record store data from the given partition container.
     *
     * @param container    the source partition container
     * @param _partitionId the partition ID (for future index/stats use)
     * @param _replicaIndex the replica index (for future filtering)
     */
    prepare(container: PartitionContainer, _partitionId: number, _replicaIndex: number): void {
        for (const mapName of container.getAllNamespaces()) {
            const store = container.getRecordStore(mapName);
            const records: ReplicatedRecord[] = [];
            for (const [key, value] of store.entries()) {
                records.push({ key, value });
            }
            this.mapData.set(mapName, records);
        }
    }

    /**
     * Applies captured state to the destination partition container.
     * Clears existing records in each map before applying.
     *
     * @param container the destination partition container
     */
    applyState(container: PartitionContainer): void {
        for (const [mapName, records] of this.mapData) {
            const store = container.getRecordStore(mapName);
            store.clear();
            for (const { key, value } of records) {
                store.put(key, value, -1, -1);
            }
        }
    }
}
