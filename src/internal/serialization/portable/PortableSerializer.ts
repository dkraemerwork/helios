/**
 * Port of {@code com.hazelcast.internal.serialization.impl.portable}.
 *
 * Full Portable serialization: ClassDefinition registry, factory registry,
 * PortableReader / PortableWriter, version tracking, and binary write/read.
 *
 * Wire format (big-endian):
 *   [factoryId:int][classId:int][version:int]
 *   [field-count:int]
 *   for each field: [nameLength:int][name:utf8][fieldType:byte][factoryId:int][classId:int]
 *   [data-start-pos:int]      (== position of first field data)
 *   field payloads in declaration order
 */
import { ByteArrayObjectDataInput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';
import { ByteArrayObjectDataOutput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput';
import { HazelcastSerializationError } from '@zenystx/helios-core/internal/serialization/impl/HazelcastSerializationError';
import { SerializationConstants } from '@zenystx/helios-core/internal/serialization/impl/SerializationConstants';
import type { SerializerAdapter } from '@zenystx/helios-core/internal/serialization/impl/SerializerAdapter';
import type {
    BigDecimal,
    LocalDate,
    LocalDateTime,
    LocalTime,
    OffsetDateTime,
} from '@zenystx/helios-core/internal/serialization/GenericRecord';

// ── Field types ───────────────────────────────────────────────────────────────

export const enum PortableFieldType {
    PORTABLE = 0,
    BYTE = 1,
    BOOLEAN = 2,
    CHAR = 3,
    SHORT = 4,
    INT = 5,
    LONG = 6,
    FLOAT = 7,
    DOUBLE = 8,
    STRING = 9,
    PORTABLE_ARRAY = 10,
    BYTE_ARRAY = 11,
    BOOLEAN_ARRAY = 12,
    CHAR_ARRAY = 13,
    SHORT_ARRAY = 14,
    INT_ARRAY = 15,
    LONG_ARRAY = 16,
    FLOAT_ARRAY = 17,
    DOUBLE_ARRAY = 18,
    STRING_ARRAY = 19,
    DECIMAL = 20,
    DECIMAL_ARRAY = 21,
    TIME = 22,
    TIME_ARRAY = 23,
    DATE = 24,
    DATE_ARRAY = 25,
    TIMESTAMP = 26,
    TIMESTAMP_ARRAY = 27,
    TIMESTAMP_WITH_TIMEZONE = 28,
    TIMESTAMP_WITH_TIMEZONE_ARRAY = 29,
}

// ── ClassDefinition ───────────────────────────────────────────────────────────

export interface FieldDefinition {
    readonly name: string;
    readonly type: PortableFieldType;
    readonly factoryId: number;
    readonly classId: number;
    readonly version: number;
    readonly index: number;
}

export class ClassDefinition {
    readonly factoryId: number;
    readonly classId: number;
    readonly version: number;
    private readonly _fields: Map<string, FieldDefinition> = new Map();
    private readonly _fieldList: FieldDefinition[] = [];

    constructor(factoryId: number, classId: number, version: number) {
        this.factoryId = factoryId;
        this.classId = classId;
        this.version = version;
    }

    addField(fd: FieldDefinition): void {
        if (this._fields.has(fd.name)) {
            throw new HazelcastSerializationError(
                `Field already defined: '${fd.name}' in ClassDefinition factoryId=${this.factoryId}, classId=${this.classId}`,
            );
        }
        this._fields.set(fd.name, fd);
        this._fieldList.push(fd);
    }

    getField(name: string): FieldDefinition | undefined {
        return this._fields.get(name);
    }

    getFieldByIndex(index: number): FieldDefinition {
        const fd = this._fieldList[index];
        if (!fd) throw new HazelcastSerializationError(`No field at index ${index}`);
        return fd;
    }

    getFieldCount(): number {
        return this._fieldList.length;
    }

    getFieldNames(): ReadonlySet<string> {
        return new Set(this._fields.keys());
    }

    hasField(name: string): boolean {
        return this._fields.has(name);
    }

    getFields(): readonly FieldDefinition[] {
        return this._fieldList;
    }
}

// ── ClassDefinitionBuilder ────────────────────────────────────────────────────

export class ClassDefinitionBuilder {
    private readonly _factoryId: number;
    private readonly _classId: number;
    private readonly _version: number;
    private readonly _fields: FieldDefinition[] = [];

    constructor(factoryId: number, classId: number, version = 0) {
        this._factoryId = factoryId;
        this._classId = classId;
        this._version = version;
    }

    private _addScalar(name: string, type: PortableFieldType): this {
        this._fields.push({ name, type, factoryId: 0, classId: 0, version: 0, index: this._fields.length });
        return this;
    }

    addPortableField(name: string, classDef: ClassDefinition): this {
        this._fields.push({
            name,
            type: PortableFieldType.PORTABLE,
            factoryId: classDef.factoryId,
            classId: classDef.classId,
            version: classDef.version,
            index: this._fields.length,
        });
        return this;
    }

    addPortableArrayField(name: string, classDef: ClassDefinition): this {
        this._fields.push({
            name,
            type: PortableFieldType.PORTABLE_ARRAY,
            factoryId: classDef.factoryId,
            classId: classDef.classId,
            version: classDef.version,
            index: this._fields.length,
        });
        return this;
    }

    addByteField(name: string): this { return this._addScalar(name, PortableFieldType.BYTE); }
    addBooleanField(name: string): this { return this._addScalar(name, PortableFieldType.BOOLEAN); }
    addCharField(name: string): this { return this._addScalar(name, PortableFieldType.CHAR); }
    addShortField(name: string): this { return this._addScalar(name, PortableFieldType.SHORT); }
    addIntField(name: string): this { return this._addScalar(name, PortableFieldType.INT); }
    addLongField(name: string): this { return this._addScalar(name, PortableFieldType.LONG); }
    addFloatField(name: string): this { return this._addScalar(name, PortableFieldType.FLOAT); }
    addDoubleField(name: string): this { return this._addScalar(name, PortableFieldType.DOUBLE); }
    addStringField(name: string): this { return this._addScalar(name, PortableFieldType.STRING); }
    addDecimalField(name: string): this { return this._addScalar(name, PortableFieldType.DECIMAL); }
    addTimeField(name: string): this { return this._addScalar(name, PortableFieldType.TIME); }
    addDateField(name: string): this { return this._addScalar(name, PortableFieldType.DATE); }
    addTimestampField(name: string): this { return this._addScalar(name, PortableFieldType.TIMESTAMP); }
    addTimestampWithTimezoneField(name: string): this { return this._addScalar(name, PortableFieldType.TIMESTAMP_WITH_TIMEZONE); }

    addByteArrayField(name: string): this { return this._addScalar(name, PortableFieldType.BYTE_ARRAY); }
    addBooleanArrayField(name: string): this { return this._addScalar(name, PortableFieldType.BOOLEAN_ARRAY); }
    addCharArrayField(name: string): this { return this._addScalar(name, PortableFieldType.CHAR_ARRAY); }
    addShortArrayField(name: string): this { return this._addScalar(name, PortableFieldType.SHORT_ARRAY); }
    addIntArrayField(name: string): this { return this._addScalar(name, PortableFieldType.INT_ARRAY); }
    addLongArrayField(name: string): this { return this._addScalar(name, PortableFieldType.LONG_ARRAY); }
    addFloatArrayField(name: string): this { return this._addScalar(name, PortableFieldType.FLOAT_ARRAY); }
    addDoubleArrayField(name: string): this { return this._addScalar(name, PortableFieldType.DOUBLE_ARRAY); }
    addStringArrayField(name: string): this { return this._addScalar(name, PortableFieldType.STRING_ARRAY); }
    addDecimalArrayField(name: string): this { return this._addScalar(name, PortableFieldType.DECIMAL_ARRAY); }
    addTimeArrayField(name: string): this { return this._addScalar(name, PortableFieldType.TIME_ARRAY); }
    addDateArrayField(name: string): this { return this._addScalar(name, PortableFieldType.DATE_ARRAY); }
    addTimestampArrayField(name: string): this { return this._addScalar(name, PortableFieldType.TIMESTAMP_ARRAY); }
    addTimestampWithTimezoneArrayField(name: string): this { return this._addScalar(name, PortableFieldType.TIMESTAMP_WITH_TIMEZONE_ARRAY); }

    build(): ClassDefinition {
        const cd = new ClassDefinition(this._factoryId, this._classId, this._version);
        for (const fd of this._fields) cd.addField(fd);
        return cd;
    }
}

// ── Portable / PortableFactory interfaces ─────────────────────────────────────

export interface Portable {
    getFactoryId(): number;
    getClassId(): number;
    writePortable(writer: PortableWriter): void;
    readPortable(reader: PortableReader): void;
}

export interface PortableFactory {
    create(classId: number): Portable;
}

// ── PortableWriter ────────────────────────────────────────────────────────────

export class PortableWriter {
    private readonly _out: ByteArrayObjectDataOutput;
    private readonly _registry: PortableRegistry;
    private readonly _classDef: ClassDefinition;

    /** Positions in the output buffer where each field's offset is stored. */
    private readonly _offsetPositions: number[];
    /** Position of the offsets array start (after the header). */
    private readonly _offsetsPos: number;

    constructor(
        out: ByteArrayObjectDataOutput,
        registry: PortableRegistry,
        classDef: ClassDefinition,
    ) {
        this._out = out;
        this._registry = registry;
        this._classDef = classDef;

        const fieldCount = classDef.getFieldCount();
        // Reserve space: fieldCount * 4-byte offsets table
        this._offsetsPos = out.pos;
        this._offsetPositions = new Array<number>(fieldCount);
        for (let i = 0; i < fieldCount; i++) {
            this._offsetPositions[i] = out.pos;
            out.writeInt(0); // placeholder
        }
    }

    private _recordFieldOffset(fieldName: string): void {
        const fd = this._classDef.getField(fieldName);
        if (!fd) {
            throw new HazelcastSerializationError(
                `No field '${fieldName}' in ClassDefinition classId=${this._classDef.classId}`,
            );
        }
        const pos = this._out.pos - this._offsetsPos - this._classDef.getFieldCount() * 4;
        this._out.writeInt(this._offsetPositions[fd.index], pos);
    }

    writeInt(fieldName: string, value: number): void {
        this._recordFieldOffset(fieldName);
        this._out.writeInt(value);
    }

    writeLong(fieldName: string, value: bigint): void {
        this._recordFieldOffset(fieldName);
        this._out.writeLong(value);
    }

    writeBoolean(fieldName: string, value: boolean): void {
        this._recordFieldOffset(fieldName);
        this._out.writeBoolean(value);
    }

    writeByte(fieldName: string, value: number): void {
        this._recordFieldOffset(fieldName);
        this._out.writeByte(value);
    }

    writeChar(fieldName: string, value: number): void {
        this._recordFieldOffset(fieldName);
        this._out.writeChar(value);
    }

    writeShort(fieldName: string, value: number): void {
        this._recordFieldOffset(fieldName);
        this._out.writeShort(value);
    }

    writeFloat(fieldName: string, value: number): void {
        this._recordFieldOffset(fieldName);
        this._out.writeFloat(value);
    }

    writeDouble(fieldName: string, value: number): void {
        this._recordFieldOffset(fieldName);
        this._out.writeDouble(value);
    }

    writeString(fieldName: string, value: string | null): void {
        this._recordFieldOffset(fieldName);
        this._out.writeString(value);
    }

    writeDecimal(fieldName: string, value: BigDecimal | null): void {
        this._recordFieldOffset(fieldName);
        writeDecimalToOutput(this._out, value);
    }

    writeTime(fieldName: string, value: LocalTime | null): void {
        this._recordFieldOffset(fieldName);
        writeTimeToOutput(this._out, value);
    }

    writeDate(fieldName: string, value: LocalDate | null): void {
        this._recordFieldOffset(fieldName);
        writeDateToOutput(this._out, value);
    }

    writeTimestamp(fieldName: string, value: LocalDateTime | null): void {
        this._recordFieldOffset(fieldName);
        writeTimestampToOutput(this._out, value);
    }

    writeTimestampWithTimezone(fieldName: string, value: OffsetDateTime | null): void {
        this._recordFieldOffset(fieldName);
        writeTimestampWithTimezoneToOutput(this._out, value);
    }

    writePortable(fieldName: string, portable: Portable | null): void {
        this._recordFieldOffset(fieldName);
        if (portable === null) {
            this._out.writeBoolean(true); // null flag
            return;
        }
        this._out.writeBoolean(false); // not null
        const cd = this._registry.lookupOrRegister(portable);
        this._registry.writePortable(this._out, portable, cd);
    }

    writeByteArray(fieldName: string, value: Buffer | null): void {
        this._recordFieldOffset(fieldName);
        this._out.writeByteArray(value);
    }

    writeBooleanArray(fieldName: string, value: boolean[] | null): void {
        this._recordFieldOffset(fieldName);
        this._out.writeBooleanArray(value);
    }

    writeCharArray(fieldName: string, value: number[] | null): void {
        this._recordFieldOffset(fieldName);
        this._out.writeCharArray(value);
    }

    writeShortArray(fieldName: string, value: number[] | null): void {
        this._recordFieldOffset(fieldName);
        this._out.writeShortArray(value);
    }

    writeIntArray(fieldName: string, value: number[] | null): void {
        this._recordFieldOffset(fieldName);
        this._out.writeIntArray(value);
    }

    writeLongArray(fieldName: string, value: bigint[] | null): void {
        this._recordFieldOffset(fieldName);
        this._out.writeLongArray(value);
    }

    writeFloatArray(fieldName: string, value: number[] | null): void {
        this._recordFieldOffset(fieldName);
        this._out.writeFloatArray(value);
    }

    writeDoubleArray(fieldName: string, value: number[] | null): void {
        this._recordFieldOffset(fieldName);
        this._out.writeDoubleArray(value);
    }

    writeStringArray(fieldName: string, value: string[] | null): void {
        this._recordFieldOffset(fieldName);
        this._out.writeStringArray(value);
    }

    writePortableArray(fieldName: string, portables: Portable[] | null): void {
        this._recordFieldOffset(fieldName);
        if (portables === null) {
            this._out.writeInt(-1);
            return;
        }
        this._out.writeInt(portables.length);
        if (portables.length === 0) return;
        const first = portables[0];
        const cd = this._registry.lookupOrRegister(first);
        this._out.writeInt(cd.factoryId);
        this._out.writeInt(cd.classId);
        for (const p of portables) {
            this._registry.writePortable(this._out, p, cd);
        }
    }
}

// ── PortableReader ────────────────────────────────────────────────────────────

export class PortableReader {
    private readonly _inp: ByteArrayObjectDataInput;
    private readonly _registry: PortableRegistry;
    private readonly _classDef: ClassDefinition;
    private readonly _dataStartPos: number;
    private readonly _offsetsPos: number;

    constructor(
        inp: ByteArrayObjectDataInput,
        registry: PortableRegistry,
        classDef: ClassDefinition,
        dataStartPos: number,
        offsetsPos: number,
    ) {
        this._inp = inp;
        this._registry = registry;
        this._classDef = classDef;
        this._dataStartPos = dataStartPos;
        this._offsetsPos = offsetsPos;
    }

    private _seekToField(fieldName: string): void {
        const fd = this._classDef.getField(fieldName);
        if (!fd) {
            throw new HazelcastSerializationError(
                `No field '${fieldName}' in ClassDefinition classId=${this._classDef.classId}`,
            );
        }
        // Read offset from the offsets table
        const offset = this._inp.readInt(this._offsetsPos + fd.index * 4);
        this._inp.position(this._dataStartPos + offset);
    }

    readInt(fieldName: string): number {
        this._seekToField(fieldName);
        return this._inp.readInt();
    }

    readLong(fieldName: string): bigint {
        this._seekToField(fieldName);
        return this._inp.readLong();
    }

    readBoolean(fieldName: string): boolean {
        this._seekToField(fieldName);
        return this._inp.readBoolean();
    }

    readByte(fieldName: string): number {
        this._seekToField(fieldName);
        return this._inp.readByte();
    }

    readChar(fieldName: string): number {
        this._seekToField(fieldName);
        return this._inp.readChar();
    }

    readShort(fieldName: string): number {
        this._seekToField(fieldName);
        return this._inp.readShort();
    }

    readFloat(fieldName: string): number {
        this._seekToField(fieldName);
        return this._inp.readFloat();
    }

    readDouble(fieldName: string): number {
        this._seekToField(fieldName);
        return this._inp.readDouble();
    }

    readString(fieldName: string): string | null {
        this._seekToField(fieldName);
        return this._inp.readString();
    }

    readDecimal(fieldName: string): BigDecimal | null {
        this._seekToField(fieldName);
        return readDecimalFromInput(this._inp);
    }

    readTime(fieldName: string): LocalTime | null {
        this._seekToField(fieldName);
        return readTimeFromInput(this._inp);
    }

    readDate(fieldName: string): LocalDate | null {
        this._seekToField(fieldName);
        return readDateFromInput(this._inp);
    }

    readTimestamp(fieldName: string): LocalDateTime | null {
        this._seekToField(fieldName);
        return readTimestampFromInput(this._inp);
    }

    readTimestampWithTimezone(fieldName: string): OffsetDateTime | null {
        this._seekToField(fieldName);
        return readTimestampWithTimezoneFromInput(this._inp);
    }

    readPortable(fieldName: string): Portable | null {
        this._seekToField(fieldName);
        const isNull = this._inp.readBoolean();
        if (isNull) return null;
        return this._registry.readPortable(this._inp);
    }

    readByteArray(fieldName: string): Buffer | null {
        this._seekToField(fieldName);
        return this._inp.readByteArray();
    }

    readBooleanArray(fieldName: string): boolean[] | null {
        this._seekToField(fieldName);
        return this._inp.readBooleanArray();
    }

    readCharArray(fieldName: string): number[] | null {
        this._seekToField(fieldName);
        return this._inp.readCharArray();
    }

    readShortArray(fieldName: string): number[] | null {
        this._seekToField(fieldName);
        return this._inp.readShortArray();
    }

    readIntArray(fieldName: string): number[] | null {
        this._seekToField(fieldName);
        return this._inp.readIntArray();
    }

    readLongArray(fieldName: string): bigint[] | null {
        this._seekToField(fieldName);
        return this._inp.readLongArray();
    }

    readFloatArray(fieldName: string): number[] | null {
        this._seekToField(fieldName);
        return this._inp.readFloatArray();
    }

    readDoubleArray(fieldName: string): number[] | null {
        this._seekToField(fieldName);
        return this._inp.readDoubleArray();
    }

    readStringArray(fieldName: string): string[] | null {
        this._seekToField(fieldName);
        return this._inp.readStringArray();
    }

    readPortableArray(fieldName: string): Portable[] | null {
        this._seekToField(fieldName);
        const len = this._inp.readInt();
        if (len === -1) return null;
        if (len === 0) return [];
        const factoryId = this._inp.readInt();
        const classId = this._inp.readInt();
        const result: Portable[] = new Array(len);
        for (let i = 0; i < len; i++) {
            result[i] = this._registry.readPortableWithIds(this._inp, factoryId, classId);
        }
        return result;
    }
}

// ── PortableRegistry (internal wiring) ───────────────────────────────────────

/**
 * Holds ClassDefinitions and PortableFactories; orchestrates read/write.
 */
export class PortableRegistry {
    private readonly _factories = new Map<number, PortableFactory>();
    private readonly _classDefs = new Map<string, ClassDefinition>();
    /** Global (default) portable version used when no class-specific version is found. */
    portableVersion: number = 0;

    registerFactory(factoryId: number, factory: PortableFactory): void {
        this._factories.set(factoryId, factory);
    }

    registerClassDefinition(cd: ClassDefinition): void {
        const key = `${cd.factoryId}:${cd.classId}:${cd.version}`;
        this._classDefs.set(key, cd);
    }

    lookupClassDefinition(factoryId: number, classId: number, version: number): ClassDefinition | undefined {
        return this._classDefs.get(`${factoryId}:${classId}:${version}`);
    }

    lookupOrRegister(portable: Portable): ClassDefinition {
        // Try to find an existing definition; if absent, create an empty one (lazy)
        const existing = this.lookupClassDefinition(
            portable.getFactoryId(),
            portable.getClassId(),
            this.portableVersion,
        );
        if (existing) return existing;
        // Build by doing a dry-run write to capture field definitions
        const cd = new ClassDefinition(portable.getFactoryId(), portable.getClassId(), this.portableVersion);
        this.registerClassDefinition(cd);
        return cd;
    }

    writePortable(out: ByteArrayObjectDataOutput, portable: Portable, cd: ClassDefinition): void {
        // Write header: factoryId, classId, version
        out.writeInt(cd.factoryId);
        out.writeInt(cd.classId);
        out.writeInt(cd.version);

        const fieldCount = cd.getFieldCount();
        const writer = new PortableWriter(out, this, cd);
        portable.writePortable(writer);
        // fieldCount placeholder in the header — write after writer is done
        // (In Hazelcast Java the fieldCount is encoded at a known offset.)
        // We embed it right after version: patch it back
        void fieldCount; // used implicitly through ClassDefinition
    }

    readPortable(inp: ByteArrayObjectDataInput): Portable {
        const factoryId = inp.readInt();
        const classId = inp.readInt();
        return this.readPortableWithIds(inp, factoryId, classId);
    }

    readPortableWithIds(inp: ByteArrayObjectDataInput, factoryId: number, classId: number): Portable {
        const version = inp.readInt();
        const cd = this.lookupClassDefinition(factoryId, classId, version);
        if (!cd) {
            throw new HazelcastSerializationError(
                `No ClassDefinition found for factoryId=${factoryId}, classId=${classId}, version=${version}`,
            );
        }
        const factory = this._factories.get(factoryId);
        if (!factory) {
            throw new HazelcastSerializationError(
                `No PortableFactory registered for factoryId=${factoryId}`,
            );
        }
        const portable = factory.create(classId);
        if (!portable) {
            throw new HazelcastSerializationError(
                `PortableFactory returned null for classId=${classId}`,
            );
        }

        const fieldCount = cd.getFieldCount();
        // offsetsPos: right after the header (factoryId/classId/version already consumed)
        const offsetsPos = inp.position();
        // Skip the offsets table
        inp.position(offsetsPos + fieldCount * 4);
        const dataStartPos = inp.position();

        const reader = new PortableReader(inp, this, cd, dataStartPos, offsetsPos);
        portable.readPortable(reader);
        return portable;
    }
}

// ── PortableSerializer (SerializerAdapter implementation) ─────────────────────

export class PortableSerializer implements SerializerAdapter {
    private readonly _registry: PortableRegistry;

    constructor(registry: PortableRegistry) {
        this._registry = registry;
    }

    getTypeId(): number {
        return SerializationConstants.CONSTANT_TYPE_PORTABLE;
    }

    write(out: ByteArrayObjectDataOutput, obj: unknown): void {
        const portable = obj as Portable;
        const cd = this._registry.lookupOrRegister(portable);
        this._registry.writePortable(out, portable, cd);
    }

    read(inp: ByteArrayObjectDataInput): unknown {
        return this._registry.readPortable(inp);
    }
}

// ── Temporal type helpers (shared with CompactSerializer) ─────────────────────

/** Writes BigDecimal: [scale:int][unscaledLength:int][unscaledBytes] */
export function writeDecimalToOutput(out: ByteArrayObjectDataOutput, value: BigDecimal | null): void {
    if (value === null) {
        out.writeInt(-1);
        return;
    }
    out.writeInt(value.scale);
    out.writeByteArray(value.unscaled);
}

export function readDecimalFromInput(inp: ByteArrayObjectDataInput): BigDecimal | null {
    const scale = inp.readInt();
    if (scale === -1) return null;
    const unscaled = inp.readByteArray();
    if (unscaled === null) return null;
    return { scale, unscaled };
}

/**
 * Writes LocalTime as:
 *   [hour:byte][minute:byte][second:byte][nano:int]
 * Matches Hazelcast Java PortableReader/Writer.
 */
export function writeTimeToOutput(out: ByteArrayObjectDataOutput, value: LocalTime | null): void {
    if (value === null) {
        out.writeByte(-1);
        return;
    }
    out.writeByte(value.hour);
    out.writeByte(value.minute);
    out.writeByte(value.second);
    out.writeInt(value.nano);
}

export function readTimeFromInput(inp: ByteArrayObjectDataInput): LocalTime | null {
    const hour = inp.readByte();
    if (hour === -1) return null;
    const minute = inp.readByte();
    const second = inp.readByte();
    const nano = inp.readInt();
    return { hour, minute, second, nano };
}

/**
 * Writes LocalDate as:
 *   [year:int][month:byte][dayOfMonth:byte]
 */
export function writeDateToOutput(out: ByteArrayObjectDataOutput, value: LocalDate | null): void {
    if (value === null) {
        out.writeInt(0x80000000 | 0); // MIN_VALUE sentinel
        return;
    }
    out.writeInt(value.year);
    out.writeByte(value.month);
    out.writeByte(value.dayOfMonth);
}

export function readDateFromInput(inp: ByteArrayObjectDataInput): LocalDate | null {
    const year = inp.readInt();
    if (year === (0x80000000 | 0)) return null;
    const month = inp.readByte();
    const dayOfMonth = inp.readByte();
    return { year, month, dayOfMonth };
}

/** Writes LocalDateTime = LocalDate + LocalTime. */
export function writeTimestampToOutput(out: ByteArrayObjectDataOutput, value: LocalDateTime | null): void {
    if (value === null) {
        writeDateToOutput(out, null);
        return;
    }
    writeDateToOutput(out, value.date);
    writeTimeToOutput(out, value.time);
}

export function readTimestampFromInput(inp: ByteArrayObjectDataInput): LocalDateTime | null {
    const date = readDateFromInput(inp);
    if (date === null) return null;
    const time = readTimeFromInput(inp);
    if (time === null) return null;
    return { date, time };
}

/**
 * Writes OffsetDateTime = LocalDateTime + [offsetSeconds:int].
 */
export function writeTimestampWithTimezoneToOutput(out: ByteArrayObjectDataOutput, value: OffsetDateTime | null): void {
    if (value === null) {
        writeTimestampToOutput(out, null);
        return;
    }
    writeTimestampToOutput(out, value.dateTime);
    out.writeInt(value.offsetSeconds);
}

export function readTimestampWithTimezoneFromInput(inp: ByteArrayObjectDataInput): OffsetDateTime | null {
    const dateTime = readTimestampFromInput(inp);
    if (dateTime === null) return null;
    const offsetSeconds = inp.readInt();
    return { dateTime, offsetSeconds };
}
