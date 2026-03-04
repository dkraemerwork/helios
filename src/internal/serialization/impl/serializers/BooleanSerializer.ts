import type { SerializerAdapter } from '@helios/internal/serialization/impl/SerializerAdapter';
import { SerializationConstants } from '@helios/internal/serialization/impl/SerializationConstants';

export const BooleanSerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_BOOLEAN,
    write(out, obj) { out.writeBoolean(obj as boolean); },
    read(inp) { return inp.readBoolean(); },
};
