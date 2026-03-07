/**
 * Port of {@code com.hazelcast.map.impl.record.CachedDataRecordWithStats}.
 *
 * A DataRecord that supports caching the deserialized value (lazy deserialization).
 * Single-threaded: uses simple compare-and-set without CAS atomics.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { JVMUtil } from '@zenystx/helios-core/internal/util/JVMUtil';
import { DataRecordWithStats } from './DataRecordWithStats';

export class CachedDataRecordWithStats extends DataRecordWithStats {
    private _cachedValue: unknown = null;

    constructor(value?: Data | null) {
        super(value);
    }

    override setValue(value: Data | null): void {
        super.setValue(value);
        this._cachedValue = null;
    }

    override getCachedValueUnsafe(): unknown {
        return this._cachedValue;
    }

    override casCachedValue(expectedValue: unknown, newValue: unknown): boolean {
        if (this._cachedValue !== expectedValue) return false;
        this._cachedValue = newValue;
        return true;
    }

    override getCost(): number {
        return super.getCost() + JVMUtil.REFERENCE_COST_IN_BYTES;
    }

    override equals(other: unknown): boolean {
        if (this === other) return true;
        if (!super.equals(other)) return false;
        const that = other as CachedDataRecordWithStats;
        return this._cachedValue === that._cachedValue;
    }

    override hashCode(): number {
        let result = super.hashCode();
        const ch = this._cachedValue != null ? this._cachedValue.toString().length : 0;
        result = (Math.imul(31, result) + ch) | 0;
        return result;
    }

    override toString(): string {
        return `CachedDataRecordWithStats{cachedValue=${this._cachedValue}, ${super.toString()}}`;
    }
}
