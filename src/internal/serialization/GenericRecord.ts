/**
 * Port of {@code com.hazelcast.nio.serialization.genericrecord.GenericRecord}.
 *
 * Provides schemaless read/write access to serialized records without
 * requiring concrete domain classes.  Supports both Portable and Compact
 * payloads.
 */

// ── Field kind (mirrors FieldKind in Java) ────────────────────────────────

export const enum FieldKind {
    NOT_AVAILABLE = 0,
    BOOLEAN = 1,
    ARRAY_OF_BOOLEAN = 2,
    INT8 = 3,
    ARRAY_OF_INT8 = 4,
    INT16 = 5,
    ARRAY_OF_INT16 = 6,
    INT32 = 7,
    ARRAY_OF_INT32 = 8,
    INT64 = 9,
    ARRAY_OF_INT64 = 10,
    FLOAT32 = 11,
    ARRAY_OF_FLOAT32 = 12,
    FLOAT64 = 13,
    ARRAY_OF_FLOAT64 = 14,
    STRING = 15,
    ARRAY_OF_STRING = 16,
    DECIMAL = 17,
    ARRAY_OF_DECIMAL = 18,
    TIME = 19,
    ARRAY_OF_TIME = 20,
    DATE = 21,
    ARRAY_OF_DATE = 22,
    TIMESTAMP = 23,
    ARRAY_OF_TIMESTAMP = 24,
    TIMESTAMP_WITH_TIMEZONE = 25,
    ARRAY_OF_TIMESTAMP_WITH_TIMEZONE = 26,
    COMPACT = 27,
    ARRAY_OF_COMPACT = 28,
    PORTABLE = 29,
    ARRAY_OF_PORTABLE = 30,
    NULLABLE_BOOLEAN = 31,
    ARRAY_OF_NULLABLE_BOOLEAN = 32,
    NULLABLE_INT8 = 33,
    ARRAY_OF_NULLABLE_INT8 = 34,
    NULLABLE_INT16 = 35,
    ARRAY_OF_NULLABLE_INT16 = 36,
    NULLABLE_INT32 = 37,
    ARRAY_OF_NULLABLE_INT32 = 38,
    NULLABLE_INT64 = 39,
    ARRAY_OF_NULLABLE_INT64 = 40,
    NULLABLE_FLOAT32 = 41,
    ARRAY_OF_NULLABLE_FLOAT32 = 42,
    NULLABLE_FLOAT64 = 43,
    ARRAY_OF_NULLABLE_FLOAT64 = 44,
}

// ── Temporal types matching java.time ────────────────────────────────────────

/** Matches java.time.LocalDate: year/month/day with no time or timezone. */
export interface LocalDate {
    readonly year: number;    // full Gregorian year
    readonly month: number;   // 1–12
    readonly dayOfMonth: number; // 1–31
}

/** Matches java.time.LocalTime: time of day with nanosecond precision. */
export interface LocalTime {
    readonly hour: number;        // 0–23
    readonly minute: number;      // 0–59
    readonly second: number;      // 0–59
    readonly nano: number;        // 0–999_999_999
}

/** Matches java.time.LocalDateTime. */
export interface LocalDateTime {
    readonly date: LocalDate;
    readonly time: LocalTime;
}

/** Matches java.time.OffsetDateTime. */
export interface OffsetDateTime {
    readonly dateTime: LocalDateTime;
    /** Offset from UTC in total seconds (e.g. +3600 = UTC+1). */
    readonly offsetSeconds: number;
}

/** Matches java.math.BigDecimal. */
export interface BigDecimal {
    /** Unscaled integer value as a big-endian two's-complement byte array. */
    readonly unscaled: Buffer;
    /** Scale (digits to the right of the decimal point). */
    readonly scale: number;
}

// ── GenericRecord interface ───────────────────────────────────────────────────

/**
 * Provides typed, field-name-based read access to a serialized record.
 * Implementations exist for both Portable and Compact formats.
 */
