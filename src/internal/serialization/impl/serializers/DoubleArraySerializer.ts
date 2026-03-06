import type { SerializerAdapter } from '@zenystx/helios-core/internal/serialization/impl/SerializerAdapter';
import { SerializationConstants } from '@zenystx/helios-core/internal/serialization/impl/SerializationConstants';

export const DoubleArraySerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_DOUBLE_ARRAY,
    write(out, obj) { out.writeDoubleArray(obj as number[]); },
    read(inp) { return inp.readDoubleArray(); },
};
