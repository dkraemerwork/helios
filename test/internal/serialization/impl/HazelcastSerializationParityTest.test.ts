import {
    HazelcastSerializationConfig,
    HazelcastSerializationService,
} from '@zenystx/helios-core/internal/serialization/HazelcastSerializationService';
import {
    FieldKind,
    GenericRecordBuilderImpl,
    GenericRecordError,
    type GenericRecord,
} from '@zenystx/helios-core/internal/serialization/GenericRecord';
import { HeapData } from '@zenystx/helios-core/internal/serialization/impl/HeapData';
import { HazelcastSerializationError } from '@zenystx/helios-core/internal/serialization/impl/HazelcastSerializationError';
import type {
    CompactReader,
    CompactSerializable,
    CompactWriter,
} from '@zenystx/helios-core/internal/serialization/compact/CompactSerializer';
import { ClassDefinitionBuilder, type Portable, type PortableFactory, type PortableReader, type PortableWriter } from '@zenystx/helios-core/internal/serialization/portable/PortableSerializer';
import { describe, expect, test } from 'bun:test';

const IDS_FACTORY_ID = 91;
const IDS_CLASS_ID = 7;
const PORTABLE_FACTORY_ID = 72;
const PORTABLE_CLASS_ID = 5;
const CUSTOM_SERIALIZER_ID = 777;
const GLOBAL_SERIALIZER_ID = 778;

class SampleIds {
    constructor(public id = 0, public name = '') {}

    getFactoryId(): number { return IDS_FACTORY_ID; }
    getClassId(): number { return IDS_CLASS_ID; }
    writeData(out: import('@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput').ByteArrayObjectDataOutput): void {
        out.writeInt(this.id);
        out.writeString(this.name);
    }
    readData(inp: import('@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput').ByteArrayObjectDataInput): void {
        this.id = inp.readInt();
        this.name = inp.readString() ?? '';
    }
}

class SamplePortable implements Portable {
    constructor(public id = 0, public name: string | null = null) {}

    getFactoryId(): number { return PORTABLE_FACTORY_ID; }
    getClassId(): number { return PORTABLE_CLASS_ID; }
    writePortable(writer: PortableWriter): void {
        writer.writeInt('id', this.id);
        writer.writeString('name', this.name);
    }
    readPortable(reader: PortableReader): void {
        this.id = reader.readInt('id');
        this.name = reader.readString('name');
    }
}

class SampleCompact {
    constructor(public id: number, public name: string | null, public maybeAge: number | null) {}
}

const sampleCompactSerializer: CompactSerializable<SampleCompact> = {
    getClass: () => SampleCompact as unknown as new (...args: unknown[]) => SampleCompact,
    getTypeName: () => 'sample-compact',
    write(writer: CompactWriter, object: SampleCompact): void {
        writer.writeInt32('id', object.id);
        writer.writeString('name', object.name);
        writer.writeNullableInt32('maybeAge', object.maybeAge);
    },
    read(reader: CompactReader): SampleCompact {
        return new SampleCompact(
            reader.readInt32('id'),
            reader.readString('name'),
            reader.readNullableInt32('maybeAge'),
        );
    },
};

class CustomPayload {
    readonly hzCustomId = CUSTOM_SERIALIZER_ID;

    constructor(public label: string) {}
}

