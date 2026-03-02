/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.record.NearCacheDataRecord}.
 *
 * NearCacheRecord implementation that stores Data (binary) values.
 */
import type { Data } from '@helios/internal/serialization/Data';
import { AbstractNearCacheRecord } from '@helios/internal/nearcache/impl/record/AbstractNearCacheRecord';

export class NearCacheDataRecord extends AbstractNearCacheRecord<Data | null> {
    constructor(value: Data | null, creationTime: number, expiryTime: number) {
        super(value, creationTime, expiryTime);
    }

    toString(): string {
        return `NearCacheDataRecord{${super.toString()}}`;
    }
}
