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

const BYTE_OFFSET_READER_RANGE = 255;
const SHORT_OFFSET_READER_RANGE = 65535;
const NULL_OFFSET = -1;

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
    constructor(schema: Schema, out: ByteArrayObjectDataOutput, serializer: CompactStreamSerializer) {
        this._schema = schema;
        this._out = out;
        this._serializer = serializer;
        this._fixedValues = new Array(schema.getFieldCount());
        this._varValues = new Array(schema.getFieldCount());
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

    end(): void {
        const out = this._out;
        const variableFieldCount = this._schema.numberVarSizeFields;
        const dataStartPosition = variableFieldCount === 0 ? out.pos : out.pos + 4;

        if (variableFieldCount !== 0) {
            out.writeZeroBytes(this._schema.fixedSizeFieldsLength + 4);
        } else {
            out.writeZeroBytes(this._schema.fixedSizeFieldsLength);
        }

        for (let index = 0; index < this._schema.getFieldCount(); index++) {
            const field = this._schema.fields[index]!;
            const value = this._fixedValues[index];
            if (field.kind === FieldKind.BOOLEAN) {
                out.writeBooleanBit(dataStartPosition + (field.offset ?? 0), field.bitOffset ?? 0, Boolean(value));
                continue;
            }
            if (!isFixedSize(field.kind)) {
                continue;
            }
            writeFixedField(out, field, value, dataStartPosition + (field.offset ?? 0));
        }

        if (variableFieldCount === 0) {
            return;
        }

        const variableOffsets = new Array<number>(variableFieldCount).fill(-1);
        for (let index = 0; index < this._schema.getFieldCount(); index++) {
            const field = this._schema.fields[index]!;
            if (isFixedSize(field.kind) || field.kind === FieldKind.BOOLEAN) {
                continue;
            }
            const fieldIndex = field.index ?? 0;
            const value = this._varValues[index];
            if (value === null || value === undefined) {
                variableOffsets[fieldIndex] = -1;
                continue;
            }
            variableOffsets[fieldIndex] = out.pos - dataStartPosition;
            writeVarField(out, field, value, this._serializer);
        }

        const dataLength = out.pos - dataStartPosition;
        out.writeInt(dataStartPosition - 4, dataLength);
        writeCompactOffsets(out, dataLength, variableOffsets);
    }
}

function writeCompactOffsets(out: ByteArrayObjectDataOutput, dataLength: number, offsets: number[]): void {
    if (dataLength < BYTE_OFFSET_READER_RANGE) {
        for (const offset of offsets) {
            out.writeByte(offset === NULL_OFFSET ? 0xff : offset);
        }
        return;
    }

    if (dataLength < SHORT_OFFSET_READER_RANGE) {
        for (const offset of offsets) {
            out.writeShort(offset === NULL_OFFSET ? NULL_OFFSET : (offset > 0x7fff ? offset - 0x10000 : offset));
        }
        return;
    }

    for (const offset of offsets) {
        out.writeInt(offset);
    }
}

function readCompactByteOffset(input: ByteArrayObjectDataInput, variableOffsetsPos: number, index: number): number {
    const offset = input.readByte(variableOffsetsPos + index) & 0xff;
    return offset === 0xff ? NULL_OFFSET : offset;
}

function readCompactShortOffset(input: ByteArrayObjectDataInput, variableOffsetsPos: number, index: number): number {
    const offset = input.readShort(variableOffsetsPos + index * 2);
    return offset === NULL_OFFSET ? NULL_OFFSET : offset & 0xffff;
}

function readCompactIntOffset(input: ByteArrayObjectDataInput, variableOffsetsPos: number, index: number): number {
    return input.readInt(variableOffsetsPos + index * 4);
}

// ── CompactReader ─────────────────────────────────────────────────────────────

export class CompactReader {
    private readonly _inp: ByteArrayObjectDataInput;
    private readonly _schema: Schema;
    private readonly _serializer: CompactStreamSerializer;

    private readonly _dataStartPosition: number;
    private readonly _variableOffsetsPosition: number;
    private readonly _dataEnd: number;
    private readonly _offsetReader: (input: ByteArrayObjectDataInput, variableOffsetsPos: number, index: number) => number;

