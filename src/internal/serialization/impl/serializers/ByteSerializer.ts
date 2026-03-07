import { SerializationConstants } from '@zenystx/helios-core/internal/serialization/impl/SerializationConstants';
import type { SerializerAdapter } from '@zenystx/helios-core/internal/serialization/impl/SerializerAdapter';

export const ByteSerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_BYTE,
    write(out, obj) { out.writeByte(obj as number); },
    read(inp) { return inp.readByte(); },
};