export interface GenericRecord {
    getTypeName(): string;
    /** Returns the field names present in this record. */
    getFieldNames(): ReadonlySet<string>;

    /** Returns the FieldKind for the given field, or NOT_AVAILABLE if absent. */
    getFieldKind(fieldName: string): FieldKind;

    /** Whether this record was produced by Compact serialization. */
    isCompact(): boolean;

    /** Whether this record was produced by Portable serialization. */
    isPortable(): boolean;

    getBoolean(fieldName: string): boolean;
    getInt8(fieldName: string): number;
    getInt16(fieldName: string): number;
    getInt32(fieldName: string): number;
    getInt64(fieldName: string): bigint;
    getFloat32(fieldName: string): number;
    getFloat64(fieldName: string): number;
    getString(fieldName: string): string | null;
    getDecimal(fieldName: string): BigDecimal | null;
    getTime(fieldName: string): LocalTime | null;
    getDate(fieldName: string): LocalDate | null;
    getTimestamp(fieldName: string): LocalDateTime | null;
    getTimestampWithTimezone(fieldName: string): OffsetDateTime | null;
    getGenericRecord(fieldName: string): GenericRecord | null;

    getNullableBoolean(fieldName: string): boolean | null;
    getNullableInt8(fieldName: string): number | null;
    getNullableInt16(fieldName: string): number | null;
    getNullableInt32(fieldName: string): number | null;
    getNullableInt64(fieldName: string): bigint | null;
    getNullableFloat32(fieldName: string): number | null;
    getNullableFloat64(fieldName: string): number | null;

    getArrayOfBoolean(fieldName: string): boolean[] | null;
    getArrayOfInt8(fieldName: string): Buffer | null;
    getArrayOfInt16(fieldName: string): number[] | null;
    getArrayOfInt32(fieldName: string): number[] | null;
    getArrayOfInt64(fieldName: string): bigint[] | null;
    getArrayOfFloat32(fieldName: string): number[] | null;
    getArrayOfFloat64(fieldName: string): number[] | null;
    getArrayOfString(fieldName: string): (string | null)[] | null;
    getArrayOfDecimal(fieldName: string): (BigDecimal | null)[] | null;
    getArrayOfTime(fieldName: string): (LocalTime | null)[] | null;
    getArrayOfDate(fieldName: string): (LocalDate | null)[] | null;
    getArrayOfTimestamp(fieldName: string): (LocalDateTime | null)[] | null;
    getArrayOfTimestampWithTimezone(fieldName: string): (OffsetDateTime | null)[] | null;
    getArrayOfGenericRecord(fieldName: string): (GenericRecord | null)[] | null;

    getArrayOfNullableBoolean(fieldName: string): (boolean | null)[] | null;
    getArrayOfNullableInt8(fieldName: string): (number | null)[] | null;
    getArrayOfNullableInt16(fieldName: string): (number | null)[] | null;
    getArrayOfNullableInt32(fieldName: string): (number | null)[] | null;
    getArrayOfNullableInt64(fieldName: string): (bigint | null)[] | null;
    getArrayOfNullableFloat32(fieldName: string): (number | null)[] | null;
    getArrayOfNullableFloat64(fieldName: string): (number | null)[] | null;

    /** Creates a builder pre-populated with the current record's values. */
    newBuilderWithClone(): GenericRecordBuilder;

    /** Creates a new builder from scratch for the same schema. */
    newBuilder(): GenericRecordBuilder;
}

// ── GenericRecordBuilder ──────────────────────────────────────────────────────

/**
 * Builder pattern for constructing {@link GenericRecord} instances.
 * All set methods return {@code this} for chaining.
 */
