/**
 * Port of {@code com.hazelcast.map.impl.operation.DeleteOperation}.
 *
 * Removes key without returning the old value.
 * Sends true if the key existed (and was deleted), false otherwise.
 */
import type { Data } from '@helios/internal/serialization/Data';
import { MapOperation } from '@helios/map/impl/operation/MapOperation';

export class DeleteOperation extends MapOperation {
    private readonly _key: Data;

    constructor(mapName: string, key: Data) {
        super(mapName);
        this._key = key;
    }

    async run(): Promise<void> {
        this.sendResponse(this.recordStore.delete(this._key));
    }
}
