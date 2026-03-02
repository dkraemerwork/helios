/**
 * Access and manipulate bits, bytes, and primitives.
 *
 * Port of {@code com.hazelcast.internal.nio.Bits}.
 *
 * Type mapping
 *   Java char  (unsigned 16-bit) → number  (0..65535)
 *   Java short (signed   16-bit) → number  (−32768..32767)
 *   Java int   (signed   32-bit) → number  (standard JS bitwise 32-bit int)
 *   Java long  (signed   64-bit) → bigint
 *   Java byte[]                  → Buffer
 */
export const Bits = {
    // ── size constants ──────────────────────────────────────────────────────
    BYTE_SIZE_IN_BYTES: 1,
    BOOLEAN_SIZE_IN_BYTES: 1,
    SHORT_SIZE_IN_BYTES: 2,
    CHAR_SIZE_IN_BYTES: 2,
    BYTES_CHAR: 2,
    INT_SIZE_IN_BYTES: 4,
    BYTES_INT: 4,
    FLOAT_SIZE_IN_BYTES: 4,
    LONG_SIZE_IN_BYTES: 8,
    BYTES_LONG: 8,
    DOUBLE_SIZE_IN_BYTES: 8,
    /** Sentinel written to the stream to represent a null array. */
    NULL_ARRAY_LENGTH: -1,
    CACHE_LINE_LENGTH: 64,

    // ── char (unsigned 16-bit) ──────────────────────────────────────────────

    readChar(buffer: Buffer, pos: number, useBigEndian: boolean): number {
        return useBigEndian ? buffer.readUInt16BE(pos) : buffer.readUInt16LE(pos);
    },

    readCharB(buffer: Buffer, pos: number): number {
        return buffer.readUInt16BE(pos);
    },

    readCharL(buffer: Buffer, pos: number): number {
        return buffer.readUInt16LE(pos);
    },

    writeChar(buffer: Buffer, pos: number, v: number, useBigEndian: boolean): void {
        if (useBigEndian) buffer.writeUInt16BE(v & 0xffff, pos);
        else buffer.writeUInt16LE(v & 0xffff, pos);
    },

    writeCharB(buffer: Buffer, pos: number, v: number): void {
        buffer.writeUInt16BE(v & 0xffff, pos);
    },

    writeCharL(buffer: Buffer, pos: number, v: number): void {
        buffer.writeUInt16LE(v & 0xffff, pos);
    },

    // ── short (signed 16-bit) ───────────────────────────────────────────────

    readShort(buffer: Buffer, pos: number, useBigEndian: boolean): number {
        return useBigEndian ? buffer.readInt16BE(pos) : buffer.readInt16LE(pos);
    },

    readShortB(buffer: Buffer, pos: number): number {
        return buffer.readInt16BE(pos);
    },

    readShortL(buffer: Buffer, pos: number): number {
        return buffer.readInt16LE(pos);
    },

    writeShort(buffer: Buffer, pos: number, v: number, useBigEndian: boolean): void {
        if (useBigEndian) buffer.writeInt16BE(v, pos);
        else buffer.writeInt16LE(v, pos);
    },

    writeShortB(buffer: Buffer, pos: number, v: number): void {
        buffer.writeInt16BE(v, pos);
    },

    writeShortL(buffer: Buffer, pos: number, v: number): void {
        buffer.writeInt16LE(v, pos);
    },

    // ── int (signed 32-bit) ─────────────────────────────────────────────────

    readInt(buffer: Buffer, pos: number, useBigEndian: boolean): number {
        return useBigEndian ? buffer.readInt32BE(pos) : buffer.readInt32LE(pos);
    },

    readIntB(buffer: Buffer, pos: number): number {
        return buffer.readInt32BE(pos);
    },

    readIntL(buffer: Buffer, pos: number): number {
        return buffer.readInt32LE(pos);
    },

    writeInt(buffer: Buffer, pos: number, v: number, useBigEndian: boolean): void {
        if (useBigEndian) buffer.writeInt32BE(v, pos);
        else buffer.writeInt32LE(v, pos);
    },

    writeIntB(buffer: Buffer, pos: number, v: number): void {
        buffer.writeInt32BE(v, pos);
    },

    writeIntL(buffer: Buffer, pos: number, v: number): void {
        buffer.writeInt32LE(v, pos);
    },

    // ── long (signed 64-bit → bigint) ───────────────────────────────────────

    readLong(buffer: Buffer, pos: number, useBigEndian: boolean): bigint {
        return useBigEndian ? buffer.readBigInt64BE(pos) : buffer.readBigInt64LE(pos);
    },

    readLongB(buffer: Buffer, pos: number): bigint {
        return buffer.readBigInt64BE(pos);
    },

    readLongL(buffer: Buffer, pos: number): bigint {
        return buffer.readBigInt64LE(pos);
    },

    writeLong(buffer: Buffer, pos: number, v: bigint, useBigEndian: boolean): void {
        if (useBigEndian) buffer.writeBigInt64BE(v, pos);
        else buffer.writeBigInt64LE(v, pos);
    },

    writeLongB(buffer: Buffer, pos: number, v: bigint): void {
        buffer.writeBigInt64BE(v, pos);
    },

    writeLongL(buffer: Buffer, pos: number, v: bigint): void {
        buffer.writeBigInt64LE(v, pos);
    },

    // ── UTF-8 ────────────────────────────────────────────────────────────────

    /**
     * Writes a single Unicode code-point as modified-UTF-8 (same encoding as
     * Java's DataOutputStream.writeUTF).  Returns the number of bytes written
     * (1, 2 or 3).
     */
    writeUtf8Char(buffer: Buffer, pos: number, c: number): number {
        if (c < 0x80) {
            buffer[pos] = c;
            return 1;
        }
        if (c < 0x800) {
            buffer[pos]     = 0xc0 | (c >> 6);
            buffer[pos + 1] = 0x80 | (c & 0x3f);
            return 2;
        }
        buffer[pos]     = 0xe0 | (c >> 12);
        buffer[pos + 1] = 0x80 | ((c >> 6) & 0x3f);
        buffer[pos + 2] = 0x80 | (c & 0x3f);
        return 3;
    },

    // ── bit manipulation ────────────────────────────────────────────────────
    //
    // All three operate on 32-bit two's-complement integers.
    // TypeScript has no `byte` primitive; callers that need signed-byte
    // semantics must apply `(result << 24) >> 24` themselves.

    /** Sets bit {@code bit} of {@code value}. */
    setBit(value: number, bit: number): number {
        return (value | (1 << bit)) | 0;
    },

    /** Clears bit {@code bit} of {@code value}. */
    clearBit(value: number, bit: number): number {
        return (value & ~(1 << bit)) | 0;
    },

    /** Inverts bit {@code bit} of {@code value}. */
    invertBit(value: number, bit: number): number {
        return (value ^ (1 << bit)) | 0;
    },

    /** Returns {@code true} if bit {@code bit} is set in {@code value}. */
    isBitSet(value: number, bit: number): boolean {
        return (value & (1 << bit)) !== 0;
    },

    // ── combine / extract ────────────────────────────────────────────────────

    /**
     * Packs two signed 16-bit values into one signed 32-bit integer.
     * {@code x} occupies the upper 16 bits, {@code y} the lower 16 bits.
     */
    combineToInt(x: number, y: number): number {
        return ((x << 16) | (y & 0xffff)) | 0;
    },

    /**
     * Extracts a signed 16-bit value from a packed 32-bit integer.
     * {@code lowerBits = true} → lower 16 bits; {@code false} → upper 16 bits.
     */
    extractShort(value: number, lowerBits: boolean): number {
        const raw = lowerBits ? value : (value >> 16);
        return (raw << 16) >> 16; // sign-extend to 16 bits
    },

    /**
     * Packs two signed 32-bit integers into one signed 64-bit bigint.
     * {@code x} occupies the upper 32 bits, {@code y} the lower 32 bits.
     */
    combineToLong(x: number, y: number): bigint {
        return (BigInt(x) << 32n) | (BigInt(y) & 0xffff_ffffn);
    },

    /**
     * Extracts a signed 32-bit integer from a packed 64-bit bigint.
     * {@code lowerBits = true} → lower 32 bits; {@code false} → upper 32 bits.
     */
    extractInt(value: bigint, lowerBits: boolean): number {
        const raw = lowerBits ? value : (value >> 32n);
        return Number(BigInt.asIntN(32, raw));
    },
} as const;
