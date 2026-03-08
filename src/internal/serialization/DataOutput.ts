/**
 * Binary output stream matching Hazelcast's ObjectDataOutput interface.
 *
 * This is a thin facade alias exported from the existing
 * ByteArrayObjectDataOutput so callers can import from the canonical
 * Block-E path without duplicating the implementation.
 */
export {
    ByteArrayObjectDataOutput as DataOutput,
    MAX_ARRAY_SIZE,
} from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput';
