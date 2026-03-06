/**
 * Tests for SerializationServiceImpl — Block 15.4
 *
 * Covers: dispatch chain (serializerFor + serializerForTypeId),
 * toData/toObject round-trips, writeObject/readObject, BufferPool wiring,
 * factory hook registration, error handling, and edge cases.
 */
import { describe, expect, test } from 'bun:test';
import { SerializationServiceImpl } from '@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl';
import { SerializationConfig, type DataSerializableFactory, type IdentifiedDataSerializable } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';
import { HazelcastSerializationError } from '@zenystx/helios-core/internal/serialization/impl/HazelcastSerializationError';
import { HeapData } from '@zenystx/helios-core/internal/serialization/impl/HeapData';
import { SerializationConstants } from '@zenystx/helios-core/internal/serialization/impl/SerializationConstants';
import { ByteArrayObjectDataOutput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput';
import { ByteArrayObjectDataInput, BIG_ENDIAN, LITTLE_ENDIAN } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';
import type { DataSerializerHook } from '@zenystx/helios-core/internal/serialization/impl/DataSerializerHook';

// ── toData / toObject round-trip tests ──

describe('SerializationServiceImpl — toData/toObject round-trips', () => {
    const ss = new SerializationServiceImpl();

    test('null returns null', () => {
        expect(ss.toData(null)).toBeNull();
        expect(ss.toData(undefined)).toBeNull();
        expect(ss.toObject(null)).toBeNull();
    });

    test('HeapData pass-through', () => {
        const data = ss.toData(42)!;
        expect(data).toBeInstanceOf(HeapData);
        const again = ss.toData(data);
        expect(again).toBe(data); // same reference
    });

    test('integer round-trip', () => {
        const data = ss.toData(42)!;
        expect(data.getType()).toBe(SerializationConstants.CONSTANT_TYPE_INTEGER);
        expect(ss.toObject<number>(data)).toBe(42);
    });

    test('negative zero round-trip as double', () => {
        const data = ss.toData(-0)!;
        expect(data.getType()).toBe(SerializationConstants.CONSTANT_TYPE_DOUBLE);
        const result = ss.toObject<number>(data)!;
        expect(Object.is(result, -0)).toBeTrue();
    });

    test('large integer (outside int32) round-trip as long', () => {
        const val = 2 ** 40;
        const data = ss.toData(val)!;
        expect(data.getType()).toBe(SerializationConstants.CONSTANT_TYPE_LONG);
        const result = ss.toObject<bigint>(data)!;
        expect(result).toBe(BigInt(val));
    });

    test('NaN round-trip as double', () => {
        const data = ss.toData(NaN)!;
        expect(data.getType()).toBe(SerializationConstants.CONSTANT_TYPE_DOUBLE);
        expect(Number.isNaN(ss.toObject<number>(data))).toBeTrue();
    });

    test('Infinity round-trip as double', () => {
        const data = ss.toData(Infinity)!;
        expect(data.getType()).toBe(SerializationConstants.CONSTANT_TYPE_DOUBLE);
        expect(ss.toObject<number>(data)).toBe(Infinity);
    });

    test('bigint round-trip as long', () => {
        const data = ss.toData(42n)!;
        expect(data.getType()).toBe(SerializationConstants.CONSTANT_TYPE_LONG);
        expect(ss.toObject<bigint>(data)).toBe(42n);
    });

    test('boolean round-trip', () => {
        const dataT = ss.toData(true)!;
        expect(dataT.getType()).toBe(SerializationConstants.CONSTANT_TYPE_BOOLEAN);
        expect(ss.toObject<boolean>(dataT)).toBeTrue();
        const dataF = ss.toData(false)!;
        expect(ss.toObject<boolean>(dataF)).toBeFalse();
    });

    test('string round-trip', () => {
        const data = ss.toData('hello')!;
        expect(data.getType()).toBe(SerializationConstants.CONSTANT_TYPE_STRING);
        expect(ss.toObject<string>(data)).toBe('hello');
    });

    test('Buffer round-trip as byte array', () => {
        const buf = Buffer.from([1, 2, 3]);
        const data = ss.toData(buf)!;
        expect(data.getType()).toBe(SerializationConstants.CONSTANT_TYPE_BYTE_ARRAY);
        const result = ss.toObject<Buffer>(data)!;
        expect(Buffer.isBuffer(result)).toBeTrue();
        expect(result).toEqual(buf);
    });

    test('boolean[] round-trip', () => {
        const arr = [true, false, true];
        const data = ss.toData(arr)!;
        expect(data.getType()).toBe(SerializationConstants.CONSTANT_TYPE_BOOLEAN_ARRAY);
        expect(ss.toObject<boolean[]>(data)).toEqual(arr);
    });

    test('bigint[] round-trip as long array', () => {
        const arr = [1n, 2n, 3n];
        const data = ss.toData(arr)!;
        expect(data.getType()).toBe(SerializationConstants.CONSTANT_TYPE_LONG_ARRAY);
        expect(ss.toObject<bigint[]>(data)).toEqual(arr);
    });

    test('int32 number[] round-trip as integer array', () => {
        const arr = [1, -2147483648, 2147483647];
        const data = ss.toData(arr)!;
        expect(data.getType()).toBe(SerializationConstants.CONSTANT_TYPE_INTEGER_ARRAY);
        expect(ss.toObject<number[]>(data)).toEqual(arr);
    });

    test('float/mixed number[] round-trip as double array', () => {
        const arr = [1.5, 2.7, 3.14];
        const data = ss.toData(arr)!;
        expect(data.getType()).toBe(SerializationConstants.CONSTANT_TYPE_DOUBLE_ARRAY);
        expect(ss.toObject<number[]>(data)).toEqual(arr);
    });

    test('string[] round-trip', () => {
        const arr = ['a', 'b', 'c'];
        const data = ss.toData(arr)!;
        expect(data.getType()).toBe(SerializationConstants.CONSTANT_TYPE_STRING_ARRAY);
        expect(ss.toObject<string[]>(data)).toEqual(arr);
    });

    test('empty array falls to JSON', () => {
        const data = ss.toData([])!;
        expect(data.getType()).toBe(SerializationConstants.JAVASCRIPT_JSON_SERIALIZATION_TYPE);
        expect(ss.toObject<unknown[]>(data)).toEqual([]);
    });

    test('array with null element falls to JSON', () => {
        const data = ss.toData([1, null, 3])!;
        expect(data.getType()).toBe(SerializationConstants.JAVASCRIPT_JSON_SERIALIZATION_TYPE);
    });

    test('plain object round-trip via JSON', () => {
        const obj = { name: 'test', value: 42 };
        const data = ss.toData(obj)!;
        expect(data.getType()).toBe(SerializationConstants.JAVASCRIPT_JSON_SERIALIZATION_TYPE);
        expect(ss.toObject<{ name: string; value: number }>(data)).toEqual(obj);
    });

    test('UUID string round-trip', () => {
        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        const data = ss.toData(uuid)!;
        expect(data.getType()).toBe(SerializationConstants.CONSTANT_TYPE_STRING);
        expect(ss.toObject<string>(data)).toBe(uuid);
    });

    test('number[] with large integers (outside int32) becomes double array', () => {
        const arr = [1, 2 ** 33, 3];
        const data = ss.toData(arr)!;
        expect(data.getType()).toBe(SerializationConstants.CONSTANT_TYPE_DOUBLE_ARRAY);
    });
});

// ── writeObject / readObject round-trip tests ──

describe('SerializationServiceImpl — writeObject/readObject', () => {
    const ss = new SerializationServiceImpl();

    test('writeObject/readObject round-trip for integer', () => {
        const out = new ByteArrayObjectDataOutput(256, ss, BIG_ENDIAN);
        ss.writeObject(out, 42);
        const bytes = out.toByteArray();
        const inp = new ByteArrayObjectDataInput(bytes, 0, ss, BIG_ENDIAN);
        expect(ss.readObject<number>(inp)).toBe(42);
    });

    test('writeObject/readObject round-trip for string', () => {
        const out = new ByteArrayObjectDataOutput(256, ss, BIG_ENDIAN);
        ss.writeObject(out, 'hello');
        const bytes = out.toByteArray();
        const inp = new ByteArrayObjectDataInput(bytes, 0, ss, BIG_ENDIAN);
        expect(ss.readObject<string>(inp)).toBe('hello');
    });

    test('writeObject/readObject round-trip for null', () => {
        const out = new ByteArrayObjectDataOutput(256, ss, BIG_ENDIAN);
        ss.writeObject(out, null);
        const bytes = out.toByteArray();
        const inp = new ByteArrayObjectDataInput(bytes, 0, ss, BIG_ENDIAN);
        expect(ss.readObject(inp)).toBeNull();
    });

    test('writeObject/readObject round-trip for object via JSON', () => {
        const out = new ByteArrayObjectDataOutput(256, ss, BIG_ENDIAN);
        const obj = { x: 1, y: 'two' };
        ss.writeObject(out, obj);
        const bytes = out.toByteArray();
        const inp = new ByteArrayObjectDataInput(bytes, 0, ss, BIG_ENDIAN);
        expect(ss.readObject<{ x: number; y: string }>(inp)).toEqual(obj);
    });

    test('writeObject throws on HeapData', () => {
        const out = new ByteArrayObjectDataOutput(256, ss, BIG_ENDIAN);
        const data = ss.toData(42)!;
        expect(() => ss.writeObject(out, data)).toThrow(HazelcastSerializationError);
    });

    test('readObject with useBigEndianForTypeId', () => {
        // Write typeId in big-endian manually, then payload
        const out = new ByteArrayObjectDataOutput(256, ss, LITTLE_ENDIAN);
        // Write typeId -7 (integer) in BIG_ENDIAN
        const typeIdBuf = Buffer.alloc(4);
        typeIdBuf.writeInt32BE(SerializationConstants.CONSTANT_TYPE_INTEGER);
        out.writeBytes(typeIdBuf, 0, 4);
        // Write payload in LE (the stream byte order)
        out.writeInt(99);
        const bytes = out.toByteArray();
        const inp = new ByteArrayObjectDataInput(bytes, 0, ss, LITTLE_ENDIAN);
        expect(ss.readObject<number>(inp, undefined, true)).toBe(99);
    });
});

// ── IDS factory registration ──

describe('SerializationServiceImpl — IDS factory registration', () => {
    test('IDS round-trip via config factories', () => {
        const config = new SerializationConfig();
        const factory: DataSerializableFactory = {
            create(classId: number) {
                if (classId === 1) return new TestIDS();
                throw new Error('Unknown classId');
            },
        };
        config.dataSerializableFactories.set(42, factory);
        const ss = new SerializationServiceImpl(config);

        const ids = new TestIDS();
        ids.value = 'hello';
        const data = ss.toData(ids)!;
        expect(data.getType()).toBe(SerializationConstants.CONSTANT_TYPE_DATA_SERIALIZABLE);
        const result = ss.toObject<TestIDS>(data)!;
        expect(result.value).toBe('hello');
    });

    test('IDS round-trip via hook', () => {
        const config = new SerializationConfig();
        const hook: DataSerializerHook = {
            getFactoryId: () => 99,
            createFactory: () => ({
                create(classId: number) {
                    if (classId === 1) return new TestIDS2();
                    throw new Error('Unknown classId');
                },
            }),
        };
        config.dataSerializerHooks.push(hook);
        const ss = new SerializationServiceImpl(config);

        const ids = new TestIDS2();
        ids.num = 777;
        const data = ss.toData(ids)!;
        const result = ss.toObject<TestIDS2>(data)!;
        expect(result.num).toBe(777);
    });
});

// ── Error cases ──

describe('SerializationServiceImpl — error handling', () => {
    const ss = new SerializationServiceImpl();

    test('unknown typeId throws HazelcastSerializationError', () => {
        // Create HeapData with an unknown typeId
        const buf = Buffer.alloc(12);
        buf.writeInt32BE(0, 0);     // partitionHash
        buf.writeInt32BE(999, 4);   // unknown typeId
        buf.writeInt32BE(42, 8);    // payload
        const data = new HeapData(buf);
        expect(() => ss.toObject(data)).toThrow(HazelcastSerializationError);
    });

    test('toData_objectWithBigintField_throwsHazelcastSerializationError', () => {
        expect(() => ss.toData({ id: 42n })).toThrow(HazelcastSerializationError);
    });

    test('toData_function_throwsHazelcastSerializationError', () => {
        expect(() => ss.toData(() => {})).toThrow(HazelcastSerializationError);
    });

    test('toData_symbol_throwsHazelcastSerializationError', () => {
        expect(() => ss.toData(Symbol('x'))).toThrow(HazelcastSerializationError);
    });

    test('toData_plainUint8Array_serializesWithoutCrash', () => {
        const u8 = new Uint8Array([1, 2, 3]);
        // Plain Uint8Array is NOT a Buffer, so it falls to JSON serializer
        const data = ss.toData(u8)!;
        expect(data).not.toBeNull();
    });
});

// ── BufferPool / destroy ──

describe('SerializationServiceImpl — BufferPool & destroy', () => {
    test('destroy_clearsBufferPool_noLeak', () => {
        const ss = new SerializationServiceImpl();
        // Force buffer pool usage
        ss.toData(42);
        ss.toData('hello');
        // Should not throw
        ss.destroy();
    });

    test('getClassLoader returns null', () => {
        const ss = new SerializationServiceImpl();
        expect(ss.getClassLoader()).toBeNull();
    });
});

// ── Test IDS helpers ──

class TestIDS implements IdentifiedDataSerializable {
    value = '';
    getFactoryId(): number { return 42; }
    getClassId(): number { return 1; }
    writeData(out: ByteArrayObjectDataOutput): void { out.writeString(this.value); }
    readData(inp: ByteArrayObjectDataInput): void { this.value = inp.readString()!; }
}

class TestIDS2 implements IdentifiedDataSerializable {
    num = 0;
    getFactoryId(): number { return 99; }
    getClassId(): number { return 1; }
    writeData(out: ByteArrayObjectDataOutput): void { out.writeInt(this.num); }
    readData(inp: ByteArrayObjectDataInput): void { this.num = inp.readInt(); }
}
