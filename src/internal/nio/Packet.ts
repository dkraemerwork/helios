/**
 * Port of {@code com.hazelcast.internal.nio.Packet}.
 *
 * A Packet is a piece of data sent over the wire for member-to-member communication.
 * It extends HeapData and implements OutboundFrame.
 */
import { HeapData } from '@helios/internal/serialization/impl/HeapData';
import type { OutboundFrame } from '@helios/internal/networking/OutboundFrame';

// Packet wire header size: 1 (version) + 2 (flags/char) + 4 (partitionId) + 4 (payload size)
const PACKET_HEADER_SIZE = 11;

export class Packet extends HeapData implements OutboundFrame {
    static readonly VERSION: number = 4;

    // 1. URGENT flag
    static readonly FLAG_URGENT = 1 << 4;

    // 2. Packet type bits
    private static readonly FLAG_TYPE0 = 1 << 0;
    private static readonly FLAG_TYPE1 = 1 << 2;
    private static readonly FLAG_TYPE2 = 1 << 5;

    // 3. Type-specific flags
    static readonly FLAG_OP_RESPONSE = 1 << 1;
    static readonly FLAG_OP_CONTROL = 1 << 6;
    static readonly FLAG_JET_FLOW_CONTROL = 1 << 1;

    // 4.x flag
    static readonly FLAG_4_0 = 1 << 7;

    // 16-bit unsigned flags field (Java char)
    private _flags: number = 0;
    private _partitionId: number;
    private _conn: unknown = null;

    constructor(payload?: Buffer, partitionId: number = -1) {
        super(payload ?? null);
        this._partitionId = partitionId;
        this.raiseFlags(Packet.FLAG_4_0);
    }

    getConn(): unknown {
        return this._conn;
    }

    setConn(conn: unknown): this {
        this._conn = conn;
        return this;
    }

    getPacketType(): Packet.Type {
        return Packet.Type.fromFlags(this._flags);
    }

    setPacketType(type: Packet.Type): this {
        const nonTypeFlags = this._flags & (~Packet.FLAG_TYPE0 & ~Packet.FLAG_TYPE1 & ~Packet.FLAG_TYPE2);
        this.resetFlagsTo(type.headerEncoding | nonTypeFlags);
        return this;
    }

    raiseFlags(flagsToRaise: number): this {
        this._flags = (this._flags | flagsToRaise) & 0xffff;
        return this;
    }

    resetFlagsTo(flagsToSet: number): this {
        this._flags = flagsToSet & 0xffff;
        return this;
    }

    isFlagRaised(flagsToCheck: number): boolean {
        return (this._flags & flagsToCheck) !== 0;
    }

    getFlags(): number {
        return this._flags;
    }

    getPartitionId(): number {
        return this._partitionId;
    }

    isUrgent(): boolean {
        return this.isFlagRaised(Packet.FLAG_URGENT);
    }

    getFrameLength(): number {
        return (this.payload != null ? this.totalSize() : 0) + PACKET_HEADER_SIZE;
    }

    equals(other: unknown): boolean {
        if (this === other) return true;
        if (!(other instanceof Packet)) return false;
        if (!super.equals(other)) return false;
        if (this._flags !== other._flags) return false;
        return this._partitionId === other._partitionId;
    }

    hashCode(): number {
        let result = super.hashCode();
        result = (31 * result + this._flags) | 0;
        result = (31 * result + this._partitionId) | 0;
        return result;
    }

    toString(): string {
        const type = this.getPacketType();
        return `Packet{partitionId=${this._partitionId}, frameLength=${this.getFrameLength()}, conn=${this._conn}, rawFlags=${this._flags.toString(2)}, isUrgent=${this.isUrgent()}, packetType=${type.name}, typeSpecificFlags=${type.describeFlags(this._flags)}}`;
    }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Packet {
    export class Type {
        static readonly NULL = new Type('NULL', 0);
        static readonly OPERATION = new Type('OPERATION', 1, (flags) =>
            `[isResponse=${!!(flags & Packet.FLAG_OP_RESPONSE)}, isOpControl=${!!(flags & Packet.FLAG_OP_CONTROL)}]`
        );
        static readonly EVENT = new Type('EVENT', 2);
        static readonly JET = new Type('JET', 3, (flags) =>
            `[isFlowControl=${!!(flags & Packet.FLAG_JET_FLOW_CONTROL)}]`
        );
        static readonly SERVER_CONTROL = new Type('SERVER_CONTROL', 4);
        static readonly UNDEFINED5 = new Type('UNDEFINED5', 5);
        static readonly UNDEFINED6 = new Type('UNDEFINED6', 6);
        static readonly UNDEFINED7 = new Type('UNDEFINED7', 7);

        private static readonly VALUES: Type[] = [
            Type.NULL, Type.OPERATION, Type.EVENT, Type.JET,
            Type.SERVER_CONTROL, Type.UNDEFINED5, Type.UNDEFINED6, Type.UNDEFINED7,
        ];

        readonly headerEncoding: number;

        private constructor(
            readonly name: string,
            private readonly ordinal: number,
            private readonly _describeFlags?: (flags: number) => string
        ) {
            this.headerEncoding = Type.encodeOrdinal(ordinal);
        }

        static fromFlags(flags: number): Type {
            return Type.VALUES[Type.headerDecode(flags)];
        }

        describeFlags(flags: number): string {
            return this._describeFlags ? this._describeFlags(flags) : '<NONE>';
        }

        private static encodeOrdinal(ordinal: number): number {
            return (ordinal & 0x01) | ((ordinal & 0x02) << 1) | ((ordinal & 0x04) << 3);
        }

        private static headerDecode(flags: number): number {
            return (flags & (1 << 0)) | ((flags & (1 << 2)) >> 1) | ((flags & (1 << 5)) >> 3);
        }
    }
}
