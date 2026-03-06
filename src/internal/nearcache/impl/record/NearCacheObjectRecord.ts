/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.record.NearCacheObjectRecord}.
 *
 * NearCacheRecord implementation that stores any object (non-Data) values.
 */
import { AbstractNearCacheRecord } from '@zenystx/helios-core/internal/nearcache/impl/record/AbstractNearCacheRecord';

export class NearCacheObjectRecord<V> extends AbstractNearCacheRecord<V> {
    constructor(value: V | null, creationTime: number, expiryTime: number) {
        super(value, creationTime, expiryTime);
    }

    toString(): string {
        return `NearCacheObjectRecord{${super.toString()}}`;
    }
}
