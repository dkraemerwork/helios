/**
 * Port of {@code com.hazelcast.internal.serialization.impl.ByteArrayObjectDataInput}.
 *
 * Reads binary data from a byte Buffer with position tracking.
 * Supports both big-endian and little-endian byte orders.
 */
import { Bits } from '@zenystx/helios-core/internal/nio/Bits';
import { HeapData } from '@zenystx/helios-core/internal/serialization/impl/HeapData';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { InternalSerializationService } from '@zenystx/helios-core/internal/serialization/InternalSerializationService';

export const NULL_ARRAY_LENGTH = -1;
const UTF_BUFFER_SIZE = 1024;

export class EOFError extends Error {
    constructor(msg = 'End of stream reached') {
        super(msg);
        this.name = 'EOFError';
    }
}

export type ByteOrder = 'BE' | 'LE';
export const BIG_ENDIAN: ByteOrder = 'BE';
export const LITTLE_ENDIAN: ByteOrder = 'LE';

export class ByteArrayObjectDataInput {
    readonly UTF_BUFFER_SIZE = UTF_BUFFER_SIZE;

    data: Buffer | null;
    size: number;
    pos: number;
    /** Mark position (Java field `mark`; renamed to avoid collision with the mark() method). */
    markPos: number;
    charBuffer: string[] | null;

    private readonly service: InternalSerializationService;
    private readonly bigEndian: boolean;

    constructor(
        data: Buffer | null,
        service: InternalSerializationService,
        byteOrder: ByteOrder,
        isCompatibility?: boolean,
    );
    constructor(
        data: Buffer | null,
        offset: number,
        service: InternalSerializationService,
        byteOrder: ByteOrder,
        isCompatibility?: boolean,
    );
    constructor(
        data: Buffer | null,
        serviceOrOffset: InternalSerializationService | number,
        byteOrderOrService: ByteOrder | InternalSerializationService,
        isCompatibilityOrByteOrder?: boolean | ByteOrder,
        isCompatibility2?: boolean,
    ) {
        if (typeof serviceOrOffset === 'number') {
            // (data, offset, service, byteOrder, isCompatibility?)
            const offset = serviceOrOffset;
            const service = byteOrderOrService as InternalSerializationService;
            const byteOrder = isCompatibilityOrByteOrder as ByteOrder;
            this.data = data;
            this.size = data != null ? data.length : 0;
            this.pos = offset;
            this.service = service;
            this.bigEndian = byteOrder === BIG_ENDIAN;
        } else {
            // (data, service, byteOrder, isCompatibility?)
            const service = serviceOrOffset as InternalSerializationService;
            const byteOrder = byteOrderOrService as ByteOrder;
            this.data = data;
            this.size = data != null ? data.length : 0;
            this.pos = 0;
            this.service = service;
            this.bigEndian = byteOrder === BIG_ENDIAN;
        }
        this.markPos = 0;
        this.charBuffer = null;
    }

    init(data: Buffer | null, offset: number): void {
        this.data = data;
        this.size = data != null ? data.length : 0;
        this.pos = offset;
    }

    clear(): void {
        this.data = null;
        this.size = 0;
        this.pos = 0;
        this.markPos = 0;
        if (this.charBuffer != null && this.charBuffer.length > UTF_BUFFER_SIZE * 8) {
            this.charBuffer = new Array(UTF_BUFFER_SIZE * 8);
        }
    }

    /** Read unsigned byte at current position (-1 if past end). */
    read(): number {
        return (this.pos < this.size && this.data != null) ? (this.data[this.pos++] & 0xff) : -1;
    }

    /** Read unsigned byte at given position (-1 if past end). */
    readAt(position: number): number {
        return (position < this.size && this.data != null) ? (this.data[position] & 0xff) : -1;
    }

    readBytes(b: Buffer, off: number, len: number): number {
        if (b == null) throw new TypeError('NullPointerException');
        this._boundsCheck(b.length, off, len);
        if (len === 0) return 0;
        if (this.pos >= this.size) return -1;
        if (this.pos + len > this.size) len = this.size - this.pos;
        this.data!.copy(b, off, this.pos, this.pos + len);
        this.pos += len;
        return len;
    }

    readBoolean(): boolean;
    readBoolean(position: number): boolean;
    readBoolean(position?: number): boolean {
        if (position !== undefined) {
            const ch = this.readAt(position);
            if (ch < 0) throw new EOFError();
            return ch !== 0;
        }
        const ch = this.read();
        if (ch < 0) throw new EOFError();
        return ch !== 0;
    }

