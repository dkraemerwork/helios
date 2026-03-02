/**
 * Java-like ByteBuffer adapter for TypeScript/Bun.
 * Wraps a Node.js Buffer with position/limit/capacity semantics.
 */
export class ByteBuffer {
    private _buf: Buffer;
    private _pos: number;
    private _limit: number;
    private readonly _capacity: number;

    private constructor(buf: Buffer, pos: number, limit: number) {
        this._buf = buf;
        this._pos = pos;
        this._limit = limit;
        this._capacity = buf.length;
    }

    static allocate(capacity: number): ByteBuffer {
        return new ByteBuffer(Buffer.allocUnsafe(capacity), 0, capacity);
    }

    static wrap(buf: Buffer): ByteBuffer {
        return new ByteBuffer(buf, 0, buf.length);
    }

    remaining(): number {
        return this._limit - this._pos;
    }

    hasRemaining(): boolean {
        return this._pos < this._limit;
    }

    position(): number {
        return this._pos;
    }

    setPosition(n: number): this {
        this._pos = n;
        return this;
    }

    limit(): number {
        return this._limit;
    }

    capacity(): number {
        return this._capacity;
    }

    flip(): this {
        this._limit = this._pos;
        this._pos = 0;
        return this;
    }

    clear(): this {
        this._pos = 0;
        this._limit = this._capacity;
        return this;
    }

    compact(): this {
        const remaining = this._limit - this._pos;
        this._buf.copy(this._buf, 0, this._pos, this._limit);
        this._pos = remaining;
        this._limit = this._capacity;
        return this;
    }

    /** Compact if there are remaining bytes, otherwise clear. */
    static compactOrClear(buf: ByteBuffer): void {
        if (buf.hasRemaining()) {
            buf.compact();
        } else {
            buf.clear();
        }
    }

    get(): number {
        return this._buf[this._pos++];
    }

    put(value: number): this {
        this._buf[this._pos++] = value & 0xff;
        return this;
    }

    getChar(): number {
        const v = this._buf.readUInt16BE(this._pos);
        this._pos += 2;
        return v;
    }

    putChar(value: number): this {
        this._buf.writeUInt16BE(value & 0xffff, this._pos);
        this._pos += 2;
        return this;
    }

    getInt(): number {
        const v = this._buf.readInt32BE(this._pos);
        this._pos += 4;
        return v;
    }

    putInt(value: number): this {
        this._buf.writeInt32BE(value, this._pos);
        this._pos += 4;
        return this;
    }

    /** Read a LE int32 at current position and advance by 4. */
    getInt32LE(): number {
        const v = this._buf.readInt32LE(this._pos);
        this._pos += 4;
        return v;
    }

    /** Write a LE int32 at current position and advance by 4. */
    putInt32LE(v: number): this {
        this._buf.writeInt32LE(v | 0, this._pos);
        this._pos += 4;
        return this;
    }

    /** Read a LE uint16 at current position and advance by 2. */
    getInt16LE(): number {
        const v = this._buf.readUInt16LE(this._pos);
        this._pos += 2;
        return v;
    }

    /** Write a LE uint16 at current position and advance by 2. */
    putInt16LE(v: number): this {
        this._buf.writeUInt16LE(v & 0xffff, this._pos);
        this._pos += 2;
        return this;
    }

    /** Read a LE int32 at current position WITHOUT advancing. */
    peekInt32LE(): number {
        return this._buf.readInt32LE(this._pos);
    }

    /** Read a LE uint16 at current position WITHOUT advancing. */
    peekInt16LE(): number {
        return this._buf.readUInt16LE(this._pos);
    }

    /** Read a LE int64 (bigint) at current position and advance by 8. */
    getInt64LE(): bigint {
        const v = this._buf.readBigInt64LE(this._pos);
        this._pos += 8;
        return v;
    }

    /** Write a LE int64 (bigint) at current position and advance by 8. */
    putInt64LE(v: bigint): this {
        this._buf.writeBigInt64LE(v, this._pos);
        this._pos += 8;
        return this;
    }

    /** Read a LE uint64 (bigint) at current position and advance by 8. */
    getUInt64LE(): bigint {
        const v = this._buf.readBigUInt64LE(this._pos);
        this._pos += 8;
        return v;
    }

    /** Write a LE uint64 (bigint) at current position and advance by 8. */
    putUInt64LE(v: bigint): this {
        this._buf.writeBigUInt64LE(v, this._pos);
        this._pos += 8;
        return this;
    }

    getBytes(dst: Buffer, offset: number, length: number): void {
        this._buf.copy(dst, offset, this._pos, this._pos + length);
        this._pos += length;
    }

    putBytes(src: Buffer, offset: number, length: number): this {
        src.copy(this._buf, this._pos, offset, offset + length);
        this._pos += length;
        return this;
    }

    /** Expose the underlying Buffer (for direct I/O). */
    buffer(): Buffer {
        return this._buf;
    }
}
