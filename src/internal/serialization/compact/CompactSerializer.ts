/**
 * Port of {@code com.hazelcast.internal.serialization.impl.compact.CompactStreamSerializer}.
 *
 * Compact serialization wire format (TYPE_COMPACT = -55):
 *
 * With schema (TYPE_COMPACT_WITH_SCHEMA = -56):
 *   [schemaId:long(8)][schema-inline][payload]
 *
 * Without schema (TYPE_COMPACT = -55 — schema looked up via SchemaService):
 *   [schemaId:long(8)][payload]
 *
 * Payload layout:
 *   [fixedDataLength:int]
 *   [fixedData: all fixed-size fields packed in declaration order]
 *   [variableData: all variable-size fields prefixed with 4-byte offset]
 *   [offsetTable: one 4-byte offset per variable-size field (relative to fixedDataLength)]
 *
 * Fixed-size fields (1, 2, 4, or 8 bytes):
 *   BOOLEAN = 1 bit (packed into bytes), INT8 = 1, INT16 = 2, INT32 = 4,
 *   INT64 = 8, FLOAT32 = 4, FLOAT64 = 8,
 *   NULLABLE_* fixed scalars: [nullFlag:byte][value?]
 *
 * Variable-size fields: strings, arrays, nested compact, temporal types.
 *
 * Boolean fields are bit-packed: groups of up to 8 booleans share one byte.
 *
 * Reference: Hazelcast Compact Binary Format Specification v1.0
 */

