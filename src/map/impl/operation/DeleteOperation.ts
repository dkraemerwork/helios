/**
 * Port of {@code com.hazelcast.map.impl.operation.DeleteOperation}.
 *
 * Removes key without returning the old value.
 * Sends true if the key existed (and was deleted), false otherwise.
 * Implements BackupAwareOperation — produces a RemoveBackupOperation.
 */
import type { Data } from '@zenystx/core/internal/serialization/Data';
import type { Operation } from '@zenystx/core/spi/impl/operationservice/Operation';
import type { BackupAwareOperation } from '@zenystx/core/spi/impl/operationservice/BackupAwareOperation';
import { MapOperation } from '@zenystx/core/map/impl/operation/MapOperation';
import { RemoveBackupOperation } from '@zenystx/core/map/impl/operation/RemoveBackupOperation';

export class DeleteOperation extends MapOperation implements BackupAwareOperation {
    private readonly _key: Data;

    constructor(mapName: string, key: Data) {
        super(mapName);
        this._key = key;
    }

    async run(): Promise<void> {
        this.sendResponse(this.recordStore.delete(this._key));
    }

    shouldBackup(): boolean { return true; }
    getSyncBackupCount(): number { return 1; }
    getAsyncBackupCount(): number { return 0; }

    getBackupOperation(): Operation {
        return new RemoveBackupOperation(this.mapName, this._key);
    }
}
