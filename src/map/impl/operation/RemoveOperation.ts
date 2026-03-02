/**
 * Port of {@code com.hazelcast.map.impl.operation.RemoveOperation}.
 *
 * Removes key and sends the previous value (or null if absent).
 */
import type { Data } from '@helios/internal/serialization/Data';
import { MapOperation } from '@helios/map/impl/operation/MapOperation';

export class RemoveOperation extends MapOperation {
    private readonly _key: Data;

    constructor(mapName: string, key: Data) {
        super(mapName);
        this._key = key;
    }

    async run(): Promise<void> {
        this.sendResponse(this.recordStore.remove(this._key));
    }
}