    readByte(): number;
    readByte(position: number): number;
    readByte(position?: number): number {
        if (position !== undefined) {
            const ch = this.readAt(position);
            if (ch < 0) throw new EOFError();
            return (ch << 24) >> 24; // sign-extend to byte
        }
        const ch = this.read();
        if (ch < 0) throw new EOFError();
        return (ch << 24) >> 24; // sign-extend to byte
    }

    readChar(): number;
    readChar(position: number): number;
    readChar(position?: number): number {
        if (position !== undefined) {
            this.checkAvailable(position, Bits.CHAR_SIZE_IN_BYTES);
            return Bits.readChar(this.data!, position, this.bigEndian);
        }
        const c = this.readChar(this.pos);
        this.pos += Bits.CHAR_SIZE_IN_BYTES;
        return c;
    }

    readDouble(): number;
    readDouble(position: number): number;
    readDouble(byteOrder: ByteOrder): number;
    readDouble(position: number, byteOrder: ByteOrder): number;
    readDouble(posOrByteOrder?: number | ByteOrder, byteOrder?: ByteOrder): number {
        if (byteOrder !== undefined) {
            // (position, byteOrder)
            return longBitsToDouble(this.readLong(posOrByteOrder as number, byteOrder));
        }
        if (typeof posOrByteOrder === 'string') {
            // (byteOrder)
            return longBitsToDouble(this.readLongBO(posOrByteOrder));
        }
        if (typeof posOrByteOrder === 'number') {
            // (position)
            return longBitsToDouble(this.readLongAt(posOrByteOrder));
        }
        // ()
        return longBitsToDouble(this.readLong());
    }

    readFloat(): number;
    readFloat(position: number): number;
    readFloat(byteOrder: ByteOrder): number;
    readFloat(position: number, byteOrder: ByteOrder): number;
    readFloat(posOrByteOrder?: number | ByteOrder, byteOrder?: ByteOrder): number {
        if (byteOrder !== undefined) {
            return intBitsToFloat(this.readIntAt(posOrByteOrder as number, byteOrder));
        }
        if (typeof posOrByteOrder === 'string') {
            return intBitsToFloat(this.readIntBO(posOrByteOrder));
        }
        if (typeof posOrByteOrder === 'number') {
            return intBitsToFloat(this.readIntAt(posOrByteOrder));
        }
        return intBitsToFloat(this.readInt());
    }

    readFully(b: Buffer): void;
    readFully(b: Buffer, off: number, len: number): void;
    readFully(b: Buffer, off?: number, len?: number): void {
        if (off !== undefined && len !== undefined) {
            if (this.readBytes(b, off, len) === -1) throw new EOFError();
        } else {
            if (this.readBytes(b, 0, b.length) === -1) throw new EOFError();
        }
    }

    readInt(): number;
    readInt(position: number): number;
    readInt(byteOrder: ByteOrder): number;
    readInt(position: number, byteOrder: ByteOrder): number;
    readInt(posOrByteOrder?: number | ByteOrder, byteOrder?: ByteOrder): number {
        if (byteOrder !== undefined) {
            return this.readIntAt(posOrByteOrder as number, byteOrder);
        }
        if (typeof posOrByteOrder === 'string') {
            return this.readIntBO(posOrByteOrder);
        }
        if (typeof posOrByteOrder === 'number') {
            return this.readIntAt(posOrByteOrder);
        }
        const i = this.readIntAt(this.pos);
        this.pos += Bits.INT_SIZE_IN_BYTES;
        return i;
    }

    private readIntAt(position: number, byteOrder?: ByteOrder): number {
        this.checkAvailable(position, Bits.INT_SIZE_IN_BYTES);
        const be = byteOrder !== undefined ? byteOrder === BIG_ENDIAN : this.bigEndian;
        return Bits.readInt(this.data!, position, be);
    }

    private readIntBO(byteOrder: ByteOrder): number {
        const i = this.readIntAt(this.pos, byteOrder);
        this.pos += Bits.INT_SIZE_IN_BYTES;
        return i;
    }

    readLine(): never {
        throw new Error('UnsupportedOperation: readLine');
    }

