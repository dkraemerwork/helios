import { SerializationConstants } from '@zenystx/helios-core/internal/serialization/impl/SerializationConstants';
import type { SerializerAdapter } from '@zenystx/helios-core/internal/serialization/impl/SerializerAdapter';

export const UuidSerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_UUID,
    write(out, obj) {
        const hex = (obj as string).replace(/-/g, '');
        const most = BigInt.asIntN(64, BigInt('0x' + hex.slice(0, 16)));
        const least = BigInt.asIntN(64, BigInt('0x' + hex.slice(16, 32)));
        out.writeLong(most);
        out.writeLong(least);
    },
    read(inp) {
        const most = inp.readLong();
        const least = inp.readLong();
        // R3-C2 FIX: use BigInt.asUintN(64, ...) to handle signed bigint correctly
        const mostHex = BigInt.asUintN(64, most).toString(16).padStart(16, '0');
        const leastHex = BigInt.asUintN(64, least).toString(16).padStart(16, '0');
        const hex = mostHex + leastHex;
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
};
