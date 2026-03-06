/**
 * Port of {@code com.hazelcast.map.impl.operation.PutAllOperation} (minimal).
 *
 * Batch-stores all (key, value) pairs into the partition's record store.
 * In single-node operation this runs synchronously on the local partition.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { MapOperation } from '@zenystx/helios-core/map/impl/operation/MapOperation';

export class PutAllOperation extends MapOperation {
    private readonly _entries: ReadonlyArray<readonly [Data, Data]>;

    constructor(mapName: string, entries: ReadonlyArray<readonly [Data, Data]>) {
        super(mapName);
        this._entries = entries;
    }

    async run(): Promise<void> {
        this.recordStore.putAll(this._entries);
        this.sendResponse(undefined);
    }
}
