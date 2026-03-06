/**
 * Port of {@code com.hazelcast.map.impl.record.Record}.
 *
 * Generic interface for a map record value with metadata (stats, TTL, hits, etc.).
 */
import type { RecordReaderWriter } from './RecordReaderWriter';
import { SystemClock } from '@zenystx/helios-core/internal/util/time/Clock';

export interface Record<V> {
    getValue(): V;
    setValue(value: V): void;

    /** Heap cost of this record in bytes. */
    getCost(): number;

    getVersion(): number;
    setVersion(version: number): void;

    /**
     * Returns the raw cached value (may be NOT_CACHED or a mutex marker).
     * Use {@link Records.getCachedValue} instead of calling this directly.
     */
    getCachedValueUnsafe(): unknown;

    /**
     * Compare-and-set the cached value.
     * Single-threaded: just sets if current matches expected.
     */
    casCachedValue(expectedValue: unknown, newValue: unknown): boolean;

    getLastAccessTime(): number;
    setLastAccessTime(lastAccessTime: number): void;

    getLastUpdateTime(): number;
    setLastUpdateTime(lastUpdateTime: number): void;

    getCreationTime(): number;
    setCreationTime(creationTime: number): void;

    getHits(): number;
    setHits(hits: number): void;

    /** Only used for Hot Restart; always UNSET in standard records. */
    getSequence(): number;
    setSequence(sequence: number): void;

    getLastStoredTime(): number;
    setLastStoredTime(lastStoredTime: number): void;

    onAccess(now: number): void;
    onUpdate(now: number): void;
    onStore(): void;
    incrementHits(): void;

    getMatchingRecordReaderWriter(): RecordReaderWriter;

    /* Raw (stripped) accessors for serialization. */
    getRawCreationTime(): number;
    setRawCreationTime(creationTime: number): void;
    getRawLastAccessTime(): number;
    setRawLastAccessTime(lastAccessTime: number): void;
    getRawLastUpdateTime(): number;
    setRawLastUpdateTime(lastUpdateTime: number): void;
    getRawLastStoredTime(): number;
    setRawLastStoredTime(time: number): void;

    equals(other: unknown): boolean;
    hashCode(): number;
}

export namespace Record {
    /** Represents an unset value (default for ttl, max-idle, etc.). */
    export const UNSET: number = -1;

    /** Singleton sentinel: record does not support caching. */
    export const NOT_CACHED: object = Object.freeze({});
}

/** Default mixin helpers — shared implementation for onAccess/onUpdate/onStore. */
export function defaultOnAccess(record: Record<unknown>, now: number): void {
    record.incrementHits();
    record.setLastAccessTime(now);
}

export function defaultOnUpdate(record: Record<unknown>, now: number): void {
    record.setVersion(record.getVersion() + 1);
    record.setLastUpdateTime(now);
}

export function defaultOnStore(record: Record<unknown>): void {
    record.setLastStoredTime(SystemClock.nowMillis());
}

export function defaultIncrementHits(record: Record<unknown>): void {
    const hits = record.getHits();
    if (hits < 2147483647) {
        record.setHits(hits + 1);
    }
}
