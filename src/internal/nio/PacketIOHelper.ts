/**
 * Port of {@code com.hazelcast.internal.nio.PacketIOHelper}.
 *
 * Responsible for writing or reading a Packet to/from a ByteBuffer.
 * Stateful — reusable but should only be used for reading OR writing, not both.
 */
import { Packet } from '@helios/internal/nio/Packet';
import { ByteBuffer } from '@helios/internal/networking/ByteBuffer';

export class PacketIOHelper {
    // 1 (version) + 2 (flags/char) + 4 (partitionId) + 4 (payload size)
    static readonly HEADER_SIZE = 11;

    private _valueOffset: number = 0;
    private _size: number = 0;
    private _headerComplete: boolean = false;
    private _flags: number = 0;
    private _partitionId: number = 0;
    private _payload: Buffer | null = null;

    /**
     * Writes the packet data to the supplied ByteBuffer, up to the buffer's limit.
     * Returns true if all packet data was written, false if more calls are needed.
     */
    writeTo(packet: Packet, dst: ByteBuffer): boolean {
        if (!this._headerComplete) {
            if (dst.remaining() < PacketIOHelper.HEADER_SIZE) {
                return false;
            }
            dst.put(Packet.VERSION);
            dst.putChar(packet.getFlags());
            dst.putInt(packet.getPartitionId());
            const size = packet.totalSize();
            dst.putInt(size);
            this._size = size;
            this._headerComplete = true;
        }

        if (this._writeValue(packet, dst)) {
            this._reset();
            return true;
        }
        return false;
    }

    private _writeValue(packet: Packet, dst: ByteBuffer): boolean {
        if (this._size > 0) {
            const bytesWritable = dst.remaining();
            const bytesNeeded = this._size - this._valueOffset;

            let bytesWrite: number;
            let done: boolean;
            if (bytesWritable >= bytesNeeded) {
                bytesWrite = bytesNeeded;
                done = true;
            } else {
                bytesWrite = bytesWritable;
                done = false;
            }

            const byteArray = packet.toByteArray()!;
            dst.putBytes(byteArray, this._valueOffset, bytesWrite);
            this._valueOffset += bytesWrite;

            if (!done) return false;
        }
        return true;
    }

    /**
     * Reads packet data from the supplied ByteBuffer.
     * Returns the Packet if fully read, or null if more data is needed.
     */
    readFrom(src: ByteBuffer): Packet | null {
        if (!this._headerComplete) {
            if (src.remaining() < PacketIOHelper.HEADER_SIZE) {
                return null;
            }

            const version = src.get();
            if (Packet.VERSION !== version) {
                throw new Error(`Packet versions are not matching! Expected -> ${Packet.VERSION}, Incoming -> ${version}`);
            }

            this._flags = src.getChar();
            this._partitionId = src.getInt();
            this._size = src.getInt();
            this._headerComplete = true;
        }

        if (this._readValue(src)) {
            const payload = this._payload ?? Buffer.alloc(0);
            const packet = new Packet(payload, this._partitionId).resetFlagsTo(this._flags);
            this._reset();
            return packet;
        }
        return null;
    }

    private _readValue(src: ByteBuffer): boolean {
        if (this._payload === null) {
            this._payload = Buffer.allocUnsafe(this._size);
        }

        if (this._size > 0) {
            const bytesReadable = src.remaining();
            const bytesNeeded = this._size - this._valueOffset;

            let bytesRead: number;
            let done: boolean;
            if (bytesReadable >= bytesNeeded) {
                bytesRead = bytesNeeded;
                done = true;
            } else {
                bytesRead = bytesReadable;
                done = false;
            }

            src.getBytes(this._payload!, this._valueOffset, bytesRead);
            this._valueOffset += bytesRead;

            if (!done) return false;
        }
        return true;
    }

    private _reset(): void {
        this._headerComplete = false;
        this._payload = null;
        this._valueOffset = 0;
    }
}
