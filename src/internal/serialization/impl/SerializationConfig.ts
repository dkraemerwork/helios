/**
 * Port of {@code com.hazelcast.config.SerializationConfig} (subset).
 *
 * Configuration for SerializationServiceImpl — byte order, factory registrations,
 * and hook-based subsystem registration.
 */
import { BIG_ENDIAN, type ByteOrder } from '@helios/internal/serialization/impl/ByteArrayObjectDataInput';
import type { DataSerializerHook } from '@helios/internal/serialization/impl/DataSerializerHook';
import type { ByteArrayObjectDataOutput } from '@helios/internal/serialization/impl/ByteArrayObjectDataOutput';
import type { ByteArrayObjectDataInput } from '@helios/internal/serialization/impl/ByteArrayObjectDataInput';

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

export class SerializationConfig {
    byteOrder: ByteOrder = BIG_ENDIAN;
    dataSerializableFactories: Map<number, DataSerializableFactory> = new Map();
    dataSerializerHooks: DataSerializerHook[] = [];
}