export interface GenericRecordBuilder {
    setBoolean(fieldName: string, value: boolean): this;
    setInt8(fieldName: string, value: number): this;
    setInt16(fieldName: string, value: number): this;
    setInt32(fieldName: string, value: number): this;
    setInt64(fieldName: string, value: bigint): this;
    setFloat32(fieldName: string, value: number): this;
    setFloat64(fieldName: string, value: number): this;
    setString(fieldName: string, value: string | null): this;
    setDecimal(fieldName: string, value: BigDecimal | null): this;
    setTime(fieldName: string, value: LocalTime | null): this;
    setDate(fieldName: string, value: LocalDate | null): this;
    setTimestamp(fieldName: string, value: LocalDateTime | null): this;
    setTimestampWithTimezone(fieldName: string, value: OffsetDateTime | null): this;
    setGenericRecord(fieldName: string, value: GenericRecord | null): this;

    setNullableBoolean(fieldName: string, value: boolean | null): this;
    setNullableInt8(fieldName: string, value: number | null): this;
    setNullableInt16(fieldName: string, value: number | null): this;
    setNullableInt32(fieldName: string, value: number | null): this;
    setNullableInt64(fieldName: string, value: bigint | null): this;
    setNullableFloat32(fieldName: string, value: number | null): this;
    setNullableFloat64(fieldName: string, value: number | null): this;

    setArrayOfBoolean(fieldName: string, value: boolean[] | null): this;
    setArrayOfInt8(fieldName: string, value: Buffer | null): this;
    setArrayOfInt16(fieldName: string, value: number[] | null): this;
    setArrayOfInt32(fieldName: string, value: number[] | null): this;
    setArrayOfInt64(fieldName: string, value: bigint[] | null): this;
    setArrayOfFloat32(fieldName: string, value: number[] | null): this;
    setArrayOfFloat64(fieldName: string, value: number[] | null): this;
    setArrayOfString(fieldName: string, value: (string | null)[] | null): this;
    setArrayOfDecimal(fieldName: string, value: (BigDecimal | null)[] | null): this;
    setArrayOfTime(fieldName: string, value: (LocalTime | null)[] | null): this;
    setArrayOfDate(fieldName: string, value: (LocalDate | null)[] | null): this;
    setArrayOfTimestamp(fieldName: string, value: (LocalDateTime | null)[] | null): this;
    setArrayOfTimestampWithTimezone(fieldName: string, value: (OffsetDateTime | null)[] | null): this;
    setArrayOfGenericRecord(fieldName: string, value: (GenericRecord | null)[] | null): this;

    setArrayOfNullableBoolean(fieldName: string, value: (boolean | null)[] | null): this;
    setArrayOfNullableInt8(fieldName: string, value: (number | null)[] | null): this;
    setArrayOfNullableInt16(fieldName: string, value: (number | null)[] | null): this;
    setArrayOfNullableInt32(fieldName: string, value: (number | null)[] | null): this;
    setArrayOfNullableInt64(fieldName: string, value: (bigint | null)[] | null): this;
    setArrayOfNullableFloat32(fieldName: string, value: (number | null)[] | null): this;
    setArrayOfNullableFloat64(fieldName: string, value: (number | null)[] | null): this;

    /** Finalise and return the immutable {@link GenericRecord}. */
    build(): GenericRecord;
}

// ── Concrete implementation ───────────────────────────────────────────────────

/** Thrown when a field is not found or has a mismatched kind. */
export class GenericRecordError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'GenericRecordError';
    }
}

/** Simple map-backed GenericRecord used by both Compact and Portable paths. */
export class GenericRecordImpl implements GenericRecord {
    private readonly _fields: Map<string, FieldKind>;
    private readonly _values: Map<string, unknown>;
    private readonly _compact: boolean;
    private readonly _typeName: string;

    constructor(
        fields: Map<string, FieldKind>,
        values: Map<string, unknown>,
        compact: boolean,
        typeName = 'GenericRecord',
    ) {
        this._fields = fields;
        this._values = values;
        this._compact = compact;
        this._typeName = typeName;
    }

    getTypeName(): string { return this._typeName; }

    getFieldNames(): ReadonlySet<string> {
        return new Set(this._fields.keys());
    }

