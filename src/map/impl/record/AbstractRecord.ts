/**
 * Port of {@code com.hazelcast.map.impl.record.AbstractRecord}.
 *
 * Abstract base for map records with full statistics tracking
 * (version, hits, timestamps). Timestamps are stored as 32-bit
 * integer offsets from EPOCH_TIME_MILLIS for compact storage.
 */
import type { Record } from './Record';
import { Record as RecordNS } from './Record';
import { RecordReaderWriter } from './RecordReaderWriter';
import { stripBaseTime, recomputeWithBaseTime } from '@zenystx/core/internal/util/TimeStripUtil';
import { JVMUtil } from '@zenystx/core/internal/util/JVMUtil';
import { SystemClock } from '@zenystx/core/internal/util/time/Clock';

const INT_SIZE_IN_BYTES = 4;
const NUMBER_OF_INTS = 6; // version, hits, lastAccessTime, lastUpdateTime, creationTime, lastStoredTime

export abstract class AbstractRecord<V> implements Record<V> {
    protected _version = 0;
    protected _hits = 0;
    private _lastAccessTime: number = RecordNS.UNSET;
    private _lastUpdateTime: number = RecordNS.UNSET;
    private _creationTime: number = RecordNS.UNSET;
    private _lastStoredTime: number = RecordNS.UNSET;

    abstract getValue(): V;
    abstract setValue(value: V): void;

    getMatchingRecordReaderWriter(): RecordReaderWriter {
        return RecordReaderWriter.DATA_RECORD_WITH_STATS_READER_WRITER;
    }

    getVersion(): number { return this._version; }
    setVersion(version: number): void { this._version = version; }

    getLastAccessTime(): number { return recomputeWithBaseTime(this._lastAccessTime); }
    setLastAccessTime(lastAccessTime: number): void { this._lastAccessTime = stripBaseTime(lastAccessTime); }

    getLastUpdateTime(): number { return recomputeWithBaseTime(this._lastUpdateTime); }
    setLastUpdateTime(lastUpdateTime: number): void { this._lastUpdateTime = stripBaseTime(lastUpdateTime); }

    getCreationTime(): number { return recomputeWithBaseTime(this._creationTime); }
    setCreationTime(creationTime: number): void { this._creationTime = stripBaseTime(creationTime); }

    getHits(): number { return this._hits; }
    setHits(hits: number): void { this._hits = hits; }

    /** UNSET — Hot Restart only; not used in standard records. */
    getSequence(): number { return RecordNS.UNSET; }
    setSequence(_sequence: number): void { /* NOP */ }

    getLastStoredTime(): number {
        if (this._lastStoredTime === RecordNS.UNSET) return 0;
        return recomputeWithBaseTime(this._lastStoredTime);
    }
    setLastStoredTime(lastStoredTime: number): void { this._lastStoredTime = stripBaseTime(lastStoredTime); }

    getCost(): number {
        return JVMUtil.OBJECT_HEADER_SIZE + NUMBER_OF_INTS * INT_SIZE_IN_BYTES;
    }

    getCachedValueUnsafe(): unknown { return RecordNS.NOT_CACHED; }
    casCachedValue(_expected: unknown, _newValue: unknown): boolean { return true; }

    onAccess(now: number): void {
        this.incrementHits();
        this.setLastAccessTime(now);
    }

    onUpdate(now: number): void {
        this._version = this._version + 1;
        this.setLastUpdateTime(now);
    }

    onStore(): void {
        this.setLastStoredTime(SystemClock.nowMillis());
    }

    incrementHits(): void {
        if (this._hits < 2147483647) {
            this._hits++;
        }
    }

    /* Raw (stripped) accessors used during serialization. */
    getRawCreationTime(): number { return this._creationTime; }
    setRawCreationTime(creationTime: number): void { this._creationTime = creationTime; }

    getRawLastAccessTime(): number { return this._lastAccessTime; }
    setRawLastAccessTime(lastAccessTime: number): void { this._lastAccessTime = lastAccessTime; }

    getRawLastUpdateTime(): number { return this._lastUpdateTime; }
    setRawLastUpdateTime(lastUpdateTime: number): void { this._lastUpdateTime = lastUpdateTime; }

    getRawLastStoredTime(): number { return this._lastStoredTime; }
    setRawLastStoredTime(time: number): void { this._lastStoredTime = time; }

    equals(other: unknown): boolean {
        if (this === other) return true;
        if (other == null || Object.getPrototypeOf(this) !== Object.getPrototypeOf(other)) return false;
        const that = other as AbstractRecord<unknown>;
        return this._version === that._version
            && this._hits === that._hits
            && this._lastAccessTime === that._lastAccessTime
            && this._lastUpdateTime === that._lastUpdateTime
            && this._creationTime === that._creationTime
            && this._lastStoredTime === that._lastStoredTime;
    }

    hashCode(): number {
        let result = this._version | 0;
        result = (Math.imul(31, result) + this._hits) | 0;
        result = (Math.imul(31, result) + this._lastAccessTime) | 0;
        result = (Math.imul(31, result) + this._lastUpdateTime) | 0;
        result = (Math.imul(31, result) + this._creationTime) | 0;
        result = (Math.imul(31, result) + this._lastStoredTime) | 0;
        return result;
    }

    toString(): string {
        return `AbstractRecord{version=${this._version}, hits=${this._hits}, lastAccessTime=${this._lastAccessTime}, lastUpdateTime=${this._lastUpdateTime}, creationTime=${this._creationTime}}`;
    }
}
