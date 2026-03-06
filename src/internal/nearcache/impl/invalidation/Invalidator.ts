/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.invalidation.Invalidator}.
 *
 * Abstract base class for Near Cache invalidation. Contains shared functionality
 * for invalidating Near Cache entries by key or clearing all entries.
 */
import { MetaDataGenerator } from '@zenystx/core/internal/nearcache/impl/invalidation/MetaDataGenerator';
import { SingleNearCacheInvalidation } from '@zenystx/core/internal/nearcache/impl/invalidation/SingleNearCacheInvalidation';
import type { Invalidation } from '@zenystx/core/internal/nearcache/impl/invalidation/Invalidation';
import type { Data } from '@zenystx/core/internal/serialization/Data';

export interface EventRegistration {
    getId(): string;
}

export interface EventService {
    getRegistrations(serviceName: string, dataStructureName: string): EventRegistration[];
    publishEvent(serviceName: string, registration: EventRegistration, event: unknown, orderKey: number): void;
}

export interface PartitionServiceLike {
    getPartitionCount(): number;
    getPartitionId(key: unknown): number;
}

export interface LoggerLike {
    finest(msg: string): void;
    isFinestEnabled(): boolean;
}

export interface InvalidatorNodeEngine {
    getLogger(cls: unknown): LoggerLike;
    getPartitionService(): PartitionServiceLike;
    getEventService(): EventService;
}

export type EventFilter = (registration: EventRegistration) => boolean;

export abstract class Invalidator {
    protected readonly partitionCount: number;
    protected readonly serviceName: string;
    protected readonly logger: LoggerLike;
    protected readonly nodeEngine: InvalidatorNodeEngine;
    protected readonly eventService: EventService;
    protected readonly metaDataGenerator: MetaDataGenerator;
    protected readonly partitionService: PartitionServiceLike;
    protected readonly eventFilter: EventFilter;

    constructor(serviceName: string, eventFilter: EventFilter, nodeEngine: InvalidatorNodeEngine) {
        this.serviceName = serviceName;
        this.eventFilter = eventFilter;
        this.nodeEngine = nodeEngine;
        this.logger = nodeEngine.getLogger(this.constructor);
        this.partitionService = nodeEngine.getPartitionService();
        this.eventService = nodeEngine.getEventService();
        this.partitionCount = nodeEngine.getPartitionService().getPartitionCount();
        this.metaDataGenerator = new MetaDataGenerator(this.partitionCount);
    }

    protected abstract invalidateInternal(invalidation: Invalidation, orderKey: number): void;

    /** Invalidates a single key from Near Caches of the specified data structure. */
    invalidateKey(key: Data, dataStructureName: string, sourceUuid: string): void {
        if (key == null) throw new Error('key cannot be null');
        if (sourceUuid == null) throw new Error('sourceUuid cannot be null');

        const invalidation = this._newKeyInvalidation(key, dataStructureName, sourceUuid);
        this.invalidateInternal(invalidation, this.partitionService.getPartitionId(key));
    }

    /** Invalidates all keys from Near Caches of the specified data structure. */
    invalidateAllKeys(dataStructureName: string, sourceUuid: string): void {
        if (dataStructureName == null) throw new Error('dataStructureName cannot be null');
        if (sourceUuid == null) throw new Error('sourceUuid cannot be null');

        const orderKey = this.partitionService.getPartitionId(dataStructureName);
        const invalidation = this._newClearInvalidation(dataStructureName, sourceUuid);
        this.sendImmediately(invalidation, orderKey);
    }

    getMetaDataGenerator(): MetaDataGenerator {
        return this.metaDataGenerator;
    }

    forceIncrementSequence(dataStructureName: string, partitionId: number): void {
        this.metaDataGenerator.nextSequence(dataStructureName, partitionId);
    }

    protected newInvalidation(
        key: Data | null,
        dataStructureName: string,
        sourceUuid: string | null,
        partitionId: number,
    ): SingleNearCacheInvalidation {
        const sequence = this.metaDataGenerator.nextSequence(dataStructureName, partitionId);
        const partitionUuid = this.metaDataGenerator.getOrCreateUuid(partitionId);
        return new SingleNearCacheInvalidation(key, dataStructureName, sourceUuid, partitionUuid, sequence);
    }

    protected sendImmediately(invalidation: Invalidation, orderKey: number): void {
        const dataStructureName = invalidation.getName();
        const registrations = this.eventService.getRegistrations(this.serviceName, dataStructureName);
        for (const registration of registrations) {
            if (this.eventFilter(registration)) {
                this.eventService.publishEvent(this.serviceName, registration, invalidation, orderKey);
            }
        }
    }

    /** Removes data structure metadata and flushes pending invalidations. */
    destroy(dataStructureName: string, sourceUuid: string): void {
        this.invalidateAllKeys(dataStructureName, sourceUuid);
        this.metaDataGenerator.destroyMetaDataFor(dataStructureName);
    }

    reset(): void {
        // nop
    }

    shutdown(): void {
        // nop
    }

    private _newKeyInvalidation(key: Data, dataStructureName: string, sourceUuid: string): SingleNearCacheInvalidation {
        const partitionId = this.partitionService.getPartitionId(key);
        return this.newInvalidation(key, dataStructureName, sourceUuid, partitionId);
    }

    private _newClearInvalidation(dataStructureName: string, sourceUuid: string): SingleNearCacheInvalidation {
        const partitionId = this.partitionService.getPartitionId(dataStructureName);
        return this.newInvalidation(null, dataStructureName, sourceUuid, partitionId);
    }
}
