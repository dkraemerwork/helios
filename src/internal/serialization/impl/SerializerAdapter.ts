/**
 * Port of {@code com.hazelcast.internal.serialization.impl.StreamSerializerAdapter}.
 *
 * Internal bridge interface between the dispatch table and individual serializers.
 */
import type { ByteArrayObjectDataOutput } from '@helios/internal/serialization/impl/ByteArrayObjectDataOutput';
import type { ByteArrayObjectDataInput } from '@helios/internal/serialization/impl/ByteArrayObjectDataInput';

export interface SerializerAdapter {
    getTypeId(): number;
    write(out: ByteArrayObjectDataOutput, obj: unknown): void;
    read(inp: ByteArrayObjectDataInput): unknown;
}
