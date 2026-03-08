import type { EventloopChannel } from '@zenystx/helios-core/internal/eventloop/Eventloop';

const INITIAL_BATCH_CAPACITY = 64 * 1024;
const IDLE_FLUSH_DELAY_MS = 1;

export class OutboundBatcher {
    private readonly _channel: EventloopChannel;
    private _batchBuffer: Buffer;
    private _batchOffset = 0;
    private _flushScheduled = false;
    private _idleTimer: ReturnType<typeof setTimeout> | null = null;
    private _disposed = false;

    constructor(channel: EventloopChannel, initialCapacity = INITIAL_BATCH_CAPACITY) {
        this._channel = channel;
        this._batchBuffer = Buffer.allocUnsafe(initialCapacity);
    }

    enqueue(payload: Uint8Array): boolean {
        if (this._disposed) {
            return false;
        }

        const frameLength = 4 + payload.length;

        if (this._canWriteThrough()) {
            return this._writeDirect(payload, frameLength);
        }

        if (this._batchOffset > 0 && this._batchOffset + frameLength > this._batchBuffer.length) {
            this._flush();
        }

        if (frameLength > this._batchBuffer.length) {
            return this._writeDirect(payload, frameLength);
        }

        this._batchBuffer.writeUInt32BE(payload.length, this._batchOffset);
        this._batchBuffer.set(payload, this._batchOffset + 4);
        this._batchOffset += frameLength;
        this._scheduleFlush();
        return true;
    }

    dispose(): void {
        this._disposed = true;
        this._batchOffset = 0;
        this._flushScheduled = false;
        this._clearIdleTimer();
    }

    bufferedBytes(): number {
        return this._batchOffset;
    }

    private _canWriteThrough(): boolean {
        return this._batchOffset === 0
            && this._channel.queuedFrames() === 0
            && this._channel.pendingBytes() === 0;
    }

    private _writeDirect(payload: Uint8Array, frameLength: number): boolean {
        const frame = Buffer.allocUnsafe(frameLength);
        frame.writeUInt32BE(payload.length, 0);
        frame.set(payload, 4);
        return this._channel.write(frame);
    }

    private _scheduleFlush(): void {
        if (!this._flushScheduled) {
            this._flushScheduled = true;
            queueMicrotask(() => {
                this._flush();
            });
        }

        this._clearIdleTimer();
        this._idleTimer = setTimeout(() => {
            this._flush();
        }, IDLE_FLUSH_DELAY_MS);
    }

    private _flush(): void {
        if (this._disposed) {
            this._clearIdleTimer();
            return;
        }

        this._flushScheduled = false;
        this._clearIdleTimer();

        if (this._batchOffset === 0) {
            return;
        }

        const flushedBuffer = this._batchBuffer;
        const flushedLength = this._batchOffset;
        this._batchBuffer = Buffer.allocUnsafe(Math.max(INITIAL_BATCH_CAPACITY, flushedBuffer.length));
        this._batchOffset = 0;
        this._channel.write(flushedBuffer.subarray(0, flushedLength));
    }

    private _clearIdleTimer(): void {
        if (this._idleTimer !== null) {
            clearTimeout(this._idleTimer);
            this._idleTimer = null;
        }
    }
}
