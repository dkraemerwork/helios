import type { SerializerAdapter } from '@zenystx/helios-core/internal/serialization/impl/SerializerAdapter';
import { SerializationConstants } from '@zenystx/helios-core/internal/serialization/impl/SerializationConstants';

export const CharSerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_CHAR,
    write(out, obj) { out.writeChar(obj as number); },
    read(inp) { return inp.readChar(); },
};
