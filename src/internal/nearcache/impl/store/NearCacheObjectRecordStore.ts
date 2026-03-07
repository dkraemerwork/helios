/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.store.NearCacheObjectRecordStore}.
 *
 * NearCacheRecordStore for OBJECT in-memory-format.
 * Memory cost is always 0 (objects are not measured in heap-cost terms).
 */
import type { NearCacheConfig } from '@zenystx/helios-core/config/NearCacheConfig';
import { NearCacheObjectRecord } from '@zenystx/helios-core/internal/nearcache/impl/record/NearCacheObjectRecord';
import { BaseHeapNearCacheRecordStore } from '@zenystx/helios-core/internal/nearcache/impl/store/BaseHeapNearCacheRecordStore';
import { TIME_NOT_SET } from '@zenystx/helios-core/internal/nearcache/NearCacheRecord';
import type { SerializationService } from '@zenystx/helios-core/internal/serialization/SerializationService';
import type { HeliosProperties } from '@zenystx/helios-core/spi/properties/HeliosProperties';

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
