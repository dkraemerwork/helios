/**
 * Port of {@code com.hazelcast.internal.nio.BufferObjectDataOutput}.
 *
 * A positioned, random-access binary output stream backed by a byte buffer.
 * The full interface including ObjectDataOutput / DataWriter inheritance is
 * wired up in Block 2.1 (serialization).  This stub exposes the subset
 * consumed by the nio layer.
 */
export interface BufferObjectDataOutput {
    write(position: number, b: number): void;

    writeInt(position: number, v: number): void;
    writeIntByteOrder(v: number, byteOrder: "BE" | "LE"): void;
    writeIntAtByteOrder(position: number, v: number, byteOrder: "BE" | "LE"): void;

    writeLong(position: number, v: bigint): void;
    writeLongByteOrder(v: bigint, byteOrder: "BE" | "LE"): void;
    writeLongAtByteOrder(position: number, v: bigint, byteOrder: "BE" | "LE"): void;

    writeBoolean(position: number, v: boolean): void;
    writeBooleanBit(position: number, bitIndex: number, v: boolean): void;
    writeByte(position: number, v: number): void;
    writeZeroBytes(count: number): void;
    writeChar(position: number, v: number): void;

    writeDouble(position: number, v: number): void;
    writeDoubleByteOrder(v: number, byteOrder: "BE" | "LE"): void;
    writeDoubleAtByteOrder(position: number, v: number, byteOrder: "BE" | "LE"): void;

    writeFloat(position: number, v: number): void;
    writeFloatByteOrder(v: number, byteOrder: "BE" | "LE"): void;
    writeFloatAtByteOrder(position: number, v: number, byteOrder: "BE" | "LE"): void;

    writeShort(position: number, v: number): void;
    writeShortByteOrder(v: number, byteOrder: "BE" | "LE"): void;
    writeShortAtByteOrder(position: number, v: number, byteOrder: "BE" | "LE"): void;

    position(): number;
    setPosition(newPos: number): void;
    clear(): void;

    close(): void;
}
