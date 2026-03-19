/**
 * Port of {@code com.hazelcast.projection.impl.ProjectionDataSerializerHook}.
 *
 * Registers the projection subsystem's IdentifiedDataSerializable factories.
 * Factory ID = -30 (PROJECTION_DS_FACTORY_ID from FactoryIdHelper).
 */
import type { DataSerializerHook } from '@zenystx/helios-core/internal/serialization/impl/DataSerializerHook';
import type { DataSerializableFactory } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';
import { IdentityProjection } from '@zenystx/helios-core/projection/impl/IdentityProjection';
import { MultiAttributeProjection } from '@zenystx/helios-core/projection/impl/MultiAttributeProjection';
import { SingleAttributeProjection } from '@zenystx/helios-core/projection/impl/SingleAttributeProjection';

export const PROJECTION_DS_FACTORY_ID = -30;

export const SINGLE_ATTRIBUTE = 0;
export const MULTI_ATTRIBUTE = 1;
export const IDENTITY_PROJECTION = 2;

export class ProjectionDataSerializerHook implements DataSerializerHook {
    getFactoryId(): number {
        return PROJECTION_DS_FACTORY_ID;
    }

    createFactory(): DataSerializableFactory {
        return {
            create(classId: number) {
                switch (classId) {
                    case SINGLE_ATTRIBUTE:
                        return new SingleAttributeProjection('__placeholder__');
                    case MULTI_ATTRIBUTE:
                        return new MultiAttributeProjection('__placeholder__');
                    case IDENTITY_PROJECTION:
                        return IdentityProjection.INSTANCE;
                    default:
                        throw new Error(`Unknown classId ${classId} for ProjectionDataSerializerHook`);
                }
            },
        };
    }
}
