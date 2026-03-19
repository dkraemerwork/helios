/**
 * Port of {@code com.hazelcast.map.impl.operation.ClearOperation}.
 *
 * Clears all entries in the partition's record store for the given map.
 * External store cleanup is handled by MapProxy after all ClearOperations complete.
 */
import { MapOperation } from '@zenystx/helios-core/map/impl/operation/MapOperation';
import { ClearBackupOperation } from '@zenystx/helios-core/map/impl/operation/ClearBackupOperation';
import type { BackupAwareOperation } from '@zenystx/helios-core/spi/impl/operationservice/BackupAwareOperation';
import type { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';

export class ClearOperation extends MapOperation implements BackupAwareOperation {
    constructor(mapName: string) {
        super(mapName);
    }

    async run(): Promise<void> {
        const hadEntries = this.recordStore.size() > 0;
        this.recordStore.clear();
        if (hadEntries) {
            this.recordNamespaceMutation();
        }
        // WAN replication: publish CLEAR event on primary replica (only if map had entries)
        if (hadEntries) {
            this.publishWanEvent('CLEAR', null, null, 0);
        }
        this.sendResponse(undefined);
    }

    shouldBackup(): boolean { return true; }
    getSyncBackupCount(): number { return 1; }
    getAsyncBackupCount(): number { return 0; }

    getBackupOperation(): Operation {
        return new ClearBackupOperation(this.mapName);
    }
}
