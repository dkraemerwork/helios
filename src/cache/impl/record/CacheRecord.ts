/**
 * Port of {@code com.hazelcast.cache.impl.record.CacheRecord}.
 * An expirable, evictable entry in a {@link ICacheRecordStore}.
 */
export interface CacheRecord<V, E> {
    /** Sentinel value meaning "time not set". */
    readonly TIME_NOT_AVAILABLE: -1;

    getValue(): V | null;
    setValue(value: V | null): void;

    getCreationTime(): number;
    setCreationTime(time: number): void;

    getLastAccessTime(): number;
    setLastAccessTime(time: number): void;

    getHits(): number;
    setHits(hit: number): void;
    incrementHits(): void;

    getExpiryPolicy(): E | null;
    setExpiryPolicy(policy: E | null): void;

    /** Returns the absolute expiry timestamp in ms, or -1 if never expires. */
    getExpirationTime(): number;
    setExpirationTime(time: number): void;

    isExpiredAt(now: number): boolean;
}
