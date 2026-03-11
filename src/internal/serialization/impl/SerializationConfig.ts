/**
 * Port of {@code com.hazelcast.config.SerializationConfig} (subset).
 *
 * Configuration for SerializationServiceImpl — byte order, factory registrations,
 * and hook-based subsystem registration.
 */
import type { ByteArrayObjectDataInput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';
import { BIG_ENDIAN, type ByteOrder } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';
import type { ByteArrayObjectDataOutput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput';
import type { CompactSerializable } from '@zenystx/helios-core/internal/serialization/compact/CompactSerializer';
import { SchemaService } from '@zenystx/helios-core/internal/serialization/compact/SchemaService';
import type { DataSerializerHook } from '@zenystx/helios-core/internal/serialization/impl/DataSerializerHook';
import type { ClassDefinition, PortableFactory } from '@zenystx/helios-core/internal/serialization/portable/PortableSerializer';

/** Duck-typed IdentifiedDataSerializable contract. */
export interface IdentifiedDataSerializable {
    getFactoryId(): number;
    getClassId(): number;
    writeData(out: ByteArrayObjectDataOutput): void;
    readData(inp: ByteArrayObjectDataInput): void;
}

/** Factory that creates blank IDS instances for deserialization. */
export interface DataSerializableFactory {
    create(classId: number): IdentifiedDataSerializable;
}

export interface StreamSerializer<T = unknown> {
    id: number;
    read(inp: ByteArrayObjectDataInput): T;
    write(out: ByteArrayObjectDataOutput, obj: T): void;
}

export interface CustomSerializer<T = unknown> extends StreamSerializer<T> {
    clazz?: new (...args: any[]) => T;
    matches?(obj: unknown): obj is T;
}

export class SerializationConfig {
    byteOrder: ByteOrder = BIG_ENDIAN;
    dataSerializableFactories: Map<number, DataSerializableFactory> = new Map();
    dataSerializerHooks: DataSerializerHook[] = [];
    portableFactories: Map<number, PortableFactory> = new Map();
    classDefinitions: ClassDefinition[] = [];
    portableVersion = 0;
    compactSerializers: CompactSerializable<unknown>[] = [];
    schemaService: SchemaService = new SchemaService();
    customSerializers: CustomSerializer[] = [];
    globalSerializer: StreamSerializer | null = null;
}
