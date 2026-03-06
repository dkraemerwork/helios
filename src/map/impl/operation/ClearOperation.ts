/**
 * Port of {@code com.hazelcast.map.impl.operation.ClearOperation}.
 *
 * Clears all entries in the partition's record store for the given map.
 */
import { MapOperation } from '@zenystx/helios-core/map/impl/operation/MapOperation';

export class ClearOperation extends MapOperation {
    constructor(mapName: string) {
        super(mapName);
    }

    async run(): Promise<void> {
        this.recordStore.clear();
        this.sendResponse(undefined);
    }
}
