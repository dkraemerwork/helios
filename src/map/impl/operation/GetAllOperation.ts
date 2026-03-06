/**
 * Port of {@code com.hazelcast.map.impl.operation.GetAllOperation} (minimal).
 *
 * Batch-fetches values for the given keys from the partition's record store.
 * Sends an array of (key, value | null) pairs; null for missing keys.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { MapOperation } from '@zenystx/helios-core/map/impl/operation/MapOperation';

export class GetAllOperation extends MapOperation {
    private readonly _keys: ReadonlyArray<Data>;

    constructor(mapName: string, keys: ReadonlyArray<Data>) {
        super(mapName);
        this._keys = keys;
    }

    async run(): Promise<void> {
        this.sendResponse(this.recordStore.getAll(this._keys));
    }
}
