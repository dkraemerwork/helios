import type { SerializerAdapter } from '@zenystx/core/internal/serialization/impl/SerializerAdapter';
import { SerializationConstants } from '@zenystx/core/internal/serialization/impl/SerializationConstants';

export const ShortSerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_SHORT,
    write(out, obj) { out.writeShort(obj as number); },
    read(inp) { return inp.readShort(); },
};
