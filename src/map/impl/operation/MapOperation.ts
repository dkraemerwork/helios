/**
 * Port of {@code com.hazelcast.map.impl.operation.MapOperation}.
 *
 * Abstract base for all map operations. On beforeRun() it resolves the
 * RecordStore for (mapName, partitionId) from the MapContainerService
 * registered in NodeEngine under MapService.SERVICE_NAME.
 */
import { Operation } from '@helios/spi/impl/operationservice/Operation';
import type { RecordStore } from '@helios/map/impl/recordstore/RecordStore';
import type { MapContainerService } from '@helios/map/impl/MapContainerService';
import { MapService } from '@helios/map/impl/MapService';

export abstract class MapOperation extends Operation {
    protected readonly mapName: string;

    /** Populated in beforeRun(); safe to access from run(). */
    protected recordStore!: RecordStore;

    constructor(mapName: string) {
        super();
        this.serviceName = MapService.SERVICE_NAME;
        this.mapName = mapName;
    }

    override async beforeRun(): Promise<void> {
        const svc = this.getNodeEngine()!
            .getService<MapContainerService>(MapService.SERVICE_NAME);
        this.recordStore = svc.getOrCreateRecordStore(this.mapName, this.partitionId);
    }
}
