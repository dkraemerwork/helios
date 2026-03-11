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

enum DeliveryState {
    READY = 'READY',
    WAITING = 'WAITING',
}

class CompactV1 {
    constructor(public id: number, public name: string | null) {}
}

class CompactV2 {
    constructor(public id: number, public name: string | null, public maybeAge: number | null) {}
}

class CompactRenameV2 {
    constructor(public id: number, public displayName: string | null) {}
}

class CompactTypeMismatchV2 {
    constructor(public id: number, public age: number) {}
}

const compactV1Serializer: CompactSerializable<CompactV1> = {
    getClass: () => CompactV1 as unknown as new (...args: unknown[]) => CompactV1,
    getTypeName: () => 'sample-compact-evolution',
    write(writer: CompactWriter, object: CompactV1): void {
        writer.writeInt32('id', object.id);
        writer.writeString('name', object.name);
    },
    read(reader: CompactReader): CompactV1 {
        return new CompactV1(reader.readInt32('id'), reader.readString('name'));
    },
};

const compactV2Serializer: CompactSerializable<CompactV2> = {
    getClass: () => CompactV2 as unknown as new (...args: unknown[]) => CompactV2,
    getTypeName: () => 'sample-compact-evolution',
    write(writer: CompactWriter, object: CompactV2): void {
        writer.writeInt32('id', object.id);
        writer.writeString('name', object.name);
        writer.writeNullableInt32('maybeAge', object.maybeAge);
    },
    read(reader: CompactReader): CompactV2 {
        return new CompactV2(
            reader.readInt32('id'),
            reader.readString('name'),
            reader.readNullableInt32('maybeAge'),
        );
    },
};

const compactRenameV2Serializer: CompactSerializable<CompactRenameV2> = {
    getClass: () => CompactRenameV2 as unknown as new (...args: unknown[]) => CompactRenameV2,
    getTypeName: () => 'sample-compact-evolution',
    write(writer: CompactWriter, object: CompactRenameV2): void {
        writer.writeInt32('id', object.id);
        writer.writeString('displayName', object.displayName);
    },
    read(reader: CompactReader): CompactRenameV2 {
        const displayName = reader.readString('displayName');
        if (displayName === null) {
            throw new HazelcastSerializationError('Renamed compact field displayName is not compatible with earlier schemas');
        }
        return new CompactRenameV2(reader.readInt32('id'), displayName);
    },
};

