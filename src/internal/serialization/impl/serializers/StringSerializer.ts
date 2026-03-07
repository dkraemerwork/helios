import { SerializationConstants } from '@zenystx/helios-core/internal/serialization/impl/SerializationConstants';
import type { SerializerAdapter } from '@zenystx/helios-core/internal/serialization/impl/SerializerAdapter';

export const StringSerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_STRING,
    write(out, obj) { out.writeString(obj as string); },
    read(inp) { return inp.readString(); },
};