    constructor(
        inp: ByteArrayObjectDataInput,
        schema: Schema,
        serializer: CompactStreamSerializer,
        dataStartPosition: number,
        variableOffsetsPosition: number,
        dataEnd: number,
        offsetReader: (input: ByteArrayObjectDataInput, variableOffsetsPos: number, index: number) => number,
    ) {
        this._inp = inp;
        this._schema = schema;
        this._serializer = serializer;
        this._dataStartPosition = dataStartPosition;
        this._variableOffsetsPosition = variableOffsetsPosition;
        this._dataEnd = dataEnd;
        this._offsetReader = offsetReader;
    }

    private _seekToFixed(fieldName: string): void {
        const field = this._schema.getField(fieldName);
        if (!field || field.offset === undefined) {
            throw new HazelcastSerializationError(`Field '${fieldName}' is not a fixed field`);
        }
        this._inp.position(this._dataStartPosition + field.offset);
    }

    private _seekToVar(fieldName: string): void {
        const field = this._schema.getField(fieldName);
        if (!field || field.index === undefined) {
            throw new HazelcastSerializationError(`Field '${fieldName}' is not a variable-size field`);
        }
        const offset = this._offsetReader(this._inp, this._variableOffsetsPosition, field.index);
        if (offset === NULL_OFFSET) {
            throw new HazelcastSerializationError(`Field '${fieldName}' is null`);
        }
        this._inp.position(this._dataStartPosition + offset);
    }

    private _nullableVarPosition(fieldName: string): number {
        const field = this._schema.getField(fieldName);
        if (!field || field.index === undefined) {
            return NULL_OFFSET;
        }
        const offset = this._offsetReader(this._inp, this._variableOffsetsPosition, field.index);
        return offset === NULL_OFFSET ? NULL_OFFSET : this._dataStartPosition + offset;
    }

    private _boolAt(fieldName: string): boolean {
        const field = this._schema.getField(fieldName);
        if (!field || field.offset === undefined || field.bitOffset === undefined) {
            throw new HazelcastSerializationError(`Field '${fieldName}' is not a BOOLEAN field`);
        }
        const bytePos = this._dataStartPosition + field.offset;
        const byte_ = this._inp.readByte(bytePos) & 0xff;
        return ((byte_ >> field.bitOffset) & 1) === 1;
    }

    // ── read methods ─────────────────────────────────────────────────────────

    readBoolean(fieldName: string): boolean {
        if (!this._schema.hasField(fieldName)) {
            return false;
        }
        return this._boolAt(fieldName);
    }

    readInt8(fieldName: string): number {
        if (!this._schema.hasField(fieldName)) {
            return 0;
        }
        this._seekToFixed(fieldName);
        return this._inp.readByte();
    }

    readInt16(fieldName: string): number {
        if (!this._schema.hasField(fieldName)) {
            return 0;
        }
        this._seekToFixed(fieldName);
        return this._inp.readShort();
    }

    readInt32(fieldName: string): number {
        if (!this._schema.hasField(fieldName)) {
            return 0;
        }
        this._seekToFixed(fieldName);
        return this._inp.readInt();
    }

    readInt64(fieldName: string): bigint {
        if (!this._schema.hasField(fieldName)) {
            return 0n;
        }
        this._seekToFixed(fieldName);
        return this._inp.readLong();
    }

    readFloat32(fieldName: string): number {
        if (!this._schema.hasField(fieldName)) {
            return 0;
        }
        this._seekToFixed(fieldName);
        return this._inp.readFloat();
    }

    readFloat64(fieldName: string): number {
        if (!this._schema.hasField(fieldName)) {
            return 0;
        }
        this._seekToFixed(fieldName);
        return this._inp.readDouble();
    }

    readString(fieldName: string): string | null {
        if (!this._schema.hasField(fieldName)) {
            return null;
        }
        const position = this._nullableVarPosition(fieldName);
        if (position === NULL_OFFSET) {
            return null;
        }
        this._inp.position(position);
        return this._inp.readString();
    }

