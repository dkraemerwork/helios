/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.store.AbstractNearCacheRecordStore}.
 *
 * Abstract implementation of NearCacheRecordStore.
 */
import type { NearCacheRecordStore } from '@helios/internal/nearcache/NearCacheRecordStore';
import type { NearCacheRecord } from '@helios/internal/nearcache/NearCacheRecord';
import type { Data } from '@helios/internal/serialization/Data';
import type { SerializationService } from '@helios/internal/serialization/SerializationService';
import type { NearCacheStats } from '@helios/nearcache/NearCacheStats';
import type { UpdateSemantic } from '@helios/internal/nearcache/NearCache';
import type { EvictionChecker } from '@helios/internal/nearcache/impl/maxsize/EntryCountNearCacheEvictionChecker';
import type { NearCacheConfig } from '@helios/config/NearCacheConfig';
import type { EvictionListener } from '@helios/internal/nearcache/impl/store/HeapNearCacheRecordMap';
import type { StaleReadDetector } from '@helios/internal/nearcache/impl/invalidation/StaleReadDetector';
import { NearCacheStatsImpl } from '@helios/internal/monitor/impl/NearCacheStatsImpl';
import { EvictionPolicy } from '@helios/config/EvictionPolicy';
import { CACHED_AS_NULL } from '@helios/internal/nearcache/NearCache';
import { NOT_RESERVED, READ_PERMITTED } from '@helios/internal/nearcache/NearCacheRecord';
import { ALWAYS_FRESH } from '@helios/internal/nearcache/impl/invalidation/StaleReadDetector';

const MILLI_SECONDS_IN_A_SECOND = 1000;