import { ByteArrayObjectDataInput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';
import { ByteArrayObjectDataOutput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput';
import { HazelcastSerializationError } from '@zenystx/helios-core/internal/serialization/impl/HazelcastSerializationError';
import { SerializationConstants } from '@zenystx/helios-core/internal/serialization/impl/SerializationConstants';
import type { SerializerAdapter } from '@zenystx/helios-core/internal/serialization/impl/SerializerAdapter';
import {
    FieldKind,
    GenericRecordBuilderImpl,
    GenericRecordImpl,
    type BigDecimal,
    type GenericRecord,
    type LocalDate,
    type LocalDateTime,
    type LocalTime,
    type OffsetDateTime,
} from '@zenystx/helios-core/internal/serialization/GenericRecord';
import {
    Schema,
    SchemaService,
    type SchemaField,
} from '@zenystx/helios-core/internal/serialization/compact/SchemaService';
import {
    readDecimalFromInput,
    readDateFromInput,
    readTimeFromInput,
    readTimestampFromInput,
    readTimestampWithTimezoneFromInput,
    writeDecimalToOutput,
    writeDateToOutput,
    writeTimeToOutput,
    writeTimestampToOutput,
    writeTimestampWithTimezoneToOutput,
} from '@zenystx/helios-core/internal/serialization/portable/PortableSerializer';

// ── Field size classification ─────────────────────────────────────────────────

/** Returns the fixed byte width of a kind, or 0 for variable-size fields. */
function fixedSizeInBytes(kind: FieldKind): number {
    switch (kind) {
        case FieldKind.BOOLEAN:          return 0; // bit-packed, handled separately
        case FieldKind.INT8:             return 1;
        case FieldKind.INT16:            return 2;
        case FieldKind.INT32:            return 4;
        case FieldKind.INT64:            return 8;
        case FieldKind.FLOAT32:          return 4;
        case FieldKind.FLOAT64:          return 8;
        case FieldKind.NULLABLE_BOOLEAN: return 0; // variable (null flag + 1 byte)
        case FieldKind.NULLABLE_INT8:    return 0; // variable
        case FieldKind.NULLABLE_INT16:   return 0; // variable
        case FieldKind.NULLABLE_INT32:   return 0; // variable
        case FieldKind.NULLABLE_INT64:   return 0; // variable
        case FieldKind.NULLABLE_FLOAT32: return 0; // variable
        case FieldKind.NULLABLE_FLOAT64: return 0; // variable
        default:                         return 0; // variable
    }
}

function isFixedSize(kind: FieldKind): boolean {
    switch (kind) {
        case FieldKind.INT8:
        case FieldKind.INT16:
        case FieldKind.INT32:
        case FieldKind.INT64:
        case FieldKind.FLOAT32:
        case FieldKind.FLOAT64:
            return true;
        default:
            return false;
    }
}

function isBooleanKind(kind: FieldKind): boolean {
    return kind === FieldKind.BOOLEAN;
}

// ── Compact object interface ──────────────────────────────────────────────────

export interface CompactSerializable<T = unknown> {
    read(reader: CompactReader): T;
    write(writer: CompactWriter, object: T): void;
    getTypeName(): string;
    getClass(): new (...args: unknown[]) => T;
}

// ── CompactWriter ─────────────────────────────────────────────────────────────

/**
 * Stateful writer for a single Compact record.
 *
 * Gathers all field values, then on {@link CompactWriter.end} flushes them
 * to the underlying output in the compact wire format.
 */
export class CompactWriter {
    private readonly _schema: Schema;
    private readonly _out: ByteArrayObjectDataOutput;
    private readonly _serializer: CompactStreamSerializer;

    /** Fixed-size field values by field index */
    private readonly _fixedValues: (unknown)[];
    /** Variable-size field values by field index */
    private readonly _varValues: (unknown)[];
    /** Boolean bit positions: [fieldIndex] → bit offset within the boolean area */
    private readonly _booleanBitPositions: Map<number, number>;
    private readonly _fixedFieldIndices: number[];
    private readonly _booleanFieldIndices: number[];
    private readonly _varFieldIndices: number[];

    constructor(schema: Schema, out: ByteArrayObjectDataOutput, serializer: CompactStreamSerializer) {
        this._schema = schema;
        this._out = out;
        this._serializer = serializer;

        this._fixedFieldIndices = [];
        this._booleanFieldIndices = [];
        this._varFieldIndices = [];
        this._booleanBitPositions = new Map();
        this._fixedValues = new Array(schema.getFieldCount());
        this._varValues = new Array(schema.getFieldCount());

        let boolBit = 0;
        for (let i = 0; i < schema.getFieldCount(); i++) {
            const field = schema.fields[i];
            if (isBooleanKind(field.kind)) {
                this._booleanFieldIndices.push(i);
                this._booleanBitPositions.set(i, boolBit++);
            } else if (isFixedSize(field.kind)) {
                this._fixedFieldIndices.push(i);
            } else {
                this._varFieldIndices.push(i);
            }
        }
    }

    // ── write methods ────────────────────────────────────────────────────────

    writeBoolean(fieldName: string, value: boolean): void {
        this._fixedValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeInt8(fieldName: string, value: number): void {
        this._fixedValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeInt16(fieldName: string, value: number): void {
        this._fixedValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeInt32(fieldName: string, value: number): void {
        this._fixedValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeInt64(fieldName: string, value: bigint): void {
        this._fixedValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeFloat32(fieldName: string, value: number): void {
        this._fixedValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeFloat64(fieldName: string, value: number): void {
        this._fixedValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeString(fieldName: string, value: string | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeDecimal(fieldName: string, value: BigDecimal | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeTime(fieldName: string, value: LocalTime | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeDate(fieldName: string, value: LocalDate | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeTimestamp(fieldName: string, value: LocalDateTime | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeTimestampWithTimezone(fieldName: string, value: OffsetDateTime | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeCompact<T>(fieldName: string, value: T | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeNullableBoolean(fieldName: string, value: boolean | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeNullableInt8(fieldName: string, value: number | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeNullableInt16(fieldName: string, value: number | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeNullableInt32(fieldName: string, value: number | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeNullableInt64(fieldName: string, value: bigint | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeNullableFloat32(fieldName: string, value: number | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeNullableFloat64(fieldName: string, value: number | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeArrayOfBoolean(fieldName: string, value: boolean[] | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeArrayOfInt8(fieldName: string, value: Buffer | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeArrayOfInt16(fieldName: string, value: number[] | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeArrayOfInt32(fieldName: string, value: number[] | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeArrayOfInt64(fieldName: string, value: bigint[] | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeArrayOfFloat32(fieldName: string, value: number[] | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeArrayOfFloat64(fieldName: string, value: number[] | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeArrayOfString(fieldName: string, value: (string | null)[] | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeArrayOfDecimal(fieldName: string, value: (BigDecimal | null)[] | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeArrayOfTime(fieldName: string, value: (LocalTime | null)[] | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeArrayOfDate(fieldName: string, value: (LocalDate | null)[] | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeArrayOfTimestamp(fieldName: string, value: (LocalDateTime | null)[] | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeArrayOfTimestampWithTimezone(fieldName: string, value: (OffsetDateTime | null)[] | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeArrayOfCompact<T>(fieldName: string, value: (T | null)[] | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeArrayOfNullableBoolean(fieldName: string, value: (boolean | null)[] | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeArrayOfNullableInt8(fieldName: string, value: (number | null)[] | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeArrayOfNullableInt16(fieldName: string, value: (number | null)[] | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeArrayOfNullableInt32(fieldName: string, value: (number | null)[] | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeArrayOfNullableInt64(fieldName: string, value: (bigint | null)[] | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeArrayOfNullableFloat32(fieldName: string, value: (number | null)[] | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    writeArrayOfNullableFloat64(fieldName: string, value: (number | null)[] | null): void {
        this._varValues[this._schema.getFieldIndex(fieldName)] = value;
    }

    /**
     * Flush all collected values to the output stream in Compact wire format.
     *
     * Layout:
     *   [fixedDataLength:int]
     *   [booleanBytes: ceil(boolCount/8)]
     *   [fixedFields in order: 1/2/4/8 bytes each]
     *   [varFields in order, each: [length:int][-1=null|data]]
     *   [offsetTable: varFieldCount * int, offsets relative to start of var-data area]
     */
    end(): void {
        const out = this._out;

        // ── 1. Fixed-size section ────────────────────────────────────────────
        // We need to know the total fixed size before writing it, so use a temp buffer
        const fixedOut = new ByteArrayObjectDataOutput(64, null, out.getByteOrder());

        // Boolean bits packed into bytes
        const boolCount = this._booleanFieldIndices.length;
        if (boolCount > 0) {
            const boolBytes = Math.ceil(boolCount / 8);
            const packed = new Uint8Array(boolBytes);
            for (let i = 0; i < boolCount; i++) {
                const fieldIdx = this._booleanFieldIndices[i];
                const bitPos = this._booleanBitPositions.get(fieldIdx)!;
                const v = this._fixedValues[fieldIdx] as boolean | undefined;
                if (v) {
                    packed[Math.floor(bitPos / 8)] |= (1 << (bitPos % 8));
                }
            }
            for (let i = 0; i < boolBytes; i++) fixedOut.writeByte(packed[i]);
        }

        // Fixed numeric fields
        for (const idx of this._fixedFieldIndices) {
            const field = this._schema.fields[idx];
            const v = this._fixedValues[idx];
            writeFixedField(fixedOut, field, v);
        }

        const fixedDataLength = fixedOut.pos;

        // ── 2. Variable-size section ─────────────────────────────────────────
        const varOut = new ByteArrayObjectDataOutput(256, null, out.getByteOrder());
        const varOffsets: number[] = [];

        for (const idx of this._varFieldIndices) {
            varOffsets.push(varOut.pos);
            const field = this._schema.fields[idx];
            const v = this._varValues[idx];
            writeVarField(varOut, field, v, this._serializer);
        }

        // ── 3. Write to main output ──────────────────────────────────────────
        out.writeInt(fixedDataLength);
        out.writeBytes(fixedOut.buffer, 0, fixedOut.pos);
        out.writeBytes(varOut.buffer, 0, varOut.pos);

        // Offset table (one int per variable field, relative to var-data start)
        for (const offset of varOffsets) {
            out.writeInt(offset);
        }
    }
}

// ── CompactReader ─────────────────────────────────────────────────────────────

export class CompactReader {
    private readonly _inp: ByteArrayObjectDataInput;
    private readonly _schema: Schema;
    private readonly _serializer: CompactStreamSerializer;

    /** Absolute position of the first byte of the fixed-data area. */
    private readonly _fixedDataStart: number;
    /** Absolute position of the first byte of the variable-data area. */
    private readonly _varDataStart: number;
    /** Absolute position of the offset table (end of var data). */
    private readonly _offsetTableStart: number;
    /** End position of the full compact record. */
    private readonly _dataEnd: number;

    /** Variable field indices (in schema order). */
    private readonly _varFieldIndices: number[];
    /** Fixed non-boolean field indices. */
    private readonly _fixedFieldIndices: number[];

    /** Cumulative byte offset of each fixed non-boolean field within the fixed area. */
    private readonly _fixedOffsets: number[];
    /** Bit position of each boolean field within the packed boolean area. */
    private readonly _boolBitPositions: Map<number, number>;
    /** Number of bytes used by packed booleans at the start of fixed area. */
    private readonly _boolByteCount: number;

    constructor(
        inp: ByteArrayObjectDataInput,
        schema: Schema,
        serializer: CompactStreamSerializer,
        fixedDataStart: number,
        varDataStart: number,
        offsetTableStart: number,
        dataEnd: number,
    ) {
        this._inp = inp;
        this._schema = schema;
        this._serializer = serializer;
        this._fixedDataStart = fixedDataStart;
        this._varDataStart = varDataStart;
        this._offsetTableStart = offsetTableStart;
        this._dataEnd = dataEnd;

        this._varFieldIndices = [];
        this._fixedFieldIndices = [];
        this._fixedOffsets = [];
        this._boolBitPositions = new Map();

        let boolBit = 0;
        let fixedOffset = 0;
        const booleans: number[] = [];

        for (let i = 0; i < schema.getFieldCount(); i++) {
            const field = schema.fields[i];
            if (isBooleanKind(field.kind)) {
                booleans.push(i);
                this._boolBitPositions.set(i, boolBit++);
            } else if (isFixedSize(field.kind)) {
                this._fixedFieldIndices.push(i);
                this._fixedOffsets.push(fixedOffset);
                fixedOffset += fixedSizeInBytes(field.kind);
            } else {
                this._varFieldIndices.push(i);
            }
        }
        this._boolByteCount = booleans.length > 0 ? Math.ceil(booleans.length / 8) : 0;
    }

    /** Ordinal of a var field among all var fields (for offset table lookup). */
    private _varOrdinal(fieldIndex: number): number {
        return this._varFieldIndices.indexOf(fieldIndex);
    }

    private _readVarOffset(varOrdinal: number): number {
        if (this._offsetTableStart === 0) {
            throw new HazelcastSerializationError('CompactReader not fully initialised');
        }
        return this._inp.readInt(this._offsetTableStart + varOrdinal * 4);
    }

    private _seekToFixed(fieldIndex: number): void {
        const fixedOrdinal = this._fixedFieldIndices.indexOf(fieldIndex);
        if (fixedOrdinal < 0) {
            throw new HazelcastSerializationError(`Field ${fieldIndex} is not a fixed field`);
        }
        // Booleans are packed at the start of fixed area; fixed scalars follow
        const pos = this._fixedDataStart + this._boolByteCount + this._fixedOffsets[fixedOrdinal];
        this._inp.position(pos);
    }

    private _seekToVar(fieldName: string): void {
        const fieldIndex = this._schema.getFieldIndex(fieldName);
        const varOrdinal = this._varOrdinal(fieldIndex);
        const offset = this._readVarOffset(varOrdinal);
        this._inp.position(this._varDataStart + offset);
    }

    private _boolAt(fieldName: string): boolean {
        const fieldIndex = this._schema.getFieldIndex(fieldName);
        const bitPos = this._boolBitPositions.get(fieldIndex);
        if (bitPos === undefined) {
            throw new HazelcastSerializationError(`Field '${fieldName}' is not a BOOLEAN field`);
        }
        const bytePos = this._fixedDataStart + Math.floor(bitPos / 8);
        const byte_ = this._inp.readByte(bytePos) & 0xff;
        return ((byte_ >> (bitPos % 8)) & 1) === 1;
    }

    // ── read methods ─────────────────────────────────────────────────────────

    readBoolean(fieldName: string): boolean {
        return this._boolAt(fieldName);
    }

    readInt8(fieldName: string): number {
        const idx = this._schema.getFieldIndex(fieldName);
        this._seekToFixed(idx);
        return this._inp.readByte();
    }

    readInt16(fieldName: string): number {
        const idx = this._schema.getFieldIndex(fieldName);
        this._seekToFixed(idx);
        return this._inp.readShort();
    }

    readInt32(fieldName: string): number {
        const idx = this._schema.getFieldIndex(fieldName);
        this._seekToFixed(idx);
        return this._inp.readInt();
    }

    readInt64(fieldName: string): bigint {
        const idx = this._schema.getFieldIndex(fieldName);
        this._seekToFixed(idx);
        return this._inp.readLong();
    }

    readFloat32(fieldName: string): number {
        const idx = this._schema.getFieldIndex(fieldName);
        this._seekToFixed(idx);
        return this._inp.readFloat();
    }

    readFloat64(fieldName: string): number {
        const idx = this._schema.getFieldIndex(fieldName);
        this._seekToFixed(idx);
        return this._inp.readDouble();
    }

    readString(fieldName: string): string | null {
        this._seekToVar(fieldName);
        return this._inp.readString();
    }

    readDecimal(fieldName: string): BigDecimal | null {
        this._seekToVar(fieldName);
        return readDecimalFromInput(this._inp);
    }

    readTime(fieldName: string): LocalTime | null {
        this._seekToVar(fieldName);
        return readTimeFromInput(this._inp);
    }

    readDate(fieldName: string): LocalDate | null {
        this._seekToVar(fieldName);
        return readDateFromInput(this._inp);
    }

    readTimestamp(fieldName: string): LocalDateTime | null {
        this._seekToVar(fieldName);
        return readTimestampFromInput(this._inp);
    }

    readTimestampWithTimezone(fieldName: string): OffsetDateTime | null {
        this._seekToVar(fieldName);
        return readTimestampWithTimezoneFromInput(this._inp);
    }

    readCompact<T>(fieldName: string): T | null {
        this._seekToVar(fieldName);
        return this._serializer.readNestedCompact<T>(this._inp);
    }

    readNullableBoolean(fieldName: string): boolean | null {
        this._seekToVar(fieldName);
        return readNullable(this._inp, () => this._inp.readBoolean());
    }

    readNullableInt8(fieldName: string): number | null {
        this._seekToVar(fieldName);
        return readNullable(this._inp, () => this._inp.readByte());
    }

    readNullableInt16(fieldName: string): number | null {
        this._seekToVar(fieldName);
        return readNullable(this._inp, () => this._inp.readShort());
    }

    readNullableInt32(fieldName: string): number | null {
        this._seekToVar(fieldName);
        return readNullable(this._inp, () => this._inp.readInt());
    }

    readNullableInt64(fieldName: string): bigint | null {
        this._seekToVar(fieldName);
        return readNullable(this._inp, () => this._inp.readLong());
    }

    readNullableFloat32(fieldName: string): number | null {
        this._seekToVar(fieldName);
        return readNullable(this._inp, () => this._inp.readFloat());
    }

    readNullableFloat64(fieldName: string): number | null {
        this._seekToVar(fieldName);
        return readNullable(this._inp, () => this._inp.readDouble());
    }

    readArrayOfBoolean(fieldName: string): boolean[] | null {
        this._seekToVar(fieldName);
        return readBooleanArray(this._inp);
    }

    readArrayOfInt8(fieldName: string): Buffer | null {
        this._seekToVar(fieldName);
        return this._inp.readByteArray();
    }

    readArrayOfInt16(fieldName: string): number[] | null {
        this._seekToVar(fieldName);
        return this._inp.readShortArray();
    }

    readArrayOfInt32(fieldName: string): number[] | null {
        this._seekToVar(fieldName);
        return this._inp.readIntArray();
    }

    readArrayOfInt64(fieldName: string): bigint[] | null {
        this._seekToVar(fieldName);
        return this._inp.readLongArray();
    }

    readArrayOfFloat32(fieldName: string): number[] | null {
        this._seekToVar(fieldName);
        return this._inp.readFloatArray();
    }

    readArrayOfFloat64(fieldName: string): number[] | null {
        this._seekToVar(fieldName);
        return this._inp.readDoubleArray();
    }

    readArrayOfString(fieldName: string): (string | null)[] | null {
        this._seekToVar(fieldName);
        return readNullableArray(this._inp, () => this._inp.readString());
    }

    readArrayOfDecimal(fieldName: string): (BigDecimal | null)[] | null {
        this._seekToVar(fieldName);
        return readNullableArray(this._inp, () => readDecimalFromInput(this._inp));
    }

    readArrayOfTime(fieldName: string): (LocalTime | null)[] | null {
        this._seekToVar(fieldName);
        return readNullableArray(this._inp, () => readTimeFromInput(this._inp));
    }

    readArrayOfDate(fieldName: string): (LocalDate | null)[] | null {
        this._seekToVar(fieldName);
        return readNullableArray(this._inp, () => readDateFromInput(this._inp));
    }

    readArrayOfTimestamp(fieldName: string): (LocalDateTime | null)[] | null {
        this._seekToVar(fieldName);
        return readNullableArray(this._inp, () => readTimestampFromInput(this._inp));
    }

    readArrayOfTimestampWithTimezone(fieldName: string): (OffsetDateTime | null)[] | null {
        this._seekToVar(fieldName);
        return readNullableArray(this._inp, () => readTimestampWithTimezoneFromInput(this._inp));
    }

    readArrayOfCompact<T>(fieldName: string): (T | null)[] | null {
        this._seekToVar(fieldName);
        return readNullableArray(this._inp, () => this._serializer.readNestedCompact<T>(this._inp));
    }

    readArrayOfNullableBoolean(fieldName: string): (boolean | null)[] | null {
        this._seekToVar(fieldName);
        return readNullableArray(this._inp, () => readNullable(this._inp, () => this._inp.readBoolean()));
    }

    readArrayOfNullableInt8(fieldName: string): (number | null)[] | null {
        this._seekToVar(fieldName);
        return readNullableArray(this._inp, () => readNullable(this._inp, () => this._inp.readByte()));
    }

    readArrayOfNullableInt16(fieldName: string): (number | null)[] | null {
        this._seekToVar(fieldName);
        return readNullableArray(this._inp, () => readNullable(this._inp, () => this._inp.readShort()));
    }

    readArrayOfNullableInt32(fieldName: string): (number | null)[] | null {
        this._seekToVar(fieldName);
        return readNullableArray(this._inp, () => readNullable(this._inp, () => this._inp.readInt()));
    }

    readArrayOfNullableInt64(fieldName: string): (bigint | null)[] | null {
        this._seekToVar(fieldName);
        return readNullableArray(this._inp, () => readNullable(this._inp, () => this._inp.readLong()));
    }

    readArrayOfNullableFloat32(fieldName: string): (number | null)[] | null {
        this._seekToVar(fieldName);
        return readNullableArray(this._inp, () => readNullable(this._inp, () => this._inp.readFloat()));
    }

    readArrayOfNullableFloat64(fieldName: string): (number | null)[] | null {
        this._seekToVar(fieldName);
        return readNullableArray(this._inp, () => readNullable(this._inp, () => this._inp.readDouble()));
    }

    /** Advance the stream past the entire compact record. */
    advance(): void {
        if (this._dataEnd > 0) {
            this._inp.position(this._dataEnd);
        }
    }
}

// ── CompactStreamSerializer ───────────────────────────────────────────────────

/**
 * The central Compact serialization coordinator.
 * Handles SerializerAdapter dispatch for typeId -55 (TYPE_COMPACT)
 * and typeId -56 (TYPE_COMPACT_WITH_SCHEMA).
 *
 * User-registered serializers ({@link CompactSerializable}) are dispatched
 * based on the class constructor.  Unregistered objects fall back to
 * GenericRecord-based deserialization.
 */
export class CompactStreamSerializer implements SerializerAdapter {
    private readonly _schemaService: SchemaService;
    private readonly _serializersByClass = new Map<Function, CompactSerializable<unknown>>();
    private readonly _serializersByTypeName = new Map<string, CompactSerializable<unknown>>();
    private readonly _schemasByClass = new Map<Function, Schema>();

    constructor(schemaService: SchemaService) {
        this._schemaService = schemaService;
    }

    /**
     * Register a user-defined compact serializer.
     * The schema will be auto-derived from the first write() call
     * if not pre-registered.
     */
    registerSerializer<T>(serializer: CompactSerializable<T>): void {
        const cls = serializer.getClass() as unknown as Function;
        this._serializersByClass.set(cls, serializer as CompactSerializable<unknown>);
        this._serializersByTypeName.set(serializer.getTypeName(), serializer as CompactSerializable<unknown>);
    }

    /**
     * Pre-register a schema. If not called, the schema will be inferred
     * on the first serialization.
     */
    registerSchema(schema: Schema): void {
        this._schemaService.registerSchema(schema);
    }

    getTypeId(): number {
        return SerializationConstants.TYPE_COMPACT;
    }

    write(out: ByteArrayObjectDataOutput, obj: unknown): void {
        const cls = (obj as object).constructor as Function;
        const serializer = this._serializersByClass.get(cls);
        if (!serializer) {
            throw new HazelcastSerializationError(
                `No CompactSerializable registered for class '${cls.name}'. ` +
                'Register a serializer via CompactStreamSerializer.registerSerializer().',
            );
        }

        let schema = this._schemasByClass.get(cls);
        if (!schema) {
            schema = this._buildSchema(serializer, obj);
            this._schemasByClass.set(cls, schema);
            this._schemaService.registerSchema(schema);
        }

        // Write: [schemaId:long(8)][compact-payload]
        out.writeLong(schema.schemaId);
        const writer = new CompactWriter(schema, out, this);
        serializer.write(writer, obj);
        writer.end();
    }

    read(inp: ByteArrayObjectDataInput): unknown {
        const schemaId = inp.readLong();

        const schema = this._schemaService.getSchema(schemaId);
        if (!schema) {
            throw new HazelcastSerializationError(
                `Schema not found for ID ${schemaId}. ` +
                'Ensure the schema is registered before deserializing (use SchemaService.registerSchema).',
            );
        }

        return this._readWithSchema(inp, schema);
    }

    /** Read a nested compact object (schema ID was already written by the outer writer). */
    readNestedCompact<T>(inp: ByteArrayObjectDataInput): T | null {
        const schemaId = inp.readLong();
        if (schemaId === 0n) return null;

        const schema = this._schemaService.getSchema(schemaId);
        if (!schema) {
            throw new HazelcastSerializationError(
                `Nested compact schema not found for ID ${schemaId}.`,
            );
        }
        return this._readWithSchema(inp, schema) as T;
    }

    /** Write a nested compact object (no type header, just schemaId + payload). */
    writeNestedCompact<T>(out: ByteArrayObjectDataOutput, obj: T | null): void {
        if (obj === null) {
            out.writeLong(0n);
            return;
        }
        this.write(out, obj);
    }

    private _readWithSchema(inp: ByteArrayObjectDataInput, schema: Schema): unknown {
        const serializer = this._serializersByTypeName.get(schema.typeName);

        // 1. Read fixed-data length and compute section positions
        const fixedDataLength = inp.readInt();
        const fixedDataStart = inp.position();

        // Var fields are all fields that are neither fixed-size scalars nor booleans
        const varFields = schema.fields.filter(f => !isFixedSize(f.kind) && !isBooleanKind(f.kind));
        const varFieldCount = varFields.length;
        const varDataStart = fixedDataStart + fixedDataLength;

        // 2. Sequentially scan through variable-size fields to locate
        //    the offset table (which lives at the end of var data).
        //    We record each field's start offset relative to varDataStart
        //    so that buildGenericRecord can use them for random-access.
        inp.position(varDataStart);
        const varFieldStartOffsets: number[] = [];
        for (let vi = 0; vi < varFieldCount; vi++) {
            varFieldStartOffsets.push(inp.position() - varDataStart);
            skipVarField(inp, varFields[vi], this);
        }
        const offsetTableStart = inp.position();
        // The offset table itself is varFieldCount * 4 bytes; skip it
        const dataEnd = offsetTableStart + varFieldCount * 4;

        // 3. Build a fully-initialised CompactReader
        const reader = new CompactReader(inp, schema, this, fixedDataStart, varDataStart, offsetTableStart, dataEnd);

        if (serializer) {
            const result = serializer.read(reader);
            inp.position(dataEnd);
            return result;
        }

        // No registered serializer — materialise a GenericRecord
        const genericRecord = buildGenericRecord(
            inp, schema, this,
            fixedDataStart, fixedDataLength,
            varDataStart, varFieldStartOffsets, offsetTableStart,
        );
        inp.position(dataEnd);
        return genericRecord;
    }

    private _buildSchema<T>(serializer: CompactSerializable<T>, obj: T): Schema {
        // Dry-run write to capture field names and kinds
        const fields: SchemaField[] = [];
        const captureOut = new ByteArrayObjectDataOutput(256, null, 'BE');
        const captureWriter = new _SchemaCapturingWriter(fields, captureOut, this);
        serializer.write(captureWriter as unknown as CompactWriter, obj);
        return new Schema(serializer.getTypeName(), fields);
    }
}

// ── Schema-capturing writer (dry run) ─────────────────────────────────────────

class _SchemaCapturingWriter {
    private readonly _fields: SchemaField[];
    private readonly _seen = new Set<string>();

    constructor(fields: SchemaField[], _out: ByteArrayObjectDataOutput, _serializer: CompactStreamSerializer) {
        this._fields = fields;
    }

    private _capture(fieldName: string, kind: FieldKind): void {
        if (!this._seen.has(fieldName)) {
            this._seen.add(fieldName);
            this._fields.push({ fieldName, kind });
        }
    }

    end(): void { /* no-op for schema capture */ }

    writeBoolean(f: string, _v: boolean): void { this._capture(f, FieldKind.BOOLEAN); }
    writeInt8(f: string, _v: number): void { this._capture(f, FieldKind.INT8); }
    writeInt16(f: string, _v: number): void { this._capture(f, FieldKind.INT16); }
    writeInt32(f: string, _v: number): void { this._capture(f, FieldKind.INT32); }
    writeInt64(f: string, _v: bigint): void { this._capture(f, FieldKind.INT64); }
    writeFloat32(f: string, _v: number): void { this._capture(f, FieldKind.FLOAT32); }
    writeFloat64(f: string, _v: number): void { this._capture(f, FieldKind.FLOAT64); }
    writeString(f: string, _v: string | null): void { this._capture(f, FieldKind.STRING); }
    writeDecimal(f: string, _v: BigDecimal | null): void { this._capture(f, FieldKind.DECIMAL); }
    writeTime(f: string, _v: LocalTime | null): void { this._capture(f, FieldKind.TIME); }
    writeDate(f: string, _v: LocalDate | null): void { this._capture(f, FieldKind.DATE); }
    writeTimestamp(f: string, _v: LocalDateTime | null): void { this._capture(f, FieldKind.TIMESTAMP); }
    writeTimestampWithTimezone(f: string, _v: OffsetDateTime | null): void { this._capture(f, FieldKind.TIMESTAMP_WITH_TIMEZONE); }
    writeCompact<T>(f: string, _v: T | null): void { this._capture(f, FieldKind.COMPACT); }
    writeNullableBoolean(f: string, _v: boolean | null): void { this._capture(f, FieldKind.NULLABLE_BOOLEAN); }
    writeNullableInt8(f: string, _v: number | null): void { this._capture(f, FieldKind.NULLABLE_INT8); }
    writeNullableInt16(f: string, _v: number | null): void { this._capture(f, FieldKind.NULLABLE_INT16); }
    writeNullableInt32(f: string, _v: number | null): void { this._capture(f, FieldKind.NULLABLE_INT32); }
    writeNullableInt64(f: string, _v: bigint | null): void { this._capture(f, FieldKind.NULLABLE_INT64); }
    writeNullableFloat32(f: string, _v: number | null): void { this._capture(f, FieldKind.NULLABLE_FLOAT32); }
    writeNullableFloat64(f: string, _v: number | null): void { this._capture(f, FieldKind.NULLABLE_FLOAT64); }
    writeArrayOfBoolean(f: string, _v: boolean[] | null): void { this._capture(f, FieldKind.ARRAY_OF_BOOLEAN); }
    writeArrayOfInt8(f: string, _v: Buffer | null): void { this._capture(f, FieldKind.ARRAY_OF_INT8); }
    writeArrayOfInt16(f: string, _v: number[] | null): void { this._capture(f, FieldKind.ARRAY_OF_INT16); }
    writeArrayOfInt32(f: string, _v: number[] | null): void { this._capture(f, FieldKind.ARRAY_OF_INT32); }
    writeArrayOfInt64(f: string, _v: bigint[] | null): void { this._capture(f, FieldKind.ARRAY_OF_INT64); }
    writeArrayOfFloat32(f: string, _v: number[] | null): void { this._capture(f, FieldKind.ARRAY_OF_FLOAT32); }
    writeArrayOfFloat64(f: string, _v: number[] | null): void { this._capture(f, FieldKind.ARRAY_OF_FLOAT64); }
    writeArrayOfString(f: string, _v: (string | null)[] | null): void { this._capture(f, FieldKind.ARRAY_OF_STRING); }
    writeArrayOfDecimal(f: string, _v: (BigDecimal | null)[] | null): void { this._capture(f, FieldKind.ARRAY_OF_DECIMAL); }
    writeArrayOfTime(f: string, _v: (LocalTime | null)[] | null): void { this._capture(f, FieldKind.ARRAY_OF_TIME); }
    writeArrayOfDate(f: string, _v: (LocalDate | null)[] | null): void { this._capture(f, FieldKind.ARRAY_OF_DATE); }
    writeArrayOfTimestamp(f: string, _v: (LocalDateTime | null)[] | null): void { this._capture(f, FieldKind.ARRAY_OF_TIMESTAMP); }
    writeArrayOfTimestampWithTimezone(f: string, _v: (OffsetDateTime | null)[] | null): void { this._capture(f, FieldKind.ARRAY_OF_TIMESTAMP_WITH_TIMEZONE); }
    writeArrayOfCompact<T>(f: string, _v: (T | null)[] | null): void { this._capture(f, FieldKind.ARRAY_OF_COMPACT); }
    writeArrayOfNullableBoolean(f: string, _v: (boolean | null)[] | null): void { this._capture(f, FieldKind.ARRAY_OF_NULLABLE_BOOLEAN); }
    writeArrayOfNullableInt8(f: string, _v: (number | null)[] | null): void { this._capture(f, FieldKind.ARRAY_OF_NULLABLE_INT8); }
    writeArrayOfNullableInt16(f: string, _v: (number | null)[] | null): void { this._capture(f, FieldKind.ARRAY_OF_NULLABLE_INT16); }
    writeArrayOfNullableInt32(f: string, _v: (number | null)[] | null): void { this._capture(f, FieldKind.ARRAY_OF_NULLABLE_INT32); }
    writeArrayOfNullableInt64(f: string, _v: (bigint | null)[] | null): void { this._capture(f, FieldKind.ARRAY_OF_NULLABLE_INT64); }
    writeArrayOfNullableFloat32(f: string, _v: (number | null)[] | null): void { this._capture(f, FieldKind.ARRAY_OF_NULLABLE_FLOAT32); }
    writeArrayOfNullableFloat64(f: string, _v: (number | null)[] | null): void { this._capture(f, FieldKind.ARRAY_OF_NULLABLE_FLOAT64); }
}

// ── Wire-format helpers ───────────────────────────────────────────────────────

function writeFixedField(out: ByteArrayObjectDataOutput, field: SchemaField, v: unknown): void {
    switch (field.kind) {
        case FieldKind.INT8:    out.writeByte(v as number); break;
        case FieldKind.INT16:   out.writeShort(v as number); break;
        case FieldKind.INT32:   out.writeInt(v as number); break;
        case FieldKind.INT64:   out.writeLong(v as bigint); break;
        case FieldKind.FLOAT32: out.writeFloat(v as number); break;
        case FieldKind.FLOAT64: out.writeDouble(v as number); break;
        default: break;
    }
}

function writeVarField(
    out: ByteArrayObjectDataOutput,
    field: SchemaField,
    v: unknown,
    serializer: CompactStreamSerializer,
): void {
    switch (field.kind) {
        case FieldKind.STRING:
            out.writeString(v as string | null);
            break;
        case FieldKind.DECIMAL:
            writeDecimalToOutput(out, v as BigDecimal | null);
            break;
        case FieldKind.TIME:
            writeTimeToOutput(out, v as LocalTime | null);
            break;
        case FieldKind.DATE:
            writeDateToOutput(out, v as LocalDate | null);
            break;
        case FieldKind.TIMESTAMP:
            writeTimestampToOutput(out, v as LocalDateTime | null);
            break;
        case FieldKind.TIMESTAMP_WITH_TIMEZONE:
            writeTimestampWithTimezoneToOutput(out, v as OffsetDateTime | null);
            break;
        case FieldKind.COMPACT:
        case FieldKind.ARRAY_OF_COMPACT:
            serializer.writeNestedCompact(out, v);
            break;
        case FieldKind.NULLABLE_BOOLEAN:
            writeNullable(out, v as boolean | null, (o, n) => o.writeBoolean(n));
            break;
        case FieldKind.NULLABLE_INT8:
            writeNullable(out, v as number | null, (o, n) => o.writeByte(n));
            break;
        case FieldKind.NULLABLE_INT16:
            writeNullable(out, v as number | null, (o, n) => o.writeShort(n));
            break;
        case FieldKind.NULLABLE_INT32:
            writeNullable(out, v as number | null, (o, n) => o.writeInt(n));
            break;
        case FieldKind.NULLABLE_INT64:
            writeNullable(out, v as bigint | null, (o, n) => o.writeLong(n));
            break;
        case FieldKind.NULLABLE_FLOAT32:
            writeNullable(out, v as number | null, (o, n) => o.writeFloat(n));
            break;
        case FieldKind.NULLABLE_FLOAT64:
            writeNullable(out, v as number | null, (o, n) => o.writeDouble(n));
            break;
        case FieldKind.ARRAY_OF_BOOLEAN:
            writeBooleanArray(out, v as boolean[] | null);
            break;
        case FieldKind.ARRAY_OF_INT8:
            out.writeByteArray(v as Buffer | null);
            break;
        case FieldKind.ARRAY_OF_INT16:
            out.writeShortArray(v as number[] | null);
            break;
        case FieldKind.ARRAY_OF_INT32:
            out.writeIntArray(v as number[] | null);
            break;
        case FieldKind.ARRAY_OF_INT64:
            out.writeLongArray(v as bigint[] | null);
            break;
        case FieldKind.ARRAY_OF_FLOAT32:
            out.writeFloatArray(v as number[] | null);
            break;
        case FieldKind.ARRAY_OF_FLOAT64:
            out.writeDoubleArray(v as number[] | null);
            break;
        case FieldKind.ARRAY_OF_STRING:
            writeNullableArray(out, v as (string | null)[] | null, (o, s) => o.writeString(s));
            break;
        case FieldKind.ARRAY_OF_DECIMAL:
            writeNullableArray(out, v as (BigDecimal | null)[] | null, (o, d) => writeDecimalToOutput(o, d));
            break;
        case FieldKind.ARRAY_OF_TIME:
            writeNullableArray(out, v as (LocalTime | null)[] | null, (o, t) => writeTimeToOutput(o, t));
            break;
        case FieldKind.ARRAY_OF_DATE:
            writeNullableArray(out, v as (LocalDate | null)[] | null, (o, d) => writeDateToOutput(o, d));
            break;
        case FieldKind.ARRAY_OF_TIMESTAMP:
            writeNullableArray(out, v as (LocalDateTime | null)[] | null, (o, t) => writeTimestampToOutput(o, t));
            break;
        case FieldKind.ARRAY_OF_TIMESTAMP_WITH_TIMEZONE:
            writeNullableArray(out, v as (OffsetDateTime | null)[] | null, (o, t) => writeTimestampWithTimezoneToOutput(o, t));
            break;
        case FieldKind.ARRAY_OF_NULLABLE_BOOLEAN:
            writeNullableArray(out, v as (boolean | null)[] | null, (o, b) => writeNullable(o, b, (oo, bb) => oo.writeBoolean(bb)));
            break;
        case FieldKind.ARRAY_OF_NULLABLE_INT8:
            writeNullableArray(out, v as (number | null)[] | null, (o, n) => writeNullable(o, n, (oo, nn) => oo.writeByte(nn)));
            break;
        case FieldKind.ARRAY_OF_NULLABLE_INT16:
            writeNullableArray(out, v as (number | null)[] | null, (o, n) => writeNullable(o, n, (oo, nn) => oo.writeShort(nn)));
            break;
        case FieldKind.ARRAY_OF_NULLABLE_INT32:
            writeNullableArray(out, v as (number | null)[] | null, (o, n) => writeNullable(o, n, (oo, nn) => oo.writeInt(nn)));
            break;
        case FieldKind.ARRAY_OF_NULLABLE_INT64:
            writeNullableArray(out, v as (bigint | null)[] | null, (o, n) => writeNullable(o, n, (oo, nn) => oo.writeLong(nn)));
            break;
        case FieldKind.ARRAY_OF_NULLABLE_FLOAT32:
            writeNullableArray(out, v as (number | null)[] | null, (o, n) => writeNullable(o, n, (oo, nn) => oo.writeFloat(nn)));
            break;
        case FieldKind.ARRAY_OF_NULLABLE_FLOAT64:
            writeNullableArray(out, v as (number | null)[] | null, (o, n) => writeNullable(o, n, (oo, nn) => oo.writeDouble(nn)));
            break;
        default:
            break;
    }
}

function skipVarField(inp: ByteArrayObjectDataInput, field: SchemaField, serializer: CompactStreamSerializer): void {
    switch (field.kind) {
        case FieldKind.STRING: {
            const len = inp.readInt();
            if (len > 0) inp.skipBytes(len);
            break;
        }
        case FieldKind.DECIMAL: {
            const scale = inp.readInt();
            if (scale !== -1) {
                const unscaledLen = inp.readInt();
                if (unscaledLen > 0) inp.skipBytes(unscaledLen);
            }
            break;
        }
        case FieldKind.TIME: {
            const h = inp.readByte();
            if (h !== -1) inp.skipBytes(3); // minute + second + nano(4 bytes)
            break;
        }
        case FieldKind.DATE: {
            const year = inp.readInt();
            if (year !== (0x80000000 | 0)) inp.skipBytes(2);
            break;
        }
        case FieldKind.TIMESTAMP: {
            readDateFromInput(inp);
            readTimeFromInput(inp);
            break;
        }
        case FieldKind.TIMESTAMP_WITH_TIMEZONE: {
            readTimestampFromInput(inp);
            inp.skipBytes(4);
            break;
        }
        case FieldKind.COMPACT: {
            serializer.readNestedCompact(inp);
            break;
        }
        case FieldKind.NULLABLE_BOOLEAN:
        case FieldKind.NULLABLE_INT8: {
            const flag = inp.readByte();
            if (flag !== 0) inp.skipBytes(1);
            break;
        }
        case FieldKind.NULLABLE_INT16: {
            const flag = inp.readByte();
            if (flag !== 0) inp.skipBytes(2);
            break;
        }
        case FieldKind.NULLABLE_INT32:
        case FieldKind.NULLABLE_FLOAT32: {
            const flag = inp.readByte();
            if (flag !== 0) inp.skipBytes(4);
            break;
        }
        case FieldKind.NULLABLE_INT64:
        case FieldKind.NULLABLE_FLOAT64: {
            const flag = inp.readByte();
            if (flag !== 0) inp.skipBytes(8);
            break;
        }
        case FieldKind.ARRAY_OF_BOOLEAN: {
            const bitCount = inp.readInt();
            if (bitCount > 0) inp.skipBytes(Math.ceil(bitCount / 8));
            break;
        }
        case FieldKind.ARRAY_OF_INT8: {
            const len = inp.readInt();
            if (len > 0) inp.skipBytes(len);
            break;
        }
        case FieldKind.ARRAY_OF_INT16: {
            const len = inp.readInt();
            if (len > 0) inp.skipBytes(len * 2);
            break;
        }
        case FieldKind.ARRAY_OF_INT32:
        case FieldKind.ARRAY_OF_FLOAT32: {
            const len = inp.readInt();
            if (len > 0) inp.skipBytes(len * 4);
            break;
        }
        case FieldKind.ARRAY_OF_INT64:
        case FieldKind.ARRAY_OF_FLOAT64: {
            const len = inp.readInt();
            if (len > 0) inp.skipBytes(len * 8);
            break;
        }
        default: {
            // For arrays of complex types: read count + skip each
            const len = inp.readInt();
            if (len > 0) {
                for (let i = 0; i < len; i++) skipVarField(inp, { fieldName: '', kind: elementKindOf(field.kind) }, serializer);
            }
            break;
        }
    }
}

function elementKindOf(arrayKind: FieldKind): FieldKind {
    switch (arrayKind) {
        case FieldKind.ARRAY_OF_STRING:    return FieldKind.STRING;
        case FieldKind.ARRAY_OF_DECIMAL:   return FieldKind.DECIMAL;
        case FieldKind.ARRAY_OF_TIME:      return FieldKind.TIME;
        case FieldKind.ARRAY_OF_DATE:      return FieldKind.DATE;
        case FieldKind.ARRAY_OF_TIMESTAMP: return FieldKind.TIMESTAMP;
        case FieldKind.ARRAY_OF_TIMESTAMP_WITH_TIMEZONE: return FieldKind.TIMESTAMP_WITH_TIMEZONE;
        case FieldKind.ARRAY_OF_COMPACT:   return FieldKind.COMPACT;
        case FieldKind.ARRAY_OF_NULLABLE_BOOLEAN: return FieldKind.NULLABLE_BOOLEAN;
        case FieldKind.ARRAY_OF_NULLABLE_INT8:    return FieldKind.NULLABLE_INT8;
        case FieldKind.ARRAY_OF_NULLABLE_INT16:   return FieldKind.NULLABLE_INT16;
        case FieldKind.ARRAY_OF_NULLABLE_INT32:   return FieldKind.NULLABLE_INT32;
        case FieldKind.ARRAY_OF_NULLABLE_INT64:   return FieldKind.NULLABLE_INT64;
        case FieldKind.ARRAY_OF_NULLABLE_FLOAT32: return FieldKind.NULLABLE_FLOAT32;
        case FieldKind.ARRAY_OF_NULLABLE_FLOAT64: return FieldKind.NULLABLE_FLOAT64;
        default: return FieldKind.NOT_AVAILABLE;
    }
}

function buildGenericRecord(
    inp: ByteArrayObjectDataInput,
    schema: Schema,
    serializer: CompactStreamSerializer,
    fixedDataStart: number,
    _fixedDataLength: number,
    varDataStart: number,
    varFieldStartOffsets: number[],
    _offsetTableStart: number,
): GenericRecord {
    const fieldMap = new Map<string, FieldKind>();
    const valueMap = new Map<string, unknown>();

    let boolBit = 0;
    let fixedOffset = 0;
    let varOrdinal = 0;
    let boolByteCount = 0;
    const boolFields: number[] = [];

    for (let i = 0; i < schema.getFieldCount(); i++) {
        if (isBooleanKind(schema.fields[i].kind)) boolFields.push(i);
    }
    boolByteCount = boolFields.length > 0 ? Math.ceil(boolFields.length / 8) : 0;

    for (let i = 0; i < schema.getFieldCount(); i++) {
        const field = schema.fields[i];
        fieldMap.set(field.fieldName, field.kind);

        if (isBooleanKind(field.kind)) {
            const bytePos = fixedDataStart + Math.floor(boolBit / 8);
            const byte_ = inp.readByte(bytePos) & 0xff;
            const value = ((byte_ >> (boolBit % 8)) & 1) === 1;
            valueMap.set(field.fieldName, value);
            boolBit++;
        } else if (isFixedSize(field.kind)) {
            inp.position(fixedDataStart + boolByteCount + fixedOffset);
            const size = fixedSizeInBytes(field.kind);
            let value: unknown;
            switch (field.kind) {
                case FieldKind.INT8:    value = inp.readByte(); break;
                case FieldKind.INT16:   value = inp.readShort(); break;
                case FieldKind.INT32:   value = inp.readInt(); break;
                case FieldKind.INT64:   value = inp.readLong(); break;
                case FieldKind.FLOAT32: value = inp.readFloat(); break;
                case FieldKind.FLOAT64: value = inp.readDouble(); break;
                default: value = undefined; break;
            }
            valueMap.set(field.fieldName, value);
            fixedOffset += size;
        } else {
            // Variable field
            inp.position(varDataStart + varFieldStartOffsets[varOrdinal]);
            const value = readVarFieldValue(inp, field, serializer);
            valueMap.set(field.fieldName, value);
            varOrdinal++;
        }
    }

    return new GenericRecordImpl(fieldMap, valueMap, true);
}

function readVarFieldValue(inp: ByteArrayObjectDataInput, field: SchemaField, serializer: CompactStreamSerializer): unknown {
    switch (field.kind) {
        case FieldKind.STRING:               return inp.readString();
        case FieldKind.DECIMAL:              return readDecimalFromInput(inp);
        case FieldKind.TIME:                 return readTimeFromInput(inp);
        case FieldKind.DATE:                 return readDateFromInput(inp);
        case FieldKind.TIMESTAMP:            return readTimestampFromInput(inp);
        case FieldKind.TIMESTAMP_WITH_TIMEZONE: return readTimestampWithTimezoneFromInput(inp);
        case FieldKind.COMPACT:              return serializer.readNestedCompact(inp);
        case FieldKind.NULLABLE_BOOLEAN:     return readNullable(inp, () => inp.readBoolean());
        case FieldKind.NULLABLE_INT8:        return readNullable(inp, () => inp.readByte());
        case FieldKind.NULLABLE_INT16:       return readNullable(inp, () => inp.readShort());
        case FieldKind.NULLABLE_INT32:       return readNullable(inp, () => inp.readInt());
        case FieldKind.NULLABLE_INT64:       return readNullable(inp, () => inp.readLong());
        case FieldKind.NULLABLE_FLOAT32:     return readNullable(inp, () => inp.readFloat());
        case FieldKind.NULLABLE_FLOAT64:     return readNullable(inp, () => inp.readDouble());
        case FieldKind.ARRAY_OF_BOOLEAN:     return readBooleanArray(inp);
        case FieldKind.ARRAY_OF_INT8:        return inp.readByteArray();
        case FieldKind.ARRAY_OF_INT16:       return inp.readShortArray();
        case FieldKind.ARRAY_OF_INT32:       return inp.readIntArray();
        case FieldKind.ARRAY_OF_INT64:       return inp.readLongArray();
        case FieldKind.ARRAY_OF_FLOAT32:     return inp.readFloatArray();
        case FieldKind.ARRAY_OF_FLOAT64:     return inp.readDoubleArray();
        case FieldKind.ARRAY_OF_STRING:      return readNullableArray(inp, () => inp.readString());
        case FieldKind.ARRAY_OF_DECIMAL:     return readNullableArray(inp, () => readDecimalFromInput(inp));
        case FieldKind.ARRAY_OF_TIME:        return readNullableArray(inp, () => readTimeFromInput(inp));
        case FieldKind.ARRAY_OF_DATE:        return readNullableArray(inp, () => readDateFromInput(inp));
        case FieldKind.ARRAY_OF_TIMESTAMP:   return readNullableArray(inp, () => readTimestampFromInput(inp));
        case FieldKind.ARRAY_OF_TIMESTAMP_WITH_TIMEZONE: return readNullableArray(inp, () => readTimestampWithTimezoneFromInput(inp));
        case FieldKind.ARRAY_OF_COMPACT:     return readNullableArray(inp, () => serializer.readNestedCompact(inp));
        default: return null;
    }
}

// ── Nullable encoding: [flag:byte=0(null)|1(non-null)][value?] ────────────────

function writeNullable<T>(out: ByteArrayObjectDataOutput, value: T | null, write: (out: ByteArrayObjectDataOutput, v: T) => void): void {
    if (value === null) {
        out.writeByte(0);
    } else {
        out.writeByte(1);
        write(out, value);
    }
}

function readNullable<T>(inp: ByteArrayObjectDataInput, read: () => T): T | null {
    const flag = inp.readByte();
    return flag === 0 ? null : read();
}

// ── Nullable array encoding: [length:int][-1=null array | count][elements] ───

function writeNullableArray<T>(out: ByteArrayObjectDataOutput, arr: (T | null)[] | null, writeElem: (out: ByteArrayObjectDataOutput, v: T | null) => void): void {
    if (arr === null) {
        out.writeInt(-1);
        return;
    }
    out.writeInt(arr.length);
    for (const v of arr) writeElem(out, v);
}

function readNullableArray<T>(inp: ByteArrayObjectDataInput, readElem: () => T | null): (T | null)[] | null {
    const len = inp.readInt();
    if (len === -1) return null;
    const result: (T | null)[] = new Array(len);
    for (let i = 0; i < len; i++) result[i] = readElem();
    return result;
}

// ── Boolean array: [bitCount:int][packed bytes] ───────────────────────────────

function writeBooleanArray(out: ByteArrayObjectDataOutput, arr: boolean[] | null): void {
    if (arr === null) {
        out.writeInt(-1);
        return;
    }
    out.writeInt(arr.length);
    if (arr.length === 0) return;
    const byteCount = Math.ceil(arr.length / 8);
    for (let b = 0; b < byteCount; b++) {
        let byte_ = 0;
        for (let bit = 0; bit < 8; bit++) {
            const idx = b * 8 + bit;
            if (idx < arr.length && arr[idx]) byte_ |= (1 << bit);
        }
        out.writeByte(byte_);
    }
}

function readBooleanArray(inp: ByteArrayObjectDataInput): boolean[] | null {
    const bitCount = inp.readInt();
    if (bitCount === -1) return null;
    if (bitCount === 0) return [];
    const byteCount = Math.ceil(bitCount / 8);
    const result: boolean[] = new Array(bitCount);
    for (let b = 0; b < byteCount; b++) {
        const byte_ = inp.readByte() & 0xff;
        for (let bit = 0; bit < 8; bit++) {
            const idx = b * 8 + bit;
            if (idx < bitCount) result[idx] = ((byte_ >> bit) & 1) === 1;
        }
    }
    return result;
}

// Re-export GenericRecordBuilderImpl so callers can create GenericRecord builders
export { GenericRecordBuilderImpl, GenericRecordImpl };
