/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.store.NearCacheObjectRecordStore}.
 *
 * NearCacheRecordStore for OBJECT in-memory-format.
 * Memory cost is always 0 (objects are not measured in heap-cost terms).
 */
import type { SerializationService } from '@zenystx/core/internal/serialization/SerializationService';
import type { NearCacheConfig } from '@zenystx/core/config/NearCacheConfig';
import type { HeliosProperties } from '@zenystx/core/spi/properties/HeliosProperties';
import { BaseHeapNearCacheRecordStore } from '@zenystx/core/internal/nearcache/impl/store/BaseHeapNearCacheRecordStore';
import { NearCacheObjectRecord } from '@zenystx/core/internal/nearcache/impl/record/NearCacheObjectRecord';
import { TIME_NOT_SET } from '@zenystx/core/internal/nearcache/NearCacheRecord';

export class NearCacheObjectRecordStore<K, V> extends BaseHeapNearCacheRecordStore<K, V, NearCacheObjectRecord<V>> {

    constructor(
        name: string,
        nearCacheConfig: NearCacheConfig,
        serializationService: SerializationService,
        _classLoader: unknown,
        properties: HeliosProperties,
    ) {
        super(name, nearCacheConfig, serializationService, properties);
    }

    protected getKeyStorageMemoryCost(_key: K): number {
        return 0; // OBJECT format does not track key memory cost
    }

    protected getRecordStorageMemoryCost(_record: NearCacheObjectRecord<V> | null): number {
        return 0; // OBJECT format does not track record memory cost
    }

    protected createRecord(value: V | null): NearCacheObjectRecord<V> {
        const objValue = this.toValue(value) as V | null;
        const creationTime = Date.now();
        const expiryTime = this.timeToLiveMillis > 0 ? creationTime + this.timeToLiveMillis : TIME_NOT_SET;
        return new NearCacheObjectRecord<V>(objValue, creationTime, expiryTime);
    }

    protected updateRecordValue(record: NearCacheObjectRecord<V>, value: V | null): void {
        record.setValue(this.toValue(value) as V | null);
    }
}
