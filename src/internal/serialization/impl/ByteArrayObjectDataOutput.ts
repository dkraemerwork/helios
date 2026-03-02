/**
 * Port of {@code com.hazelcast.internal.serialization.impl.ByteArrayObjectDataOutput}.
 *
 * Dynamic byte buffer output stream with positional write methods.
 */
import { Bits } from '@helios/internal/nio/Bits';
import type { Data } from '@helios/internal/serialization/Data';
import type { InternalSerializationService } from '@helios/internal/serialization/InternalSerializationService';
import { NULL_ARRAY_LENGTH, BIG_ENDIAN, type ByteOrder } from '@helios/internal/serialization/impl/ByteArrayObjectDataInput';

/** Maximum array size (mirrors OpenJDK SOFT_MAX_ARRAY_LENGTH). */
export const MAX_ARRAY_SIZE = 2147483647 - 64; // Integer.MAX_VALUE - 64

export class ByteArrayObjectDataOutput {
    /** Maximum buffer capacity. */
    static readonly MAX_ARRAY_SIZE = MAX_ARRAY_SIZE;

    readonly initialSize: number;
    readonly firstGrowthSize: number;

    buffer: Buffer;
    pos: number;

    readonly service: InternalSerializationService | null;

    private readonly isBigEndian: boolean;

    constructor(size: number, service: InternalSerializationService | null, byteOrder: ByteOrder);
    constructor(initialSize: number, firstGrowthSize: number, service: InternalSerializationService | null, byteOrder: ByteOrder);
    constructor(
        sizeOrInitial: number,
        firstGrowthOrService: number | InternalSerializationService | null,
        serviceOrByteOrder: InternalSerializationService | null | ByteOrder,
        byteOrder?: ByteOrder,
    ) {
        if (byteOrder !== undefined) {
            // (initialSize, firstGrowthSize, service, byteOrder)
            this.initialSize = sizeOrInitial;
            this.firstGrowthSize = firstGrowthOrService as number;
            this.service = serviceOrByteOrder as InternalSerializationService | null;
            this.isBigEndian = byteOrder === BIG_ENDIAN;
        } else {
            // (size, service, byteOrder)
            this.initialSize = sizeOrInitial;
            this.firstGrowthSize = -1;
            this.service = firstGrowthOrService as InternalSerializationService | null;
            this.isBigEndian = (serviceOrByteOrder as ByteOrder) === BIG_ENDIAN;
        }
        this.buffer = Buffer.allocUnsafe(this.initialSize);
        this.pos = 0;
    }

    write(b: number): void;
    write(position: number, b: number): void;
    write(bOrPosition: number, b?: number): void {
        if (b !== undefined) {
            // write(position, b)
            this.buffer[bOrPosition] = b & 0xff;
        } else {
            this.ensureAvailable(1);
            this.buffer[this.pos++] = bOrPosition & 0xff;
        }
    }

    writeBytes(b: Buffer, off: number, len: number): void {
        if (b == null) throw new TypeError('NullPointerException');
        if (off < 0 || len < 0 || off + len > b.length) throw new RangeError('IndexOutOfBoundsException');
        if (len === 0) return;
        this.ensureAvailable(len);
        b.copy(this.buffer, this.pos, off, off + len);
        this.pos += len;
    }

    writeBoolean(v: boolean): void;
    writeBoolean(position: number, v: boolean): void;
    writeBoolean(posOrV: number | boolean, v?: boolean): void {
        if (v !== undefined) {
            // writeBoolean(position, v)
            this.write(posOrV as number, v ? 1 : 0);
        } else {
            this.write(posOrV ? 1 : 0);
        }
    }

    writeBooleanBit(position: number, bitIndex: number, v: boolean): void {
        let b = this.buffer[position];
        if (v) b = (b | (1 << bitIndex)) & 0xff;
        else b = (b & ~(1 << bitIndex)) & 0xff;
        this.buffer[position] = b;
    }

    writeByte(v: number): void;
    writeByte(position: number, v: number): void;
    writeByte(posOrV: number, v?: number): void {
        if (v !== undefined) this.write(posOrV, v);
        else this.write(posOrV);
    }

    writeZeroBytes(count: number): void {
        for (let k = 0; k < count; k++) this.write(0);
    }

