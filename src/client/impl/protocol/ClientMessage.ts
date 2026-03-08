/**
 * Port of {@code com.hazelcast.client.impl.protocol.ClientMessage}.
 *
 * A ClientMessage is a linked-list of Frame objects.
 * Each Frame consists of: 4-byte LE length, 2-byte LE flags, then content bytes.
 */

// ─── Frame ────────────────────────────────────────────────────────────────────

export class ClientMessageFrame {
    content: Buffer;
    flags: number;
    next: ClientMessageFrame | null = null;

    constructor(content: Buffer, flags: number = 0) {
        this.content = content;
        this.flags = flags;
    }

    static createStaticFrame(flags: number): ClientMessageFrame {
        return new ClientMessageFrame(Buffer.alloc(0), flags);
    }

    isNullFrame(): boolean {
        return (this.flags & ClientMessage.IS_NULL_FLAG) !== 0;
    }

    isEndFrame(): boolean {
        return (this.flags & ClientMessage.END_DATA_STRUCTURE_FLAG) !== 0;
    }

    isBeginFrame(): boolean {
        return (this.flags & ClientMessage.BEGIN_DATA_STRUCTURE_FLAG) !== 0;
    }
}

// ─── ForwardFrameIterator ─────────────────────────────────────────────────────

export class ClientMessageForwardFrameIterator {
    private _current: ClientMessageFrame | null;
    private _peekNext: ClientMessageFrame | null;

    constructor(startFrame: ClientMessageFrame | null) {
        this._current = null;
        this._peekNext = startFrame;
    }

    hasNext(): boolean {
        return this._peekNext !== null;
    }

    next(): ClientMessageFrame {
        this._current = this._peekNext!;
        this._peekNext = this._current.next;
        return this._current;
    }

    peekNext(): ClientMessageFrame | null {
        return this._peekNext;
    }
}

// ─── ClientMessage ────────────────────────────────────────────────────────────

export class ClientMessage {
    // Frame flags — must match official Hazelcast binary protocol spec:
    // https://github.com/hazelcast/hazelcast-client-protocol
    static readonly BEGIN_FRAGMENT_FLAG: number = 1 << 15;       // 0x8000
    static readonly END_FRAGMENT_FLAG: number = 1 << 14;         // 0x4000
    static readonly IS_FINAL_FLAG: number = 1 << 13;             // 0x2000
    static readonly BEGIN_DATA_STRUCTURE_FLAG: number = 1 << 12;  // 0x1000
    static readonly END_DATA_STRUCTURE_FLAG: number = 1 << 11;    // 0x0800
    static readonly IS_NULL_FLAG: number = 1 << 10;               // 0x0400
    static readonly IS_EVENT_FLAG: number = 1 << 9;               // 0x0200
    static readonly BACKUP_AWARE_FLAG: number = 1 << 8;           // 0x0100
    static readonly BACKUP_EVENT_FLAG: number = 1 << 7;           // 0x0080

    // Frame length+flags header size
    static readonly SIZE_OF_FRAME_LENGTH_AND_FLAGS: number = 6;  // 4 (length) + 2 (flags)

    // Field offsets in the initial frame content
    static readonly TYPE_FIELD_OFFSET: number = 0;
    static readonly CORRELATION_ID_FIELD_OFFSET: number = 4;
    static readonly PARTITION_ID_FIELD_OFFSET: number = 12;
    static readonly RESPONSE_BACKUP_ACKS_FIELD_OFFSET: number = 12;
    static readonly FRAGMENTATION_ID_OFFSET: number = 0;

    // Sentinel frames (initialized lazily to avoid static-init order issues)
    private static _BEGIN_FRAME: ClientMessageFrame | null = null;
    private static _END_FRAME: ClientMessageFrame | null = null;
    private static _NULL_FRAME: ClientMessageFrame | null = null;

    static get BEGIN_FRAME(): ClientMessageFrame {
        if (!ClientMessage._BEGIN_FRAME) {
            ClientMessage._BEGIN_FRAME = ClientMessageFrame.createStaticFrame(ClientMessage.BEGIN_DATA_STRUCTURE_FLAG);
        }
        return ClientMessage._BEGIN_FRAME;
    }

    static get END_FRAME(): ClientMessageFrame {
        if (!ClientMessage._END_FRAME) {
            ClientMessage._END_FRAME = ClientMessageFrame.createStaticFrame(ClientMessage.END_DATA_STRUCTURE_FLAG);
        }
        return ClientMessage._END_FRAME;
    }

