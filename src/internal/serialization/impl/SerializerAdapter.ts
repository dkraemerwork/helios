/**
 * Port of {@code com.hazelcast.internal.serialization.impl.StreamSerializerAdapter}.
 *
 * Internal bridge interface between the dispatch table and individual serializers.
 */
import type { ByteArrayObjectDataInput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';
import type { ByteArrayObjectDataOutput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput';

export interface SerializerAdapter {
    getTypeId(): number;
    write(out: ByteArrayObjectDataOutput, obj: unknown): void;
    read(inp: ByteArrayObjectDataInput): unknown;
}
