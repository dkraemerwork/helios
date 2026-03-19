/**
 * Port of {@code com.hazelcast.projection.impl.IdentityProjection}.
 *
 * A projection that returns the input unchanged.
 * Implements IdentifiedDataSerializable for wire serialization.
 */
import type { ByteArrayObjectDataInput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';
import type { ByteArrayObjectDataOutput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput';
import type { IdentifiedDataSerializable } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';
import { IDENTITY_PROJECTION, PROJECTION_DS_FACTORY_ID } from '@zenystx/helios-core/projection/impl/ProjectionDataSerializerHook';
import type { Projection } from '@zenystx/helios-core/projection/Projection';

export class IdentityProjection<I> implements Projection<I, I>, IdentifiedDataSerializable {
    static readonly INSTANCE: IdentityProjection<unknown> = new IdentityProjection();

    private constructor() {}

    transform(input: I): I {
        return input;
    }

    getFactoryId(): number {
        return PROJECTION_DS_FACTORY_ID;
    }

    getClassId(): number {
        return IDENTITY_PROJECTION;
    }

    writeData(_out: ByteArrayObjectDataOutput): void {
        // no fields to write
    }

    readData(_inp: ByteArrayObjectDataInput): void {
        // no fields to read
    }
}