    getFieldKind(fieldName: string): FieldKind {
        return this._fields.get(fieldName) ?? FieldKind.NOT_AVAILABLE;
    }

    isCompact(): boolean { return this._compact; }
    isPortable(): boolean { return !this._compact; }

    // ── scalar reads ────────────────────────────────────────────────────────

    getBoolean(fieldName: string): boolean { return this._read(fieldName, FieldKind.BOOLEAN) as boolean; }
    getInt8(fieldName: string): number { return this._read(fieldName, FieldKind.INT8) as number; }
    getInt16(fieldName: string): number { return this._read(fieldName, FieldKind.INT16) as number; }
    getInt32(fieldName: string): number { return this._read(fieldName, FieldKind.INT32) as number; }
    getInt64(fieldName: string): bigint { return this._read(fieldName, FieldKind.INT64) as bigint; }
    getFloat32(fieldName: string): number { return this._read(fieldName, FieldKind.FLOAT32) as number; }
    getFloat64(fieldName: string): number { return this._read(fieldName, FieldKind.FLOAT64) as number; }
    getString(fieldName: string): string | null { return this._readNullable(fieldName, FieldKind.STRING) as string | null; }
    getDecimal(fieldName: string): BigDecimal | null { return this._readNullable(fieldName, FieldKind.DECIMAL) as BigDecimal | null; }
    getTime(fieldName: string): LocalTime | null { return this._readNullable(fieldName, FieldKind.TIME) as LocalTime | null; }
    getDate(fieldName: string): LocalDate | null { return this._readNullable(fieldName, FieldKind.DATE) as LocalDate | null; }
    getTimestamp(fieldName: string): LocalDateTime | null { return this._readNullable(fieldName, FieldKind.TIMESTAMP) as LocalDateTime | null; }
    getTimestampWithTimezone(fieldName: string): OffsetDateTime | null { return this._readNullable(fieldName, FieldKind.TIMESTAMP_WITH_TIMEZONE) as OffsetDateTime | null; }
    getGenericRecord(fieldName: string): GenericRecord | null { return this._readNullable(fieldName, FieldKind.COMPACT) as GenericRecord | null; }

    // ── nullable scalar reads ────────────────────────────────────────────────

    getNullableBoolean(fieldName: string): boolean | null { return this._readNullable(fieldName, FieldKind.NULLABLE_BOOLEAN) as boolean | null; }
    getNullableInt8(fieldName: string): number | null { return this._readNullable(fieldName, FieldKind.NULLABLE_INT8) as number | null; }
    getNullableInt16(fieldName: string): number | null { return this._readNullable(fieldName, FieldKind.NULLABLE_INT16) as number | null; }
    getNullableInt32(fieldName: string): number | null { return this._readNullable(fieldName, FieldKind.NULLABLE_INT32) as number | null; }
    getNullableInt64(fieldName: string): bigint | null { return this._readNullable(fieldName, FieldKind.NULLABLE_INT64) as bigint | null; }
    getNullableFloat32(fieldName: string): number | null { return this._readNullable(fieldName, FieldKind.NULLABLE_FLOAT32) as number | null; }
    getNullableFloat64(fieldName: string): number | null { return this._readNullable(fieldName, FieldKind.NULLABLE_FLOAT64) as number | null; }

    // ── array reads ─────────────────────────────────────────────────────────

