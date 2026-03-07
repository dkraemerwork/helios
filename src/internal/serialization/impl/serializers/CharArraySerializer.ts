import { SerializationConstants } from '@zenystx/helios-core/internal/serialization/impl/SerializationConstants';
import type { SerializerAdapter } from '@zenystx/helios-core/internal/serialization/impl/SerializerAdapter';

export const CharArraySerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_CHAR_ARRAY,
    write(out, obj) { out.writeCharArray(obj as number[]); },
    read(inp) { return inp.readCharArray(); },
};
