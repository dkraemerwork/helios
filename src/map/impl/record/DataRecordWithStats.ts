/**
 * Port of {@code com.hazelcast.map.impl.record.DataRecordWithStats}.
 *
 * A record that stores binary-serialized ({@link Data}) values with full statistics.
 */
import { AbstractRecord } from './AbstractRecord';
import type { Data } from '@helios/internal/serialization/Data';
import { JVMUtil } from '@helios/internal/util/JVMUtil';

export class DataRecordWithStats extends AbstractRecord<Data | null> {
    protected _value: Data | null = null;

    constructor(value?: Data | null) {
        super();
        if (value !== undefined) this._value = value;
    }

    getValue(): Data | null { return this._value; }
    setValue(value: Data | null): void { this._value = value; }

    getCost(): number {
        return super.getCost()
            + JVMUtil.REFERENCE_COST_IN_BYTES
            + (this._value == null ? 0 : this._value.getHeapCost());
    }

    equals(other: unknown): boolean {
        if (!super.equals(other)) return false;
        const that = other as DataRecordWithStats;
        if (this._value === that._value) return true;
        if (this._value == null || that._value == null) return false;
        return this._value.equals(that._value);
    }

    hashCode(): number {
        let result = super.hashCode();
        const vh = this._value != null ? this._value.hashCode() : 0;
        result = (Math.imul(31, result) + vh) | 0;
        return result;
    }

    toString(): string {
        return `DataRecordWithStats{value=${this._value}, ${super.toString()}}`;
    }
}