    getArrayOfBoolean(fieldName: string): boolean[] | null { return this._readNullable(fieldName, FieldKind.ARRAY_OF_BOOLEAN) as boolean[] | null; }
    getArrayOfInt8(fieldName: string): Buffer | null { return this._readNullable(fieldName, FieldKind.ARRAY_OF_INT8) as Buffer | null; }
    getArrayOfInt16(fieldName: string): number[] | null { return this._readNullable(fieldName, FieldKind.ARRAY_OF_INT16) as number[] | null; }
    getArrayOfInt32(fieldName: string): number[] | null { return this._readNullable(fieldName, FieldKind.ARRAY_OF_INT32) as number[] | null; }
    getArrayOfInt64(fieldName: string): bigint[] | null { return this._readNullable(fieldName, FieldKind.ARRAY_OF_INT64) as bigint[] | null; }
    getArrayOfFloat32(fieldName: string): number[] | null { return this._readNullable(fieldName, FieldKind.ARRAY_OF_FLOAT32) as number[] | null; }
    getArrayOfFloat64(fieldName: string): number[] | null { return this._readNullable(fieldName, FieldKind.ARRAY_OF_FLOAT64) as number[] | null; }
    getArrayOfString(fieldName: string): (string | null)[] | null { return this._readNullable(fieldName, FieldKind.ARRAY_OF_STRING) as (string | null)[] | null; }
    getArrayOfDecimal(fieldName: string): (BigDecimal | null)[] | null { return this._readNullable(fieldName, FieldKind.ARRAY_OF_DECIMAL) as (BigDecimal | null)[] | null; }
    getArrayOfTime(fieldName: string): (LocalTime | null)[] | null { return this._readNullable(fieldName, FieldKind.ARRAY_OF_TIME) as (LocalTime | null)[] | null; }
    getArrayOfDate(fieldName: string): (LocalDate | null)[] | null { return this._readNullable(fieldName, FieldKind.ARRAY_OF_DATE) as (LocalDate | null)[] | null; }
    getArrayOfTimestamp(fieldName: string): (LocalDateTime | null)[] | null { return this._readNullable(fieldName, FieldKind.ARRAY_OF_TIMESTAMP) as (LocalDateTime | null)[] | null; }
    getArrayOfTimestampWithTimezone(fieldName: string): (OffsetDateTime | null)[] | null { return this._readNullable(fieldName, FieldKind.ARRAY_OF_TIMESTAMP_WITH_TIMEZONE) as (OffsetDateTime | null)[] | null; }
    getArrayOfGenericRecord(fieldName: string): (GenericRecord | null)[] | null { return this._readNullable(fieldName, FieldKind.ARRAY_OF_COMPACT) as (GenericRecord | null)[] | null; }

    getArrayOfNullableBoolean(fieldName: string): (boolean | null)[] | null { return this._readNullable(fieldName, FieldKind.ARRAY_OF_NULLABLE_BOOLEAN) as (boolean | null)[] | null; }
    getArrayOfNullableInt8(fieldName: string): (number | null)[] | null { return this._readNullable(fieldName, FieldKind.ARRAY_OF_NULLABLE_INT8) as (number | null)[] | null; }
    getArrayOfNullableInt16(fieldName: string): (number | null)[] | null { return this._readNullable(fieldName, FieldKind.ARRAY_OF_NULLABLE_INT16) as (number | null)[] | null; }
    getArrayOfNullableInt32(fieldName: string): (number | null)[] | null { return this._readNullable(fieldName, FieldKind.ARRAY_OF_NULLABLE_INT32) as (number | null)[] | null; }
    getArrayOfNullableInt64(fieldName: string): (bigint | null)[] | null { return this._readNullable(fieldName, FieldKind.ARRAY_OF_NULLABLE_INT64) as (bigint | null)[] | null; }
    getArrayOfNullableFloat32(fieldName: string): (number | null)[] | null { return this._readNullable(fieldName, FieldKind.ARRAY_OF_NULLABLE_FLOAT32) as (number | null)[] | null; }
    getArrayOfNullableFloat64(fieldName: string): (number | null)[] | null { return this._readNullable(fieldName, FieldKind.ARRAY_OF_NULLABLE_FLOAT64) as (number | null)[] | null; }

    // ── builder factories ────────────────────────────────────────────────────

    newBuilder(): GenericRecordBuilder {
        return new GenericRecordBuilderImpl(new Map(this._fields), new Map(), this._compact, this._typeName);
    }

    newBuilderWithClone(): GenericRecordBuilder {
        return new GenericRecordBuilderImpl(new Map(this._fields), new Map(this._values), this._compact, this._typeName);
    }

