/**
 * Backup operation that clears the backup RecordStore for a map partition.
 */
import { MapOperation } from '@zenystx/helios-core/map/impl/operation/MapOperation';

export class ClearBackupOperation extends MapOperation {
    constructor(mapName: string) {
        super(mapName);
    }

    async run(): Promise<void> {
        const hadEntries = this.recordStore.size() > 0;
        this.recordStore.clear();
        if (hadEntries) {
            this.recordNamespaceBackupMutation();
        }
    }
}
