/**
 * Port of {@code com.hazelcast.map.impl.operation.RemoveBackupOperation}.
 *
 * Backup operation that removes a key from the backup RecordStore.
 * Used by RemoveOperation and DeleteOperation.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { MapOperation } from '@zenystx/helios-core/map/impl/operation/MapOperation';

export class RemoveBackupOperation extends MapOperation {
    private readonly _key: Data;

    constructor(mapName: string, key: Data) {
        super(mapName);
        this._key = key;
    }

    async run(): Promise<void> {
        this.recordStore.delete(this._key);
        this.recordNamespaceBackupMutation();
    }
}
