/**
 * Port of {@code com.hazelcast.map.impl.record.ObjectRecordWithStats}.
 *
 * A record that stores deserialized object values with full statistics.
 * getCost() returns 0 — heap cost is not tracked for object format.
 */
import { AbstractRecord } from './AbstractRecord';
import { objectIdentityHash } from './objectIdentityHash';

export class ObjectRecordWithStats extends AbstractRecord<unknown> {
    private _value: unknown = null;

    constructor(value?: unknown) {
        super();
        if (arguments.length > 0) this._value = value;
    }

    getValue(): unknown { return this._value; }
    setValue(value: unknown): void { this._value = value; }

    /** Object-format records do not track heap cost. */
    getCost(): number { return 0; }

    equals(other: unknown): boolean {
        if (!super.equals(other)) return false;
        const that = other as ObjectRecordWithStats;
        return this._value === that._value;
    }

    hashCode(): number {
        let result = super.hashCode();
        const vh = this._value != null ? objectIdentityHash(this._value) : 0;
        result = (Math.imul(31, result) + vh) | 0;
        return result;
    }

    toString(): string {
        return `ObjectRecordWithStats{value=${this._value}, ${super.toString()}}`;
    }
}
