import type { SerializerAdapter } from '@helios/internal/serialization/impl/SerializerAdapter';
import { SerializationConstants } from '@helios/internal/serialization/impl/SerializationConstants';

export const DoubleArraySerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_DOUBLE_ARRAY,
    write(out, obj) { out.writeDoubleArray(obj as number[]); },
    read(inp) { return inp.readDoubleArray(); },
};
