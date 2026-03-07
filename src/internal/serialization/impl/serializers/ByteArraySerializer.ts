import { SerializationConstants } from '@zenystx/helios-core/internal/serialization/impl/SerializationConstants';
import type { SerializerAdapter } from '@zenystx/helios-core/internal/serialization/impl/SerializerAdapter';

export const ByteArraySerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_BYTE_ARRAY,
    write(out, obj) {
        // N8 FIX: coerce plain Uint8Array to Buffer to avoid Buffer.copy() crash
        const buf = Buffer.isBuffer(obj) ? (obj as Buffer) : Buffer.from(obj as Uint8Array);
        out.writeByteArray(buf);
    },
    read(inp) { return inp.readByteArray(); },
};
