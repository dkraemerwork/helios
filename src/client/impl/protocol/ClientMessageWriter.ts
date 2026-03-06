/**
 * Port of {@code com.hazelcast.client.impl.protocol.ClientMessageWriter}.
 */
import { ClientMessage, ClientMessageFrame } from '@zenystx/helios-core/client/impl/protocol/ClientMessage';
import { ByteBuffer } from '@zenystx/helios-core/internal/networking/ByteBuffer';

const SIZE = 6; // ClientMessage.SIZE_OF_FRAME_LENGTH_AND_FLAGS

export class ClientMessageWriter {
    private _currentFrame: ClientMessageFrame | null = null;
    private _writeOffset: number = -1;

    writeTo(dst: ByteBuffer, msg: ClientMessage): boolean {
        if (this._currentFrame === null) {
            this._currentFrame = msg.getStartFrame();
            this._writeOffset = -1;
        }

        // eslint-disable-next-line no-constant-condition
        while (true) {
            const frame: ClientMessageFrame | null = this._currentFrame;
            if (frame === null) return true;

            if (this._writeOffset === -1) {
                if (dst.remaining() < SIZE) {
                    return false;
                }
                const frameLen = SIZE + frame.content.length;
                dst.putInt32LE(frameLen);
                dst.putInt16LE(frame.flags);
                this._writeOffset = 0;
            }

            const contentLen = frame.content.length;
            const remaining = contentLen - this._writeOffset;
            const available = dst.remaining();

            if (available >= remaining) {
                if (remaining > 0) {
                    dst.putBytes(frame.content, this._writeOffset, remaining);
                }
                this._writeOffset = -1;
                this._currentFrame = frame.next;
                if (frame.next === null) {
                    return true;
                }
            } else {
                if (available > 0) {
                    dst.putBytes(frame.content, this._writeOffset, available);
                }
                this._writeOffset += available;
                return false;
            }
        }
    }

    reset(): void {
        this._currentFrame = null;
        this._writeOffset = -1;
    }
}
