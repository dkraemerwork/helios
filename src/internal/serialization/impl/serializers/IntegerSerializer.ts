import type { SerializerAdapter } from '@helios/internal/serialization/impl/SerializerAdapter';
import { SerializationConstants } from '@helios/internal/serialization/impl/SerializationConstants';

export const IntegerSerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_INTEGER,
    write(out, obj) { out.writeInt(obj as number); },
    read(inp) { return inp.readInt(); },
};
