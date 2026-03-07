import { HazelcastSerializationError } from '@zenystx/helios-core/internal/serialization/impl/HazelcastSerializationError';
import { SerializationConstants } from '@zenystx/helios-core/internal/serialization/impl/SerializationConstants';
import type { SerializerAdapter } from '@zenystx/helios-core/internal/serialization/impl/SerializerAdapter';

export const JavaScriptJsonSerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.JAVASCRIPT_JSON_SERIALIZATION_TYPE,
    write(out, obj) {
        // N11 FIX: wrap JSON.stringify in try-catch for bigint/circular refs
        let json: string | undefined;
        try {
            json = JSON.stringify(obj);
        } catch (e) {
            throw new HazelcastSerializationError(
                `JavaScriptJsonSerializer cannot serialize object: ${
                    e instanceof Error ? e.message : String(e)
                }. Objects with bigint fields or circular references cannot be ` +
                'serialized with the default JSON serializer. ' +
                'Use a custom serializer or convert bigint fields to string/number.',
                e,
            );
        }
        // R3-C3 FIX: JSON.stringify returns undefined for functions/Symbols
        if (json === undefined) {
            throw new HazelcastSerializationError(
                'JavaScriptJsonSerializer cannot serialize this value: JSON.stringify returned ' +
                'undefined. Functions, Symbols, and undefined values cannot be serialized. ' +
                'Use a custom serializer or convert the value to a JSON-representable type.',
            );
        }
        const utf8Bytes = Buffer.from(json, 'utf8');
        out.writeInt(utf8Bytes.length);
        out.writeBytes(utf8Bytes, 0, utf8Bytes.length);
    },
    read(inp) {
        const length = inp.readInt();
        const buf = Buffer.allocUnsafe(length);
        inp.readFully(buf);
        return JSON.parse(buf.toString('utf8'));
    },
};
