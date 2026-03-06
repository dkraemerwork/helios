/**
 * Port of {@code com.hazelcast.internal.partition.impl.PartitionContainer}.
 *
 * One instance per partition. Holds the partition→namespace→RecordStore hierarchy.
 * Provides lazy creation, namespace enumeration, and migration cleanup.
 */
import { DefaultRecordStore } from '@zenystx/core/map/impl/recordstore/DefaultRecordStore';
import type { RecordStore } from '@zenystx/core/map/impl/recordstore/RecordStore';

export class PartitionContainer {
    readonly partitionId: number;
    private readonly _recordStores = new Map<string, RecordStore>();

    constructor(partitionId: number) {
        this.partitionId = partitionId;
    }

    /** Returns (or lazily creates) the RecordStore for a named map within this partition. */
    getRecordStore(mapName: string): RecordStore {
        let store = this._recordStores.get(mapName);
        if (store === undefined) {
            store = new DefaultRecordStore();
            this._recordStores.set(mapName, store);
        }
        return store;
    }

    /** Returns all service namespace names (map names) for which stores have been created. */
    getAllNamespaces(): string[] {
        return [...this._recordStores.keys()];
    }

    /** Destroys all record stores and resets to empty state. Idempotent. */
    cleanUpOnMigration(): void {
        for (const store of this._recordStores.values()) {
            store.clear();
        }
        this._recordStores.clear();
    }
}
