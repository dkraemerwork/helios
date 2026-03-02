/**
 * Service registered under {@code MapService.SERVICE_NAME} in NodeEngine.
 *
 * Holds one {@link RecordStore} per (mapName, partitionId) pair.
 * In Phase 3 single-node operation, all records live in-process.
 * In Phase 4+ this will delegate to a cluster-aware partition table.
 *
 * Port of the partition-container lookup path in
 * {@code com.hazelcast.map.impl.MapServiceContextImpl}.
 */
import type { RecordStore } from '@helios/map/impl/recordstore/RecordStore';
import { DefaultRecordStore } from '@helios/map/impl/recordstore/DefaultRecordStore';

export class MapContainerService {
    private readonly _stores = new Map<string, RecordStore>();

    private _storeKey(mapName: string, partitionId: number): string {
        return `${mapName}:${partitionId}`;
    }

    /**
     * Returns the RecordStore for (mapName, partitionId), creating a new
     * DefaultRecordStore if one does not yet exist.
     */
    getOrCreateRecordStore(mapName: string, partitionId: number): RecordStore {
        const key = this._storeKey(mapName, partitionId);
        let store = this._stores.get(key);
        if (store === undefined) {
            store = new DefaultRecordStore();
            this._stores.set(key, store);
        }
        return store;
    }

    /**
     * Register a specific RecordStore for (mapName, partitionId).
     * Useful in tests to inject a pre-populated or mock store.
     */
    setRecordStore(mapName: string, partitionId: number, store: RecordStore): void {
        this._stores.set(this._storeKey(mapName, partitionId), store);
    }

    /**
     * Returns the RecordStore for (mapName, partitionId), or null if absent.
     */
    getRecordStore(mapName: string, partitionId: number): RecordStore | null {
        return this._stores.get(this._storeKey(mapName, partitionId)) ?? null;
    }

    /**
     * Iterates over all (key, value) entries across all partitions for the given map.
     * Used by MapQueryEngine to perform partition-local full scans.
     */
    *getAllEntries(mapName: string): IterableIterator<readonly [import('@helios/internal/serialization/Data').Data, import('@helios/internal/serialization/Data').Data]> {
        const prefix = `${mapName}:`;
        for (const [storeKey, store] of this._stores) {
            if (storeKey.startsWith(prefix)) {
                yield* store.entries();
            }
        }
    }
}