    readLong(): bigint;
    readLong(position: number): bigint;
    readLong(byteOrder: ByteOrder): bigint;
    readLong(position: number, byteOrder: ByteOrder): bigint;
    readLong(posOrByteOrder?: number | ByteOrder, byteOrder?: ByteOrder): bigint {
        if (byteOrder !== undefined) {
            return this.readLongAt(posOrByteOrder as number, byteOrder);
        }
        if (typeof posOrByteOrder === 'string') {
            return this.readLongBO(posOrByteOrder);
        }
        if (typeof posOrByteOrder === 'number') {
            return this.readLongAt(posOrByteOrder);
        }
        const l = this.readLongAt(this.pos);
        this.pos += Bits.LONG_SIZE_IN_BYTES;
        return l;
    }

    private readLongAt(position: number, byteOrder?: ByteOrder): bigint {
        this.checkAvailable(position, Bits.LONG_SIZE_IN_BYTES);
        const be = byteOrder !== undefined ? byteOrder === BIG_ENDIAN : this.bigEndian;
        return Bits.readLong(this.data!, position, be);
    }

    private readLongBO(byteOrder: ByteOrder): bigint {
        const l = this.readLongAt(this.pos, byteOrder);
        this.pos += Bits.LONG_SIZE_IN_BYTES;
        return l;
    }

    readShort(): number;
    readShort(position: number): number;
    readShort(byteOrder: ByteOrder): number;
    readShort(position: number, byteOrder: ByteOrder): number;
    readShort(posOrByteOrder?: number | ByteOrder, byteOrder?: ByteOrder): number {
        if (byteOrder !== undefined) {
            return this.readShortAt(posOrByteOrder as number, byteOrder);
        }
        if (typeof posOrByteOrder === 'string') {
            return this.readShortBO(posOrByteOrder);
        }
        if (typeof posOrByteOrder === 'number') {
            return this.readShortAt(posOrByteOrder);
        }
        const s = this.readShortAt(this.pos);
        this.pos += Bits.SHORT_SIZE_IN_BYTES;
        return s;
    }

    private readShortAt(position: number, byteOrder?: ByteOrder): number {
        this.checkAvailable(position, Bits.SHORT_SIZE_IN_BYTES);
        const be = byteOrder !== undefined ? byteOrder === BIG_ENDIAN : this.bigEndian;
        return Bits.readShort(this.data!, position, be);
    }

    private readShortBO(byteOrder: ByteOrder): number {
        const s = this.readShortAt(this.pos, byteOrder);
        this.pos += Bits.SHORT_SIZE_IN_BYTES;
        return s;
    }

    readByteArray(): Buffer | null {
        const len = this.readInt();
        if (len === NULL_ARRAY_LENGTH) return null;
        if (len > 0) {
            const b = Buffer.allocUnsafe(len);
            this.readFully(b);
            return b;
        }
        return Buffer.alloc(0);
    }

    readBooleanArray(): boolean[] | null {
        const len = this.readInt();
        if (len === NULL_ARRAY_LENGTH) return null;
        if (len > 0) {
            const values: boolean[] = new Array(len);
            for (let i = 0; i < len; i++) values[i] = this.readBoolean();
            return values;
        }
        return [];
    }

    readCharArray(): number[] | null {
        const len = this.readInt();
        if (len === NULL_ARRAY_LENGTH) return null;
        if (len > 0) {
            const values: number[] = new Array(len);
            for (let i = 0; i < len; i++) values[i] = this.readChar();
            return values;
        }
        return [];
    }

    readIntArray(): number[] | null {
        const len = this.readInt();
        if (len === NULL_ARRAY_LENGTH) return null;
        if (len > 0) {
            const values: number[] = new Array(len);
            for (let i = 0; i < len; i++) values[i] = this.readInt();
            return values;
        }
        return [];
    }

    readLongArray(): bigint[] | null {
        const len = this.readInt();
        if (len === NULL_ARRAY_LENGTH) return null;
        if (len > 0) {
            const values: bigint[] = new Array(len);
            for (let i = 0; i < len; i++) values[i] = this.readLong();
            return values;
        }
        return [];
    }

    readDoubleArray(): number[] | null {
        const len = this.readInt();
        if (len === NULL_ARRAY_LENGTH) return null;
        if (len > 0) {
            const values: number[] = new Array(len);
            for (let i = 0; i < len; i++) values[i] = this.readDouble();
            return values;
        }
        return [];
    }

