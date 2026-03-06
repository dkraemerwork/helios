import type { SerializerAdapter } from '@zenystx/helios-core/internal/serialization/impl/SerializerAdapter';
import { SerializationConstants } from '@zenystx/helios-core/internal/serialization/impl/SerializationConstants';

export const LongArraySerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_LONG_ARRAY,
    write(out, obj) { out.writeLongArray(obj as bigint[]); },
    read(inp) { return inp.readLongArray(); },
};
