/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.builtin.FixedSizeTypesCodec}.
 */

export const BOOLEAN_SIZE_IN_BYTES = 1;
export const BYTE_SIZE_IN_BYTES = 1;
export const SHORT_SIZE_IN_BYTES = 2;
export const INT_SIZE_IN_BYTES = 4;
export const LONG_SIZE_IN_BYTES = 8;
export const UUID_SIZE_IN_BYTES = BOOLEAN_SIZE_IN_BYTES + 2 * LONG_SIZE_IN_BYTES; // 17

export class FixedSizeTypesCodec {
    private constructor() {}

    // Boolean
    static encodeBoolean(buf: Buffer, offset: number, value: boolean): void {
        buf.writeUInt8(value ? 1 : 0, offset);
    }
    static decodeBoolean(buf: Buffer, offset: number): boolean {
        return buf.readUInt8(offset) !== 0;
    }

    // Byte
    static encodeByte(buf: Buffer, offset: number, value: number): void {
        buf.writeUInt8(value & 0xff, offset);
    }
    static decodeByte(buf: Buffer, offset: number): number {
        return buf.readUInt8(offset);
    }

    // Short (LE)
    static encodeShort(buf: Buffer, offset: number, value: number): void {
        buf.writeInt16LE(value & 0xffff, offset);
    }
    static decodeShort(buf: Buffer, offset: number): number {
        return buf.readInt16LE(offset);
    }

    // Int (LE)
    static encodeInt(buf: Buffer, offset: number, value: number): void {
        buf.writeInt32LE(value | 0, offset);
    }
    static decodeInt(buf: Buffer, offset: number): number {
        return buf.readInt32LE(offset);
    }

    // Long (LE, bigint) — signed
    static encodeLong(buf: Buffer, offset: number, value: bigint): void {
        buf.writeBigInt64LE(value, offset);
    }
    static decodeLong(buf: Buffer, offset: number): bigint {
        return buf.readBigInt64LE(offset);
    }

    // UUID: null_bool(1) + mostSig(8 LE unsigned) + leastSig(8 LE unsigned) = 17 bytes
    static encodeUUID(buf: Buffer, offset: number, uuid: string | null): void {
        const isNull = uuid === null || uuid === undefined;
        FixedSizeTypesCodec.encodeBoolean(buf, offset, isNull);
        if (!isNull) {
            const { msb, lsb } = uuidToMsbLsb(uuid!);
            buf.writeBigUInt64LE(msb, offset + BOOLEAN_SIZE_IN_BYTES);
            buf.writeBigUInt64LE(lsb, offset + BOOLEAN_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        } else {
            buf.writeBigUInt64LE(0n, offset + BOOLEAN_SIZE_IN_BYTES);
            buf.writeBigUInt64LE(0n, offset + BOOLEAN_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        }
    }

    static decodeUUID(buf: Buffer, offset: number): string | null {
        const isNull = FixedSizeTypesCodec.decodeBoolean(buf, offset);
        if (isNull) return null;
        const msb = buf.readBigUInt64LE(offset + BOOLEAN_SIZE_IN_BYTES);
        const lsb = buf.readBigUInt64LE(offset + BOOLEAN_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        return msbLsbToUUID(msb, lsb);
    }
}

function uuidToMsbLsb(uuid: string): { msb: bigint; lsb: bigint } {
    const hex = uuid.replace(/-/g, '');
    const msb = BigInt('0x' + hex.substring(0, 16));
    const lsb = BigInt('0x' + hex.substring(16, 32));
    return { msb, lsb };
}

function msbLsbToUUID(msb: bigint, lsb: bigint): string {
    const msbHex = msb.toString(16).padStart(16, '0');
    const lsbHex = lsb.toString(16).padStart(16, '0');
    const hex = msbHex + lsbHex;
    return (
        hex.substring(0, 8) + '-' +
        hex.substring(8, 12) + '-' +
        hex.substring(12, 16) + '-' +
        hex.substring(16, 20) + '-' +
        hex.substring(20, 32)
    );
}
