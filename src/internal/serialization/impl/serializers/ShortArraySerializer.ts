import { SerializationConstants } from '@zenystx/helios-core/internal/serialization/impl/SerializationConstants';
import type { SerializerAdapter } from '@zenystx/helios-core/internal/serialization/impl/SerializerAdapter';

export const ShortArraySerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_SHORT_ARRAY,
    write(out, obj) { out.writeShortArray(obj as number[]); },
    read(inp) { return inp.readShortArray(); },
};
