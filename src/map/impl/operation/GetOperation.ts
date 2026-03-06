/**
 * Port of {@code com.hazelcast.map.impl.operation.GetOperation}.
 *
 * Read-only operation: fetches the serialized value for the given key.
 * Sends null if the key is absent.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { MapOperation } from '@zenystx/helios-core/map/impl/operation/MapOperation';

export class GetOperation extends MapOperation {
    private readonly _key: Data;

    constructor(mapName: string, key: Data) {
        super(mapName);
        this._key = key;
    }

    async run(): Promise<void> {
        this.sendResponse(this.recordStore.get(this._key));
    }
}
