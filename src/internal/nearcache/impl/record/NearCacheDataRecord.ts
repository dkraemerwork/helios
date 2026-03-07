/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.record.NearCacheDataRecord}.
 *
 * NearCacheRecord implementation that stores Data (binary) values.
 */
import { AbstractNearCacheRecord } from '@zenystx/helios-core/internal/nearcache/impl/record/AbstractNearCacheRecord';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';

export class NearCacheDataRecord extends AbstractNearCacheRecord<Data | null> {
    constructor(value: Data | null, creationTime: number, expiryTime: number) {
        super(value, creationTime, expiryTime);
    }

    toString(): string {
        return `NearCacheDataRecord{${super.toString()}}`;
    }
}
