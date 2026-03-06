/**
 * Port of {@code com.hazelcast.map.impl.query.QueryResultSizeLimiter}.
 *
 * Responsible for limiting result size of queries to prevent OOM.
 * Provides a hard-coded minimum limit and a pre-check for local partitions.
 */
import type { MapServiceContext } from '@zenystx/core/map/impl/MapServiceContext';
import type { ILogger } from '@zenystx/core/test-support/ILogger';
import { ClusterProperty } from '@zenystx/core/spi/properties/ClusterProperty';
import { QueryResultSizeExceededException } from '@zenystx/core/map/QueryResultSizeExceededException';

export class QueryResultSizeLimiter {
    /**
     * Minimum value for result size limit to ensure sufficient data distribution.
     */
    static readonly MINIMUM_MAX_RESULT_LIMIT = 65_000;

    /** Security margin factor to prevent false positives. */
    static readonly MAX_RESULT_LIMIT_FACTOR = 1.15;

    /** Security margin for pre-check (3 partitions by default, data imbalance). */
    static readonly MAX_RESULT_LIMIT_FACTOR_FOR_PRECHECK = 1.25;

    /** Value marking the disabled state. */
    static readonly DISABLED = -1;

    private readonly _mapServiceContext: MapServiceContext;
    private readonly _maxResultLimit: number;
    private readonly _maxLocalPartitionsLimitForPreCheck: number;
    private readonly _resultLimitPerPartition: number;
    private readonly _isQueryResultLimitEnabled: boolean;
    private readonly _isPreCheckEnabled: boolean;

    constructor(mapServiceContext: MapServiceContext, _logger: ILogger) {
        this._mapServiceContext = mapServiceContext;
        const nodeEngine = mapServiceContext.getNodeEngine();
        const props = nodeEngine.getProperties();
        const partitionCount = nodeEngine.getPartitionService().getPartitionCount();

        this._maxResultLimit = this._getMaxResultLimit(props);
        this._maxLocalPartitionsLimitForPreCheck = this._getMaxLocalPartitionsLimitForPreCheck(props);
        this._resultLimitPerPartition =
            this._maxResultLimit * QueryResultSizeLimiter.MAX_RESULT_LIMIT_FACTOR / partitionCount;

        this._isQueryResultLimitEnabled = (this._maxResultLimit !== QueryResultSizeLimiter.DISABLED);
        this._isPreCheckEnabled = (
            this._isQueryResultLimitEnabled &&
            this._maxLocalPartitionsLimitForPreCheck !== QueryResultSizeLimiter.DISABLED
        );
    }

    isQueryResultLimitEnabled(): boolean { return this._isQueryResultLimitEnabled; }

    isPreCheckEnabled(): boolean { return this._isPreCheckEnabled; }

    getMapServiceContext(): MapServiceContext { return this._mapServiceContext; }

    getNodeResultLimit(ownedPartitions: number): number {
        return this._isQueryResultLimitEnabled
            ? Math.ceil(this._resultLimitPerPartition * ownedPartitions)
            : Number.MAX_SAFE_INTEGER;
    }

    precheckMaxResultLimitOnLocalPartitions(mapName: string): void {
        if (!this._isPreCheckEnabled) return;

        const localPartitions = this._mapServiceContext.getCachedOwnedPartitions();
        const partitionsToCheck = Math.min(localPartitions.size(), this._maxLocalPartitionsLimitForPreCheck);
        if (partitionsToCheck === 0) return;

        const localPartitionSize = this._getLocalPartitionSize(mapName, localPartitions, partitionsToCheck);
        if (localPartitionSize === 0) return;

        const localResultLimit = this.getNodeResultLimit(partitionsToCheck);
        if (localPartitionSize > localResultLimit * QueryResultSizeLimiter.MAX_RESULT_LIMIT_FACTOR_FOR_PRECHECK) {
            const provider = this._mapServiceContext.getLocalMapStatsProvider();
            if (provider !== null && provider.hasLocalMapStatsImpl(mapName)) {
                provider.getLocalMapStatsImpl(mapName).incrementQueryResultSizeExceededCount();
            }
            throw new QueryResultSizeExceededException(
                this._maxResultLimit,
                ' Result size exceeded in local pre-check.',
            );
        }
    }

    private _getLocalPartitionSize(
        mapName: string,
        localPartitions: import('@zenystx/core/internal/util/collection/PartitionIdSet').PartitionIdSet,
        partitionsToCheck: number,
    ): number {
        let localSize = 0;
        let partitionsChecked = 0;
        for (const partitionId of localPartitions) {
            localSize += this._mapServiceContext.getRecordStore(partitionId, mapName).size();
            if (++partitionsChecked === partitionsToCheck) break;
        }
        return localSize;
    }

    private _getMaxResultLimit(props: import('@zenystx/core/spi/properties/HeliosProperties').HeliosProperties): number {
        const v = props.getInteger(ClusterProperty.QUERY_RESULT_SIZE_LIMIT);
        if (v === -1) return QueryResultSizeLimiter.DISABLED;
        if (v <= 0) {
            throw new Error(`${ClusterProperty.QUERY_RESULT_SIZE_LIMIT.name} has to be -1 (disabled) or a positive number!`);
        }
        if (v < QueryResultSizeLimiter.MINIMUM_MAX_RESULT_LIMIT) {
            return QueryResultSizeLimiter.MINIMUM_MAX_RESULT_LIMIT;
        }
        return v;
    }

    private _getMaxLocalPartitionsLimitForPreCheck(
        props: import('@zenystx/core/spi/properties/HeliosProperties').HeliosProperties,
    ): number {
        const v = props.getInteger(ClusterProperty.QUERY_MAX_LOCAL_PARTITION_LIMIT_FOR_PRE_CHECK);
        if (v === -1) return QueryResultSizeLimiter.DISABLED;
        if (v <= 0) {
            throw new Error(
                `${ClusterProperty.QUERY_MAX_LOCAL_PARTITION_LIMIT_FOR_PRE_CHECK.name} has to be -1 (disabled) or a positive number!`,
            );
        }
        return v;
    }
}
