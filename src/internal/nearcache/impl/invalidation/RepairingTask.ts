/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.invalidation.RepairingTask}.
 *
 * Runs on Near Cache side. One instance per data-structure type (IMap, ICache).
 *
 * Responsibilities:
 * - Scan RepairingHandlers for missed invalidations (controlled via MAX_TOLERATED_MISS_COUNT).
 * - Send periodic operations to cluster members to fetch latest partition sequences/UUIDs
 *   (controlled via RECONCILIATION_INTERVAL_SECONDS).
 */
import { HeliosProperty } from '@helios/spi/properties/HeliosProperty';
import type { HeliosProperties } from '@helios/spi/properties/HeliosProperties';
import type { InvalidationMetaDataFetcher } from '@helios/internal/nearcache/impl/invalidation/InvalidationMetaDataFetcher';
import type { TaskScheduler } from '@helios/internal/nearcache/impl/TaskScheduler';
import type { SerializationService } from '@helios/internal/serialization/SerializationService';
import type { MinimalPartitionService } from '@helios/internal/nearcache/impl/invalidation/MinimalPartitionService';
import type { NearCache } from '@helios/internal/nearcache/NearCache';
import { RepairingHandler } from '@helios/internal/nearcache/impl/invalidation/RepairingHandler';
import { StaleReadDetectorImpl } from '@helios/internal/nearcache/impl/invalidation/StaleReadDetectorImpl';
import { DefaultNearCache } from '@helios/internal/nearcache/impl/DefaultNearCache';

const NANOS_PER_SECOND = 1_000_000_000;
const RESCHEDULE_FAILED_INITIALIZATION_AFTER_MS = 500;

interface Logger {
    finest(msg: string | Error): void;
    isFinestEnabled(): boolean;
    warning?(msg: string): void;
}

export class RepairingTask {
    /** Maximum number of missed invalidation events before forcing cache eviction. */
    static readonly MAX_TOLERATED_MISS_COUNT = new HeliosProperty(
        'hazelcast.invalidation.max.tolerated.miss.count', 10,
    );
    /** Interval (seconds) between anti-entropy reconciliation runs. Zero disables. */
    static readonly RECONCILIATION_INTERVAL_SECONDS = new HeliosProperty(
        'hazelcast.invalidation.reconciliation.interval.seconds', 60,
    );
    /** Minimum allowed reconciliation interval (seconds). Used for validation. */
    static readonly MIN_RECONCILIATION_INTERVAL_SECONDS = new HeliosProperty(
        'hazelcast.invalidation.min.reconciliation.interval.seconds', 30,
    );

    readonly maxToleratedMissCount: number;
    readonly reconciliationIntervalNanos: number;

    private readonly _partitionCount: number;
    private readonly _localUuid: string;
    private readonly _logger: Logger;
    private readonly _scheduler: TaskScheduler;
    private readonly _invalidationMetaDataFetcher: InvalidationMetaDataFetcher;
    private readonly _serializationService: SerializationService;
    private readonly _partitionService: MinimalPartitionService;
    private _running = false;
    private readonly _handlers = new Map<string, RepairingHandler>();
    private _lastAntiEntropyRunMs = 0;

    constructor(
        properties: HeliosProperties,
        invalidationMetaDataFetcher: InvalidationMetaDataFetcher,
        scheduler: TaskScheduler,
        serializationService: SerializationService,
        partitionService: MinimalPartitionService,
        localUuid: string,
        logger: Logger,
    ) {
        this.reconciliationIntervalNanos = this._getReconciliationIntervalSeconds(properties) * NANOS_PER_SECOND;
        this.maxToleratedMissCount = this._getMaxToleratedMissCount(properties);
        this._invalidationMetaDataFetcher = invalidationMetaDataFetcher;
        this._scheduler = scheduler;
        this._serializationService = serializationService;
        this._partitionService = partitionService;
        this._partitionCount = partitionService.getPartitionCount();
        this._localUuid = localUuid;
        this._logger = logger;
    }

    private _getMaxToleratedMissCount(properties: HeliosProperties): number {
        const count = properties.getInteger(RepairingTask.MAX_TOLERATED_MISS_COUNT);
        if (count < 0) {
            throw new Error(
                `max-tolerated-miss-count cannot be < 0 but found ${count}`,
            );
        }
        return count;
    }

    private _getReconciliationIntervalSeconds(properties: HeliosProperties): number {
        const interval = properties.getInteger(RepairingTask.RECONCILIATION_INTERVAL_SECONDS);
        const minInterval = properties.getInteger(RepairingTask.MIN_RECONCILIATION_INTERVAL_SECONDS);
        if (interval < 0 || (interval > 0 && interval < minInterval)) {
            throw new Error(
                `Reconciliation interval can be at least ${RepairingTask.MIN_RECONCILIATION_INTERVAL_SECONDS.defaultValue} ` +
                `seconds if it is not zero, but ${interval} was configured. ` +
                `Note: Configuring a value of zero seconds disables the reconciliation task.`,
            );
        }
        return interval;
    }

