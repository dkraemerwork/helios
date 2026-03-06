import type { SerializerAdapter } from '@zenystx/helios-core/internal/serialization/impl/SerializerAdapter';
import { SerializationConstants } from '@zenystx/helios-core/internal/serialization/impl/SerializationConstants';

export const IntegerArraySerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_INTEGER_ARRAY,
    write(out, obj) { out.writeIntArray(obj as number[]); },
    read(inp) { return inp.readIntArray(); },
};
