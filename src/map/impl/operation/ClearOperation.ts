/**
 * Port of {@code com.hazelcast.map.impl.operation.ClearOperation}.
 *
 * Clears all entries in the partition's record store for the given map.
 * External store cleanup is handled by MapProxy after all ClearOperations complete.
 */
import { MapOperation } from '@zenystx/helios-core/map/impl/operation/MapOperation';

export class ClearOperation extends MapOperation {
    constructor(mapName: string) {
        super(mapName);
    }

    async run(): Promise<void> {
        const hadEntries = this.recordStore.size() > 0;
        this.recordStore.clear();
        if (hadEntries) {
            this.recordNamespaceMutation();
        }
        this.sendResponse(undefined);
    }
}
