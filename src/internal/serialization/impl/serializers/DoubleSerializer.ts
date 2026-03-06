import type { SerializerAdapter } from '@zenystx/helios-core/internal/serialization/impl/SerializerAdapter';
import { SerializationConstants } from '@zenystx/helios-core/internal/serialization/impl/SerializationConstants';

export const DoubleSerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_DOUBLE,
    write(out, obj) { out.writeDouble(obj as number); },
    read(inp) { return inp.readDouble(); },
};
