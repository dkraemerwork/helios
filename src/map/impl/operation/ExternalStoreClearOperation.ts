import { MapOperation } from '@zenystx/helios-core/map/impl/operation/MapOperation';

export class ExternalStoreClearOperation extends MapOperation {
    constructor(mapName: string) {
        super(mapName);
    }

    async run(): Promise<void> {
        this.containerService.ensureExternalMapStoreOperationAllowed(this.partitionId);
        if (this.mapDataStore.isWithStore()) {
            await this.mapDataStore.clear();
        }
        this.sendResponse(undefined);
    }
}