export abstract class AbstractNearCacheRecordStore<K, V, R extends NearCacheRecord>
    implements NearCacheRecordStore<K, V>, EvictionListener<K, R> {

    protected readonly timeToLiveMillis: number;
    protected readonly maxIdleMillis: number;
    protected readonly evictionDisabled: boolean;
    protected readonly inMemoryFormat: string;
    protected readonly nearCacheConfig: NearCacheConfig;
    protected readonly nearCacheStats: NearCacheStatsImpl;
    protected readonly serializationService: SerializationService;

    protected evictionChecker: EvictionChecker | null = null;
    protected _reservationId = 0;
    protected staleReadDetector: StaleReadDetector = ALWAYS_FRESH;

    constructor(nearCacheConfig: NearCacheConfig, serializationService: SerializationService) {
        this.nearCacheConfig = nearCacheConfig;
        this.inMemoryFormat = nearCacheConfig.getInMemoryFormat();
        this.timeToLiveMillis = nearCacheConfig.getTimeToLiveSeconds() * MILLI_SECONDS_IN_A_SECOND;
        this.maxIdleMillis = nearCacheConfig.getMaxIdleSeconds() * MILLI_SECONDS_IN_A_SECOND;
        this.serializationService = serializationService;
        this.nearCacheStats = new NearCacheStatsImpl();
        this.evictionDisabled = nearCacheConfig.getEvictionConfig().getEvictionPolicy() === EvictionPolicy.NONE;
    }

    abstract initialize(): void;
    abstract getRecord(key: K): R | null;
    abstract size(): number;
    abstract clear(): void;
    abstract destroy(): void;
    abstract doExpiration(): void;
    abstract doEviction(withoutMaxSizeCheck: boolean): boolean;
    abstract invalidate(key: K): void;
    abstract tryReserveForUpdate(key: K, keyData: Data | null, updateSemantic?: UpdateSemantic): number;
    abstract tryPublishReserved(key: K, value: V | null, reservationId: number, deserialize?: boolean): V | null;

    protected abstract createRecord(value: V | null): R;
    protected abstract updateRecordValue(record: R, value: V | null): void;
    protected abstract getKeyStorageMemoryCost(key: K): number;
    protected abstract getRecordStorageMemoryCost(record: R): number;

    setStaleReadDetector(detector: StaleReadDetector): void {
        this.staleReadDetector = detector;
    }

    get(key: K): V | null {
        const record = this.getRecord(key);
        if (record === null) {
            this.nearCacheStats.incrementMisses();
            return null;
        }

        const value = record.getValue() as unknown;
        const recordState = record.getReservationId();

        if (recordState !== READ_PERMITTED && !record.isCachedAsNull() && value === null) {
            this.nearCacheStats.incrementMisses();
            return null;
        }

        if (this.staleReadDetector.isStaleRead(key, record)) {
            this.invalidate(key);
            this.nearCacheStats.incrementMisses();
            return null;
        }

        if (this.isRecordExpired(record)) {
            this.invalidate(key);
            this.onExpire(key, record);
            return null;
        }

        this.onRecordAccess(record);
        this.nearCacheStats.incrementHits();
        return this.recordToValue(record);
    }

    protected recordToValue(record: R): V | null {
        return record.getValue() === null
            ? (CACHED_AS_NULL as unknown as V)
            : (this.toValue(record.getValue()) as V);
    }

    put(key: K, keyData: Data | null, value: V | null, valueData: Data | null): void {
        const reservationId = this.tryReserveForUpdate(key, keyData, 'READ_UPDATE');
        if (reservationId !== NOT_RESERVED) {
            this.tryPublishReserved(key, value, reservationId, false);
        }
    }

    getNearCacheStats(): NearCacheStats {
        return this.nearCacheStats;
    }

    protected isRecordExpired(record: R): boolean {
        if (!this.canUpdateStats(record)) return false;
        const now = Date.now();
        return record.isExpiredAt(now) || record.isIdleAt(this.maxIdleMillis, now);
    }

    protected canUpdateStats(record: R | null): boolean {
        return record !== null && record.getReservationId() === READ_PERMITTED;
    }

    protected onExpire(key: K, record: R): void {
        if (!this.canUpdateStats(record)) return;
        this.nearCacheStats.incrementExpirations();
    }

    onEvict(key: K, record: R, wasExpired: boolean): void {
        if (!this.canUpdateStats(record)) return;
        if (wasExpired) {
            this.nearCacheStats.incrementExpirations();
        } else {
            this.nearCacheStats.incrementEvictions();
        }
        this.nearCacheStats.decrementOwnedEntryCount();
    }

    protected onRecordAccess(record: R): void {
        record.setLastAccessTime(Date.now());
        record.incrementHits();
    }

    protected nextReservationId(): number {
        return ++this._reservationId;
    }

    protected toData(obj: unknown): Data | null {
        return this.serializationService.toData(obj);
    }

    protected toValue(obj: unknown): unknown {
        if (obj === null || obj === undefined) return null;
        // If it's Data (has toByteArray), deserialize it
        if (typeof (obj as Record<string, unknown>)['toByteArray'] === 'function') {
            return this.serializationService.toObject(obj as Data);
        }
        return obj;
    }

    protected getTotalStorageMemoryCost(key: K, record: R): number {
        return this.getKeyStorageMemoryCost(key) + this.getRecordStorageMemoryCost(record);
    }

    protected publishReservedRecord(key: K, value: V | null, reservedRecord: R, reservationId: number): R {
        if (reservedRecord.getReservationId() !== reservationId) {
            return reservedRecord;
        }

        const isUpdate = reservedRecord.getValue() !== null || reservedRecord.isCachedAsNull();
        if (isUpdate) {
            this.nearCacheStats.incrementOwnedEntryMemoryCost(-this.getTotalStorageMemoryCost(key, reservedRecord));
        }

        this.updateRecordValue(reservedRecord, value);
        if (value === null) {
            reservedRecord.setCachedAsNull(true);
        }
        reservedRecord.setReservationId(READ_PERMITTED);

        this.nearCacheStats.incrementOwnedEntryMemoryCost(this.getTotalStorageMemoryCost(key, reservedRecord));
        if (!isUpdate) {
            this.nearCacheStats.incrementOwnedEntryCount();
        }

        return reservedRecord;
    }

    protected initInvalidationMetaData(record: R, key: K, keyData: Data | null): void {
        if (this.staleReadDetector === ALWAYS_FRESH) return;
        const dataKey = keyData ?? this.toData(key);
        const partitionId = this.staleReadDetector.getPartitionId(dataKey);
        const container = this.staleReadDetector.getMetaDataContainer(partitionId);
        record.setPartitionId(partitionId);
        record.setInvalidationSequence(container?.getSequence() ?? 0);
        record.setUuid(container?.getUuid() ?? null);
    }

    loadKeys(_adapter: unknown): void { /* no-op unless preloader configured */ }
    storeKeys(): void { /* no-op unless preloader configured */ }
}
