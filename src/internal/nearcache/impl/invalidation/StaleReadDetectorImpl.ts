/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.invalidation.StaleReadDetectorImpl}.
 *
 * Default implementation of StaleReadDetector.
 */
import type { NearCacheRecord } from '@zenystx/helios-core/internal/nearcache/NearCacheRecord';
import type { MetaDataContainer } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/MetaDataContainer';
import type { MinimalPartitionService } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/MinimalPartitionService';
import type { RepairingHandler } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/RepairingHandler';
import type { StaleReadDetector } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/StaleReadDetector';

export class StaleReadDetectorImpl implements StaleReadDetector {
    private readonly _repairingHandler: RepairingHandler;
    private readonly _partitionService: MinimalPartitionService;

    constructor(repairingHandler: RepairingHandler, partitionService: MinimalPartitionService) {
        this._repairingHandler = repairingHandler;
        this._partitionService = partitionService;
    }

    isStaleRead(key: unknown, record: NearCacheRecord): boolean {
        const latestMetaData = this._repairingHandler.getMetaDataContainer(record.getPartitionId());
        return !record.hasSameUuid(latestMetaData.getUuid())
            || record.getInvalidationSequence() < latestMetaData.getStaleSequence();
    }

    getPartitionId(key: unknown): number {
        return this._partitionService.getPartitionId(key);
    }

    getMetaDataContainer(partitionId: number): MetaDataContainer {
        return this._repairingHandler.getMetaDataContainer(partitionId);
    }

    toString(): string {
        return 'Default StaleReadDetectorImpl';
    }
}
