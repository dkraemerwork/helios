import type { SerializerAdapter } from '@zenystx/core/internal/serialization/impl/SerializerAdapter';
import { SerializationConstants } from '@zenystx/core/internal/serialization/impl/SerializationConstants';

export const LongSerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_LONG,
    write(out, obj) {
        const val = typeof obj === 'bigint' ? obj : BigInt(obj as number);
        out.writeLong(val);
    },
    read(inp) { return inp.readLong(); },
};