    readDecimal(fieldName: string): BigDecimal | null {
        const position = this._nullableVarPosition(fieldName);
        if (position === NULL_OFFSET) return null;
        this._inp.position(position);
        return readDecimalFromInput(this._inp);
    }

    readTime(fieldName: string): LocalTime | null {
        const position = this._nullableVarPosition(fieldName);
        if (position === NULL_OFFSET) return null;
        this._inp.position(position);
        return readTimeFromInput(this._inp);
    }

    readDate(fieldName: string): LocalDate | null {
        const position = this._nullableVarPosition(fieldName);
        if (position === NULL_OFFSET) return null;
        this._inp.position(position);
        return readDateFromInput(this._inp);
    }

    readTimestamp(fieldName: string): LocalDateTime | null {
        const position = this._nullableVarPosition(fieldName);
        if (position === NULL_OFFSET) return null;
        this._inp.position(position);
        return readTimestampFromInput(this._inp);
    }

    readTimestampWithTimezone(fieldName: string): OffsetDateTime | null {
        const position = this._nullableVarPosition(fieldName);
        if (position === NULL_OFFSET) return null;
        this._inp.position(position);
        return readTimestampWithTimezoneFromInput(this._inp);
    }

    readCompact<T>(fieldName: string): T | null {
        if (!this._schema.hasField(fieldName)) {
            return null;
        }
        const position = this._nullableVarPosition(fieldName);
        if (position === NULL_OFFSET) return null;
        this._inp.position(position);
        return this._serializer.readNestedCompact<T>(this._inp);
    }

    readNullableBoolean(fieldName: string): boolean | null {
        if (!this._schema.hasField(fieldName)) {
            return null;
        }
        const position = this._nullableVarPosition(fieldName);
        if (position === NULL_OFFSET) return null;
        this._inp.position(position);
        return this._inp.readBoolean();
    }

    readNullableInt8(fieldName: string): number | null {
        const position = this._nullableVarPosition(fieldName);
        if (position === NULL_OFFSET) return null;
        this._inp.position(position);
        return this._inp.readByte();
    }

    readNullableInt16(fieldName: string): number | null {
        const position = this._nullableVarPosition(fieldName);
        if (position === NULL_OFFSET) return null;
        this._inp.position(position);
        return this._inp.readShort();
    }

    readNullableInt32(fieldName: string): number | null {
        if (!this._schema.hasField(fieldName)) {
            return null;
        }
        const position = this._nullableVarPosition(fieldName);
        if (position === NULL_OFFSET) return null;
        this._inp.position(position);
        return this._inp.readInt();
    }

    readNullableInt64(fieldName: string): bigint | null {
        const position = this._nullableVarPosition(fieldName);
        if (position === NULL_OFFSET) return null;
        this._inp.position(position);
        return this._inp.readLong();
    }

    readNullableFloat32(fieldName: string): number | null {
        const position = this._nullableVarPosition(fieldName);
        if (position === NULL_OFFSET) return null;
        this._inp.position(position);
        return this._inp.readFloat();
    }

    readNullableFloat64(fieldName: string): number | null {
        const position = this._nullableVarPosition(fieldName);
        if (position === NULL_OFFSET) return null;
        this._inp.position(position);
        return this._inp.readDouble();
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
        const existingByClass = this._serializersByClass.get(cls);
        if (existingByClass && existingByClass !== serializer) {
            throw new HazelcastSerializationError(
                `Compact serializer already registered for class '${cls.name}'`,
            );
        }

        const typeName = serializer.getTypeName();
        const existingByTypeName = this._serializersByTypeName.get(typeName);
        if (existingByTypeName && existingByTypeName !== serializer) {
            throw new HazelcastSerializationError(
                `Compact serializer already registered for typeName '${typeName}'`,
            );
        }

        if (isCompactReservedClass(cls)) {
            throw new HazelcastSerializationError(
                `Compact serializer for class '${cls.name}' conflicts with a built-in serializer`,
            );
        }

        this._serializersByClass.set(cls, serializer as CompactSerializable<unknown>);
        this._serializersByTypeName.set(typeName, serializer as CompactSerializable<unknown>);
    }

