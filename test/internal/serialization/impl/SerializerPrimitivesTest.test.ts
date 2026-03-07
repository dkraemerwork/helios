/**
 * Block 15.2 — Tests for all 21 built-in serializers.
 *
 * Tests each serializer's write/read round-trip via a minimal output→input pipeline.
 */
import { BIG_ENDIAN, ByteArrayObjectDataInput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';
import { ByteArrayObjectDataOutput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput';
import { SerializationConstants } from '@zenystx/helios-core/internal/serialization/impl/SerializationConstants';
import type { InternalSerializationService } from '@zenystx/helios-core/internal/serialization/InternalSerializationService';
import { describe, expect, test } from 'bun:test';

// Import all serializers
import { HazelcastSerializationError } from '@zenystx/helios-core/internal/serialization/impl/HazelcastSerializationError';
import { BooleanArraySerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/BooleanArraySerializer';
import { BooleanSerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/BooleanSerializer';
import { ByteArraySerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/ByteArraySerializer';
import { ByteSerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/ByteSerializer';
import { CharArraySerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/CharArraySerializer';
import { CharSerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/CharSerializer';
import { DoubleArraySerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/DoubleArraySerializer';
import { DoubleSerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/DoubleSerializer';
import { FloatArraySerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/FloatArraySerializer';
import { FloatSerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/FloatSerializer';
import { IntegerArraySerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/IntegerArraySerializer';
import { IntegerSerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/IntegerSerializer';
import { JavaScriptJsonSerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/JavaScriptJsonSerializer';
import { LongArraySerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/LongArraySerializer';
import { LongSerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/LongSerializer';
import { NullSerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/NullSerializer';
import { ShortArraySerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/ShortArraySerializer';
import { ShortSerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/ShortSerializer';
import { StringArraySerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/StringArraySerializer';
import { StringSerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/StringSerializer';
import { UuidSerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/UuidSerializer';

// Stub service (not used by primitive serializers)
const stubService = {} as InternalSerializationService;

function roundTrip(serializer: { write(out: ByteArrayObjectDataOutput, obj: unknown): void; read(inp: ByteArrayObjectDataInput): unknown }, value: unknown): any {
    const out = new ByteArrayObjectDataOutput(256, stubService, BIG_ENDIAN);
    serializer.write(out, value);
    const buf = out.toByteArray();
    const inp = new ByteArrayObjectDataInput(buf, stubService, BIG_ENDIAN);
    return serializer.read(inp);
}

describe('NullSerializer', () => {
    test('typeId is 0', () => {
        expect(NullSerializer.getTypeId()).toBe(SerializationConstants.CONSTANT_TYPE_NULL);
    });
    test('write/read returns null', () => {
        expect(roundTrip(NullSerializer, null)).toBeNull();
    });
});

describe('BooleanSerializer', () => {
    test('typeId is -4', () => {
        expect(BooleanSerializer.getTypeId()).toBe(SerializationConstants.CONSTANT_TYPE_BOOLEAN);
    });
    test('round-trips true', () => {
        expect(roundTrip(BooleanSerializer, true)).toBe(true);
    });
    test('round-trips false', () => {
        expect(roundTrip(BooleanSerializer, false)).toBe(false);
    });
});

describe('ByteSerializer', () => {
    test('typeId is -3', () => {
        expect(ByteSerializer.getTypeId()).toBe(SerializationConstants.CONSTANT_TYPE_BYTE);
    });
    test('round-trips positive byte', () => {
        expect(roundTrip(ByteSerializer, 42)).toBe(42);
    });
    test('round-trips negative byte', () => {
        expect(roundTrip(ByteSerializer, -1)).toBe(-1);
    });
});

describe('CharSerializer', () => {
    test('typeId is -5', () => {
        expect(CharSerializer.getTypeId()).toBe(SerializationConstants.CONSTANT_TYPE_CHAR);
    });
    test('round-trips ASCII code unit', () => {
        expect(roundTrip(CharSerializer, 65)).toBe(65); // 'A'
    });
});

describe('ShortSerializer', () => {
    test('typeId is -6', () => {
        expect(ShortSerializer.getTypeId()).toBe(SerializationConstants.CONSTANT_TYPE_SHORT);
    });
    test('round-trips positive short', () => {
        expect(roundTrip(ShortSerializer, 12345)).toBe(12345);
    });
    test('round-trips negative short', () => {
        expect(roundTrip(ShortSerializer, -32768)).toBe(-32768);
    });
});

describe('IntegerSerializer', () => {
    test('typeId is -7', () => {
        expect(IntegerSerializer.getTypeId()).toBe(SerializationConstants.CONSTANT_TYPE_INTEGER);
    });
    test('round-trips int32', () => {
        expect(roundTrip(IntegerSerializer, 2147483647)).toBe(2147483647);
    });
    test('round-trips negative int32', () => {
        expect(roundTrip(IntegerSerializer, -2147483648)).toBe(-2147483648);
    });
});

describe('LongSerializer', () => {
    test('typeId is -8', () => {
        expect(LongSerializer.getTypeId()).toBe(SerializationConstants.CONSTANT_TYPE_LONG);
    });
    test('round-trips bigint', () => {
        expect(roundTrip(LongSerializer, 9007199254740993n)).toBe(9007199254740993n);
    });
    test('round-trips number coerced to bigint', () => {
        expect(roundTrip(LongSerializer, 42)).toBe(42n);
    });
});

describe('FloatSerializer', () => {
    test('typeId is -9', () => {
        expect(FloatSerializer.getTypeId()).toBe(SerializationConstants.CONSTANT_TYPE_FLOAT);
    });
    test('round-trips float value', () => {
        const result = roundTrip(FloatSerializer, 3.14);
        expect(Math.abs(result - 3.14)).toBeLessThan(0.001);
    });
});

describe('DoubleSerializer', () => {
    test('typeId is -10', () => {
        expect(DoubleSerializer.getTypeId()).toBe(SerializationConstants.CONSTANT_TYPE_DOUBLE);
    });
    test('round-trips double', () => {
        expect(roundTrip(DoubleSerializer, 3.141592653589793)).toBe(3.141592653589793);
    });
    test('round-trips negative zero', () => {
        const result = roundTrip(DoubleSerializer, -0);
        expect(Object.is(result, -0)).toBe(true);
    });
    test('round-trips NaN', () => {
        expect(roundTrip(DoubleSerializer, NaN)).toBeNaN();
    });
    test('round-trips Infinity', () => {
        expect(roundTrip(DoubleSerializer, Infinity)).toBe(Infinity);
    });
});

describe('StringSerializer', () => {
    test('typeId is -11', () => {
        expect(StringSerializer.getTypeId()).toBe(SerializationConstants.CONSTANT_TYPE_STRING);
    });
    test('round-trips ASCII string', () => {
        expect(roundTrip(StringSerializer, 'hello')).toBe('hello');
    });
    test('round-trips empty string', () => {
        expect(roundTrip(StringSerializer, '')).toBe('');
    });
    test('round-trips UTF-8 string', () => {
        expect(roundTrip(StringSerializer, '日本語')).toBe('日本語');
    });
});

describe('ByteArraySerializer', () => {
    test('typeId is -12', () => {
        expect(ByteArraySerializer.getTypeId()).toBe(SerializationConstants.CONSTANT_TYPE_BYTE_ARRAY);
    });
    test('round-trips Buffer', () => {
        const buf = Buffer.from([1, 2, 3, 4]);
        const result = roundTrip(ByteArraySerializer, buf);
        expect(Buffer.compare(result, buf)).toBe(0);
    });
    test('round-trips empty Buffer', () => {
        const result = roundTrip(ByteArraySerializer, Buffer.alloc(0));
        expect(result.length).toBe(0);
    });
    test('coerces plain Uint8Array to Buffer', () => {
        const arr = new Uint8Array([10, 20, 30]);
        const result = roundTrip(ByteArraySerializer, arr);
        expect(result[0]).toBe(10);
        expect(result[1]).toBe(20);
        expect(result[2]).toBe(30);
    });
});

describe('BooleanArraySerializer', () => {
    test('typeId is -13', () => {
        expect(BooleanArraySerializer.getTypeId()).toBe(SerializationConstants.CONSTANT_TYPE_BOOLEAN_ARRAY);
    });
    test('round-trips boolean array', () => {
        expect(roundTrip(BooleanArraySerializer, [true, false, true])).toEqual([true, false, true]);
    });
});

describe('CharArraySerializer', () => {
    test('typeId is -14', () => {
        expect(CharArraySerializer.getTypeId()).toBe(SerializationConstants.CONSTANT_TYPE_CHAR_ARRAY);
    });
    test('round-trips char array', () => {
        expect(roundTrip(CharArraySerializer, [65, 66, 67])).toEqual([65, 66, 67]);
    });
});

describe('ShortArraySerializer', () => {
    test('typeId is -15', () => {
        expect(ShortArraySerializer.getTypeId()).toBe(SerializationConstants.CONSTANT_TYPE_SHORT_ARRAY);
    });
    test('round-trips short array', () => {
        expect(roundTrip(ShortArraySerializer, [1, -1, 32767])).toEqual([1, -1, 32767]);
    });
});

describe('IntegerArraySerializer', () => {
    test('typeId is -16', () => {
        expect(IntegerArraySerializer.getTypeId()).toBe(SerializationConstants.CONSTANT_TYPE_INTEGER_ARRAY);
    });
    test('round-trips int array', () => {
        expect(roundTrip(IntegerArraySerializer, [0, -1, 2147483647])).toEqual([0, -1, 2147483647]);
    });
});

describe('LongArraySerializer', () => {
    test('typeId is -17', () => {
        expect(LongArraySerializer.getTypeId()).toBe(SerializationConstants.CONSTANT_TYPE_LONG_ARRAY);
    });
    test('round-trips bigint array', () => {
        expect(roundTrip(LongArraySerializer, [0n, -1n, 9007199254740993n])).toEqual([0n, -1n, 9007199254740993n]);
    });
});

describe('FloatArraySerializer', () => {
    test('typeId is -18', () => {
        expect(FloatArraySerializer.getTypeId()).toBe(SerializationConstants.CONSTANT_TYPE_FLOAT_ARRAY);
    });
    test('round-trips float array', () => {
        const result = roundTrip(FloatArraySerializer, [1.5, 2.5]);
        expect(result[0]).toBeCloseTo(1.5);
        expect(result[1]).toBeCloseTo(2.5);
    });
});

describe('DoubleArraySerializer', () => {
    test('typeId is -19', () => {
        expect(DoubleArraySerializer.getTypeId()).toBe(SerializationConstants.CONSTANT_TYPE_DOUBLE_ARRAY);
    });
    test('round-trips double array', () => {
        expect(roundTrip(DoubleArraySerializer, [1.1, 2.2, 3.3])).toEqual([1.1, 2.2, 3.3]);
    });
});

describe('StringArraySerializer', () => {
    test('typeId is -20', () => {
        expect(StringArraySerializer.getTypeId()).toBe(SerializationConstants.CONSTANT_TYPE_STRING_ARRAY);
    });
    test('round-trips string array', () => {
        expect(roundTrip(StringArraySerializer, ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    });
});

describe('UuidSerializer', () => {
    test('typeId is -21', () => {
        expect(UuidSerializer.getTypeId()).toBe(SerializationConstants.CONSTANT_TYPE_UUID);
    });
    test('round-trips standard UUID', () => {
        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        expect(roundTrip(UuidSerializer, uuid)).toBe(uuid);
    });
    test('round-trips UUID with high bit set (R3-C2 fix)', () => {
        // UUID where mostSigBits >= 2^63 — tests BigInt.asUintN(64, ...) fix
        const uuid = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
        expect(roundTrip(UuidSerializer, uuid)).toBe(uuid);
    });
    test('round-trips UUID with mixed high bits', () => {
        const uuid = '80000000-0000-0000-8000-000000000000';
        expect(roundTrip(UuidSerializer, uuid)).toBe(uuid);
    });
});

describe('JavaScriptJsonSerializer', () => {
    test('typeId is -130', () => {
        expect(JavaScriptJsonSerializer.getTypeId()).toBe(SerializationConstants.JAVASCRIPT_JSON_SERIALIZATION_TYPE);
    });
    test('round-trips plain object', () => {
        const obj = { name: 'helios', version: 1 };
        expect(roundTrip(JavaScriptJsonSerializer, obj)).toEqual(obj);
    });
    test('round-trips array', () => {
        expect(roundTrip(JavaScriptJsonSerializer, [1, 2, 3])).toEqual([1, 2, 3]);
    });
    test('throws HazelcastSerializationError for object with bigint (N11)', () => {
        expect(() => {
            const out = new ByteArrayObjectDataOutput(256, stubService, BIG_ENDIAN);
            JavaScriptJsonSerializer.write(out, { id: 42n });
        }).toThrow(HazelcastSerializationError);
    });
    test('throws HazelcastSerializationError for function (R3-C3)', () => {
        expect(() => {
            const out = new ByteArrayObjectDataOutput(256, stubService, BIG_ENDIAN);
            JavaScriptJsonSerializer.write(out, () => {});
        }).toThrow(HazelcastSerializationError);
    });
    test('throws HazelcastSerializationError for Symbol (R3-C3)', () => {
        expect(() => {
            const out = new ByteArrayObjectDataOutput(256, stubService, BIG_ENDIAN);
            JavaScriptJsonSerializer.write(out, Symbol('test'));
        }).toThrow(HazelcastSerializationError);
    });
});
