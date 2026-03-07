import { SerializationConstants } from '@zenystx/helios-core/internal/serialization/impl/SerializationConstants';
import type { SerializerAdapter } from '@zenystx/helios-core/internal/serialization/impl/SerializerAdapter';

export const NullSerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_NULL,
    write() {},
    read() { return null; },
};
