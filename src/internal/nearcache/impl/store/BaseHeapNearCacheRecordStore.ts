/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.store.BaseHeapNearCacheRecordStore}.
 *
 * Base implementation for on-heap Near Cache record stores.
 * Handles reservation/publication, eviction, expiration, and invalidation.
 */
import type { NearCacheRecord } from '@zenystx/helios-core/internal/nearcache/NearCacheRecord';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { SerializationService } from '@zenystx/helios-core/internal/serialization/SerializationService';
import type { NearCacheConfig } from '@zenystx/helios-core/config/NearCacheConfig';
import type { UpdateSemantic } from '@zenystx/helios-core/internal/nearcache/NearCache';
import type { EvictionChecker } from '@zenystx/helios-core/internal/nearcache/impl/maxsize/EntryCountNearCacheEvictionChecker';
import { AbstractNearCacheRecordStore } from '@zenystx/helios-core/internal/nearcache/impl/store/AbstractNearCacheRecordStore';
import { HeapNearCacheRecordMap } from '@zenystx/helios-core/internal/nearcache/impl/store/HeapNearCacheRecordMap';
import { EntryCountNearCacheEvictionChecker } from '@zenystx/helios-core/internal/nearcache/impl/maxsize/EntryCountNearCacheEvictionChecker';
import { MaxSizePolicy } from '@zenystx/helios-core/config/MaxSizePolicy';
import { EvictionPolicy } from '@zenystx/helios-core/config/EvictionPolicy';
import { NOT_RESERVED, READ_PERMITTED } from '@zenystx/helios-core/internal/nearcache/NearCacheRecord';
import { HeliosProperties, MapHeliosProperties } from '@zenystx/helios-core/spi/properties/HeliosProperties';

const SAMPLE_COUNT = 15;