    run(): void {
        try {
            this._fixSequenceGaps();
            if (this._isAntiEntropyNeeded()) {
                this._runAntiEntropy();
            }
        } finally {
            if (this._running) {
                this._scheduleNextRun();
            }
        }
    }

    private _fixSequenceGaps(): void {
        for (const handler of this._handlers.values()) {
            if (this._isAboveMaxToleratedMissCount(handler)) {
                this._updateLastKnownStaleSequences(handler);
            }
        }
    }

    private _runAntiEntropy(): void {
        this._invalidationMetaDataFetcher.fetchMetadata(this._handlers);
        this._lastAntiEntropyRunMs = Date.now();
    }

    private _isAntiEntropyNeeded(): boolean {
        if (this.reconciliationIntervalNanos === 0) return false;
        const sinceLastRunNs = (Date.now() - this._lastAntiEntropyRunMs) * 1_000_000;
        return sinceLastRunNs >= this.reconciliationIntervalNanos;
    }

    private _scheduleNextRun(): void {
        this._scheduler.schedule(() => this.run(), 1);
    }

    private _isAboveMaxToleratedMissCount(handler: RepairingHandler): boolean {
        let totalMissCount = 0;
        for (let partitionId = 0; partitionId < this._partitionCount; partitionId++) {
            const metaData = handler.getMetaDataContainer(partitionId);
            totalMissCount += metaData.getMissedSequenceCount();
            if (totalMissCount > this.maxToleratedMissCount) {
                if (this._logger.isFinestEnabled()) {
                    this._logger.finest(
                        `Above tolerated miss count: [map=${handler.getName()}, missCount=${totalMissCount}, ` +
                        `maxToleratedMissCount=${this.maxToleratedMissCount}]`,
                    );
                }
                return true;
            }
        }
        return false;
    }

    private _updateLastKnownStaleSequences(handler: RepairingHandler): void {
        for (let partition = 0; partition < this._partitionCount; partition++) {
            const metaData = handler.getMetaDataContainer(partition);
            const missCount = metaData.getMissedSequenceCount();
            if (missCount !== 0) {
                metaData.addAndGetMissedSequenceCount(-missCount);
                handler.updateLastKnownStaleSequence(metaData, partition);
            }
        }
    }

    /**
     * Registers a NearCache under the given name and returns a RepairingHandler for it.
     * If a handler already exists for this name, returns the existing one.
     * Starts the background repairing task if not already running.
     *
     * Port of {@code RepairingTask.registerAndGetHandler}.
     */
    registerAndGetHandler<K, V>(dataStructureName: string, nearCache: NearCache<K, V>): RepairingHandler {
        let handler = this._handlers.get(dataStructureName);
        if (handler === undefined) {
            handler = new RepairingHandler(
                this._logger,
                this._localUuid,
                dataStructureName,
                nearCache as NearCache<unknown, unknown>,
                this._serializationService,
                this._partitionService,
            );

            // Wire a StaleReadDetector onto the DefaultNearCache record store if possible
            try {
                const defaultNc = (nearCache as NearCache<unknown, unknown>).unwrap(DefaultNearCache as never);
                const staleReadDetector = new StaleReadDetectorImpl(handler, this._partitionService);
                (defaultNc as DefaultNearCache<unknown, unknown>).getNearCacheRecordStore()
                    .setStaleReadDetector(staleReadDetector);
            } catch {
                // not a DefaultNearCache — skip stale-read wiring
            }

            // Attempt initial metadata population (may be a no-op in single-node mode)
            this._invalidationMetaDataFetcher.init(handler);

            this._handlers.set(dataStructureName, handler);
        }

        if (!this._running) {
            this._running = true;
            this._lastAntiEntropyRunMs = Date.now();
            this._scheduleNextRun();
        }

        return handler;
    }

    /**
     * Removes the RepairingHandler for the given data structure name.
     *
     * Port of {@code RepairingTask.deregisterHandler}.
     */
    deregisterHandler(dataStructureName: string): void {
        this._handlers.delete(dataStructureName);
    }

    /** Used in tests. */
    getInvalidationMetaDataFetcher(): InvalidationMetaDataFetcher {
        return this._invalidationMetaDataFetcher;
    }

    /** Used in tests. */
    getHandlers(): Map<string, RepairingHandler> {
        return this._handlers;
    }

    toString(): string {
        return 'RepairingTask{}';
    }
}
