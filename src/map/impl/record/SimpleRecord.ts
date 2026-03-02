/**
 * Port of {@code com.hazelcast.map.impl.record.SimpleRecord}.
 *
 * Used when {@code MapConfig.isPerEntryStatsEnabled()} is {@code false}.
 * No time-based stats tracked; minimal memory footprint.
 */
import type { Record } from './Record';
import { Record as RecordNS } from './Record';
import { RecordReaderWriter } from './RecordReaderWriter';
import type { Data } from '@helios/internal/serialization/Data';
import { JVMUtil } from '@helios/internal/util/JVMUtil';

export class SimpleRecord<V = unknown> implements Record<V> {
    protected _value: V = null as unknown as V;
    private _version = 0;

    constructor(value?: V) {
        if (arguments.length > 0) this._value = value!;
    }

    getValue(): V { return this._value; }
    setValue(value: V): void { this._value = value; }

    getVersion(): number { return this._version; }
    setVersion(version: number): void { this._version = version; }

    getCachedValueUnsafe(): unknown { return RecordNS.NOT_CACHED; }
    casCachedValue(_expected: unknown, _newValue: unknown): boolean { return true; }

    getCost(): number {
        const v = this._value;
        if (v != null && typeof v === 'object' && 'getHeapCost' in v) {
            return JVMUtil.OBJECT_HEADER_SIZE
                + JVMUtil.REFERENCE_COST_IN_BYTES
                + (v as unknown as Data).getHeapCost();
        }
        return 0;
    }

    getLastAccessTime(): number { return RecordNS.UNSET; }
    setLastAccessTime(_t: number): void { /* NOP */ }
    getLastUpdateTime(): number { return RecordNS.UNSET; }
    setLastUpdateTime(_t: number): void { /* NOP */ }
    getCreationTime(): number { return RecordNS.UNSET; }
    setCreationTime(_t: number): void { /* NOP */ }
    getHits(): number { return RecordNS.UNSET; }
    setHits(_hits: number): void { /* NOP */ }
    getSequence(): number { return RecordNS.UNSET; }
    setSequence(_s: number): void { /* NOP */ }
    getLastStoredTime(): number { return RecordNS.UNSET; }
    setLastStoredTime(_t: number): void { /* NOP */ }

    onAccess(_now: number): void { /* NOP */ }
    onUpdate(now: number): void { this._version++; this.setLastUpdateTime(now); }
    onStore(): void { /* NOP */ }
    incrementHits(): void { /* NOP */ }

    getMatchingRecordReaderWriter(): RecordReaderWriter {
        return RecordReaderWriter.SIMPLE_DATA_RECORD_READER_WRITER;
    }

    getRawCreationTime(): number { return RecordNS.UNSET; }
    setRawCreationTime(_t: number): void { /* NOP */ }
    getRawLastAccessTime(): number { return RecordNS.UNSET; }
    setRawLastAccessTime(_t: number): void { /* NOP */ }
    getRawLastUpdateTime(): number { return RecordNS.UNSET; }
    setRawLastUpdateTime(_t: number): void { /* NOP */ }
    getRawLastStoredTime(): number { return RecordNS.UNSET; }
    setRawLastStoredTime(_t: number): void { /* NOP */ }

    equals(other: unknown): boolean {
        if (this === other) return true;
        if (other == null || Object.getPrototypeOf(this) !== Object.getPrototypeOf(other)) return false;
        const that = other as SimpleRecord<V>;
        if (this._version !== that._version) return false;
        return this._value === that._value;
    }

    hashCode(): number {
        const v = this._value as unknown;
        let result = 0;
        if (v != null && typeof v === 'object' && 'hashCode' in v) {
            result = (v as { hashCode(): number }).hashCode();
        }
        result = (Math.imul(31, result) + this._version) | 0;
        return result;
    }

    toString(): string {
        return `SimpleRecord{value=${this._value}, version=${this._version}}`;
    }
}