    writeChar(v: number): void;
    writeChar(position: number, v: number): void;
    writeChar(posOrV: number, v?: number): void {
        if (v !== undefined) {
            Bits.writeChar(this.buffer, posOrV, v, this.isBigEndian);
        } else {
            this.ensureAvailable(Bits.CHAR_SIZE_IN_BYTES);
            Bits.writeChar(this.buffer, this.pos, posOrV, this.isBigEndian);
            this.pos += Bits.CHAR_SIZE_IN_BYTES;
        }
    }

    writeDouble(v: number): void;
    writeDouble(position: number, v: number): void;
    writeDouble(v: number, byteOrder: ByteOrder): void;
    writeDouble(position: number, v: number, byteOrder: ByteOrder): void;
    writeDouble(posOrV: number, vOrByteOrder?: number | ByteOrder, byteOrder?: ByteOrder): void {
        if (byteOrder !== undefined) {
            // (position, v, byteOrder)
            this.writeLong(posOrV, doubleToLongBits(vOrByteOrder as number), byteOrder);
        } else if (typeof vOrByteOrder === 'string') {
            // (v, byteOrder)
            this.writeLong(doubleToLongBits(posOrV), vOrByteOrder);
        } else if (vOrByteOrder !== undefined) {
            // (position, v)
            this.writeLong(posOrV, doubleToLongBits(vOrByteOrder));
        } else {
            // (v)
            this.writeLong(doubleToLongBits(posOrV));
        }
    }

    writeFloat(v: number): void;
    writeFloat(position: number, v: number): void;
    writeFloat(v: number, byteOrder: ByteOrder): void;
    writeFloat(position: number, v: number, byteOrder: ByteOrder): void;
    writeFloat(posOrV: number, vOrByteOrder?: number | ByteOrder, byteOrder?: ByteOrder): void {
        if (byteOrder !== undefined) {
            this.writeInt(posOrV, floatToIntBits(vOrByteOrder as number), byteOrder);
        } else if (typeof vOrByteOrder === 'string') {
            this.writeInt(floatToIntBits(posOrV), vOrByteOrder);
        } else if (vOrByteOrder !== undefined) {
            this.writeInt(posOrV, floatToIntBits(vOrByteOrder));
        } else {
            this.writeInt(floatToIntBits(posOrV));
        }
    }

    writeInt(v: number): void;
    writeInt(position: number, v: number): void;
    writeInt(v: number, byteOrder: ByteOrder): void;
    writeInt(position: number, v: number, byteOrder: ByteOrder): void;
    writeInt(posOrV: number, vOrByteOrder?: number | ByteOrder, byteOrder?: ByteOrder): void {
        if (byteOrder !== undefined) {
            // (position, v, byteOrder)
            Bits.writeInt(this.buffer, posOrV, vOrByteOrder as number, byteOrder === BIG_ENDIAN);
        } else if (typeof vOrByteOrder === 'string') {
            // (v, byteOrder)
            this.ensureAvailable(Bits.INT_SIZE_IN_BYTES);
            Bits.writeInt(this.buffer, this.pos, posOrV, vOrByteOrder === BIG_ENDIAN);
            this.pos += Bits.INT_SIZE_IN_BYTES;
        } else if (vOrByteOrder !== undefined) {
            // (position, v)
            Bits.writeInt(this.buffer, posOrV, vOrByteOrder, this.isBigEndian);
        } else {
            // (v)
            this.ensureAvailable(Bits.INT_SIZE_IN_BYTES);
            Bits.writeInt(this.buffer, this.pos, posOrV, this.isBigEndian);
            this.pos += Bits.INT_SIZE_IN_BYTES;
        }
    }

