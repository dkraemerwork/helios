import { SerializationConstants } from '@zenystx/helios-core/internal/serialization/impl/SerializationConstants';
import type { SerializerAdapter } from '@zenystx/helios-core/internal/serialization/impl/SerializerAdapter';

export const BooleanSerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_BOOLEAN,
    write(out, obj) { out.writeBoolean(obj as boolean); },
    read(inp) { return inp.readBoolean(); },
};
