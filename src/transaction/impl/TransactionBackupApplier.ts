import { decodeData } from '@zenystx/helios-core/cluster/tcp/DataWireCodec';
import type { DistributedListService } from '@zenystx/helios-core/collection/impl/list/DistributedListService';
import type { DistributedQueueService } from '@zenystx/helios-core/collection/impl/queue/DistributedQueueService';
import type { DistributedSetService } from '@zenystx/helios-core/collection/impl/set/DistributedSetService';
import type { MapContainerService } from '@zenystx/helios-core/map/impl/MapContainerService';
import type { DistributedMultiMapService } from '@zenystx/helios-core/multimap/impl/DistributedMultiMapService';
import type { TransactionBackupRecord } from '@zenystx/helios-core/transaction/impl/TransactionBackupRecord';
import type { TransactionBackupExecutor } from '@zenystx/helios-core/transaction/impl/TransactionManagerServiceImpl';

export interface TransactionBackupServices {
    readonly mapService: MapContainerService;
    readonly queueService: DistributedQueueService | null;
    readonly listService: DistributedListService | null;
    readonly setService: DistributedSetService | null;
    readonly multiMapService: DistributedMultiMapService | null;
}

export class TransactionBackupApplier implements TransactionBackupExecutor {
    constructor(private readonly _services: TransactionBackupServices) {}

    async commitRecord(record: TransactionBackupRecord): Promise<void> {
        switch (record.kind) {
            case 'map': {
                const store = this._services.mapService.getOrCreateRecordStore(record.mapName, record.partitionId);
                const key = decodeData(record.entry.key);
                const value = record.entry.value === null ? null : decodeData(record.entry.value);
                switch (record.entry.opType) {
                    case 'put':
                    case 'set':
                    case 'putIfAbsent':
                    case 'replace':
                        if (value !== null) {
                            store.put(key, value, -1, -1);
                        }
                        return;
                    case 'remove':
                    case 'delete':
                        store.remove(key);
                        return;
                }
            }
            case 'queue':
                if (this._services.queueService === null) {
                    return;
                }
                if (record.opType === 'offer') {
                    if (record.valueData !== null) {
                        await this._services.queueService.offer(record.queueName, decodeData(record.valueData), 0);
                    }
                    return;
                }
                await this._services.queueService.poll(record.queueName, 0);
                return;
            case 'list':
                if (this._services.listService === null) {
                    return;
                }
                if (record.opType === 'add') {
                    await this._services.listService.add(record.listName, decodeData(record.valueData));
                    return;
                }
                await this._services.listService.remove(record.listName, decodeData(record.valueData));
                return;
            case 'set':
                if (this._services.setService === null) {
                    return;
                }
                if (record.opType === 'add') {
                    await this._services.setService.add(record.setName, decodeData(record.valueData));
                    return;
                }
                await this._services.setService.remove(record.setName, decodeData(record.valueData));
                return;
            case 'multimap':
                if (this._services.multiMapService === null) {
                    return;
                }
                if (record.opType === 'removeAll') {
                    await this._services.multiMapService.removeAll(record.mapName, decodeData(record.keyData));
                    return;
                }
                if (record.opType === 'put') {
                    if (record.valueData !== null) {
                        await this._services.multiMapService.put(record.mapName, decodeData(record.keyData), decodeData(record.valueData));
                    }
                    return;
                }
                if (record.valueData !== null) {
                    await this._services.multiMapService.remove(record.mapName, decodeData(record.keyData), decodeData(record.valueData));
                }
                return;
        }
    }
}
