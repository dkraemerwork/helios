import type { ClusterMessage } from '@zenystx/helios-core/cluster/tcp/ClusterMessage';
import { BinarySerializationStrategy } from '@zenystx/helios-core/cluster/tcp/BinarySerializationStrategy';
import { OutboundBatcher } from '@zenystx/helios-core/cluster/tcp/OutboundBatcher';
import { ScatterOutboundEncoder } from '@zenystx/helios-core/cluster/tcp/ScatterOutboundEncoder';
import { EventloopChannel } from '@zenystx/helios-core/internal/eventloop/Eventloop';
import { afterEach, describe, expect, it } from 'bun:test';

class RecordingSocket {
    readonly writes: Buffer[] = [];

    write(data: Buffer | string): number {
        const buffer = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);
        this.writes.push(buffer);
        return buffer.length;
    }

    end(): void {}
}

const strategy = new BinarySerializationStrategy();
const disposers: Array<() => void> = [];
const failingSerializerImportUrl = new URL('./ScatterOutboundEncoderFailingSerializer.ts', import.meta.url).href;

function decodeFrames(writes: readonly Buffer[]): ClusterMessage[] {
    const frames = Buffer.concat(writes);
    const messages: ClusterMessage[] = [];
    let offset = 0;

    while (offset < frames.length) {
        const payloadSize = frames.readUInt32BE(offset);
        offset += 4;
        messages.push(strategy.deserialize(frames.subarray(offset, offset + payloadSize)));
        offset += payloadSize;
    }

    return messages;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() >= deadline) {
            throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
        }
        await Bun.sleep(10);
    }
}

describe('ScatterOutboundEncoder', () => {
    afterEach(() => {
        for (const dispose of disposers.splice(0)) {
            dispose();
        }
    });

    it('preserves per-channel message ordering while absorbing scatter channel backpressure', async () => {
        const socket = new RecordingSocket();
        const channel = new EventloopChannel(socket, 1024);
        const batcher = new OutboundBatcher(channel);
        const encoder = new ScatterOutboundEncoder(batcher, {
            inputCapacityBytes: 256,
            outputCapacityBytes: 256,
        });
        disposers.push(() => {
            encoder.dispose();
            batcher.dispose();
            channel.close();
        });

        const sent: ClusterMessage[] = Array.from({ length: 32 }, (_, index) => ({
            type: 'HEARTBEAT' as const,
            senderUuid: `node-${index}`,
            timestamp: index,
        }));

        for (const message of sent) {
            expect(encoder.enqueue(message)).toBe(true);
        }

        await waitUntil(() => decodeFrames(socket.writes).length === sent.length);

        expect(decodeFrames(socket.writes)).toEqual(sent);
    });

    it('replays already-accepted sends in order after worker-side encoder failure', async () => {
        const socket = new RecordingSocket();
        const channel = new EventloopChannel(socket, 1024);
        const batcher = new OutboundBatcher(channel);
        const encoder = new ScatterOutboundEncoder(batcher, {
            inputCapacityBytes: 128,
            outputCapacityBytes: 128,
            serializerImportUrl: failingSerializerImportUrl,
        });
        disposers.push(() => {
            encoder.dispose();
            batcher.dispose();
            channel.close();
        });

        const sent: ClusterMessage[] = [
            { type: 'HEARTBEAT', senderUuid: 'before-failure', timestamp: 1 },
            { type: 'HEARTBEAT', senderUuid: 'fail-on-worker', timestamp: 2 },
            { type: 'HEARTBEAT', senderUuid: 'after-failure', timestamp: 3 },
            { type: 'HEARTBEAT', senderUuid: 'post-failover', timestamp: 4 },
        ];

        for (const message of sent) {
            expect(encoder.enqueue(message)).toBe(true);
        }

        await waitUntil(() => decodeFrames(socket.writes).length === sent.length);

        expect(decodeFrames(socket.writes)).toEqual(sent);
    });
});