    // ── private helpers ──────────────────────────────────────────────────────

    private _read(fieldName: string, expectedKind: FieldKind): unknown {
        this._checkField(fieldName, expectedKind);
        const v = this._values.get(fieldName);
        if (v === undefined) {
            throw new GenericRecordError(`Field '${fieldName}' has no value set`);
        }
        return v;
    }

    private _readNullable(fieldName: string, expectedKind: FieldKind): unknown {
        this._checkField(fieldName, expectedKind);
        return this._values.get(fieldName) ?? null;
    }

    private _checkField(fieldName: string, expectedKind: FieldKind): void {
        const kind = this._fields.get(fieldName);
        if (kind === undefined) {
            throw new GenericRecordError(`No field named '${fieldName}' in GenericRecord`);
        }
        if (kind !== expectedKind) {
            throw new GenericRecordError(
                `Field '${fieldName}' has kind ${kind}, not ${expectedKind}`,
            );
        }
    }
}

// ── Builder implementation ────────────────────────────────────────────────────

export class GenericRecordBuilderImpl implements GenericRecordBuilder {
    private readonly _fields: Map<string, FieldKind>;
    private readonly _values: Map<string, unknown>;
    private readonly _compact: boolean;
    private readonly _typeName: string;

    constructor(
        fields: Map<string, FieldKind>,
        values: Map<string, unknown>,
        compact: boolean,
        typeName = 'GenericRecord',
    ) {
        this._fields = fields;
        this._values = values;
        this._compact = compact;
        this._typeName = typeName;
    }

    private _set(fieldName: string, kind: FieldKind, value: unknown): this {
        if (!this._fields.has(fieldName)) {
            this._fields.set(fieldName, kind);
        }
        this._values.set(fieldName, value);
        return this;
    }

    setBoolean(f: string, v: boolean): this { return this._set(f, FieldKind.BOOLEAN, v); }
    setInt8(f: string, v: number): this { return this._set(f, FieldKind.INT8, v); }
    setInt16(f: string, v: number): this { return this._set(f, FieldKind.INT16, v); }
    setInt32(f: string, v: number): this { return this._set(f, FieldKind.INT32, v); }
    setInt64(f: string, v: bigint): this { return this._set(f, FieldKind.INT64, v); }
    setFloat32(f: string, v: number): this { return this._set(f, FieldKind.FLOAT32, v); }
    setFloat64(f: string, v: number): this { return this._set(f, FieldKind.FLOAT64, v); }
    setString(f: string, v: string | null): this { return this._set(f, FieldKind.STRING, v); }
    setDecimal(f: string, v: BigDecimal | null): this { return this._set(f, FieldKind.DECIMAL, v); }
    setTime(f: string, v: LocalTime | null): this { return this._set(f, FieldKind.TIME, v); }
    setDate(f: string, v: LocalDate | null): this { return this._set(f, FieldKind.DATE, v); }
    setTimestamp(f: string, v: LocalDateTime | null): this { return this._set(f, FieldKind.TIMESTAMP, v); }
    setTimestampWithTimezone(f: string, v: OffsetDateTime | null): this { return this._set(f, FieldKind.TIMESTAMP_WITH_TIMEZONE, v); }
    setGenericRecord(f: string, v: GenericRecord | null): this { return this._set(f, FieldKind.COMPACT, v); }

    setNullableBoolean(f: string, v: boolean | null): this { return this._set(f, FieldKind.NULLABLE_BOOLEAN, v); }
    setNullableInt8(f: string, v: number | null): this { return this._set(f, FieldKind.NULLABLE_INT8, v); }
    setNullableInt16(f: string, v: number | null): this { return this._set(f, FieldKind.NULLABLE_INT16, v); }
    setNullableInt32(f: string, v: number | null): this { return this._set(f, FieldKind.NULLABLE_INT32, v); }
    setNullableInt64(f: string, v: bigint | null): this { return this._set(f, FieldKind.NULLABLE_INT64, v); }
    setNullableFloat32(f: string, v: number | null): this { return this._set(f, FieldKind.NULLABLE_FLOAT32, v); }
    setNullableFloat64(f: string, v: number | null): this { return this._set(f, FieldKind.NULLABLE_FLOAT64, v); }

