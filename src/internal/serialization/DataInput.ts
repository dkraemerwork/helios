/**
 * Binary input stream matching Hazelcast's ObjectDataInput interface.
 *
 * This is a thin facade alias exported from the existing
 * ByteArrayObjectDataInput so callers can import from the canonical
 * Block-E path without duplicating the implementation.
 */
export {
    BIG_ENDIAN, ByteArrayObjectDataInput as DataInput, EOFError, LITTLE_ENDIAN,
    NULL_ARRAY_LENGTH,
    type ByteOrder
} from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';
