import type { SerializerAdapter } from '@helios/internal/serialization/impl/SerializerAdapter';
import { SerializationConstants } from '@helios/internal/serialization/impl/SerializationConstants';

export const FloatSerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_FLOAT,
    write(out, obj) { out.writeFloat(obj as number); },
    read(inp) { return inp.readFloat(); },
};
