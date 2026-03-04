/**
 * Port of {@code com.hazelcast.internal.serialization.impl.DataSerializableSerializer}.
 *
 * Handles typeId -2 (IdentifiedDataSerializable). Plain DataSerializable (non-identified)
 * is NOT supported — reading a non-IDS header throws HazelcastSerializationError.
 */
import type { ByteArrayObjectDataOutput } from '@helios/internal/serialization/impl/ByteArrayObjectDataOutput';
import type { ByteArrayObjectDataInput } from '@helios/internal/serialization/impl/ByteArrayObjectDataInput';
import type { SerializerAdapter } from '@helios/internal/serialization/impl/SerializerAdapter';
import type { DataSerializableFactory, IdentifiedDataSerializable } from '@helios/internal/serialization/impl/SerializationConfig';
import { DataSerializableHeader } from '@helios/internal/serialization/impl/DataSerializableHeader';
import { SerializationConstants } from '@helios/internal/serialization/impl/SerializationConstants';
import { HazelcastSerializationError } from '@helios/internal/serialization/impl/HazelcastSerializationError';

export class DataSerializableSerializer implements SerializerAdapter {
    private readonly factories = new Map<number, DataSerializableFactory>();

    getTypeId(): number {
        return SerializationConstants.CONSTANT_TYPE_DATA_SERIALIZABLE;
    }

    registerFactory(factoryId: number, factory: DataSerializableFactory): void {
        this.factories.set(factoryId, factory);
    }

    write(out: ByteArrayObjectDataOutput, obj: unknown): void {
        const ids = obj as IdentifiedDataSerializable;
        const header = DataSerializableHeader.createHeader(true, false);
        out.writeByte(header);
        out.writeInt(ids.getFactoryId());
        out.writeInt(ids.getClassId());
        ids.writeData(out);
    }

    read(inp: ByteArrayObjectDataInput): unknown {
        const header = inp.readByte();

        if (!DataSerializableHeader.isIdentifiedDataSerializable(header)) {
            throw new HazelcastSerializationError(
                'non-IdentifiedDataSerializable is not supported',
            );
        }

        const factoryId = inp.readInt();
        const classId = inp.readInt();

        const factory = this.factories.get(factoryId);
        if (!factory) {
            throw new HazelcastSerializationError(
                `No DataSerializerFactory for namespace: ${factoryId}`,
            );
        }

        const obj = factory.create(classId);
        if (!obj) {
            throw new HazelcastSerializationError(
                `Factory cannot create instance for classId: ${classId} on factoryId: ${factoryId}`,
            );
        }

        if (typeof obj.readData !== 'function') {
            throw new HazelcastSerializationError(
                `Factory created object for classId ${classId} / factoryId ${factoryId} does not implement readData(inp). The object must implement IdentifiedDataSerializable.`,
            );
        }

        if (DataSerializableHeader.isVersioned(header)) {
            inp.readByte();
            inp.readByte();
        }

        obj.readData(inp);
        return obj;
    }
}
