import type { SerializerAdapter } from '@helios/internal/serialization/impl/SerializerAdapter';
import { SerializationConstants } from '@helios/internal/serialization/impl/SerializationConstants';

export const DoubleSerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_DOUBLE,
    write(out, obj) { out.writeDouble(obj as number); },
    read(inp) { return inp.readDouble(); },
};