export abstract class BaseHeapNearCacheRecordStore<K, V, R extends NearCacheRecord>
    extends AbstractNearCacheRecordStore<K, V, R> {

    protected records: HeapNearCacheRecordMap<K, R>;

    constructor(
        _name: string,
        nearCacheConfig: NearCacheConfig,
        serializationService: SerializationService,
        _properties: HeliosProperties = new MapHeliosProperties(),
    ) {
        super(nearCacheConfig, serializationService);
        this.records = new HeapNearCacheRecordMap<K, R>();
    }

    initialize(): void {
        const evictionConfig = this.nearCacheConfig.getEvictionConfig();
        const maxSizePolicy = evictionConfig.getMaxSizePolicy();

        if (maxSizePolicy !== MaxSizePolicy.ENTRY_COUNT) {
            throw new Error(
                `Invalid max-size policy (${maxSizePolicy}) for ${this.constructor.name}! Only ENTRY_COUNT is supported.`
            );
        }

        this.evictionChecker = new EntryCountNearCacheEvictionChecker(evictionConfig.getSize(), this.records);
    }

    size(): number { return this.records.size(); }

    getRecord(key: K): R | null {
        return this.records.get(key) ?? null;
    }

    clear(): void {
        const sz = this.records.size();
        this.records.clear();
        this.nearCacheStats.setOwnedEntryCount(0);
        this.nearCacheStats.setOwnedEntryMemoryCost(0);
        this.nearCacheStats.incrementInvalidations(sz);
        this.nearCacheStats.incrementInvalidationRequests();
    }

    destroy(): void {
        this.clear();
    }

    invalidate(key: K): void {
        this.records.applyIfPresent(key, (k, record) => {
            if (this.canUpdateStats(record)) {
                this.nearCacheStats.decrementOwnedEntryCount();
                this.nearCacheStats.decrementOwnedEntryMemoryCost(this.getTotalStorageMemoryCost(k, record));
                this.nearCacheStats.incrementInvalidations();
            }
            return null; // delete the record
        });
        this.nearCacheStats.incrementInvalidationRequests();
    }

    doExpiration(): void {
        for (const [key, record] of this.records.entries()) {
            if (this.isRecordExpired(record)) {
                this.invalidate(key);
                this.onExpire(key, record);
            }
        }
    }

    doEviction(withoutMaxSizeCheck: boolean): boolean {
        if (this.evictionDisabled) return false;

        const checker: EvictionChecker | null = withoutMaxSizeCheck ? null : this.evictionChecker;
        if (checker !== null && !checker.isEvictionRequired()) return false;

        this.evictOne();
        return true;
    }

    private evictOne(): void {
        const policy = this.nearCacheConfig.getEvictionConfig().getEvictionPolicy();
        const samples = this.records.sample(SAMPLE_COUNT)
            .filter(([, r]) => r.getReservationId() === READ_PERMITTED);

        if (samples.length === 0) return;

        let victim: [K, R];
        switch (policy) {
            case EvictionPolicy.LRU:
                victim = samples.reduce((a, b) =>
                    a[1].getLastAccessTime() <= b[1].getLastAccessTime() ? a : b);
                break;
            case EvictionPolicy.LFU:
                victim = samples.reduce((a, b) => a[1].getHits() <= b[1].getHits() ? a : b);
                break;
            case EvictionPolicy.RANDOM:
            default:
                victim = samples[0];
                break;
        }

        const [key, record] = victim;
        this.records.delete(key);
        this.nearCacheStats.decrementOwnedEntryMemoryCost(this.getTotalStorageMemoryCost(key, record));
        this.onEvict(key, record, false);
    }

    tryReserveForUpdate(key: K, keyData: Data | null, updateSemantic: UpdateSemantic = 'READ_UPDATE'): number {
        // If eviction is disabled and the cache is full, refuse new keys
        if (this.evictionDisabled && this.evictionChecker!.isEvictionRequired() && !this.records.has(key)) {
            return NOT_RESERVED;
        }

        const reservationId = this.nextReservationId();

        let reservedRecord: R | null = null;
        if (updateSemantic === 'WRITE_UPDATE') {
            reservedRecord = this.records.apply(key, (k, existing) => {
                return this.reserveForWriteUpdate(k, keyData, existing, reservationId);
            });
        } else {
            reservedRecord = this.records.applyIfAbsent(key, (k) => {
                return this.newReservationRecord(k, keyData, reservationId);
            }) ?? null;
        }

        if (reservedRecord === null || reservedRecord.getReservationId() !== reservationId) {
            return NOT_RESERVED;
        }

        return reservationId;
    }

    tryPublishReserved(key: K, value: V | null, reservationId: number, deserialize = true): V | null {
        const existingRecord = this.records.applyIfPresent(key, (k, reservedRecord) =>
            this.publishReservedRecord(k, value, reservedRecord, reservationId));

        if (existingRecord === null || !deserialize) return null;

        const cachedValue = existingRecord.getValue();
        return this.toValue(cachedValue) as V | null;
    }

    protected reserveForWriteUpdate(key: K, keyData: Data | null, existing: R | undefined, reservationId: number): R | null {
        if (existing === undefined) {
            return this.newReservationRecord(key, keyData, reservationId);
        }
        if (existing.getReservationId() === READ_PERMITTED) {
            existing.setReservationId(reservationId);
            return existing;
        }
        // Previously reserved — delete it (CACHE_ON_UPDATE semantics)
        return null;
    }

    protected newReservationRecord(key: K, keyData: Data | null, reservationId: number): R {
        const record = this.createRecord(null);
        record.setReservationId(reservationId);
        this.initInvalidationMetaData(record, key, keyData);
        return record;
    }

    protected putRecord(key: K, record: R): R | undefined {
        const oldRecord = this.records.get(key);
        this.records.set(key, record);
        this.nearCacheStats.incrementOwnedEntryMemoryCost(this.getTotalStorageMemoryCost(key, record));
        if (oldRecord !== undefined) {
            this.nearCacheStats.decrementOwnedEntryMemoryCost(this.getTotalStorageMemoryCost(key, oldRecord));
        }
        return oldRecord;
    }
}
