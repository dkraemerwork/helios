/**
 * Port of {@code com.hazelcast.internal.serialization.impl.DataSerializableSerializer}.
 *
 * Handles typeId -2 (IdentifiedDataSerializable). Plain DataSerializable (non-identified)
 * is NOT supported — reading a non-IDS header throws HazelcastSerializationError.
 */
import type { ByteArrayObjectDataInput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';
import type { ByteArrayObjectDataOutput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput';
import { DataSerializableHeader } from '@zenystx/helios-core/internal/serialization/impl/DataSerializableHeader';
import { HazelcastSerializationError } from '@zenystx/helios-core/internal/serialization/impl/HazelcastSerializationError';
import type { DataSerializableFactory, IdentifiedDataSerializable } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';
import { SerializationConstants } from '@zenystx/helios-core/internal/serialization/impl/SerializationConstants';
import type { SerializerAdapter } from '@zenystx/helios-core/internal/serialization/impl/SerializerAdapter';

export class DataSerializableSerializer implements SerializerAdapter {
    private readonly factories = new Map<number, DataSerializableFactory>();

    getTypeId(): number {
        return SerializationConstants.CONSTANT_TYPE_DATA_SERIALIZABLE;
    }

    registerFactory(factoryId: number, factory: DataSerializableFactory): void {
        if (this.factories.has(factoryId)) {
            throw new HazelcastSerializationError(
                `DataSerializableFactory already registered for factoryId ${factoryId}`,
            );
        }
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
