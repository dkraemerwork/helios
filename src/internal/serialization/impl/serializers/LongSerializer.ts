import { SerializationConstants } from '@zenystx/helios-core/internal/serialization/impl/SerializationConstants';
import type { SerializerAdapter } from '@zenystx/helios-core/internal/serialization/impl/SerializerAdapter';

export const LongSerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_LONG,
    write(out, obj) {
        const val = typeof obj === 'bigint' ? obj : BigInt(obj as number);
        out.writeLong(val);
    },
    read(inp) { return inp.readLong(); },
};
