/**
 * Port of {@code com.hazelcast.config.SerializationConfig} (subset).
 *
 * Configuration for SerializationServiceImpl — byte order, factory registrations,
 * and hook-based subsystem registration.
 */
import type { ByteArrayObjectDataInput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';
import { BIG_ENDIAN, type ByteOrder } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';
import type { ByteArrayObjectDataOutput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput';
import type { DataSerializerHook } from '@zenystx/helios-core/internal/serialization/impl/DataSerializerHook';

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
