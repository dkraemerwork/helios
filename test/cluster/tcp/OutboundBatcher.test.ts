import { OutboundBatcher } from '@zenystx/helios-core/cluster/tcp/OutboundBatcher';
import { EventloopChannel } from '@zenystx/helios-core/internal/eventloop/Eventloop';
import { describe, expect, it } from 'bun:test';

class FakeSocket {
    readonly writes: Buffer[] = [];

    constructor(private readonly _writeResults: number[] = []) {}

    write(data: Buffer | string): number {
        const buf = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);
        this.writes.push(buf);
        return this._writeResults.shift() ?? buf.length;
    }

    end(): void {}
}

function decodeFrames(batch: Buffer): Buffer[] {
    const frames: Buffer[] = [];
    let offset = 0;

    while (offset < batch.length) {
        const length = batch.readUInt32BE(offset);
        offset += 4;
        frames.push(batch.subarray(offset, offset + length));
        offset += length;
    }

    return frames;
}

describe('OutboundBatcher', () => {
    it('writes through immediately when the channel is idle', () => {
        const socket = new FakeSocket();
        const channel = new EventloopChannel(socket, 1024);
        const batcher = new OutboundBatcher(channel);

        expect(batcher.enqueue(Buffer.from('hello'))).toBe(true);
        expect(socket.writes).toHaveLength(1);
        expect(decodeFrames(socket.writes[0]).map((frame) => frame.toString())).toEqual(['hello']);
        expect(batcher.bufferedBytes()).toBe(0);
    });

    it('batches follow-up frames into a single flush when the channel is congested', async () => {
        const socket = new FakeSocket([0]);
        const channel = new EventloopChannel(socket, 1024);
        const batcher = new OutboundBatcher(channel);

        expect(batcher.enqueue(Buffer.from('first'))).toBe(true);
        expect(channel.pendingBytes()).toBeGreaterThan(0);

        expect(batcher.enqueue(Buffer.from('second'))).toBe(true);
        expect(batcher.enqueue(Buffer.from('third'))).toBe(true);
        expect(socket.writes).toHaveLength(1);
        expect(batcher.bufferedBytes()).toBeGreaterThan(0);

        await Promise.resolve();

        expect(socket.writes).toHaveLength(2);
        expect(decodeFrames(socket.writes[1]).map((frame) => frame.toString())).toEqual(['second', 'third']);
        expect(batcher.bufferedBytes()).toBe(0);
    });

    it('flushes the current batch before buffering a larger follow-up frame', async () => {
        const socket = new FakeSocket([0]);
        const channel = new EventloopChannel(socket, 1024);
        const batcher = new OutboundBatcher(channel, 16);

        expect(batcher.enqueue(Buffer.from('a'))).toBe(true);
        expect(batcher.enqueue(Buffer.from('bb'))).toBe(true);

        const oversized = Buffer.from('this-frame-is-too-large');
        expect(batcher.enqueue(oversized)).toBe(true);

        expect(socket.writes).toHaveLength(2);
        expect(decodeFrames(socket.writes[1]).map((frame) => frame.toString())).toEqual(['bb']);
        expect(batcher.bufferedBytes()).toBeGreaterThan(0);

        await Promise.resolve();

        expect(socket.writes).toHaveLength(3);
        expect(decodeFrames(socket.writes[2]).map((frame) => frame.toString())).toEqual([oversized.toString()]);
    });
});
