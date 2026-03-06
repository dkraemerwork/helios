/**
 * Port of {@code com.hazelcast.client.impl.protocol.ClientMessageReader}.
 *
 * Stateful reader: accumulates header bytes across calls.
 */
import { ClientMessage, ClientMessageFrame } from '@zenystx/core/client/impl/protocol/ClientMessage';
import { ByteBuffer } from '@zenystx/core/internal/networking/ByteBuffer';

export class ClientMessageReader {
    private _startFrame: ClientMessageFrame | null = null;
    private _lastFrame: ClientMessageFrame | null = null;

    // Phase 1: buffering 6 header bytes
    private readonly _headerBuf: Buffer = Buffer.allocUnsafe(6);
    private _headerOffset: number = 0; // 0..5 = partial; 6 = header done

    // Phase 2: filling frame content
    private _contentOffset: number = -1; // -1 = not yet in content phase

    readFrom(src: ByteBuffer, _trusted: boolean): boolean {
        while (true) {
            // ── Phase 1: read frame header ──────────────────────────────────
            if (this._headerOffset < 6) {
                const needed = 6 - this._headerOffset;
                const avail = Math.min(src.remaining(), needed);
                if (avail === 0) return false;
                src.getBytes(this._headerBuf, this._headerOffset, avail);
                this._headerOffset += avail;
                if (this._headerOffset < 6) return false;

                // Parse header
                const frameLen = this._headerBuf.readInt32LE(0);
                const flags = this._headerBuf.readUInt16LE(4);
                const contentLen = Math.max(0, frameLen - 6);
                const frame = new ClientMessageFrame(Buffer.allocUnsafe(contentLen), flags);
                this._appendFrame(frame);
                this._contentOffset = 0;
            }

            // ── Phase 2: read frame content ─────────────────────────────────
            const frame = this._lastFrame!;
            const contentLen = frame.content.length;
            const remaining = contentLen - this._contentOffset;
            const avail = Math.min(src.remaining(), remaining);

            if (avail > 0) {
                src.getBytes(frame.content, this._contentOffset, avail);
                this._contentOffset += avail;
            }

            if (this._contentOffset >= contentLen) {
                // Frame complete
                const flags = frame.flags;
                this._headerOffset = 0;
                this._contentOffset = -1;

                if (ClientMessage.isFlagSet(flags, ClientMessage.IS_FINAL_FLAG)) {
                    return true;
                }
                if (!src.hasRemaining()) return false;
                // continue loop for next frame
            } else {
                return false;
            }
        }
    }

    private _appendFrame(frame: ClientMessageFrame): void {
        if (this._startFrame === null) {
            this._startFrame = frame;
            this._lastFrame = frame;
        } else {
            this._lastFrame!.next = frame;
            this._lastFrame = frame;
        }
    }

    getClientMessage(): ClientMessage {
        return ClientMessage.createForDecode(this._startFrame!);
    }

    reset(): void {
        this._startFrame = null;
        this._lastFrame = null;
        this._headerOffset = 0;
        this._contentOffset = -1;
    }
}
