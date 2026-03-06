/**
 * Port of {@code com.hazelcast.internal.serialization.impl.ByteArrayObjectDataInputTest}.
 */
import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import {
    ByteArrayObjectDataInput,
    EOFError,
    BIG_ENDIAN,
    LITTLE_ENDIAN,
    type ByteOrder,
} from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';
import { Bits } from '@zenystx/helios-core/internal/nio/Bits';
import type { InternalSerializationService } from '@zenystx/helios-core/internal/serialization/InternalSerializationService';

const INIT_DATA = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0xff]);

function makeMockService(): InternalSerializationService {
    return {
        toData: mock(() => null),
        toObject: mock(() => null),
        writeObject: mock(() => undefined),
        readObject: mock(() => null),
        getClassLoader: mock(() => null),
    } as unknown as InternalSerializationService;
}

function createDataInput(bo: ByteOrder, service: InternalSerializationService): ByteArrayObjectDataInput {
    return new ByteArrayObjectDataInput(Buffer.from(INIT_DATA), service, bo);
}

describe('ByteArrayObjectDataInputTest', () => {
    let mockService: InternalSerializationService;
    let byteOrder: ByteOrder;
    let inp: ByteArrayObjectDataInput;

    beforeEach(() => {
        mockService = makeMockService();
        byteOrder = BIG_ENDIAN;
        inp = createDataInput(byteOrder, mockService);
    });

    afterEach(() => {
        inp.close();
    });

    // ── init ────────────────────────────────────────────────────────────────

    test('testInit', () => {
        inp.init(Buffer.from(INIT_DATA), 2);
        expect(inp.data).toEqual(INIT_DATA);
        expect(inp.size).toBe(INIT_DATA.length);
        expect(inp.pos).toBe(2);
    });

    test('testInit_null', () => {
        inp.init(null, 0);
        expect(inp.data).toBeNull();
        expect(inp.size).toBe(0);
        expect(inp.pos).toBe(0);
    });

    test('testClear', () => {
        inp.clear();
        expect(inp.data).toBeNull();
        expect(inp.size).toBe(0);
        expect(inp.pos).toBe(0);
        expect(inp.markPos).toBe(0);
    });

    // ── read ────────────────────────────────────────────────────────────────

    test('testRead', () => {
        for (let i = 0; i < inp.size; i++) {
            const readValidPos = inp.read();
            expect(readValidPos).toBe(INIT_DATA[i] & 0xff);
        }
        expect(inp.read()).toBe(-1);
    });

    test('testReadPosition', () => {
        const read = inp.readAt(1);
        const readUnsigned = inp.readAt(INIT_DATA.length - 1);
        const readEnd = inp.readAt(INIT_DATA.length);
        expect(read).toBe(1);
        expect(readUnsigned).toBe(0xff);
        expect(readEnd).toBe(-1);
    });

    test('testReadForBOffLen', () => {
        const b = Buffer.allocUnsafe(INIT_DATA.length);
        const read = inp.readBytes(b, 0, 5);
        expect(read).toBe(5);
    });

    test('testReadForBOffLen_null_array', () => {
        expect(() => inp.readBytes(null as unknown as Buffer, 0, 1)).toThrow();
    });

    test('testReadForBOffLen_negativeLen', () => {
        expect(() => inp.readBytes(Buffer.from(INIT_DATA), 0, -11)).toThrow();
    });

    test('testReadForBOffLen_negativeOffset', () => {
        expect(() => inp.readBytes(Buffer.from(INIT_DATA), -10, 1)).toThrow();
    });

    test('testReadForBOffLen_Len_LT_Bytes', () => {
        expect(() => inp.readBytes(Buffer.from(INIT_DATA), 0, INIT_DATA.length + 1)).toThrow();
    });

    test('testReadForBOffLen_pos_gt_size', () => {
        inp.pos = 100;
        const b = Buffer.allocUnsafe(INIT_DATA.length);
        const read = inp.readBytes(b, 0, 1);
        expect(read).toBe(-1);
    });

    // ── readBoolean ─────────────────────────────────────────────────────────

    test('testReadBoolean', () => {
        const read1 = inp.readBoolean();
        const read2 = inp.readBoolean();
        expect(read1).toBe(false);
        expect(read2).toBe(true);
    });

    test('testReadBooleanPosition', () => {
        const read1 = inp.readBoolean(0);
        const read2 = inp.readBoolean(1);
        expect(read1).toBe(false);
        expect(read2).toBe(true);
    });

    test('testReadBoolean_EOF', () => {
        inp.pos = INIT_DATA.length + 1;
        expect(() => inp.readBoolean()).toThrow(EOFError);
    });

    test('testReadBooleanPosition_EOF', () => {
        expect(() => inp.readBoolean(INIT_DATA.length + 1)).toThrow(EOFError);
    });

    // ── readByte ────────────────────────────────────────────────────────────

    test('testReadByte', () => {
        const read = inp.readByte();
        expect(read).toBe(0);
    });

    test('testReadBytePosition', () => {
        const read = inp.readByte(1);
        expect(read).toBe(1);
    });

    test('testReadByte_EOF', () => {
        inp.pos = INIT_DATA.length + 1;
        expect(() => inp.readByte()).toThrow(EOFError);
    });

    test('testReadBytePosition_EOF', () => {
        expect(() => inp.readByte(INIT_DATA.length + 1)).toThrow(EOFError);
    });

    // ── readChar ────────────────────────────────────────────────────────────

    test('testReadChar', () => {
        const c = inp.readChar();
        const expected = Bits.readChar(Buffer.from(INIT_DATA), 0, byteOrder === BIG_ENDIAN);
        expect(c).toBe(expected);
    });

    test('testReadCharPosition', () => {
        const c = inp.readChar(0);
        const expected = Bits.readChar(Buffer.from(INIT_DATA), 0, byteOrder === BIG_ENDIAN);
        expect(c).toBe(expected);
    });

    // ── readDouble ──────────────────────────────────────────────────────────

    test('testReadDouble', () => {
        const readDouble = inp.readDouble();
        const longB = Bits.readLong(Buffer.from(INIT_DATA), 0, byteOrder === BIG_ENDIAN);
        const aDouble = longBitsToDouble(longB);
        expect(readDouble).toBe(aDouble);
    });

    test('testReadDoublePosition', () => {
        const readDouble = inp.readDouble(2);
        const longB = Bits.readLong(Buffer.from(INIT_DATA), 2, byteOrder === BIG_ENDIAN);
        const aDouble = longBitsToDouble(longB);
        expect(readDouble).toBe(aDouble);
    });

    test('testReadDoubleByteOrder', () => {
        const readDouble = inp.readDouble(LITTLE_ENDIAN);
        const longB = Bits.readLong(Buffer.from(INIT_DATA), 0, false);
        const aDouble = longBitsToDouble(longB);
        expect(readDouble).toBe(aDouble);
    });

    test('testReadDoubleForPositionByteOrder', () => {
        const readDouble = inp.readDouble(2, LITTLE_ENDIAN);
        const longB = Bits.readLong(Buffer.from(INIT_DATA), 2, false);
        const aDouble = longBitsToDouble(longB);
        expect(readDouble).toBe(aDouble);
    });

    // ── readFloat ───────────────────────────────────────────────────────────

    test('testReadFloat', () => {
        const readFloat = inp.readFloat();
        const intB = Bits.readInt(Buffer.from(INIT_DATA), 0, byteOrder === BIG_ENDIAN);
        const aFloat = intBitsToFloat(intB);
        expect(readFloat).toBe(aFloat);
    });

    test('testReadFloatPosition', () => {
        const readFloat = inp.readFloat(2);
        const intB = Bits.readInt(Buffer.from(INIT_DATA), 2, byteOrder === BIG_ENDIAN);
        const aFloat = intBitsToFloat(intB);
        expect(readFloat).toBe(aFloat);
    });

    test('testReadFloatByteOrder', () => {
        const readFloat = inp.readFloat(LITTLE_ENDIAN);
        const intB = Bits.readIntL(Buffer.from(INIT_DATA), 0);
        const aFloat = intBitsToFloat(intB);
        expect(readFloat).toBe(aFloat);
    });

    test('testReadFloatForPositionByteOrder', () => {
        const readFloat = inp.readFloat(2, LITTLE_ENDIAN);
        const intB = Bits.readIntL(Buffer.from(INIT_DATA), 2);
        const aFloat = intBitsToFloat(intB);
        expect(readFloat).toBe(aFloat);
    });

    // ── readFully ───────────────────────────────────────────────────────────

    test('testReadFullyB', () => {
        const readFull = Buffer.allocUnsafe(INIT_DATA.length);
        inp.readFully(readFull);
        expect(readFull).toEqual(Buffer.from(inp.data!));
    });

    test('testReadFullyB_EOF', () => {
        inp.position(INIT_DATA.length);
        const readFull = Buffer.allocUnsafe(INIT_DATA.length);
        expect(() => inp.readFully(readFull)).toThrow(EOFError);
    });

    test('testReadFullyForBOffLen', () => {
        const readFull = Buffer.alloc(10);
        inp.readFully(readFull, 0, 5);
        for (let i = 0; i < 5; i++) {
            expect(readFull[i]).toBe(inp.data![i]);
        }
    });

    test('testReadFullyForBOffLen_EOF', () => {
        inp.position(INIT_DATA.length);
        const readFull = Buffer.allocUnsafe(INIT_DATA.length);
        expect(() => inp.readFully(readFull, 0, readFull.length)).toThrow(EOFError);
    });

    // ── readInt ─────────────────────────────────────────────────────────────

    test('testReadInt', () => {
        const readInt = inp.readInt();
        const theInt = Bits.readInt(Buffer.from(INIT_DATA), 0, byteOrder === BIG_ENDIAN);
        expect(readInt).toBe(theInt);
    });

    test('testReadIntPosition', () => {
        const readInt = inp.readInt(2);
        const theInt = Bits.readInt(Buffer.from(INIT_DATA), 2, byteOrder === BIG_ENDIAN);
        expect(readInt).toBe(theInt);
    });

    test('testReadIntByteOrder', () => {
        const readInt = inp.readInt(LITTLE_ENDIAN);
        const theInt = Bits.readIntL(Buffer.from(INIT_DATA), 0);
        expect(readInt).toBe(theInt);
    });

    test('testReadIntForPositionByteOrder', () => {
        const readInt1 = inp.readInt(1, BIG_ENDIAN);
        const readInt2 = inp.readInt(5, LITTLE_ENDIAN);
        const theInt1 = Bits.readInt(Buffer.from(INIT_DATA), 1, true);
        const theInt2 = Bits.readInt(Buffer.from(INIT_DATA), 5, false);
        expect(readInt1).toBe(theInt1);
        expect(readInt2).toBe(theInt2);
    });

    test('testReadLine', () => {
        expect(() => inp.readLine()).toThrow();
    });

    // ── readLong ────────────────────────────────────────────────────────────

    test('testReadLong', () => {
        const readLong = inp.readLong();
        const expected = Bits.readLong(Buffer.from(INIT_DATA), 0, byteOrder === BIG_ENDIAN);
        expect(readLong).toBe(expected);
    });

    test('testReadLongPosition', () => {
        const readLong = inp.readLong(2);
        const longB = Bits.readLong(Buffer.from(INIT_DATA), 2, byteOrder === BIG_ENDIAN);
        expect(readLong).toBe(longB);
    });

    test('testReadLongByteOrder', () => {
        const readLong = inp.readLong(LITTLE_ENDIAN);
        const longB = Bits.readLongL(Buffer.from(INIT_DATA), 0);
        expect(readLong).toBe(longB);
    });

    test('testReadLongForPositionByteOrder', () => {
        const readLong1 = inp.readLong(0, LITTLE_ENDIAN);
        const readLong2 = inp.readLong(2, BIG_ENDIAN);
        const longB1 = Bits.readLong(Buffer.from(INIT_DATA), 0, false);
        const longB2 = Bits.readLong(Buffer.from(INIT_DATA), 2, true);
        expect(readLong1).toBe(longB1);
        expect(readLong2).toBe(longB2);
    });

    // ── readShort ───────────────────────────────────────────────────────────

    test('testReadShort', () => {
        const read = inp.readShort();
        const val = Bits.readShort(Buffer.from(INIT_DATA), 0, byteOrder === BIG_ENDIAN);
        expect(read).toBe(val);
    });

    test('testReadShortPosition', () => {
        const read = inp.readShort(1);
        const val = Bits.readShort(Buffer.from(INIT_DATA), 1, byteOrder === BIG_ENDIAN);
        expect(read).toBe(val);
    });

    test('testReadShortByteOrder', () => {
        const read = inp.readShort(LITTLE_ENDIAN);
        const val = Bits.readShortL(Buffer.from(INIT_DATA), 0);
        expect(read).toBe(val);
    });

    test('testReadShortForPositionByteOrder', () => {
        const read1 = inp.readShort(1, LITTLE_ENDIAN);
        const read2 = inp.readShort(3, BIG_ENDIAN);
        const val1 = Bits.readShort(Buffer.from(INIT_DATA), 1, false);
        const val2 = Bits.readShort(Buffer.from(INIT_DATA), 3, true);
        expect(read1).toBe(val1);
        expect(read2).toBe(val2);
    });

    // ── array reads ─────────────────────────────────────────────────────────

    test('testReadByteArray', () => {
        const bytesBE = Buffer.from([0, 0, 0, 0, 0, 0, 0, 1, 1, 9, 0xff, 0xff, 0xff, 0xff]);
        const bytesLE = Buffer.from([0, 0, 0, 0, 1, 0, 0, 0, 1, 9, 0xff, 0xff, 0xff, 0xff]);
        inp.init(byteOrder === BIG_ENDIAN ? bytesBE : bytesLE, 0);

        inp.position(10);
        const theNullArray = inp.readByteArray();
        inp.position(0);
        const theZeroLengthArray = inp.readByteArray();
        inp.position(4);
        const bytes = inp.readByteArray();

        expect(theNullArray).toBeNull();
        expect(theZeroLengthArray).toEqual(Buffer.alloc(0));
        expect(bytes).toEqual(Buffer.from([1]));
    });

    test('testReadBooleanArray', () => {
        const bytesBE = Buffer.from([0, 0, 0, 0, 0, 0, 0, 1, 1, 9, 0xff, 0xff, 0xff, 0xff]);
        const bytesLE = Buffer.from([0, 0, 0, 0, 1, 0, 0, 0, 1, 9, 0xff, 0xff, 0xff, 0xff]);
        inp.init(byteOrder === BIG_ENDIAN ? bytesBE : bytesLE, 0);

        inp.position(10);
        const theNullArray = inp.readBooleanArray();
        inp.position(0);
        const theZeroLengthArray = inp.readBooleanArray();
        inp.position(4);
        const booleanArray = inp.readBooleanArray();

        expect(theNullArray).toBeNull();
        expect(theZeroLengthArray).toEqual([]);
        expect(booleanArray).toEqual([true]);
    });

    test('testReadCharArray', () => {
        const bytesBE = Buffer.from([0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0xff, 0xff, 0xff, 0xff]);
        const bytesLE = Buffer.from([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0xff, 0xff, 0xff, 0xff]);
        inp.init(byteOrder === BIG_ENDIAN ? bytesBE : bytesLE, 0);

        inp.position(10);
        const theNullArray = inp.readCharArray();
        inp.position(0);
        const theZeroLengthArray = inp.readCharArray();
        inp.position(4);
        const charArray = inp.readCharArray();

        expect(theNullArray).toBeNull();
        expect(theZeroLengthArray).toEqual([]);
        expect(charArray).toEqual([1]);
    });

    test('testReadIntArray', () => {
        const bytesBE = Buffer.from([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0xff, 0xff, 0xff, 0xff]);
        const bytesLE = Buffer.from([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0xff, 0xff, 0xff, 0xff]);
        inp.init(byteOrder === BIG_ENDIAN ? bytesBE : bytesLE, 0);

        inp.position(12);
        const theNullArray = inp.readIntArray();
        inp.position(0);
        const theZeroLengthArray = inp.readIntArray();
        inp.position(4);
        const bytes = inp.readIntArray();

        expect(theNullArray).toBeNull();
        expect(theZeroLengthArray).toEqual([]);
        expect(bytes).toEqual([1]);
    });

    test('testReadLongArray', () => {
        const bytesBE = Buffer.from([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0xff, 0xff, 0xff, 0xff]);
        const bytesLE = Buffer.from([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff]);
        inp.init(byteOrder === BIG_ENDIAN ? bytesBE : bytesLE, 0);

        inp.position(bytesLE.length - 4);
        const theNullArray = inp.readLongArray();
        inp.position(0);
        const theZeroLengthArray = inp.readLongArray();
        inp.position(4);
        const bytes = inp.readLongArray();

        expect(theNullArray).toBeNull();
        expect(theZeroLengthArray).toEqual([]);
        expect(bytes).toEqual([1n]);
    });

    test('testReadDoubleArray', () => {
        const bytesBE = Buffer.from([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0xff, 0xff, 0xff, 0xff]);
        const bytesLE = Buffer.from([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff]);
        inp.init(byteOrder === BIG_ENDIAN ? bytesBE : bytesLE, 0);

        inp.position(bytesLE.length - 4);
        const theNullArray = inp.readDoubleArray();
        inp.position(0);
        const theZeroLengthArray = inp.readDoubleArray();
        inp.position(4);
        const doubles = inp.readDoubleArray();

        expect(theNullArray).toBeNull();
        expect(theZeroLengthArray).toEqual([]);
        expect(doubles).toEqual([longBitsToDouble(1n)]);
    });

    test('testReadFloatArray', () => {
        const bytesBE = Buffer.from([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0xff, 0xff, 0xff, 0xff]);
        const bytesLE = Buffer.from([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0xff, 0xff, 0xff, 0xff]);
        inp.init(byteOrder === BIG_ENDIAN ? bytesBE : bytesLE, 0);

        inp.position(bytesLE.length - 4);
        const theNullArray = inp.readFloatArray();
        inp.position(0);
        const theZeroLengthArray = inp.readFloatArray();
        inp.position(4);
        const floats = inp.readFloatArray();

        expect(theNullArray).toBeNull();
        expect(theZeroLengthArray).toEqual([]);
        expect(floats).toEqual([intBitsToFloat(1)]);
    });

    test('testReadShortArray', () => {
        const bytesBE = Buffer.from([0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0xff, 0xff, 0xff, 0xff]);
        const bytesLE = Buffer.from([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0xff, 0xff, 0xff, 0xff]);
        inp.init(byteOrder === BIG_ENDIAN ? bytesBE : bytesLE, 0);

        inp.position(bytesLE.length - 4);
        const theNullArray = inp.readShortArray();
        inp.position(0);
        const theZeroLengthArray = inp.readShortArray();
        inp.position(4);
        const booleanArray = inp.readShortArray();

        expect(theNullArray).toBeNull();
        expect(theZeroLengthArray).toEqual([]);
        expect(booleanArray).toEqual([1]);
    });

    test('testReadUTFArray', () => {
        // readStringArray: length prefix + string content (length prefix + UTF-8 bytes)
        // Build: [count=1 (4 bytes), str_len=1 (4 bytes), byte 0x20=space]
        const bytesBE = Buffer.from([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0x20, 9, 0xff, 0xff, 0xff, 0xff]);
        const bytesLE = Buffer.from([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0x20, 9, 0xff, 0xff, 0xff, 0xff]);
        inp.init(byteOrder === BIG_ENDIAN ? bytesBE : bytesLE, 0);

        inp.position(bytesLE.length - 4);
        const theNullArray = inp.readStringArray();
        inp.position(0);
        const theZeroLengthArray = inp.readStringArray();
        inp.position(4);
        const bytes = inp.readStringArray();

        expect(theNullArray).toBeNull();
        expect(theZeroLengthArray).toEqual([]);
        expect(bytes).toEqual([' ']);
    });

    test('testReadUnsignedByte', () => {
        inp.init(Buffer.from([0xff, 0xff, 0xff, 0xff]), 0);
        const unsigned = inp.readUnsignedByte();
        expect(unsigned).toBe(0xff);
    });

    test('testReadUnsignedShort', () => {
        const bytes1 = Buffer.from([0, 0, 0, 0, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 1, 0xff, 0xff, 0xff, 0xff]);
        inp.init(bytes1, bytes1.length - 4);
        const unsigned = inp.readUnsignedShort();
        expect(unsigned).toBe(0xffff);
    });

    // ── readObject, readData ─────────────────────────────────────────────────

    test('testReadObject', () => {
        const spy = spyOn(mockService, 'readObject');
        inp.readObject();
        expect(spy).toHaveBeenCalledWith(inp);
    });

    test('testReadData', () => {
        const bytesBE = Buffer.from([0, 0, 0, 0, 0, 0, 0, 8, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0, 0, 1, 0xff, 0xff, 0xff, 0xff]);
        const bytesLE = Buffer.from([0, 0, 0, 0, 8, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0, 0, 1, 0xff, 0xff, 0xff, 0xff]);
        inp.init(byteOrder === BIG_ENDIAN ? bytesBE : bytesLE, 0);

        inp.position(bytesLE.length - 4);
        const nullData = inp.readData();
        inp.position(0);
        const theZeroLengthArray = inp.readData();
        inp.position(4);
        const data = inp.readData();

        expect(nullData).toBeNull();
        expect(theZeroLengthArray!.getType()).toBe(0);
        expect(theZeroLengthArray!.toByteArray()).toEqual(Buffer.alloc(0));
        expect(data!.toByteArray()).toEqual(Buffer.from([0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0]));
    });

    // ── skip ────────────────────────────────────────────────────────────────

    test('testSkip', () => {
        const s1 = inp.skip(-1);
        const s2 = inp.skip(2147483647);
        const s3 = inp.skip(1);
        expect(s1).toBe(0);
        expect(s2).toBe(0);
        expect(s3).toBe(1);
    });

    test('testSkipBytes', () => {
        const s1 = inp.skipBytes(-1);
        const s2 = inp.skipBytes(1);
        inp.position(0);
        const maxSkipBytes = inp.available();
        const s3 = inp.skipBytes(INIT_DATA.length);
        expect(s1).toBe(0);
        expect(s2).toBe(1);
        expect(s3).toBe(maxSkipBytes);
    });

    // ── position ────────────────────────────────────────────────────────────

    test('testPosition', () => {
        expect(inp.position()).toBe(0);
    });

    test('testPositionNewPos', () => {
        inp.position(INIT_DATA.length - 1);
        expect(inp.position()).toBe(INIT_DATA.length - 1);
    });

    test('testPositionNewPos_mark', () => {
        inp.position(INIT_DATA.length - 1);
        inp.mark(0);
        const firstMarked = inp.markPos;
        inp.position(1);
        expect(firstMarked).toBe(INIT_DATA.length - 1);
        expect(inp.position()).toBe(1);
        expect(inp.markPos).toBe(-1);
    });

    test('testPositionNewPos_HighNewPos', () => {
        expect(() => inp.position(INIT_DATA.length + 10)).toThrow();
    });

    test('testPositionNewPos_negativeNewPos', () => {
        expect(() => inp.position(-1)).toThrow();
    });

    // ── checkAvailable ───────────────────────────────────────────────────────

    test('testCheckAvailable', () => {
        expect(() => inp.checkAvailable(-1, INIT_DATA.length)).toThrow();
    });

    test('testCheckAvailable_EOF', () => {
        expect(() => inp.checkAvailable(0, INIT_DATA.length + 1)).toThrow(EOFError);
    });

    // ── misc ────────────────────────────────────────────────────────────────

    test('testAvailable', () => {
        expect(inp.available()).toBe(inp.size - inp.pos);
    });

    test('testMarkSupported', () => {
        expect(inp.markSupported()).toBe(true);
    });

    test('testMark', () => {
        inp.position(1);
        inp.mark(1);
        expect(inp.markPos).toBe(1);
    });

    test('testReset', () => {
        inp.position(1);
        inp.mark(1);
        inp.reset();
        expect(inp.pos).toBe(1);
    });

    test('testClose', () => {
        inp.close();
        expect(inp.data).toBeNull();
        expect(inp.charBuffer).toBeNull();
    });

    test('testGetClassLoader', () => {
        const spy = spyOn(mockService, 'getClassLoader');
        inp.getClassLoader();
        expect(spy).toHaveBeenCalled();
    });

    test('testGetByteOrder', () => {
        const inputLE = createDataInput(LITTLE_ENDIAN, mockService);
        expect(inputLE.getByteOrder()).toBe(LITTLE_ENDIAN);
        expect(inp.getByteOrder()).toBe(byteOrder);
        inputLE.close();
    });

    test('testToString', () => {
        expect(inp.toString()).toBeTruthy();
    });
});

// ── helpers ──────────────────────────────────────────────────────────────────

function longBitsToDouble(bits: bigint): number {
    const buf = Buffer.allocUnsafe(8);
    buf.writeBigInt64BE(bits, 0);
    return buf.readDoubleBE(0);
}

function intBitsToFloat(bits: number): number {
    const buf = Buffer.allocUnsafe(4);
    buf.writeInt32BE(bits, 0);
    return buf.readFloatBE(0);
}
