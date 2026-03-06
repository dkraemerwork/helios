/**
 * Port of {@code com.hazelcast.internal.serialization.DataSerializerHook}.
 *
 * Each subsystem that defines IdentifiedDataSerializable classes implements
 * this interface to register its factory with SerializationServiceImpl.
 */
import type { DataSerializableFactory } from '@zenystx/core/internal/serialization/impl/SerializationConfig';

export interface DataSerializerHook {
    getFactoryId(): number;
    createFactory(): DataSerializableFactory;
}
