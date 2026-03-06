/**
 * Tests for DataSerializableSerializer (typeId -2).
 *
 * Covers: IDS round-trip via mock factory, error cases (missing factory, missing classId,
 * non-IDS header, readData not a function), EE versioned header skip.
 */
import { describe, expect, it } from 'bun:test';
import { DataSerializableSerializer } from '@zenystx/helios-core/internal/serialization/impl/serializers/DataSerializableSerializer';
import { ByteArrayObjectDataOutput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput';
import { ByteArrayObjectDataInput, BIG_ENDIAN } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';
import { HazelcastSerializationError } from '@zenystx/helios-core/internal/serialization/impl/HazelcastSerializationError';
import { SerializationConstants } from '@zenystx/helios-core/internal/serialization/impl/SerializationConstants';
import type { DataSerializableFactory, IdentifiedDataSerializable } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';

class TestIdsObject implements IdentifiedDataSerializable {
    value = 0;

    getFactoryId(): number { return 1; }
    getClassId(): number { return 42; }

    writeData(out: ByteArrayObjectDataOutput): void {
        out.writeInt(this.value);
    }

    readData(inp: ByteArrayObjectDataInput): void {
        this.value = inp.readInt();
    }
}

class TestFactory implements DataSerializableFactory {
    create(classId: number): IdentifiedDataSerializable {
        if (classId === 42) return new TestIdsObject();
        throw new Error(`Unknown classId: ${classId}`);
    }
}

function createSerializer(): DataSerializableSerializer {
    const s = new DataSerializableSerializer();
    s.registerFactory(1, new TestFactory());
    return s;
}

describe('DataSerializableSerializer', () => {
    it('has typeId -2', () => {
        const s = new DataSerializableSerializer();
        expect(s.getTypeId()).toBe(SerializationConstants.CONSTANT_TYPE_DATA_SERIALIZABLE);
    });

    it('round-trips an IdentifiedDataSerializable object', () => {
        const s = createSerializer();
        const obj = new TestIdsObject();
        obj.value = 12345;

        const out = new ByteArrayObjectDataOutput(64, null, BIG_ENDIAN);
        s.write(out, obj);

        const inp = new ByteArrayObjectDataInput(out.buffer.subarray(0, out.pos), null as any, BIG_ENDIAN);
        const result = s.read(inp) as TestIdsObject;

        expect(result).toBeInstanceOf(TestIdsObject);
        expect(result.value).toBe(12345);
    });

    it('throws on non-IDS header (plain DataSerializable)', () => {
        const s = createSerializer();

        // Write a header with IDS bit=0
        const out = new ByteArrayObjectDataOutput(16, null, BIG_ENDIAN);
        out.writeByte(0x00); // non-IDS header

        const inp = new ByteArrayObjectDataInput(out.buffer.subarray(0, out.pos), null as any, BIG_ENDIAN);
        expect(() => s.read(inp)).toThrow(HazelcastSerializationError);
        expect(() => {
            inp.pos = 0;
            s.read(inp);
        }).toThrow('non-IdentifiedDataSerializable');
    });

    it('throws when factory not found for factoryId', () => {
        const s = new DataSerializableSerializer();
        // No factories registered

        const out = new ByteArrayObjectDataOutput(16, null, BIG_ENDIAN);
        out.writeByte(0x01); // IDS header
        out.writeInt(999);   // unknown factoryId
        out.writeInt(1);     // classId

        const inp = new ByteArrayObjectDataInput(out.buffer.subarray(0, out.pos), null as any, BIG_ENDIAN);
        expect(() => s.read(inp)).toThrow(HazelcastSerializationError);
        expect(() => {
            inp.pos = 0;
            s.read(inp);
        }).toThrow('No DataSerializerFactory for namespace: 999');
    });

    it('throws when factory returns null/undefined for classId', () => {
        const s = new DataSerializableSerializer();
        s.registerFactory(1, {
            create(_classId: number) { return null as any; },
        });

        const out = new ByteArrayObjectDataOutput(16, null, BIG_ENDIAN);
        out.writeByte(0x01); // IDS header
        out.writeInt(1);     // factoryId
        out.writeInt(99);    // classId that factory doesn't handle

        const inp = new ByteArrayObjectDataInput(out.buffer.subarray(0, out.pos), null as any, BIG_ENDIAN);
        expect(() => s.read(inp)).toThrow(HazelcastSerializationError);
        expect(() => {
            inp.pos = 0;
            s.read(inp);
        }).toThrow('Factory cannot create instance for classId: 99 on factoryId: 1');
    });

    it('throws when created object does not implement readData (N18)', () => {
        const s = new DataSerializableSerializer();
        s.registerFactory(1, {
            create(_classId: number) {
                return { getFactoryId: () => 1, getClassId: () => 1, writeData() {} } as any;
            },
        });

        const out = new ByteArrayObjectDataOutput(16, null, BIG_ENDIAN);
        out.writeByte(0x01); // IDS header
        out.writeInt(1);     // factoryId
        out.writeInt(1);     // classId

        const inp = new ByteArrayObjectDataInput(out.buffer.subarray(0, out.pos), null as any, BIG_ENDIAN);
        expect(() => s.read(inp)).toThrow(HazelcastSerializationError);
        expect(() => {
            inp.pos = 0;
            s.read(inp);
        }).toThrow('does not implement readData');
    });

    it('skips 2 EE version bytes when versioned header is set', () => {
        const s = createSerializer();
        const obj = new TestIdsObject();
        obj.value = 7777;

        // Manually write versioned format
        const out = new ByteArrayObjectDataOutput(64, null, BIG_ENDIAN);
        out.writeByte(0x03); // IDS=1, versioned=1
        out.writeInt(1);     // factoryId
        out.writeInt(42);    // classId
        out.writeByte(0);    // EE version byte 1
        out.writeByte(0);    // EE version byte 2
        // Write the payload (same as writeData)
        out.writeInt(7777);

        const inp = new ByteArrayObjectDataInput(out.buffer.subarray(0, out.pos), null as any, BIG_ENDIAN);
        const result = s.read(inp) as TestIdsObject;

        expect(result).toBeInstanceOf(TestIdsObject);
        expect(result.value).toBe(7777);
    });
});
