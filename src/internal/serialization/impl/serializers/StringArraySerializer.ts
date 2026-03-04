import type { SerializerAdapter } from '@helios/internal/serialization/impl/SerializerAdapter';
import { SerializationConstants } from '@helios/internal/serialization/impl/SerializationConstants';

export const StringArraySerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_STRING_ARRAY,
    write(out, obj) { out.writeStringArray(obj as string[]); },
    read(inp) { return inp.readStringArray(); },
};
