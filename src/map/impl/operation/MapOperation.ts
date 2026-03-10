/**
 * Port of {@code com.hazelcast.map.impl.operation.MapOperation}.
 *
 * Abstract base for all map operations. On beforeRun() it resolves the
 * RecordStore for (mapName, partitionId) from the MapContainerService
 * registered in NodeEngine under MapService.SERVICE_NAME.
 *
 * Block 21.2: Also resolves the MapDataStore so owner-executed operations
 * can perform external store/delete/load calls on the partition owner.
 */
import type { MapContainerService } from '@zenystx/helios-core/map/impl/MapContainerService';
import { MapService } from '@zenystx/helios-core/map/impl/MapService';
import type { MapDataStore } from '@zenystx/helios-core/map/impl/mapstore/MapDataStore';
import type { RecordStore } from '@zenystx/helios-core/map/impl/recordstore/RecordStore';
import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';

export abstract class MapOperation extends Operation {
    protected readonly mapName: string;

    /** Populated in beforeRun(); safe to access from run(). */
    protected recordStore!: RecordStore;

    /** MapDataStore for external persistence. Populated in beforeRun(). */
    protected mapDataStore!: MapDataStore<unknown, unknown>;

    /** MapContainerService reference. Populated in beforeRun(). */
    protected containerService!: MapContainerService;

    constructor(mapName: string) {
        super();
        this.serviceName = MapService.SERVICE_NAME;
        this.mapName = mapName;
    }

    override async beforeRun(): Promise<void> {
        const svc = this.getNodeEngine()!
            .getService<MapContainerService>(MapService.SERVICE_NAME);
        this.containerService = svc;
        this.recordStore = svc.getOrCreateRecordStore(this.mapName, this.partitionId);
        // Ensure MapDataStore is initialized on the owner (lazy init if config registered)
        await svc.ensureMapDataStoreInitialized(this.mapName);
        this.mapDataStore = svc.getExistingMapDataStore(this.mapName);
    }

    protected recordNamespaceMutation(): void {
        const partitionService = this.getNodeEngine()?.getPartitionService() as {
            recordNamespaceMutation?: (partitionId: number, namespace: string) => void;
        } | undefined;
        partitionService?.recordNamespaceMutation?.(this.partitionId, this.mapName);
    }

    protected recordNamespaceBackupMutation(): void {
        const partitionService = this.getNodeEngine()?.getPartitionService() as {
            applyNamespaceBackupMutation?: (partitionId: number, namespace: string, replicaIndex: number) => void;
        } | undefined;
        partitionService?.applyNamespaceBackupMutation?.(this.partitionId, this.mapName, this.replicaIndex);
    }

    protected recordMapGet(latencyMs: number): void {
        this.containerService.getOrCreateMapStats(this.mapName).incrementGetCount(latencyMs);
    }

    protected recordMapPut(latencyMs: number): void {
        this.containerService.getOrCreateMapStats(this.mapName).incrementPutCount(latencyMs);
    }

    protected recordMapSet(): void {
        this.containerService.getOrCreateMapStats(this.mapName).incrementSetCount();
    }

    protected recordMapRemove(latencyMs: number): void {
        this.containerService.getOrCreateMapStats(this.mapName).incrementRemoveCount(latencyMs);
    }
}