describe('Hazelcast serialization retained breadth', () => {
    test('round-trips primitives and primitive arrays', () => {
        const service = new HazelcastSerializationService();

        expect(service.toObject<number>(service.toData(42)!)).toBe(42);
        expect(service.toObject<string>(service.toData('helios')!)).toBe('helios');
        expect(service.toObject<number[]>(service.toData([1, 2, 3])!)).toEqual([1, 2, 3]);
        expect(service.toObject<string[]>(service.toData(['a', 'b'])!)).toEqual(['a', 'b']);
        expect(service.toObject<boolean[]>(service.toData([true, false, true])!)).toEqual([true, false, true]);
    });

    test('round-trips IdentifiedDataSerializable with a registered factory', () => {
        const config = new HazelcastSerializationConfig();
        config.dataSerializableFactories.set(IDS_FACTORY_ID, { create: () => new SampleIds() });
        const service = new HazelcastSerializationService(config);

        const result = service.toObject<SampleIds>(service.toData(new SampleIds(7, 'ids'))!);

        expect(result).toBeInstanceOf(SampleIds);
        expect(result).toEqual(new SampleIds(7, 'ids'));
    });

    test('round-trips Portable when the class definition and factory are registered', () => {
        const config = new HazelcastSerializationConfig();
        config.portableFactories.set(PORTABLE_FACTORY_ID, portableFactory);
        config.classDefinitions.push(
            new ClassDefinitionBuilder(PORTABLE_FACTORY_ID, PORTABLE_CLASS_ID)
                .addIntField('id')
                .addStringField('name')
                .build(),
        );
        const service = new HazelcastSerializationService(config);

        const result = service.toObject<SamplePortable>(service.toData(new SamplePortable(3, 'portable'))!);

        expect(result).toBeInstanceOf(SamplePortable);
        expect(result).toEqual(new SamplePortable(3, 'portable'));
    });

    test('round-trips Compact with nullable fields through a registered serializer', () => {
        const config = new HazelcastSerializationConfig();
        config.compactSerializers.push(sampleCompactSerializer);
        const service = new HazelcastSerializationService(config);

        const result = service.toObject<SampleCompact>(service.toData(new SampleCompact(4, 'compact', null))!);

        expect(result).toEqual(new SampleCompact(4, 'compact', null));
    });

    test('materializes Compact GenericRecord when schema exists but no serializer is registered', () => {
        const writerConfig = new HazelcastSerializationConfig();
        writerConfig.compactSerializers.push(sampleCompactSerializer);
        const writerService = new HazelcastSerializationService(writerConfig);
        const data = writerService.toData(new SampleCompact(8, 'generic', null))!;

        const readerConfig = new HazelcastSerializationConfig();
        for (const schema of writerService.schemaService.getAllSchemas().values()) {
            readerConfig.schemaService.registerSchema(schema);
        }
        const readerService = new HazelcastSerializationService(readerConfig);
        const record = readerService.toObject<GenericRecord>(data)!;

        expect(record.isCompact()).toBe(true);
        expect(record.getTypeName()).toBe('sample-compact');
        expect(record.getInt32('id')).toBe(8);
        expect(record.getString('name')).toBe('generic');
        expect(record.getNullableInt32('maybeAge')).toBeNull();
    });

    test('round-trips Compact GenericRecord values created by the member runtime', () => {
        const service = new HazelcastSerializationService();
        const record = new GenericRecordBuilderImpl(new Map(), new Map(), true, 'member-generic')
            .setInt32('id', 11)
            .setString('name', 'member')
            .setNullableInt32('maybeAge', null)
            .build();

        const result = service.toObject<GenericRecord>(service.toData(record)!)!;

        expect(result.getTypeName()).toBe('member-generic');
        expect(result.getInt32('id')).toBe(11);
        expect(result.getString('name')).toBe('member');
        expect(result.getNullableInt32('maybeAge')).toBeNull();
    });

    test('uses registered custom and global serializers before falling back to JSON', () => {
        const config = new HazelcastSerializationConfig();
        config.customSerializers.push({
            id: CUSTOM_SERIALIZER_ID,
            clazz: CustomPayload,
            read: (inp) => new CustomPayload(inp.readString() ?? ''),
            write: (out, obj) => out.writeString((obj as CustomPayload).label),
        });
        config.globalSerializer = {
            id: GLOBAL_SERIALIZER_ID,
            read: (inp) => ({ value: inp.readString() ?? '', fromGlobal: true }),
            write: (out, obj) => out.writeString(JSON.stringify(obj, (_key, value) => typeof value === 'bigint' ? value.toString() : value)),
        };
        const service = new HazelcastSerializationService(config);

        expect(service.toObject<CustomPayload>(service.toData(new CustomPayload('custom'))!)).toEqual(new CustomPayload('custom'));
        expect(service.toObject<{ value: string; fromGlobal: boolean }>(service.toData({ nested: 1n, ok: true })!)).toEqual({ value: '{"nested":"1","ok":true}', fromGlobal: true });
    });

    test('fails closed for unknown Java collection type IDs outside the retained scope', () => {
        const service = new HazelcastSerializationService();
        const data = new HeapData(Buffer.from([
            0, 0, 0, 0,
            0xff, 0xff, 0xff, 0xe3,
        ]));

        expect(() => service.toObject(data)).toThrow(HazelcastSerializationError);
    });

    test('fails when Portable data arrives without the required server-side registrations', () => {
        const writerConfig = new HazelcastSerializationConfig();
        writerConfig.portableFactories.set(PORTABLE_FACTORY_ID, portableFactory);
        writerConfig.classDefinitions.push(
            new ClassDefinitionBuilder(PORTABLE_FACTORY_ID, PORTABLE_CLASS_ID)
                .addIntField('id')
                .addStringField('name')
                .build(),
        );
        const writerService = new HazelcastSerializationService(writerConfig);
        const readerService = new HazelcastSerializationService();
        const data = writerService.toData(new SamplePortable(1, 'missing-registry'))!;

        expect(() => readerService.toObject(data)).toThrow(HazelcastSerializationError);
    });

    test('fails when Compact data is read without the matching schema', () => {
        const writerConfig = new HazelcastSerializationConfig();
        writerConfig.compactSerializers.push(sampleCompactSerializer);
        const writerService = new HazelcastSerializationService(writerConfig);
        const readerConfig = new HazelcastSerializationConfig();
        readerConfig.compactSerializers.push(sampleCompactSerializer);
        const readerService = new HazelcastSerializationService(readerConfig);
        const data = writerService.toData(new SampleCompact(2, 'missing-schema', 9))!;

        expect(() => readerService.toObject(data)).toThrow(HazelcastSerializationError);
    });

    test('fails on Compact nullability mismatches via GenericRecord accessors', () => {
        const service = new HazelcastSerializationService();
        const record = new GenericRecordBuilderImpl(new Map(), new Map(), true, 'nullable-mismatch')
            .setNullableInt32('maybeAge', null)
            .build();

        expect(() => record.getInt32('maybeAge')).toThrow(GenericRecordError);
        expect(record.getFieldKind('maybeAge')).toBe(FieldKind.NULLABLE_INT32);
    });
});

const portableFactory: PortableFactory = {
    create: () => new SamplePortable(),
};
