/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.record.AbstractNearCacheRecord}.
 *
 * Abstract implementation of NearCacheRecord with value and expiration time as internal state.
 * Uses TimeStripUtil to compress timestamps into 32-bit seconds offsets.
 */
import type { NearCacheRecord } from '@helios/internal/nearcache/NearCacheRecord';
import { TIME_NOT_SET, READ_PERMITTED } from '@helios/internal/nearcache/NearCacheRecord';
import { stripBaseTime, recomputeWithBaseTime } from '@helios/internal/util/TimeStripUtil';

// Byte-cost constants matching AbstractNearCacheRecord.java
export const NUMBER_OF_LONG_FIELD_TYPES = 2;   // reservationId, invalidationSequence
export const NUMBER_OF_INTEGER_FIELD_TYPES = 5; // partitionId, hits, lastAccessTime, expirationTime, creationTime
export const NUMBER_OF_BOOLEAN_FIELD_TYPES = 1; // cachedAsNull

export abstract class AbstractNearCacheRecord<V> implements NearCacheRecord<V> {
    protected _value: V | null;
    protected _creationTime: number;    // compressed int (seconds since epoch)
    protected _expirationTime: number;  // compressed int
    protected _lastAccessTime: number = TIME_NOT_SET; // compressed int
    protected _hits = 0;
    protected _partitionId = 0;
    protected _invalidationSequence = 0;
    protected _uuid: string | null = null;
    protected _cachedAsNull = false;
    protected _reservationId: number = READ_PERMITTED;

    constructor(value: V | null, creationTime: number, expirationTime: number) {
        this._value = value;
        this._creationTime = stripBaseTime(creationTime);
        this._expirationTime = stripBaseTime(expirationTime);
    }

    getValue(): V | null { return this._value; }
    setValue(value: V | null): void { this._value = value; }

    getCreationTime(): number { return recomputeWithBaseTime(this._creationTime); }
    setCreationTime(time: number): void { this._creationTime = stripBaseTime(time); }

    getExpirationTime(): number { return recomputeWithBaseTime(this._expirationTime); }
    setExpirationTime(time: number): void { this._expirationTime = stripBaseTime(time); }

    getLastAccessTime(): number { return recomputeWithBaseTime(this._lastAccessTime); }
    setLastAccessTime(time: number): void { this._lastAccessTime = stripBaseTime(time); }

    getHits(): number { return this._hits; }
    setHits(hits: number): void { this._hits = hits; }
    incrementHits(): void { this._hits++; }

    getReservationId(): number { return this._reservationId; }
    setReservationId(id: number): void { this._reservationId = id; }

    getPartitionId(): number { return this._partitionId; }
    setPartitionId(partitionId: number): void { this._partitionId = partitionId; }

    getInvalidationSequence(): number { return this._invalidationSequence; }
    setInvalidationSequence(sequence: number): void { this._invalidationSequence = sequence; }

    setUuid(uuid: string | null): void { this._uuid = uuid; }
    hasSameUuid(uuid: string | null): boolean {
        return this._uuid !== null && uuid !== null && this._uuid === uuid;
    }

    isCachedAsNull(): boolean { return this._cachedAsNull; }
    setCachedAsNull(cachedAsNull: boolean): void { this._cachedAsNull = cachedAsNull; }

    isExpiredAt(now: number): boolean {
        const exp = this.getExpirationTime();
        return exp > 0 && exp <= now;
    }

    isIdleAt(maxIdleMillis: number, now: number): boolean {
        if (maxIdleMillis <= 0) return false;
        const lastAccess = this.getLastAccessTime();
        return lastAccess > 0
            ? lastAccess + maxIdleMillis < now
            : this.getCreationTime() + maxIdleMillis < now;
    }

    toString(): string {
        return `AbstractNearCacheRecord{creationTime=${this._creationTime}, value=${this._value}, uuid=${this._uuid}, cachedAsNull=${this._cachedAsNull}, hits=${this._hits}, partitionId=${this._partitionId}, lastAccessTime=${this._lastAccessTime}, expirationTime=${this._expirationTime}, invalidationSequence=${this._invalidationSequence}, reservationId=${this._reservationId}}`;
    }
}
