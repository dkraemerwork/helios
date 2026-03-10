/**
 * Port of {@code com.hazelcast.map.impl.operation.GetOperation}.
 *
 * Read-only operation: fetches the serialized value for the given key.
 * Sends null if the key is absent.
 *
 * Block 21.2: Performs load-on-miss from MapStore on the owner.
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
        const startedAt = Date.now();
        const data = this.recordStore.get(this._key);
        if (data !== null) {
            this.recordMapGet(Date.now() - startedAt);
            this.sendResponse(data);
            return;
        }
        // Load-on-miss from external MapStore on the owner
        if (this.mapDataStore.isWithStore()) {
            this.containerService.ensureExternalMapStoreOperationAllowed(this.partitionId);
            const ne = this.getNodeEngine()!;
            const key = ne.toObject(this._key);
            const loaded = await this.mapDataStore.load(key);
            if (loaded !== null) {
                const loadedData = ne.toData(loaded);
                if (loadedData !== null) {
                    // Store loaded value back into RecordStore
                    this.recordStore.put(this._key, loadedData, -1, -1);
                    this.recordMapGet(Date.now() - startedAt);
                    this.sendResponse(loadedData);
                    return;
                }
            }
        }
        this.recordMapGet(Date.now() - startedAt);
        this.sendResponse(null);
    }
}