    writeLong(v: bigint): void;
    writeLong(position: number, v: bigint): void;
    writeLong(v: bigint, byteOrder: ByteOrder): void;
    writeLong(position: number, v: bigint, byteOrder: ByteOrder): void;
    writeLong(posOrV: number | bigint, vOrByteOrder?: bigint | ByteOrder, byteOrder?: ByteOrder): void {
        if (byteOrder !== undefined) {
            // (position, v, byteOrder)
            Bits.writeLong(this.buffer, posOrV as number, vOrByteOrder as bigint, byteOrder === BIG_ENDIAN);
        } else if (typeof vOrByteOrder === 'string') {
            // (v, byteOrder)
            this.ensureAvailable(Bits.LONG_SIZE_IN_BYTES);
            Bits.writeLong(this.buffer, this.pos, posOrV as bigint, vOrByteOrder === BIG_ENDIAN);
            this.pos += Bits.LONG_SIZE_IN_BYTES;
        } else if (vOrByteOrder !== undefined) {
            // (position, v)
            Bits.writeLong(this.buffer, posOrV as number, vOrByteOrder, this.isBigEndian);
        } else {
            // (v)
            this.ensureAvailable(Bits.LONG_SIZE_IN_BYTES);
            Bits.writeLong(this.buffer, this.pos, posOrV as bigint, this.isBigEndian);
            this.pos += Bits.LONG_SIZE_IN_BYTES;
        }
    }

    writeShort(v: number): void;
    writeShort(position: number, v: number): void;
    writeShort(v: number, byteOrder: ByteOrder): void;
    writeShort(position: number, v: number, byteOrder: ByteOrder): void;
    writeShort(posOrV: number, vOrByteOrder?: number | ByteOrder, byteOrder?: ByteOrder): void {
        if (byteOrder !== undefined) {
            Bits.writeShort(this.buffer, posOrV, vOrByteOrder as number, byteOrder === BIG_ENDIAN);
        } else if (typeof vOrByteOrder === 'string') {
            this.ensureAvailable(Bits.SHORT_SIZE_IN_BYTES);
            Bits.writeShort(this.buffer, this.pos, posOrV, vOrByteOrder === BIG_ENDIAN);
            this.pos += Bits.SHORT_SIZE_IN_BYTES;
        } else if (vOrByteOrder !== undefined) {
            Bits.writeShort(this.buffer, posOrV, vOrByteOrder, this.isBigEndian);
        } else {
            this.ensureAvailable(Bits.SHORT_SIZE_IN_BYTES);
            Bits.writeShort(this.buffer, this.pos, posOrV, this.isBigEndian);
            this.pos += Bits.SHORT_SIZE_IN_BYTES;
        }
    }

    writeString(str: string | null): void {
        if (str === null || str === undefined) {
            this.writeInt(NULL_ARRAY_LENGTH);
            return;
        }
        const utf8Bytes = Buffer.from(str, 'utf8');
        this.writeInt(utf8Bytes.length);
        this.ensureAvailable(utf8Bytes.length);
        utf8Bytes.copy(this.buffer, this.pos);
        this.pos += utf8Bytes.length;
    }

    writeByteArray(bytes: Buffer | null): void {
        const len = bytes != null ? bytes.length : NULL_ARRAY_LENGTH;
        this.writeInt(len);
        if (len > 0) this.writeBytes(bytes!, 0, len);
    }

    writeBooleanArray(booleans: boolean[] | null): void {
        const len = booleans != null ? booleans.length : NULL_ARRAY_LENGTH;
        this.writeInt(len);
        if (len > 0) for (const b of booleans!) this.writeBoolean(b);
    }

    writeCharArray(chars: number[] | null): void {
        const len = chars != null ? chars.length : NULL_ARRAY_LENGTH;
        this.writeInt(len);
        if (len > 0) for (const c of chars!) this.writeChar(c);
    }

    writeIntArray(ints: number[] | null): void {
        const len = ints != null ? ints.length : NULL_ARRAY_LENGTH;
        this.writeInt(len);
        if (len > 0) for (const i of ints!) this.writeInt(i);
    }

    writeLongArray(longs: bigint[] | null): void {
        const len = longs != null ? longs.length : NULL_ARRAY_LENGTH;
        this.writeInt(len);
        if (len > 0) for (const l of longs!) this.writeLong(l);
    }

    writeDoubleArray(doubles: number[] | null): void {
        const len = doubles != null ? doubles.length : NULL_ARRAY_LENGTH;
        this.writeInt(len);
        if (len > 0) for (const d of doubles!) this.writeDouble(d);
    }

    writeFloatArray(floats: number[] | null): void {
        const len = floats != null ? floats.length : NULL_ARRAY_LENGTH;
        this.writeInt(len);
        if (len > 0) {
            const sizeInBytes = len * Bits.FLOAT_SIZE_IN_BYTES;
            this.ensureAvailable(sizeInBytes);
            for (let i = 0; i < len; i++) {
                if (this.isBigEndian) this.buffer.writeFloatBE(floats![i], this.pos + i * 4);
                else this.buffer.writeFloatLE(floats![i], this.pos + i * 4);
            }
            this.pos += sizeInBytes;
        }
    }

