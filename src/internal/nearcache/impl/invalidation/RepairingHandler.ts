/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.invalidation.RepairingHandler}.
 *
 * Handler used on Near Cache side. Observes local and remote invalidations and registers
 * relevant data to MetaDataContainers. Used to repair Near Cache in the event of missed
 * invalidation events or partition UUID changes.
 */
import { MetaDataContainer } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/MetaDataContainer';
import type { MinimalPartitionService } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/MinimalPartitionService';
import type { NearCache } from '@zenystx/helios-core/internal/nearcache/NearCache';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { SerializationService } from '@zenystx/helios-core/internal/serialization/SerializationService';

interface Logger {
    finest(msg: string): void;
    isFinestEnabled(): boolean;
}

export class RepairingHandler {
    private readonly _partitionCount: number;
    private readonly _serializeKeys: boolean;
    private readonly _logger: Logger;
    private readonly _localUuid: string;
    private readonly _name: string;
    private readonly _nearCache: NearCache<unknown, unknown>;
    private readonly _serializationService: SerializationService;
    private readonly _partitionService: MinimalPartitionService;
    private readonly _metaDataContainers: MetaDataContainer[];

    constructor(
        logger: Logger,
        localUuid: string,
        name: string,
        nearCache: NearCache<unknown, unknown>,
        serializationService: SerializationService,
        partitionService: MinimalPartitionService,
    ) {
        this._logger = logger;
        this._localUuid = localUuid;
        this._name = name;
        this._nearCache = nearCache;
        this._serializeKeys = nearCache.isSerializeKeys();
        this._serializationService = serializationService;
        this._partitionService = partitionService;
        this._partitionCount = partitionService.getPartitionCount();
        this._metaDataContainers = Array.from({ length: this._partitionCount }, () => new MetaDataContainer());
    }

    getMetaDataContainer(partition: number): MetaDataContainer {
        return this._metaDataContainers[partition]!;
    }

    getName(): string {
        return this._name;
    }

    /** Handles a single invalidation. */
    handle(key: Data | null, sourceUuid: string | null, partitionUuid: string, sequence: number): void {
        if (sourceUuid !== this._localUuid) {
            if (key === null) {
                this._nearCache.clear();
            } else {
                const cacheKey = this._serializeKeys ? key : this._serializationService.toObject(key);
                this._nearCache.invalidate(cacheKey);
            }
        }

        const partitionId = this._getPartitionIdOrDefault(key);
        this.checkOrRepairUuid(partitionId, partitionUuid);
        this.checkOrRepairSequence(partitionId, sequence, false);
    }

    /** Handles batch invalidations. */
    handleBatch(
        keys: (Data | null)[],
        sourceUuids: (string | null)[],
        partitionUuids: string[],
        sequences: number[],
    ): void {
        const len = Math.min(keys.length, sourceUuids.length, partitionUuids.length, sequences.length);
        for (let i = 0; i < len; i++) {
            this.handle(keys[i]!, sourceUuids[i]!, partitionUuids[i]!, sequences[i]!);
        }
    }

    updateLastKnownStaleSequence(metaData: MetaDataContainer, _partition: number): void {
        while (true) {
            const lastReceivedSequence = metaData.getSequence();
            const lastKnownStaleSequence = metaData.getStaleSequence();
            if (lastKnownStaleSequence >= lastReceivedSequence) break;
            if (metaData.casStaleSequence(lastKnownStaleSequence, lastReceivedSequence)) {
                if (this._logger.isFinestEnabled()) {
                    this._logger.finest(
                        `Stale sequences updated: [map=${this._name}, partition=${_partition}, ` +
                        `lowerSequencesStaleThan=${metaData.getStaleSequence()}, lastReceivedSequence=${metaData.getSequence()}]`
                    );
                }
                break;
            }
        }
    }

    checkOrRepairUuid(partition: number, newUuid: string): void {
        const metaData = this.getMetaDataContainer(partition);
        while (true) {
            const prevUuid = metaData.getUuid();
            if (prevUuid !== null && prevUuid === newUuid) break;
            if (metaData.casUuid(prevUuid, newUuid)) {
                metaData.resetSequence();
                metaData.resetStaleSequence();
                if (this._logger.isFinestEnabled()) {
                    this._logger.finest(
                        `Invalid UUID, lost remote partition data: [name=${this._name}, partition=${partition}, ` +
                        `prevUuid=${prevUuid}, newUuid=${newUuid}]`
                    );
                }
                break;
            }
        }
    }

    checkOrRepairSequence(partition: number, nextSequence: number, viaAntiEntropy: boolean): void {
        const metaData = this.getMetaDataContainer(partition);
        while (true) {
            const currentSequence = metaData.getSequence();
            if (currentSequence >= nextSequence) break;
            if (metaData.casSequence(currentSequence, nextSequence)) {
                const sequenceDiff = nextSequence - currentSequence;
                if (viaAntiEntropy || sequenceDiff > 1) {
                    const missCount = viaAntiEntropy ? sequenceDiff : sequenceDiff - 1;
                    const totalMissCount = metaData.addAndGetMissedSequenceCount(missCount);
                    if (this._logger.isFinestEnabled()) {
                        this._logger.finest(
                            `Invalid sequence: [map=${this._name}, partition=${partition}, ` +
                            `currentSequence=${currentSequence}, nextSequence=${nextSequence}, totalMissCount=${totalMissCount}]`
                        );
                    }
                }
                break;
            }
        }
    }

    initUuid(partitionId: number, partitionUuid: string): void {
        this.getMetaDataContainer(partitionId).setUuid(partitionUuid);
    }

    initSequence(partitionId: number, partitionSequence: number): void {
        this.getMetaDataContainer(partitionId).setSequence(partitionSequence);
    }

    private _getPartitionIdOrDefault(key: Data | null): number {
        if (key === null) {
            return this._partitionService.getPartitionId(this._name);
        }
        return this._partitionService.getPartitionId(key);
    }

    toString(): string {
        return `RepairingHandler{name='${this._name}', localUuid='${this._localUuid}'}`;
    }
}
