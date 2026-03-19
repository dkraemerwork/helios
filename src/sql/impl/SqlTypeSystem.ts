/**
 * SQL Type System — coercion, inference, and compatibility rules.
 *
 * Mirrors Hazelcast's SQL type coercion semantics for the embedded engine.
 */
import type { SqlColumnType } from '@zenystx/helios-core/sql/impl/SqlRowMetadata.js';

/** Error codes matching Hazelcast SQL error codes. */
export enum SqlErrorCode {
    GENERIC = -1,
    CONNECTION_PROBLEM = 1001,
    CANCELLED_BY_USER = 1003,
    TIMEOUT = 1004,
    PARTITION_DISTRIBUTION = 1005,
    MAP_DESTROYED = 1007,
    PARSING = 1008,
    INDEX_INVALID = 1009,
    DATA_EXCEPTION = 2000,
}

/** Numeric precedence for type promotion — higher wins. */
const TYPE_PRECEDENCE: Record<SqlColumnType, number> = {
    NULL: 0,
    BOOLEAN: 1,
    TINYINT: 2,
    SMALLINT: 3,
    INTEGER: 4,
    BIGINT: 5,
    DECIMAL: 6,
    REAL: 7,
    DOUBLE: 8,
    VARCHAR: 9,
    DATE: 10,
    TIME: 11,
    TIMESTAMP: 12,
    TIMESTAMP_WITH_TIME_ZONE: 13,
    OBJECT: 14,
};

export class SqlTypeSystem {
    /**
     * Coerce a JS value to the given SQL column type.
     * Follows Hazelcast coercion rules (widening numeric conversions, string parsing, etc.).
     */
    coerce(value: unknown, targetType: SqlColumnType): unknown {
        if (value === null || value === undefined) return null;

        switch (targetType) {
            case 'VARCHAR':
                return String(value);

            case 'BOOLEAN':
                if (typeof value === 'boolean') return value;
                if (typeof value === 'string') {
                    const lower = value.toLowerCase();
                    if (lower === 'true' || lower === '1') return true;
                    if (lower === 'false' || lower === '0') return false;
                }
                if (typeof value === 'number') return value !== 0;
                throw new Error(`Cannot coerce ${typeof value} to BOOLEAN`);

            case 'TINYINT': {
                const n = this._toNumber(value);
                if (n < -128 || n > 127) throw new Error(`Value ${n} out of range for TINYINT`);
                return Math.trunc(n);
            }

            case 'SMALLINT': {
                const n = this._toNumber(value);
                if (n < -32768 || n > 32767) throw new Error(`Value ${n} out of range for SMALLINT`);
                return Math.trunc(n);
            }

            case 'INTEGER': {
                const n = this._toNumber(value);
                if (n < -2147483648 || n > 2147483647) throw new Error(`Value ${n} out of range for INTEGER`);
                return Math.trunc(n);
            }

            case 'BIGINT':
                if (typeof value === 'bigint') return value;
                return BigInt(Math.trunc(this._toNumber(value)));

            case 'DECIMAL':
            case 'REAL':
            case 'DOUBLE':
                return this._toNumber(value);

            case 'DATE':
            case 'TIME':
            case 'TIMESTAMP':
            case 'TIMESTAMP_WITH_TIME_ZONE':
                if (value instanceof Date) return value;
                if (typeof value === 'string') return new Date(value);
                if (typeof value === 'number') return new Date(value);
                throw new Error(`Cannot coerce ${typeof value} to ${targetType}`);

            case 'NULL':
                return null;

            case 'OBJECT':
                return value;
        }
    }

    /** Infer the SQL column type from a JavaScript runtime value. */
    inferType(value: unknown): SqlColumnType {
        if (value === null || value === undefined) return 'NULL';
        if (typeof value === 'boolean') return 'BOOLEAN';
        if (typeof value === 'bigint') return 'BIGINT';
        if (typeof value === 'string') return 'VARCHAR';
        if (value instanceof Date) return 'TIMESTAMP';
        if (typeof value === 'number') {
            return Number.isInteger(value) ? 'INTEGER' : 'DOUBLE';
        }
        return 'OBJECT';
    }

    /** Whether two SQL types are assignment-compatible. */
    areTypesCompatible(t1: SqlColumnType, t2: SqlColumnType): boolean {
        if (t1 === t2) return true;
        if (t1 === 'NULL' || t2 === 'NULL') return true;
        if (t1 === 'OBJECT' || t2 === 'OBJECT') return true;

        const numericTypes = new Set<SqlColumnType>(['TINYINT', 'SMALLINT', 'INTEGER', 'BIGINT', 'DECIMAL', 'REAL', 'DOUBLE']);
        if (numericTypes.has(t1) && numericTypes.has(t2)) return true;

        const temporalTypes = new Set<SqlColumnType>(['DATE', 'TIME', 'TIMESTAMP', 'TIMESTAMP_WITH_TIME_ZONE']);
        if (temporalTypes.has(t1) && temporalTypes.has(t2)) return true;

        return false;
    }

    /** Return the common (wider) type for two SQL types — used in CASE/COALESCE. */
    commonType(t1: SqlColumnType, t2: SqlColumnType): SqlColumnType {
        if (t1 === t2) return t1;
        if (t1 === 'NULL') return t2;
        if (t2 === 'NULL') return t1;
        if (t1 === 'OBJECT' || t2 === 'OBJECT') return 'OBJECT';

        const p1 = TYPE_PRECEDENCE[t1] ?? 0;
        const p2 = TYPE_PRECEDENCE[t2] ?? 0;
        return p1 >= p2 ? t1 : t2;
    }

    private _toNumber(value: unknown): number {
        if (typeof value === 'number') return value;
        if (typeof value === 'bigint') return Number(value);
        if (typeof value === 'string') {
            const n = Number(value);
            if (isNaN(n)) throw new Error(`Cannot parse '${value}' as a number`);
            return n;
        }
        if (typeof value === 'boolean') return value ? 1 : 0;
        throw new Error(`Cannot coerce ${typeof value} to a number`);
    }
}

/** Singleton instance for convenience. */
export const sqlTypeSystem = new SqlTypeSystem();