    writeShortArray(shorts: number[] | null): void {
        const len = shorts != null ? shorts.length : NULL_ARRAY_LENGTH;
        this.writeInt(len);
        if (len > 0) for (const s of shorts!) this.writeShort(s);
    }

    writeStringArray(strings: string[] | null): void {
        const len = strings != null ? strings.length : NULL_ARRAY_LENGTH;
        this.writeInt(len);
        if (len > 0) for (const s of strings!) this.writeString(s);
    }

    writeObject(object: unknown): void {
        this.service!.writeObject(this, object);
    }

    writeData(data: Data | null): void {
        const len = data == null ? NULL_ARRAY_LENGTH : data.totalSize();
        this.writeInt(len);
        if (len > 0) {
            this.ensureAvailable(len);
            data!.copyTo(this.buffer, this.pos);
            this.pos += len;
        }
    }

    /** Exposed for testing. Override to mock buffer length. */
    getBufferLength(): number {
        return this.buffer.length;
    }

    /** Exposed for testing. Compute new capacity needed for {@code len} more bytes. */
    getNewCapacity(len: number): number {
        const needed = this.getBufferLength() + len;
        // overflow check
        if (needed < 0 || needed > MAX_ARRAY_SIZE) {
            throw new Error(`OutOfMemoryError: Buffer capacity cannot be allocated. Current: ${this.getBufferLength()}, Len: ${len}, Maximum: ${MAX_ARRAY_SIZE}`);
        }
        const doubled = this.getBufferLength() * 2;
        if (doubled < 0 || doubled > MAX_ARRAY_SIZE) {
            return MAX_ARRAY_SIZE;
        }
        const candidate = Math.max(Math.max(doubled, needed), this.firstGrowthSize);
        return candidate;
    }

    ensureAvailable(len: number): void {
        if (this.available() < len) {
            if (this.buffer != null) {
                const newCap = this.getNewCapacity(len);
                const newBuf = Buffer.allocUnsafe(newCap);
                this.buffer.copy(newBuf);
                this.buffer = newBuf;
            } else {
                const sz = len > this.initialSize / 2 ? len * 2 : this.initialSize;
                this.buffer = Buffer.allocUnsafe(sz);
            }
        }
    }

    position(): number;
    position(newPos: number): void;
    position(newPos?: number): number | void {
        if (newPos !== undefined) {
            if (newPos > this.buffer.length || newPos < 0) throw new Error('IllegalArgumentException: position out of range');
            this.pos = newPos;
        } else {
            return this.pos;
        }
    }

    available(): number {
        return this.buffer != null ? this.buffer.length - this.pos : 0;
    }

    toByteArray(): Buffer;
    toByteArray(padding: number): Buffer;
    toByteArray(padding = 0): Buffer {
        if (this.buffer == null || this.pos === 0) return Buffer.alloc(padding);
        const newBuffer = Buffer.allocUnsafe(padding + this.pos);
        this.buffer.copy(newBuffer, padding, 0, this.pos);
        return newBuffer;
    }

    clear(): void {
        this.pos = 0;
        if (this.buffer != null && this.buffer.length > this.initialSize * 8) {
            this.buffer = Buffer.allocUnsafe(this.initialSize * 8);
        }
    }

    close(): void {
        this.pos = 0;
        this.buffer = null as unknown as Buffer;
    }

    getByteOrder(): ByteOrder {
        return this.isBigEndian ? BIG_ENDIAN : 'LE';
    }

    getSerializationService(): InternalSerializationService | null {
        return this.service;
    }

    toString(): string {
        return `ByteArrayObjectDataOutput{size=${this.buffer != null ? this.buffer.length : 0}, pos=${this.pos}}`;
    }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function doubleToLongBits(v: number): bigint {
    const buf = Buffer.allocUnsafe(8);
    buf.writeDoubleBE(v, 0);
    return buf.readBigInt64BE(0);
}

function floatToIntBits(v: number): number {
    const buf = Buffer.allocUnsafe(4);
    buf.writeFloatBE(v, 0);
    return buf.readInt32BE(0);
}