    /**
     * Pre-register a schema. If not called, the schema will be inferred
     * on the first serialization.
     */
    registerSchema(schema: Schema): void {
        this._schemaService.registerSchema(schema);
    }

    isRegistered(cls: Function): boolean {
        return this._serializersByClass.has(cls);
    }

    getTypeId(): number {
        return SerializationConstants.TYPE_COMPACT;
    }

    write(out: ByteArrayObjectDataOutput, obj: unknown): void {
        if (isCompactGenericRecordValue(obj)) {
            this._writeGenericRecord(out, obj);
            return;
        }

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

        const variableFieldCount = schema.numberVarSizeFields;
        let dataStartPosition: number;
        let variableOffsetsPosition: number;
        let dataEnd: number;
        let offsetReader = readCompactIntOffset;

        if (variableFieldCount !== 0) {
            const dataLength = inp.readInt();
            dataStartPosition = inp.position();
            variableOffsetsPosition = dataStartPosition + dataLength;
            if (dataLength < BYTE_OFFSET_READER_RANGE) {
                offsetReader = readCompactByteOffset;
                dataEnd = variableOffsetsPosition + variableFieldCount;
            } else if (dataLength < SHORT_OFFSET_READER_RANGE) {
                offsetReader = readCompactShortOffset;
                dataEnd = variableOffsetsPosition + variableFieldCount * 2;
            } else {
                dataEnd = variableOffsetsPosition + variableFieldCount * 4;
            }
        } else {
            dataStartPosition = inp.position();
            variableOffsetsPosition = 0;
            dataEnd = dataStartPosition + schema.fixedSizeFieldsLength;
        }

        const reader = new CompactReader(inp, schema, this, dataStartPosition, variableOffsetsPosition, dataEnd, offsetReader);

        if (serializer) {
            const result = serializer.read(reader);
            reader.advance();
            return result;
        }

        const genericRecord = buildGenericRecord(reader, schema);
        reader.advance();
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

    private _writeGenericRecord(out: ByteArrayObjectDataOutput, record: GenericRecord): void {
        const schema = buildSchemaFromGenericRecord(record);
        this._schemaService.registerSchema(schema);
        out.writeLong(schema.schemaId);
        const writer = new CompactWriter(schema, out, this);
        writeGenericRecordToWriter(writer, schema, record);
        writer.end();
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

function writeFixedField(out: ByteArrayObjectDataOutput, field: SchemaField, v: unknown, position: number): void {
    switch (field.kind) {
        case FieldKind.INT8:    out.writeByte(position, v as number); break;
        case FieldKind.INT16:   out.writeShort(position, v as number); break;
        case FieldKind.INT32:   out.writeInt(position, v as number); break;
        case FieldKind.INT64:   out.writeLong(position, v as bigint); break;
        case FieldKind.FLOAT32: out.writeFloat(position, v as number); break;
        case FieldKind.FLOAT64: out.writeDouble(position, v as number); break;
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
            out.writeBoolean(v as boolean);
            break;
        case FieldKind.NULLABLE_INT8:
            out.writeByte(v as number);
            break;
        case FieldKind.NULLABLE_INT16:
            out.writeShort(v as number);
            break;
        case FieldKind.NULLABLE_INT32:
            out.writeInt(v as number);
            break;
        case FieldKind.NULLABLE_INT64:
            out.writeLong(v as bigint);
            break;
        case FieldKind.NULLABLE_FLOAT32:
            out.writeFloat(v as number);
            break;
        case FieldKind.NULLABLE_FLOAT64:
            out.writeDouble(v as number);
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

function buildGenericRecord(reader: CompactReader, schema: Schema): GenericRecord {
    const fieldMap = new Map<string, FieldKind>();
    const valueMap = new Map<string, unknown>();

    for (let i = 0; i < schema.getFieldCount(); i++) {
        const field = schema.fields[i];
        fieldMap.set(field.fieldName, field.kind);
        valueMap.set(field.fieldName, readFieldValue(reader, field));
    }

    return new GenericRecordImpl(fieldMap, valueMap, true, schema.typeName);
}

function readFieldValue(reader: CompactReader, field: SchemaField): unknown {
    switch (field.kind) {
        case FieldKind.BOOLEAN: return reader.readBoolean(field.fieldName);
        case FieldKind.INT8: return reader.readInt8(field.fieldName);
        case FieldKind.INT16: return reader.readInt16(field.fieldName);
        case FieldKind.INT32: return reader.readInt32(field.fieldName);
        case FieldKind.INT64: return reader.readInt64(field.fieldName);
        case FieldKind.FLOAT32: return reader.readFloat32(field.fieldName);
        case FieldKind.FLOAT64: return reader.readFloat64(field.fieldName);
        case FieldKind.STRING: return reader.readString(field.fieldName);
        case FieldKind.DECIMAL: return reader.readDecimal(field.fieldName);
        case FieldKind.TIME: return reader.readTime(field.fieldName);
        case FieldKind.DATE: return reader.readDate(field.fieldName);
        case FieldKind.TIMESTAMP: return reader.readTimestamp(field.fieldName);
        case FieldKind.TIMESTAMP_WITH_TIMEZONE: return reader.readTimestampWithTimezone(field.fieldName);
        case FieldKind.COMPACT: return reader.readCompact(field.fieldName);
        case FieldKind.NULLABLE_BOOLEAN: return reader.readNullableBoolean(field.fieldName);
        case FieldKind.NULLABLE_INT8: return reader.readNullableInt8(field.fieldName);
        case FieldKind.NULLABLE_INT16: return reader.readNullableInt16(field.fieldName);
        case FieldKind.NULLABLE_INT32: return reader.readNullableInt32(field.fieldName);
        case FieldKind.NULLABLE_INT64: return reader.readNullableInt64(field.fieldName);
        case FieldKind.NULLABLE_FLOAT32: return reader.readNullableFloat32(field.fieldName);
        case FieldKind.NULLABLE_FLOAT64: return reader.readNullableFloat64(field.fieldName);
        case FieldKind.ARRAY_OF_BOOLEAN: return reader.readArrayOfBoolean(field.fieldName);
        case FieldKind.ARRAY_OF_INT8: return reader.readArrayOfInt8(field.fieldName);
        case FieldKind.ARRAY_OF_INT16: return reader.readArrayOfInt16(field.fieldName);
        case FieldKind.ARRAY_OF_INT32: return reader.readArrayOfInt32(field.fieldName);
        case FieldKind.ARRAY_OF_INT64: return reader.readArrayOfInt64(field.fieldName);
        case FieldKind.ARRAY_OF_FLOAT32: return reader.readArrayOfFloat32(field.fieldName);
        case FieldKind.ARRAY_OF_FLOAT64: return reader.readArrayOfFloat64(field.fieldName);
        case FieldKind.ARRAY_OF_STRING: return reader.readArrayOfString(field.fieldName);
        case FieldKind.ARRAY_OF_DECIMAL: return reader.readArrayOfDecimal(field.fieldName);
        case FieldKind.ARRAY_OF_TIME: return reader.readArrayOfTime(field.fieldName);
        case FieldKind.ARRAY_OF_DATE: return reader.readArrayOfDate(field.fieldName);
        case FieldKind.ARRAY_OF_TIMESTAMP: return reader.readArrayOfTimestamp(field.fieldName);
        case FieldKind.ARRAY_OF_TIMESTAMP_WITH_TIMEZONE: return reader.readArrayOfTimestampWithTimezone(field.fieldName);
        case FieldKind.ARRAY_OF_COMPACT: return reader.readArrayOfCompact(field.fieldName);
        case FieldKind.ARRAY_OF_NULLABLE_BOOLEAN: return reader.readArrayOfNullableBoolean(field.fieldName);
        case FieldKind.ARRAY_OF_NULLABLE_INT8: return reader.readArrayOfNullableInt8(field.fieldName);
        case FieldKind.ARRAY_OF_NULLABLE_INT16: return reader.readArrayOfNullableInt16(field.fieldName);
        case FieldKind.ARRAY_OF_NULLABLE_INT32: return reader.readArrayOfNullableInt32(field.fieldName);
        case FieldKind.ARRAY_OF_NULLABLE_INT64: return reader.readArrayOfNullableInt64(field.fieldName);
        case FieldKind.ARRAY_OF_NULLABLE_FLOAT32: return reader.readArrayOfNullableFloat32(field.fieldName);
        case FieldKind.ARRAY_OF_NULLABLE_FLOAT64: return reader.readArrayOfNullableFloat64(field.fieldName);
        default: return null;
    }
}

function isCompactGenericRecordValue(obj: unknown): obj is GenericRecord {
    if (typeof obj !== 'object' || obj === null) return false;
    const record = obj as Record<string, unknown>;
    return typeof record.getFieldNames === 'function'
        && typeof record.getFieldKind === 'function'
        && typeof record.isCompact === 'function'
        && (record.isCompact as () => boolean)();
}

function isCompactReservedClass(cls: Function): boolean {
    return cls === String
        || cls === Number
        || cls === Boolean
        || cls === Buffer
        || cls === Date
        || cls === BigInt
        || cls === Array;
}

function buildSchemaFromGenericRecord(record: GenericRecord): Schema {
    const fields: SchemaField[] = [];
    for (const fieldName of record.getFieldNames()) {
        fields.push({ fieldName, kind: record.getFieldKind(fieldName) });
    }
    return new Schema(record.getTypeName(), fields);
}

function writeGenericRecordToWriter(writer: CompactWriter, schema: Schema, record: GenericRecord): void {
    for (const field of schema.fields) {
        switch (field.kind) {
            case FieldKind.BOOLEAN: writer.writeBoolean(field.fieldName, record.getBoolean(field.fieldName)); break;
            case FieldKind.INT8: writer.writeInt8(field.fieldName, record.getInt8(field.fieldName)); break;
            case FieldKind.INT16: writer.writeInt16(field.fieldName, record.getInt16(field.fieldName)); break;
            case FieldKind.INT32: writer.writeInt32(field.fieldName, record.getInt32(field.fieldName)); break;
            case FieldKind.INT64: writer.writeInt64(field.fieldName, record.getInt64(field.fieldName)); break;
            case FieldKind.FLOAT32: writer.writeFloat32(field.fieldName, record.getFloat32(field.fieldName)); break;
            case FieldKind.FLOAT64: writer.writeFloat64(field.fieldName, record.getFloat64(field.fieldName)); break;
            case FieldKind.STRING: writer.writeString(field.fieldName, record.getString(field.fieldName)); break;
            case FieldKind.DECIMAL: writer.writeDecimal(field.fieldName, record.getDecimal(field.fieldName)); break;
            case FieldKind.TIME: writer.writeTime(field.fieldName, record.getTime(field.fieldName)); break;
            case FieldKind.DATE: writer.writeDate(field.fieldName, record.getDate(field.fieldName)); break;
            case FieldKind.TIMESTAMP: writer.writeTimestamp(field.fieldName, record.getTimestamp(field.fieldName)); break;
            case FieldKind.TIMESTAMP_WITH_TIMEZONE: writer.writeTimestampWithTimezone(field.fieldName, record.getTimestampWithTimezone(field.fieldName)); break;
            case FieldKind.COMPACT: writer.writeCompact(field.fieldName, record.getGenericRecord(field.fieldName)); break;
            case FieldKind.NULLABLE_BOOLEAN: writer.writeNullableBoolean(field.fieldName, record.getNullableBoolean(field.fieldName)); break;
            case FieldKind.NULLABLE_INT8: writer.writeNullableInt8(field.fieldName, record.getNullableInt8(field.fieldName)); break;
            case FieldKind.NULLABLE_INT16: writer.writeNullableInt16(field.fieldName, record.getNullableInt16(field.fieldName)); break;
            case FieldKind.NULLABLE_INT32: writer.writeNullableInt32(field.fieldName, record.getNullableInt32(field.fieldName)); break;
            case FieldKind.NULLABLE_INT64: writer.writeNullableInt64(field.fieldName, record.getNullableInt64(field.fieldName)); break;
            case FieldKind.NULLABLE_FLOAT32: writer.writeNullableFloat32(field.fieldName, record.getNullableFloat32(field.fieldName)); break;
            case FieldKind.NULLABLE_FLOAT64: writer.writeNullableFloat64(field.fieldName, record.getNullableFloat64(field.fieldName)); break;
            case FieldKind.ARRAY_OF_BOOLEAN: writer.writeArrayOfBoolean(field.fieldName, record.getArrayOfBoolean(field.fieldName)); break;
            case FieldKind.ARRAY_OF_INT8: writer.writeArrayOfInt8(field.fieldName, record.getArrayOfInt8(field.fieldName)); break;
            case FieldKind.ARRAY_OF_INT16: writer.writeArrayOfInt16(field.fieldName, record.getArrayOfInt16(field.fieldName)); break;
            case FieldKind.ARRAY_OF_INT32: writer.writeArrayOfInt32(field.fieldName, record.getArrayOfInt32(field.fieldName)); break;
            case FieldKind.ARRAY_OF_INT64: writer.writeArrayOfInt64(field.fieldName, record.getArrayOfInt64(field.fieldName)); break;
            case FieldKind.ARRAY_OF_FLOAT32: writer.writeArrayOfFloat32(field.fieldName, record.getArrayOfFloat32(field.fieldName)); break;
            case FieldKind.ARRAY_OF_FLOAT64: writer.writeArrayOfFloat64(field.fieldName, record.getArrayOfFloat64(field.fieldName)); break;
            case FieldKind.ARRAY_OF_STRING: writer.writeArrayOfString(field.fieldName, record.getArrayOfString(field.fieldName)); break;
            case FieldKind.ARRAY_OF_DECIMAL: writer.writeArrayOfDecimal(field.fieldName, record.getArrayOfDecimal(field.fieldName)); break;
            case FieldKind.ARRAY_OF_TIME: writer.writeArrayOfTime(field.fieldName, record.getArrayOfTime(field.fieldName)); break;
            case FieldKind.ARRAY_OF_DATE: writer.writeArrayOfDate(field.fieldName, record.getArrayOfDate(field.fieldName)); break;
            case FieldKind.ARRAY_OF_TIMESTAMP: writer.writeArrayOfTimestamp(field.fieldName, record.getArrayOfTimestamp(field.fieldName)); break;
            case FieldKind.ARRAY_OF_TIMESTAMP_WITH_TIMEZONE: writer.writeArrayOfTimestampWithTimezone(field.fieldName, record.getArrayOfTimestampWithTimezone(field.fieldName)); break;
            case FieldKind.ARRAY_OF_COMPACT: writer.writeArrayOfCompact(field.fieldName, record.getArrayOfGenericRecord(field.fieldName)); break;
            case FieldKind.ARRAY_OF_NULLABLE_BOOLEAN: writer.writeArrayOfNullableBoolean(field.fieldName, record.getArrayOfNullableBoolean(field.fieldName)); break;
            case FieldKind.ARRAY_OF_NULLABLE_INT8: writer.writeArrayOfNullableInt8(field.fieldName, record.getArrayOfNullableInt8(field.fieldName)); break;
            case FieldKind.ARRAY_OF_NULLABLE_INT16: writer.writeArrayOfNullableInt16(field.fieldName, record.getArrayOfNullableInt16(field.fieldName)); break;
            case FieldKind.ARRAY_OF_NULLABLE_INT32: writer.writeArrayOfNullableInt32(field.fieldName, record.getArrayOfNullableInt32(field.fieldName)); break;
            case FieldKind.ARRAY_OF_NULLABLE_INT64: writer.writeArrayOfNullableInt64(field.fieldName, record.getArrayOfNullableInt64(field.fieldName)); break;
            case FieldKind.ARRAY_OF_NULLABLE_FLOAT32: writer.writeArrayOfNullableFloat32(field.fieldName, record.getArrayOfNullableFloat32(field.fieldName)); break;
            case FieldKind.ARRAY_OF_NULLABLE_FLOAT64: writer.writeArrayOfNullableFloat64(field.fieldName, record.getArrayOfNullableFloat64(field.fieldName)); break;
            default: throw new HazelcastSerializationError(`Unsupported GenericRecord field kind ${field.kind}`);
        }
    }
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
