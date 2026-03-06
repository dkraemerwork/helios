import type { SerializerAdapter } from '@zenystx/helios-core/internal/serialization/impl/SerializerAdapter';
import { SerializationConstants } from '@zenystx/helios-core/internal/serialization/impl/SerializationConstants';

export const BooleanArraySerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_BOOLEAN_ARRAY,
    write(out, obj) { out.writeBooleanArray(obj as boolean[]); },
    read(inp) { return inp.readBooleanArray(); },
};
