/**
 * Port of {@code com.hazelcast.internal.nearcache.NearCacheRecord}.
 *
 * An expirable and evictable data object which represents a Near Cache entry.
 */

export const TIME_NOT_SET = -1;
export const NOT_RESERVED = -1;
export const READ_PERMITTED = -2;

export interface NearCacheRecord<V = unknown> {
    getValue(): V | null;
    setValue(value: V | null): void;

    getCreationTime(): number;
    setCreationTime(time: number): void;

    getExpirationTime(): number;
    setExpirationTime(time: number): void;

    getLastAccessTime(): number;
    setLastAccessTime(time: number): void;

    getHits(): number;
    setHits(hits: number): void;
    incrementHits(): void;

    getReservationId(): number;
    setReservationId(id: number): void;

    getPartitionId(): number;
    setPartitionId(partitionId: number): void;

    getInvalidationSequence(): number;
    setInvalidationSequence(sequence: number): void;

    setUuid(uuid: string | null): void;
    hasSameUuid(uuid: string | null): boolean;

    isCachedAsNull(): boolean;
    setCachedAsNull(cachedAsNull: boolean): void;

    isExpiredAt(now: number): boolean;
    isIdleAt(maxIdleMillis: number, now: number): boolean;
}
