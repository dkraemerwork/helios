/**
 * Port of {@code com.hazelcast.map.impl.nearcache.MapNearCacheManager}.
 *
 * Server-side Near Cache manager for IMap. Extends DefaultNearCacheManager
 * with invalidation and repair support.
 *
 * Responsibilities:
 * - Create/destroy NearCache instances per map name
 * - Create the correct Invalidator (batch or non-stop) based on cluster properties
 * - Create a RepairingTask backed by MemberMapInvalidationMetaDataFetcher
 * - Propagate lifecycle events (reset/shutdown) to invalidator and repairing task
 */
import { DefaultNearCacheManager } from '@helios/internal/nearcache/impl/DefaultNearCacheManager';
import { NonStopInvalidator } from '@helios/internal/nearcache/impl/invalidation/NonStopInvalidator';
import { BatchInvalidator } from '@helios/internal/nearcache/impl/invalidation/BatchInvalidator';
import { RepairingTask } from '@helios/internal/nearcache/impl/invalidation/RepairingTask';
import { MemberMinimalPartitionService } from '@helios/map/impl/nearcache/MemberMinimalPartitionService';
import { MemberMapInvalidationMetaDataFetcher } from '@helios/map/impl/nearcache/invalidation/MemberMapInvalidationMetaDataFetcher';
import type { Invalidator } from '@helios/internal/nearcache/impl/invalidation/Invalidator';
import type { EventService, EventRegistration, EventFilter, LoggerLike } from '@helios/internal/nearcache/impl/invalidation/Invalidator';
import type { BatchInvalidatorNodeEngine } from '@helios/internal/nearcache/impl/invalidation/BatchInvalidator';
import type { SerializationService } from '@helios/internal/serialization/SerializationService';
import type { HeliosProperties } from '@helios/spi/properties/HeliosProperties';
import type { TaskScheduler } from '@helios/internal/nearcache/impl/TaskScheduler';
import type { NearCache } from '@helios/internal/nearcache/NearCache';
import type { RepairingHandler } from '@helios/internal/nearcache/impl/invalidation/RepairingHandler';
import { NoOpTaskScheduler } from '@helios/internal/nearcache/impl/TaskScheduler';
import { MapHeliosProperties } from '@helios/spi/properties/HeliosProperties';

/** Cluster property keys for batch invalidation configuration */
const BATCH_ENABLED_KEY = 'hazelcast.map.invalidation.batch.enabled';
const BATCH_SIZE_KEY = 'hazelcast.map.invalidation.batch.size';
const BATCH_FREQUENCY_KEY = 'hazelcast.map.invalidation.batch.frequency.seconds';

/** Map service name (matches Java MapService.SERVICE_NAME) */
export const MAP_SERVICE_NAME = 'hz:impl:mapService';

/**
 * The node engine interface required by MapNearCacheManager.
 * Adapts the minimal NodeEngine + execution services needed for invalidation.
 */
export interface MapNearCacheNodeEngine {
    getLogger(cls: unknown): LoggerLike;
    getPartitionService(): {
        getPartitionCount(): number;
        getPartitionId(key: unknown): number;
    };
    getSerializationService(): SerializationService;
    getProperties(): HeliosProperties;
    getEventService(): EventService;
    getLocalMemberUuid(): string;
    getTaskScheduler(): TaskScheduler;
}

/** Filters event registrations to only pass invalidation-related listeners. */
const INVALIDATION_ACCEPTOR: EventFilter = (_registration: EventRegistration) => {
    // In single-node mode there are no real registrations — always accept (no-op gate).
    return true;
};

export class MapNearCacheManager extends DefaultNearCacheManager {

    readonly partitionCount: number;
    readonly invalidator: Invalidator;
    readonly repairingTask: RepairingTask;

    private readonly _nodeEngine: MapNearCacheNodeEngine;

    constructor(nodeEngine: MapNearCacheNodeEngine) {
        const scheduler = nodeEngine.getTaskScheduler();
        super(
            nodeEngine.getSerializationService(),
            scheduler,
            null,
            nodeEngine.getProperties(),
        );
        this._nodeEngine = nodeEngine;

        const partitionService = new MemberMinimalPartitionService(nodeEngine.getPartitionService());
        this.partitionCount = partitionService.getPartitionCount();

        this.invalidator = this._createInvalidator();
        this.repairingTask = this._createRepairingTask(partitionService);
    }

