import { SerializationConstants } from '@zenystx/helios-core/internal/serialization/impl/SerializationConstants';
import type { SerializerAdapter } from '@zenystx/helios-core/internal/serialization/impl/SerializerAdapter';

export const FloatArraySerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_FLOAT_ARRAY,
    write(out, obj) { out.writeFloatArray(obj as number[]); },
    read(inp) { return inp.readFloatArray(); },
};
