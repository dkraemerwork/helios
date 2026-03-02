/**
 * Port of {@code com.hazelcast.map.impl.query.QueryResultRow}.
 *
 * Represents a single row (key, value) in a query result.
 * Either key or value may be null depending on IterationType.
 */
import type { Data } from '@helios/internal/serialization/Data';

export class QueryResultRow {
    private readonly _key: Data | null;
    private readonly _value: Data | null;

    constructor(key: Data | null, value: Data | null) {
        this._key = key;
        this._value = value;
    }

    getKey(): Data | null { return this._key; }

    getValue(): Data | null { return this._value; }

    equals(other: unknown): boolean {
        if (this === other) return true;
        if (!(other instanceof QueryResultRow)) return false;
        const keyEq = this._key === null ? other._key === null
            : (other._key !== null && this._key.equals(other._key));
        const valEq = this._value === null ? other._value === null
            : (other._value !== null && this._value.equals(other._value));
        return keyEq && valEq;
    }

    hashCode(): number {
        const kh = this._key?.hashCode() ?? 0;
        const vh = this._value?.hashCode() ?? 0;
        return (kh * 31 + vh) | 0;
    }
}
