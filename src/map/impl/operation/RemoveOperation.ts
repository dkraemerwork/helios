/**
 * Port of {@code com.hazelcast.map.impl.operation.RemoveOperation}.
 *
 * Removes key and sends the previous value (or null if absent).
 * Implements BackupAwareOperation — produces a RemoveBackupOperation.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import type { BackupAwareOperation } from '@zenystx/helios-core/spi/impl/operationservice/BackupAwareOperation';
import { MapOperation } from '@zenystx/helios-core/map/impl/operation/MapOperation';
import { RemoveBackupOperation } from '@zenystx/helios-core/map/impl/operation/RemoveBackupOperation';

export class RemoveOperation extends MapOperation implements BackupAwareOperation {
    private readonly _key: Data;

    constructor(mapName: string, key: Data) {
        super(mapName);
        this._key = key;
    }

    async run(): Promise<void> {
        this.sendResponse(this.recordStore.remove(this._key));
    }

    shouldBackup(): boolean { return true; }
    getSyncBackupCount(): number { return 1; }
    getAsyncBackupCount(): number { return 0; }

    getBackupOperation(): Operation {
        return new RemoveBackupOperation(this.mapName, this._key);
    }
}
