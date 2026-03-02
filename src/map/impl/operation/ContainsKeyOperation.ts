/**
 * Port of {@code com.hazelcast.map.impl.operation.ContainsKeyOperation}.
 *
 * Sends true if the key exists in the partition's record store, false otherwise.
 */
import type { Data } from '@helios/internal/serialization/Data';
import { MapOperation } from '@helios/map/impl/operation/MapOperation';

export class ContainsKeyOperation extends MapOperation {
    private readonly _key: Data;

    constructor(mapName: string, key: Data) {
        super(mapName);
        this._key = key;
    }

    async run(): Promise<void> {
        this.sendResponse(this.recordStore.containsKey(this._key));
    }
}
