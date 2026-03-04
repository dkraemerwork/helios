import type { SerializerAdapter } from '@helios/internal/serialization/impl/SerializerAdapter';
import { SerializationConstants } from '@helios/internal/serialization/impl/SerializationConstants';

export const FloatArraySerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_FLOAT_ARRAY,
    write(out, obj) { out.writeFloatArray(obj as number[]); },
    read(inp) { return inp.readFloatArray(); },
};
