import type { SerializerAdapter } from '@zenystx/core/internal/serialization/impl/SerializerAdapter';
import { SerializationConstants } from '@zenystx/core/internal/serialization/impl/SerializationConstants';

export const CharArraySerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_CHAR_ARRAY,
    write(out, obj) { out.writeCharArray(obj as number[]); },
    read(inp) { return inp.readCharArray(); },
};