const compactTypeMismatchV2Serializer: CompactSerializable<CompactTypeMismatchV2> = {
    getClass: () => CompactTypeMismatchV2 as unknown as new (...args: unknown[]) => CompactTypeMismatchV2,
    getTypeName: () => 'sample-compact-mismatch',
    write(writer: CompactWriter, object: CompactTypeMismatchV2): void {
        writer.writeInt32('id', object.id);
        writer.writeInt32('age', object.age);
    },
    read(reader: CompactReader): CompactTypeMismatchV2 {
        return new CompactTypeMismatchV2(reader.readInt32('id'), reader.readInt32('age'));
    },
};

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

    test('retains enum wire values through the primitive serialization path', () => {
        const service = new HazelcastSerializationService();

        expect(service.toObject<DeliveryState>(service.toData(DeliveryState.READY)!)).toBe(DeliveryState.READY);
        expect(service.toObject<DeliveryState[]>(service.toData([DeliveryState.READY, DeliveryState.WAITING])!)).toEqual([
            DeliveryState.READY,
            DeliveryState.WAITING,
        ]);
    });

    test('composes config registrations with runtime registrations before global fallback', () => {
        const config = new HazelcastSerializationConfig();
        config.classDefinitions.push(
            new ClassDefinitionBuilder(PORTABLE_FACTORY_ID, PORTABLE_CLASS_ID)
                .addIntField('id')
                .addStringField('name')
                .build(),
        );
        config.globalSerializer = {
            id: GLOBAL_SERIALIZER_ID,
            read: (inp) => ({ viaGlobal: inp.readString() ?? '' }),
            write: (out, obj) => out.writeString(JSON.stringify(obj)),
        };
        const service = new HazelcastSerializationService(config);
        service.registerPortableFactory(PORTABLE_FACTORY_ID, portableFactory);
        service.registerCustomSerializer({
            id: CUSTOM_SERIALIZER_ID,
            clazz: CustomPayload,
            read: (inp) => new CustomPayload(inp.readString() ?? ''),
            write: (out, obj) => out.writeString((obj as CustomPayload).label),
        });

        expect(service.toObject<SamplePortable>(service.toData(new SamplePortable(9, 'portable-runtime'))!)).toEqual(new SamplePortable(9, 'portable-runtime'));
        expect(service.toObject<CustomPayload>(service.toData(new CustomPayload('runtime-custom'))!)).toEqual(new CustomPayload('runtime-custom'));
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

    test('supports additive Compact schema evolution by defaulting missing fields', () => {
        const writerConfig = new HazelcastSerializationConfig();
        writerConfig.compactSerializers.push(compactV1Serializer);
        const writerService = new HazelcastSerializationService(writerConfig);
        const data = writerService.toData(new CompactV1(1, 'before-age'))!;
        const readerConfig = new HazelcastSerializationConfig();
        readerConfig.compactSerializers.push(compactV2Serializer);
        for (const schema of writerService.schemaService.getAllSchemas().values()) {
            readerConfig.schemaService.registerSchema(schema);
        }
        const readerService = new HazelcastSerializationService(readerConfig);

        const result = readerService.toObject<CompactV2>(data);

        expect(result).toEqual(new CompactV2(1, 'before-age', null));
    });

    test('supports subtractive Compact schema evolution by ignoring removed fields', () => {
        const writerConfig = new HazelcastSerializationConfig();
        writerConfig.compactSerializers.push(compactV2Serializer);
        const writerService = new HazelcastSerializationService(writerConfig);
        const data = writerService.toData(new CompactV2(2, 'after-age', 33))!;
        const readerConfig = new HazelcastSerializationConfig();
        readerConfig.compactSerializers.push(compactV1Serializer);
        for (const schema of writerService.schemaService.getAllSchemas().values()) {
            readerConfig.schemaService.registerSchema(schema);
        }
        const readerService = new HazelcastSerializationService(readerConfig);

        const result = readerService.toObject<CompactV1>(data);

        expect(result).toEqual(new CompactV1(2, 'after-age'));
    });

    test('fails on incompatible Compact field renames', () => {
        const writerConfig = new HazelcastSerializationConfig();
        writerConfig.compactSerializers.push(compactV1Serializer);
        const writerService = new HazelcastSerializationService(writerConfig);
        const readerConfig = new HazelcastSerializationConfig();
        readerConfig.compactSerializers.push(compactRenameV2Serializer);
        for (const schema of writerService.schemaService.getAllSchemas().values()) {
            readerConfig.schemaService.registerSchema(schema);
        }
        const readerService = new HazelcastSerializationService(readerConfig);

        expect(() => readerService.toObject(writerService.toData(new CompactV1(3, 'renamed'))!)).toThrow(HazelcastSerializationError);
    });

    test('fails on incompatible Compact field kind changes', () => {
        const writerConfig = new HazelcastSerializationConfig();
        writerConfig.compactSerializers.push({
            getClass: () => CompactV1 as unknown as new (...args: unknown[]) => CompactV1,
            getTypeName: () => 'sample-compact-mismatch',
            write: (writer: CompactWriter, object: CompactV1) => {
                writer.writeInt32('id', object.id);
                writer.writeString('age', object.name);
            },
            read: (reader: CompactReader) => new CompactV1(reader.readInt32('id'), reader.readString('age')),
        });
        const writerService = new HazelcastSerializationService(writerConfig);
        const readerConfig = new HazelcastSerializationConfig();
        readerConfig.compactSerializers.push(compactTypeMismatchV2Serializer);
        for (const schema of writerService.schemaService.getAllSchemas().values()) {
            readerConfig.schemaService.registerSchema(schema);
        }
        const readerService = new HazelcastSerializationService(readerConfig);

        expect(() => readerService.toObject(writerService.toData(new CompactV1(4, 'not-an-int'))!)).toThrow(HazelcastSerializationError);
    });

    test('fails on serializer conflicts and duplicate registrations', () => {
        const config = new HazelcastSerializationConfig();
        config.customSerializers.push({
            id: CUSTOM_SERIALIZER_ID,
            clazz: CustomPayload,
            read: (inp) => new CustomPayload(inp.readString() ?? ''),
            write: (out, obj) => out.writeString((obj as CustomPayload).label),
        });
        config.globalSerializer = {
            id: CUSTOM_SERIALIZER_ID,
            read: (inp) => inp.readString() ?? '',
            write: (out, obj) => out.writeString(String(obj)),
        };

        expect(() => new HazelcastSerializationService(config)).toThrow(HazelcastSerializationError);
        expect(() => {
            const service = new HazelcastSerializationService();
            service.registerDataSerializableFactory(IDS_FACTORY_ID, { create: () => new SampleIds() });
            service.registerDataSerializableFactory(IDS_FACTORY_ID, { create: () => new SampleIds() });
        }).toThrow(HazelcastSerializationError);
        expect(() => {
            const service = new HazelcastSerializationService();
            service.registerPortableFactory(PORTABLE_FACTORY_ID, portableFactory);
            service.registerPortableFactory(PORTABLE_FACTORY_ID, portableFactory);
        }).toThrow(HazelcastSerializationError);
        expect(() => {
            const service = new HazelcastSerializationService();
            service.registerClassDefinition(
                new ClassDefinitionBuilder(PORTABLE_FACTORY_ID, PORTABLE_CLASS_ID)
                    .addIntField('id')
                    .build(),
            );
            service.registerClassDefinition(
                new ClassDefinitionBuilder(PORTABLE_FACTORY_ID, PORTABLE_CLASS_ID)
                    .addStringField('name')
                    .build(),
            );
        }).toThrow(HazelcastSerializationError);
        expect(() => {
            const service = new HazelcastSerializationService();
            service.registerCompactSerializer(sampleCompactSerializer);
            service.registerCompactSerializer(sampleCompactSerializer);
        }).not.toThrow();
        expect(() => {
            const service = new HazelcastSerializationService();
            service.registerCompactSerializer(sampleCompactSerializer);
            service.registerCompactSerializer({ ...sampleCompactSerializer });
        }).toThrow(HazelcastSerializationError);
        expect(() => {
            const service = new HazelcastSerializationService();
            service.registerCompactSerializer({
                getClass: () => String as unknown as new (...args: unknown[]) => string,
                getTypeName: () => 'string-override',
                write: () => undefined,
                read: () => '',
            });
        }).toThrow(HazelcastSerializationError);
    });
});

const portableFactory: PortableFactory = {
    create: () => new SamplePortable(),
};
