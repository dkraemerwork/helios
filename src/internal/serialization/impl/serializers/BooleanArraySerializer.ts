import type { SerializerAdapter } from '@helios/internal/serialization/impl/SerializerAdapter';
import { SerializationConstants } from '@helios/internal/serialization/impl/SerializationConstants';

export const BooleanArraySerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_BOOLEAN_ARRAY,
    write(out, obj) { out.writeBooleanArray(obj as boolean[]); },
    read(inp) { return inp.readBooleanArray(); },
};
