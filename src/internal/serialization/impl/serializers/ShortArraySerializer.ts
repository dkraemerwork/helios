import type { SerializerAdapter } from '@zenystx/core/internal/serialization/impl/SerializerAdapter';
import { SerializationConstants } from '@zenystx/core/internal/serialization/impl/SerializationConstants';

export const ShortArraySerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_SHORT_ARRAY,
    write(out, obj) { out.writeShortArray(obj as number[]); },
    read(inp) { return inp.readShortArray(); },
};
