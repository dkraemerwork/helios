import type { SerializerAdapter } from '@zenystx/core/internal/serialization/impl/SerializerAdapter';
import { SerializationConstants } from '@zenystx/core/internal/serialization/impl/SerializationConstants';

export const NullSerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_NULL,
    write() {},
    read() { return null; },
};
