/**
 * Port of {@code com.hazelcast.config.InMemoryFormat}.
 * Determines how cache values are stored internally.
 */
export enum InMemoryFormat {
    /** Stored in binary serialized form (as {@code Data}). */
    BINARY = 'BINARY',
    /** Stored as deserialized Java/TypeScript objects. */
    OBJECT = 'OBJECT',
    /** Off-heap native memory — not supported in Helios (single-node JVM-based). */
    NATIVE = 'NATIVE',
}
