import type { SerializerAdapter } from '@helios/internal/serialization/impl/SerializerAdapter';
import { SerializationConstants } from '@helios/internal/serialization/impl/SerializationConstants';

export const LongArraySerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_LONG_ARRAY,
    write(out, obj) { out.writeLongArray(obj as bigint[]); },
    read(inp) { return inp.readLongArray(); },
};