    static get NULL_FRAME(): ClientMessageFrame {
        if (!ClientMessage._NULL_FRAME) {
            ClientMessage._NULL_FRAME = ClientMessageFrame.createStaticFrame(ClientMessage.IS_NULL_FLAG);
        }
        return ClientMessage._NULL_FRAME;
    }

    private _startFrame: ClientMessageFrame | null = null;
    private _endFrame: ClientMessageFrame | null = null;
    private _retryable: boolean = false;

    private constructor() {}

    static createForEncode(): ClientMessage {
        return new ClientMessage();
    }

    static createForDecode(startFrame: ClientMessageFrame): ClientMessage {
        const msg = new ClientMessage();
        msg._startFrame = startFrame;
        // find the end frame
        let f: ClientMessageFrame | null = startFrame;
        while (f !== null && !ClientMessage.isFlagSet(f.flags, ClientMessage.IS_FINAL_FLAG)) {
            f = f.next;
        }
        msg._endFrame = f;
        return msg;
    }

    static isFlagSet(flags: number, flagMask: number): boolean {
        return (flags & flagMask) !== 0;
    }

    add(frame: ClientMessageFrame): void {
        frame.next = null;
        if (this._startFrame === null) {
            this._startFrame = frame;
            this._endFrame = frame;
        } else {
            this._endFrame!.next = frame;
            this._endFrame = frame;
        }
    }

    getStartFrame(): ClientMessageFrame {
        return this._startFrame!;
    }

    /** Mark the last frame with IS_FINAL_FLAG. */
    setFinal(): void {
        if (this._endFrame !== null) {
            this._endFrame.flags |= ClientMessage.IS_FINAL_FLAG;
        }
    }

    isRetryable(): boolean { return this._retryable; }
    setRetryable(v: boolean): void { this._retryable = v; }

    getMessageType(): number {
        return this._startFrame!.content.readUInt32LE(ClientMessage.TYPE_FIELD_OFFSET);
    }

    setMessageType(type: number): void {
        this._startFrame!.content.writeUInt32LE(type >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
    }

    getCorrelationId(): number {
        return this._startFrame!.content.readInt32LE(ClientMessage.CORRELATION_ID_FIELD_OFFSET);
    }

    setCorrelationId(id: number): void {
        this._startFrame!.content.writeInt32LE(id | 0, ClientMessage.CORRELATION_ID_FIELD_OFFSET);
        this._startFrame!.content.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET + 4);
    }

    getPartitionId(): number {
        return this._startFrame!.content.readInt32LE(ClientMessage.PARTITION_ID_FIELD_OFFSET);
    }

    setPartitionId(id: number): void {
        this._startFrame!.content.writeInt32LE(id | 0, ClientMessage.PARTITION_ID_FIELD_OFFSET);
    }

    getFragmentationId(): bigint {
        return this._startFrame!.content.readBigInt64LE(ClientMessage.FRAGMENTATION_ID_OFFSET);
    }

    /** Total size of all frames including length+flags headers. */
    getFrameLength(): number {
        let total = 0;
        let f: ClientMessageFrame | null = this._startFrame;
        while (f !== null) {
            total += ClientMessage.SIZE_OF_FRAME_LENGTH_AND_FLAGS + f.content.length;
            f = f.next;
        }
        return total;
    }

    forwardFrameIterator(): ClientMessageForwardFrameIterator {
        return new ClientMessageForwardFrameIterator(this._startFrame);
    }

    copy(): ClientMessage {
        const copy = new ClientMessage();
        let f: ClientMessageFrame | null = this._startFrame;
        while (f !== null) {
            const contentCopy = Buffer.from(f.content);
            const frameCopy = new ClientMessageFrame(contentCopy, f.flags);
            copy.add(frameCopy);
            f = f.next;
        }
        copy._retryable = this._retryable;
        return copy;
    }
}

// ─── Namespace merging for ClientMessage.Frame / ClientMessage.ForwardFrameIterator ──

export namespace ClientMessage {
    export const Frame = ClientMessageFrame;
    export type Frame = ClientMessageFrame;
    export const ForwardFrameIterator = ClientMessageForwardFrameIterator;
    export type ForwardFrameIterator = ClientMessageForwardFrameIterator;
}
