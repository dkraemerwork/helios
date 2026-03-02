/**
 * Port of {@code com.hazelcast.internal.nio.BufferObjectDataInput}.
 *
 * A positioned, random-access binary input stream backed by a byte buffer.
 * The full interface including ObjectDataInput / DataReader inheritance is
 * wired up in Block 2.1 (serialization).  This stub exposes the subset
 * consumed by the nio layer.
 */
export interface BufferObjectDataInput {
    readonly UTF_BUFFER_SIZE: 1024;

    read(position: number): number;

    readInt(position: number): number;
    readIntByteOrder(byteOrder: "BE" | "LE"): number;
    readIntAtByteOrder(position: number, byteOrder: "BE" | "LE"): number;

    readLong(position: number): bigint;
    readLongByteOrder(byteOrder: "BE" | "LE"): bigint;
    readLongAtByteOrder(position: number, byteOrder: "BE" | "LE"): bigint;

    readBoolean(position: number): boolean;
    readByte(position: number): number;
    readChar(position: number): number;

    readDouble(position: number): number;
    readDoubleByteOrder(byteOrder: "BE" | "LE"): number;
    readDoubleAtByteOrder(position: number, byteOrder: "BE" | "LE"): number;

    readFloat(position: number): number;
    readFloatByteOrder(byteOrder: "BE" | "LE"): number;
    readFloatAtByteOrder(position: number, byteOrder: "BE" | "LE"): number;

    readShort(position: number): number;
    readShortByteOrder(byteOrder: "BE" | "LE"): number;
    readShortAtByteOrder(position: number, byteOrder: "BE" | "LE"): number;

    position(): number;
    setPosition(newPos: number): void;
    reset(): void;
    clear(): void;
    init(data: Buffer, offset: number): void;
}