    setArrayOfBoolean(f: string, v: boolean[] | null): this { return this._set(f, FieldKind.ARRAY_OF_BOOLEAN, v); }
    setArrayOfInt8(f: string, v: Buffer | null): this { return this._set(f, FieldKind.ARRAY_OF_INT8, v); }
    setArrayOfInt16(f: string, v: number[] | null): this { return this._set(f, FieldKind.ARRAY_OF_INT16, v); }
    setArrayOfInt32(f: string, v: number[] | null): this { return this._set(f, FieldKind.ARRAY_OF_INT32, v); }
    setArrayOfInt64(f: string, v: bigint[] | null): this { return this._set(f, FieldKind.ARRAY_OF_INT64, v); }
    setArrayOfFloat32(f: string, v: number[] | null): this { return this._set(f, FieldKind.ARRAY_OF_FLOAT32, v); }
    setArrayOfFloat64(f: string, v: number[] | null): this { return this._set(f, FieldKind.ARRAY_OF_FLOAT64, v); }
    setArrayOfString(f: string, v: (string | null)[] | null): this { return this._set(f, FieldKind.ARRAY_OF_STRING, v); }
    setArrayOfDecimal(f: string, v: (BigDecimal | null)[] | null): this { return this._set(f, FieldKind.ARRAY_OF_DECIMAL, v); }
    setArrayOfTime(f: string, v: (LocalTime | null)[] | null): this { return this._set(f, FieldKind.ARRAY_OF_TIME, v); }
    setArrayOfDate(f: string, v: (LocalDate | null)[] | null): this { return this._set(f, FieldKind.ARRAY_OF_DATE, v); }
    setArrayOfTimestamp(f: string, v: (LocalDateTime | null)[] | null): this { return this._set(f, FieldKind.ARRAY_OF_TIMESTAMP, v); }
    setArrayOfTimestampWithTimezone(f: string, v: (OffsetDateTime | null)[] | null): this { return this._set(f, FieldKind.ARRAY_OF_TIMESTAMP_WITH_TIMEZONE, v); }
    setArrayOfGenericRecord(f: string, v: (GenericRecord | null)[] | null): this { return this._set(f, FieldKind.ARRAY_OF_COMPACT, v); }

    setArrayOfNullableBoolean(f: string, v: (boolean | null)[] | null): this { return this._set(f, FieldKind.ARRAY_OF_NULLABLE_BOOLEAN, v); }
    setArrayOfNullableInt8(f: string, v: (number | null)[] | null): this { return this._set(f, FieldKind.ARRAY_OF_NULLABLE_INT8, v); }
    setArrayOfNullableInt16(f: string, v: (number | null)[] | null): this { return this._set(f, FieldKind.ARRAY_OF_NULLABLE_INT16, v); }
    setArrayOfNullableInt32(f: string, v: (number | null)[] | null): this { return this._set(f, FieldKind.ARRAY_OF_NULLABLE_INT32, v); }
    setArrayOfNullableInt64(f: string, v: (bigint | null)[] | null): this { return this._set(f, FieldKind.ARRAY_OF_NULLABLE_INT64, v); }
    setArrayOfNullableFloat32(f: string, v: (number | null)[] | null): this { return this._set(f, FieldKind.ARRAY_OF_NULLABLE_FLOAT32, v); }
    setArrayOfNullableFloat64(f: string, v: (number | null)[] | null): this { return this._set(f, FieldKind.ARRAY_OF_NULLABLE_FLOAT64, v); }

    build(): GenericRecord {
        return new GenericRecordImpl(new Map(this._fields), new Map(this._values), this._compact, this._typeName);
    }
}
