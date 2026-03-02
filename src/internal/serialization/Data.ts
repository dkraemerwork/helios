/**
 * Port of {@code com.hazelcast.internal.serialization.Data}.
 *
 * Core interface for binary serialized data.
 */
export interface Data {
    /** Raw byte representation of this Data. */
    toByteArray(): Buffer | null;

    /** Serializer type identifier. */
    getType(): number;

    /** Total byte count including header overhead. */
    totalSize(): number;

    /** Data payload byte count (totalSize - header overhead). */
    dataSize(): number;

    /** Copies this data into {@code dest} at {@code destPos}. */
    copyTo(dest: Buffer, destPos: number): void;

    /** Partition hash stored in the header (or fallback hashCode). */
    getPartitionHash(): number;

    /** Whether a non-zero partition hash is stored in the header. */
    hasPartitionHash(): boolean;

    /** Estimated heap cost in bytes. */
    getHeapCost(): number;

    /** 32-bit hash over the payload (excludes header). */
    hashCode(): number;

    /** 64-bit hash over the payload (excludes header). */
    hash64(): bigint;

    /** Whether this data is a Portable-serialized object. */
    isPortable(): boolean;

    /** Whether this data is JSON-serialized. */
    isJson(): boolean;

    /** Whether this data is Compact-serialized. */
    isCompact(): boolean;

    /** Value equality (compares type + payload bytes). */
    equals(other: unknown): boolean;
}
