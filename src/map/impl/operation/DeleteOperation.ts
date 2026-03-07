/**
 * Port of {@code com.hazelcast.map.impl.operation.DeleteOperation}.
 *
 * Removes key without returning the old value.
 * Sends true if the key existed (and was deleted), false otherwise.
 * Implements BackupAwareOperation — produces a RemoveBackupOperation.
 *
 * Block 21.2: Performs external MapStore delete on the owner.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import type { BackupAwareOperation } from '@zenystx/helios-core/spi/impl/operationservice/BackupAwareOperation';
import { MapOperation } from '@zenystx/helios-core/map/impl/operation/MapOperation';
import { RemoveBackupOperation } from '@zenystx/helios-core/map/impl/operation/RemoveBackupOperation';

export class DeleteOperation extends MapOperation implements BackupAwareOperation {
    private readonly _key: Data;

    constructor(mapName: string, key: Data) {
        super(mapName);
        this._key = key;
    }

    async run(): Promise<void> {
        const deleted = this.recordStore.delete(this._key);
        this.sendResponse(deleted);
        if (deleted) {
            this.recordNamespaceMutation();
        }
        // Owner-side external store delete (only if key existed)
        if (deleted && this.mapDataStore.isWithStore()) {
            this.containerService.ensureExternalMapStoreOperationAllowed(this.partitionId);
            const ne = this.getNodeEngine()!;
            const key = ne.toObject(this._key);
            await this.mapDataStore.remove(key, Date.now());
        }
    }

    shouldBackup(): boolean { return true; }
    getSyncBackupCount(): number { return 1; }
    getAsyncBackupCount(): number { return 0; }

    getBackupOperation(): Operation {
        return new RemoveBackupOperation(this.mapName, this._key);
    }
}
