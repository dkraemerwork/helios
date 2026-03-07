import { SerializationConstants } from '@zenystx/helios-core/internal/serialization/impl/SerializationConstants';
import type { SerializerAdapter } from '@zenystx/helios-core/internal/serialization/impl/SerializerAdapter';

export const StringArraySerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_STRING_ARRAY,
    write(out, obj) { out.writeStringArray(obj as string[]); },
    read(inp) { return inp.readStringArray(); },
};