    readFloatArray(): number[] | null {
        const len = this.readInt();
        if (len === NULL_ARRAY_LENGTH) return null;
        if (len > 0) {
            const values: number[] = new Array(len);
            const sizeInBytes = len * Bits.FLOAT_SIZE_IN_BYTES;
            this.checkAvailable(this.pos, sizeInBytes);
            for (let i = 0; i < len; i++) {
                values[i] = this.bigEndian
                    ? this.data!.readFloatBE(this.pos + i * 4)
                    : this.data!.readFloatLE(this.pos + i * 4);
            }
            this.pos += sizeInBytes;
            return values;
        }
        return [];
    }

    readShortArray(): number[] | null {
        const len = this.readInt();
        if (len === NULL_ARRAY_LENGTH) return null;
        if (len > 0) {
            const values: number[] = new Array(len);
            for (let i = 0; i < len; i++) values[i] = this.readShort();
            return values;
        }
        return [];
    }

    readStringArray(): string[] | null {
        const len = this.readInt();
        if (len === NULL_ARRAY_LENGTH) return null;
        if (len > 0) {
            const values: string[] = new Array(len);
            for (let i = 0; i < len; i++) values[i] = this.readString()!;
            return values;
        }
        return [];
    }

    readUnsignedByte(): number {
        return this.readByte() & 0xff;
    }

    readUnsignedShort(): number {
        return this.readShort() & 0xffff;
    }

    readString(): string | null {
        const numberOfBytes = this.readInt();
        if (numberOfBytes === NULL_ARRAY_LENGTH) return null;
        this.checkAvailable(this.pos, numberOfBytes);
        const result = this.data!.toString('utf8', this.pos, this.pos + numberOfBytes);
        this.pos += numberOfBytes;
        return result;
    }

    readObject(): unknown {
        return this.service.readObject(this);
    }

    readData(): Data | null {
        const bytes = this.readByteArray();
        return bytes === null ? null : new HeapData(bytes);
    }

    skip(n: number | bigint): number {
        const num = typeof n === 'bigint' ? Number(n) : n;
        if (num <= 0 || num >= 2147483647) return 0;
        return this.skipBytes(num);
    }

    skipBytes(n: number): number {
        if (n <= 0) return 0;
        let skip = n;
        const pos = this.position();
        if (pos + skip > this.size) skip = this.size - pos;
        this.position(pos + skip);
        return skip;
    }

    position(): number;
    position(newPos: number): void;
    position(newPos?: number): number | void {
        if (newPos !== undefined) {
            if (newPos > this.size || newPos < 0) throw new Error('IllegalArgumentException: position out of range');
            this.pos = newPos;
            if (this.markPos > this.pos) this.markPos = -1;
        } else {
            return this.pos;
        }
    }

    checkAvailable(pos: number, k: number): void {
        if (pos < 0) throw new Error(`IllegalArgumentException: Negative pos! -> ${pos}`);
        if ((this.size - pos) < k) throw new EOFError(`Cannot read ${k} bytes!`);
    }

    available(): number {
        return this.size - this.pos;
    }

    markSupported(): boolean {
        return true;
    }

    mark(readlimit: number): void {
        this.markPos = this.pos;
    }

    reset(): void {
        this.pos = this.markPos;
    }

    close(): void {
        this.data = null;
        this.charBuffer = null;
    }

    getClassLoader(): unknown {
        return this.service.getClassLoader();
    }

    getSerializationService(): InternalSerializationService {
        return this.service;
    }

    getByteOrder(): ByteOrder {
        return this.bigEndian ? BIG_ENDIAN : LITTLE_ENDIAN;
    }

    private _boundsCheck(bufLen: number, off: number, len: number): void {
        if (off < 0 || len < 0 || off + len > bufLen) {
            throw new RangeError('IndexOutOfBoundsException');
        }
    }

    toString(): string {
        return `ByteArrayObjectDataInput{size=${this.size}, pos=${this.pos}, mark=${this.markPos}}`;
    }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function longBitsToDouble(bits: bigint): number {
    const buf = Buffer.allocUnsafe(8);
    buf.writeBigInt64BE(BigInt.asIntN(64, bits), 0);
    return buf.readDoubleBE(0);
}

function intBitsToFloat(bits: number): number {
    const buf = Buffer.allocUnsafe(4);
    buf.writeInt32BE(bits, 0);
    return buf.readFloatBE(0);
}
