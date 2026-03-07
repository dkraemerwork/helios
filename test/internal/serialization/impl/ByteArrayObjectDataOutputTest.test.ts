/**
 * Port of {@code com.hazelcast.internal.serialization.impl.ByteArrayObjectDataOutputTest}.
 */
import { Bits } from '@zenystx/helios-core/internal/nio/Bits';
import { BIG_ENDIAN, LITTLE_ENDIAN } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';
import {
    ByteArrayObjectDataOutput,
    MAX_ARRAY_SIZE,
} from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput';
import type { InternalSerializationService } from '@zenystx/helios-core/internal/serialization/InternalSerializationService';
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';

const TEST_DATA = Buffer.from([1, 2, 3]);

function makeMockService(): InternalSerializationService {
    return {
        toData: mock(() => null),
        toObject: mock(() => null),
        writeObject: mock(() => undefined),
        readObject: mock(() => null),
        getClassLoader: mock(() => null),
    } as unknown as InternalSerializationService;
}

describe('ByteArrayObjectDataOutputTest', () => {
    // Run tests once (parametrised in Java, but we cover both constructors inline where needed)
    let mockService: InternalSerializationService;
    let out: ByteArrayObjectDataOutput;

    beforeEach(() => {
        mockService = makeMockService();
        // mirrors useHugeFirstGrowth=true: new ByteArrayObjectDataOutput(10, 100, service, BIG_ENDIAN)
        out = new ByteArrayObjectDataOutput(10, 100, mockService, BIG_ENDIAN);
    });

    afterEach(() => {
        out.close();
    });

    test('testWriteForPositionB', () => {
        out.write(1, 5);
        expect(out.buffer[1]).toBe(5);
    });

    test('testWriteForBOffLen', () => {
        const zeroBytes = Buffer.alloc(20);
        out.writeBytes(zeroBytes, 0, 20);
        const bytes = out.buffer.slice(0, 20);
        expect(bytes).toEqual(zeroBytes);
        expect(out.pos).toBe(20);
    });

    test('testWriteForBOffLen_negativeOff', () => {
        expect(() => out.writeBytes(TEST_DATA, -1, 3)).toThrow();
    });

    test('testWriteForBOffLen_negativeLen', () => {
        expect(() => out.writeBytes(TEST_DATA, 0, -3)).toThrow();
    });

    test('testWriteForBOffLen_OffLenHigherThenSize', () => {
        expect(() => out.writeBytes(TEST_DATA, 0, -3)).toThrow();
    });

    test('testWrite_whenBufferIsNull', () => {
        expect(() => out.writeBytes(null as unknown as Buffer, 0, 0)).toThrow();
    });

    test('testWriteBooleanForPositionV', () => {
        out.writeBoolean(0, true);
        out.writeBoolean(1, false);
        expect(out.buffer[0]).toBe(1);
        expect(out.buffer[1]).toBe(0);
    });

    test('testWriteByteForPositionV', () => {
        out.writeByte(0, 10);
        expect(out.buffer[0]).toBe(10);
    });

    test('testWriteDoubleForPositionV', () => {
        const v = 1.1;
        out.writeDouble(1, v);
        const theLong = doubleToLongBits(v);
        const readLongB = Bits.readLongB(out.buffer, 1);
        expect(readLongB).toBe(theLong);
    });

    test('testWriteDoubleForVByteOrder', () => {
        const v = 1.1;
        out.writeDouble(v, LITTLE_ENDIAN);
        const theLong = doubleToLongBits(v);
        const readLongB = Bits.readLongL(out.buffer, 0);
        expect(readLongB).toBe(theLong);
    });

    test('testWriteDoubleForPositionVByteOrder', () => {
        const v = 1.1;
        out.writeDouble(1, v, LITTLE_ENDIAN);
        const theLong = doubleToLongBits(v);
        const readLongB = Bits.readLongL(out.buffer, 1);
        expect(readLongB).toBe(theLong);
    });

    test('testWriteFloatV', () => {
        const v = 1.1;
        out.writeFloat(v);
        const expected = floatToIntBits(v);
        const actual = Bits.readIntB(out.buffer, 0);
        expect(actual).toBe(expected);
    });

    test('testWriteFloatForPositionV', () => {
        const v = 1.1;
        out.writeFloat(1, v);
        const expected = floatToIntBits(v);
        const actual = Bits.readIntB(out.buffer, 1);
        expect(actual).toBe(expected);
    });

    test('testWriteFloatForVByteOrder', () => {
        const v = 1.1;
        out.writeFloat(v, LITTLE_ENDIAN);
        const expected = floatToIntBits(v);
        const actual = Bits.readIntL(out.buffer, 0);
        expect(actual).toBe(expected);
    });

    test('testWriteFloatForPositionVByteOrder', () => {
        const v = 1.1;
        out.writeFloat(1, v, LITTLE_ENDIAN);
        const expected = floatToIntBits(v);
        const actual = Bits.readIntL(out.buffer, 1);
        expect(actual).toBe(expected);
    });

    test('testWriteIntV', () => {
        const expected = 100;
        out.writeInt(expected);
        const actual = Bits.readIntB(out.buffer, 0);
        expect(actual).toBe(expected);
    });

    test('testWriteIntForPositionV', () => {
        const expected = 100;
        out.writeInt(1, expected);
        const actual = Bits.readIntB(out.buffer, 1);
        expect(actual).toBe(expected);
    });

    test('testWriteIntForVByteOrder', () => {
        const expected = 100;
        out.writeInt(expected, LITTLE_ENDIAN);
        const actual = Bits.readIntL(out.buffer, 0);
        expect(actual).toBe(expected);
    });

    test('testWriteIntForPositionVByteOrder', () => {
        const expected = 100;
        out.writeInt(2, expected, LITTLE_ENDIAN);
        const actual = Bits.readIntL(out.buffer, 2);
        expect(actual).toBe(expected);
    });

    test('testWriteLongV', () => {
        const expected = 100n;
        out.writeLong(expected);
        const actual = Bits.readLongB(out.buffer, 0);
        expect(actual).toBe(expected);
    });

    test('testWriteLongForPositionV', () => {
        const expected = 100n;
        out.writeLong(2, expected);
        const actual = Bits.readLongB(out.buffer, 2);
        expect(actual).toBe(expected);
    });

    test('testWriteLongForVByteOrder', () => {
        const expected = 100n;
        out.writeLong(2, expected, LITTLE_ENDIAN);
        const actual = Bits.readLongL(out.buffer, 2);
        expect(actual).toBe(expected);
    });

    test('testWriteLongForPositionVByteOrder', () => {
        const expected = 100n;
        out.writeLong(2, expected, LITTLE_ENDIAN);
        const actual = Bits.readLongL(out.buffer, 2);
        expect(actual).toBe(expected);
    });

    test('testWriteShortV', () => {
        const expected: number = 100;
        out.writeShort(expected);
        const actual = Bits.readShortB(out.buffer, 0);
        expect(actual).toBe(expected);
    });

    test('testWriteShortForPositionV', () => {
        const expected: number = 100;
        out.writeShort(2, expected);
        const actual = Bits.readShortB(out.buffer, 2);
        expect(actual).toBe(expected);
    });

    test('testWriteShortForVByteOrder', () => {
        const expected: number = 100;
        out.writeShort(2, expected, LITTLE_ENDIAN);
        const actual = Bits.readShortL(out.buffer, 2);
        expect(actual).toBe(expected);
    });

    test('testWriteShortForPositionVByteOrder', () => {
        const expected: number = 100;
        out.writeShort(2, expected, LITTLE_ENDIAN);
        const actual = Bits.readShortL(out.buffer, 2);
        expect(actual).toBe(expected);
    });

    test('testWriteShortForPositionVAndByteOrder', () => {
        const expected: number = 42;
        out.pos = 2;
        out.writeShort(42, LITTLE_ENDIAN);
        const actual = Bits.readShortL(out.buffer, 2);
        expect(actual).toBe(expected);
    });

    test('testEnsureAvailable', () => {
        out.buffer = null as unknown as Buffer;
        out.ensureAvailable(5);
        expect(out.buffer.length).toBe(10);
    });

    test('testEnsureAvailable_smallLen', () => {
        out.buffer = null as unknown as Buffer;
        out.ensureAvailable(1);
        expect(out.buffer.length).toBe(10);
    });

    test('testWriteObject', () => {
        const spy = spyOn(mockService, 'writeObject');
        out.writeObject('TEST');
        expect(spy).toHaveBeenCalledWith(out, 'TEST');
    });

    test('testPosition', () => {
        out.pos = 21;
        expect(out.position()).toBe(21);
    });

    test('testPositionNewPos', () => {
        out.position(1);
        expect(out.pos).toBe(1);
    });

    test('testPositionNewPos_negativePos', () => {
        expect(() => out.position(-1)).toThrow();
    });

    test('testPositionNewPos_highPos', () => {
        expect(() => out.position(out.buffer.length + 1)).toThrow();
    });

    test('testAvailable', () => {
        const available = out.available();
        out.buffer = null as unknown as Buffer;
        const availableWhenBufferNull = out.available();
        expect(available).toBe(10);
        expect(availableWhenBufferNull).toBe(0);
    });

    test('testToByteArray', () => {
        const arrayWhenPosZero = out.toByteArray();
        out.buffer = null as unknown as Buffer;
        const arrayWhenBufferNull = out.toByteArray();
        expect(arrayWhenPosZero).toEqual(Buffer.alloc(0));
        expect(arrayWhenBufferNull).toEqual(Buffer.alloc(0));
    });

    test('testClear', () => {
        out.clear();
        expect(out.position()).toBe(0);
        expect(out.available()).toBe(10);
    });

    test('testClear_bufferNull', () => {
        out.buffer = null as unknown as Buffer;
        out.clear();
        expect(out.buffer).toBeNull();
    });

    test('testClear_bufferLen_lt_initX8', () => {
        out.ensureAvailable(10 * 10);
        out.clear();
        expect(out.available()).toBe(10 * 8);
    });

    test('testClose', () => {
        out.close();
        expect(out.position()).toBe(0);
        expect(out.buffer).toBeNull();
    });

    test('testGetByteOrder', () => {
        const outLE = new ByteArrayObjectDataOutput(10, mockService, LITTLE_ENDIAN);
        const outBE = new ByteArrayObjectDataOutput(10, mockService, BIG_ENDIAN);
        expect(outLE.getByteOrder()).toBe(LITTLE_ENDIAN);
        expect(outBE.getByteOrder()).toBe(BIG_ENDIAN);
    });

    test('testOverflowScenario', () => {
        const hugeLength = Math.floor(2147483647 / 2) + 1;
        const mockOut = new MockLengthOutput(hugeLength);
        const newCapacity = mockOut.getNewCapacity(20);
        expect(newCapacity).toBe(MAX_ARRAY_SIZE);
    });

    test('testExceptionThrownForTooLargeCapacity', () => {
        testExceptionThrownForTooLargeCapacity(MAX_ARRAY_SIZE, 20);
    });

    test('testExceptionThrownForTooLargeCapacity_WhenInitialLengthSmall', () => {
        testExceptionThrownForTooLargeCapacity(20, MAX_ARRAY_SIZE);
    });

    test('testExceptionThrownForTooLargeCapacity_WhenInitialLengthHalf', () => {
        const initialLength = Math.floor(2147483647 / 2) + 1;
        testExceptionThrownForTooLargeCapacity(initialLength, (MAX_ARRAY_SIZE - initialLength) + 1);
    });

    test('testExceptionThrownForTooLargeCapacity_WithIntegerOverflow', () => {
        testExceptionThrownForTooLargeCapacity(Math.floor(2147483647 / 2) + 1, Math.floor(2147483647 / 2) + 2);
    });

    test('testToString', () => {
        expect(out.toString()).toBeTruthy();
    });
});

// ── helpers ──────────────────────────────────────────────────────────────────

class MockLengthOutput extends ByteArrayObjectDataOutput {
    private readonly _length: number;
    constructor(mockedLength: number) {
        super(16, null, BIG_ENDIAN);
        this._length = mockedLength;
    }
    getBufferLength(): number { return this._length; }
}

function testExceptionThrownForTooLargeCapacity(initialLength: number, requestedLength: number): void {
    const mockOut = new MockLengthOutput(initialLength);
    expect(() => mockOut.getNewCapacity(requestedLength)).toThrow();
}

function doubleToLongBits(v: number): bigint {
    const buf = Buffer.allocUnsafe(8);
    buf.writeDoubleBE(v, 0);
    return buf.readBigInt64BE(0);
}

function floatToIntBits(v: number): number {
    // Single-precision float → int bits (matching Java Float.floatToIntBits)
    const buf = Buffer.allocUnsafe(4);
    buf.writeFloatBE(v, 0);
    return buf.readInt32BE(0);
}
