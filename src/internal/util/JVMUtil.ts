/**
 * Port of {@code com.hazelcast.internal.util.JVMUtil}.
 *
 * JVM memory layout constants used for heap cost estimation.
 * Values match a 64-bit JVM with compressed oops (the most common case).
 */
export const JVMUtil = {
    /**
     * Cost of an object reference in bytes.
     * 4 bytes with compressed oops (default for heap < 32 GB on 64-bit JVM).
     */
    REFERENCE_COST_IN_BYTES: 4 as number,

    /**
     * Size of the object header in bytes.
     * 12 bytes on 64-bit JVM with compressed oops (mark word 8 bytes + klass pointer 4 bytes).
     */
    OBJECT_HEADER_SIZE: 12 as number,
} as const;