    private _createInvalidator(): Invalidator {
        const properties = this._nodeEngine.getProperties();
        const batchEnabled = properties.getString({ name: BATCH_ENABLED_KEY, defaultValue: 'false' }) === 'true';
        const batchSize = properties.getInteger({ name: BATCH_SIZE_KEY, defaultValue: '100' });

        if (batchEnabled && batchSize > 1) {
            const batchFrequency = properties.getInteger({ name: BATCH_FREQUENCY_KEY, defaultValue: '10' });
            const batchNodeEngine: BatchInvalidatorNodeEngine = {
                getLogger: (cls) => this._nodeEngine.getLogger(cls),
                getPartitionService: () => this._nodeEngine.getPartitionService(),
                getEventService: () => this._nodeEngine.getEventService(),
                getExecutionService: () => ({
                    scheduleWithRepetition: (_name: string, _task: () => void, _i: number, _p: number) => {},
                    shutdownExecutor: (_name: string) => {},
                }),
                getHeliosInstance: () => ({
                    getLifecycleService: () => ({
                        addLifecycleListener: (_fn: (event: { state: string }) => void) => 'noop-id',
                        removeLifecycleListener: (_id: string) => {},
                    }),
                }),
            };
            return new BatchInvalidator(MAP_SERVICE_NAME, batchSize, batchFrequency, INVALIDATION_ACCEPTOR, batchNodeEngine);
        }

        return new NonStopInvalidator(MAP_SERVICE_NAME, INVALIDATION_ACCEPTOR, {
            getLogger: (cls) => this._nodeEngine.getLogger(cls),
            getPartitionService: () => this._nodeEngine.getPartitionService(),
            getEventService: () => this._nodeEngine.getEventService(),
        });
    }

    private _createRepairingTask(partitionService: MemberMinimalPartitionService): RepairingTask {
        const logger = this._nodeEngine.getLogger(RepairingTask);
        const fetcher = new MemberMapInvalidationMetaDataFetcher();
        const localUuid = this._nodeEngine.getLocalMemberUuid();
        const scheduler = this._nodeEngine.getTaskScheduler();
        return new RepairingTask(
            this._nodeEngine.getProperties(),
            fetcher,
            scheduler,
            this._nodeEngine.getSerializationService(),
            partitionService,
            localUuid,
            logger,
        );
    }

    getInvalidator(): Invalidator {
        return this.invalidator;
    }

    getRepairingTask(): RepairingTask {
        return this.repairingTask;
    }

    /**
     * Creates and registers a RepairingHandler for the given near cache.
     *
     * Port of {@code MapNearCacheManager.newRepairingHandler}.
     */
    newRepairingHandler<K, V>(name: string, nearCache: NearCache<K, V>): RepairingHandler {
        return this.repairingTask.registerAndGetHandler(name, nearCache);
    }

    /**
     * Removes the RepairingHandler for the given map name.
     *
     * Port of {@code MapNearCacheManager.deregisterRepairingHandler}.
     */
    deregisterRepairingHandler(name: string): void {
        this.repairingTask.deregisterHandler(name);
    }

    /**
     * Clears all near caches and resets the invalidator.
     *
     * Port of {@code MapNearCacheManager.reset}.
     */
    reset(): void {
        this.clearAllNearCaches();
        this.invalidator.reset();
    }

    /**
     * Destroys all near caches and shuts down the invalidator.
     *
     * Port of {@code MapNearCacheManager.shutdown}.
     */
    shutdown(): void {
        this.destroyAllNearCaches();
        this.invalidator.shutdown();
    }

    /**
     * Destroys the near cache for the given map name and sends a clear invalidation.
     *
     * Port of {@code MapNearCacheManager.destroyNearCache}.
     */
    override destroyNearCache(mapName: string): boolean {
        const localUuid = this._nodeEngine.getLocalMemberUuid();
        this.invalidator.destroy(mapName, localUuid);
        return super.destroyNearCache(mapName);
    }
}
