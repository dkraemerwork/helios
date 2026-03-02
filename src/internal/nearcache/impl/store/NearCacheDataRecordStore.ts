/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.store.NearCacheDataRecordStore}.
 *
 * NearCacheRecordStore for BINARY in-memory-format.
 */
import type { Data } from '@helios/internal/serialization/Data';
import type { SerializationService } from '@helios/internal/serialization/SerializationService';
import type { NearCacheConfig } from '@helios/config/NearCacheConfig';
import type { HeliosProperties } from '@helios/spi/properties/HeliosProperties';
import { BaseHeapNearCacheRecordStore } from '@helios/internal/nearcache/impl/store/BaseHeapNearCacheRecordStore';
import { NearCacheDataRecord } from '@helios/internal/nearcache/impl/record/NearCacheDataRecord';
import {
    NUMBER_OF_LONG_FIELD_TYPES,
    NUMBER_OF_INTEGER_FIELD_TYPES,
    NUMBER_OF_BOOLEAN_FIELD_TYPES,
} from '@helios/internal/nearcache/impl/record/AbstractNearCacheRecord';
import { TIME_NOT_SET } from '@helios/internal/nearcache/NearCacheRecord';

// Mirrors JVMUtil constants from Block 3.2a
const REFERENCE_COST_IN_BYTES = 4;

export class NearCacheDataRecordStore<K, V> extends BaseHeapNearCacheRecordStore<K, V, NearCacheDataRecord> {

    constructor(
        name: string,
        nearCacheConfig: NearCacheConfig,
        serializationService: SerializationService,
        _classLoader: unknown,
        properties: HeliosProperties,
    ) {
        super(name, nearCacheConfig, serializationService, properties);
    }

    protected getKeyStorageMemoryCost(key: K): number {
        // Only Data keys have a measurable cost; plain object keys are 0
        if (key != null && typeof (key as Record<string, unknown>)['toByteArray'] === 'function') {
            const data = key as unknown as Data;
            return REFERENCE_COST_IN_BYTES + data.getHeapCost();
        }
        return 0;
    }

    protected getRecordStorageMemoryCost(record: NearCacheDataRecord | null): number {
        if (record === null) return 0;
        const value = record.getValue();
        return REFERENCE_COST_IN_BYTES        // ref to record in map
            + REFERENCE_COST_IN_BYTES         // ref to value field
            + 4                               // partitionId (int)
            + REFERENCE_COST_IN_BYTES + 16    // uuid ref + 2 longs
            + (value !== null ? value.getHeapCost() : 0)
            + NUMBER_OF_LONG_FIELD_TYPES * 8
            + NUMBER_OF_INTEGER_FIELD_TYPES * 4
            + NUMBER_OF_BOOLEAN_FIELD_TYPES;
    }

    protected createRecord(value: V | null): NearCacheDataRecord {
        const dataValue = this.toData(value);
        const creationTime = Date.now();
        const expiryTime = this.timeToLiveMillis > 0 ? creationTime + this.timeToLiveMillis : TIME_NOT_SET;
        return new NearCacheDataRecord(dataValue, creationTime, expiryTime);
    }

    protected updateRecordValue(record: NearCacheDataRecord, value: V | null): void {
        record.setValue(this.toData(value));
    }
}
