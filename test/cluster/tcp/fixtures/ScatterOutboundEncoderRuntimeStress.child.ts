import { strict as assert } from 'node:assert';

import type { ClusterMessage } from '@zenystx/helios-core/cluster/tcp/ClusterMessage';
import { BinarySerializationStrategy } from '@zenystx/helios-core/cluster/tcp/BinarySerializationStrategy';
import { OutboundBatcher } from '@zenystx/helios-core/cluster/tcp/OutboundBatcher';
import { ScatterOutboundEncoder } from '@zenystx/helios-core/cluster/tcp/ScatterOutboundEncoder';
import { EventloopChannel } from '@zenystx/helios-core/internal/eventloop/Eventloop';
import { HeapData } from '@zenystx/helios-core/internal/serialization/impl/HeapData';
import { SetOperation } from '@zenystx/helios-core/map/impl/operation/SetOperation';
import { serializeOperation } from '@zenystx/helios-core/spi/impl/operationservice/OperationWireCodec';

type OperationMessage = Extract<ClusterMessage, { type: 'OPERATION' }>;

type EncoderDebugState = {
    _acceptedMessages: ClusterMessage[];
    _scatterHealthy: boolean;
    _submittedCount: number;
    _worker: { alive: boolean };
    _workerFailure: string | null;
};

type StressPeer = {
    peerId: string;
    socket: CongestedRecordingSocket;
    channel: EventloopChannel;
    batcher: OutboundBatcher;
    encoder: ScatterOutboundEncoder;
    accepted: OperationMessage[];
    maxQueuedFrames: number;
    maxPendingBytes: number;
    maxBufferedBytes: number;
};

type StressSummary = {
    peerCount: number;
    messagesPerPeer: number;
    totalAccepted: number;
    totalEmitted: number;
    totalPartialWrites: number;
    totalDrains: number;
    maxQueuedFrames: number;
    maxPendingBytes: number;
    maxBufferedBytes: number;
};

const strategy = new BinarySerializationStrategy();
const PEER_COUNT = 5;
const MESSAGES_PER_PEER = 240;
const CHANNEL_MAX_OUTBOUND_BYTES = 384;
const BATCH_CAPACITY_BYTES = 256;
const SCATTER_CHANNEL_CAPACITY_BYTES = 16 * 1024;
const WORK_THRESHOLD = 900;

class CongestedRecordingSocket {
    readonly writes: Buffer[] = [];
    partialWriteCount = 0;
    drainCount = 0;
    writeCount = 0;

    private _channel: EventloopChannel | null = null;
    private _drainScheduled = false;

    attach(channel: EventloopChannel): void {
        this._channel = channel;
    }

    write(data: Buffer | string): number {
        const buffer = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);
        this.writes.push(buffer);
        this.writeCount += 1;

        if (this._shouldBackpressure(buffer)) {
            this.partialWriteCount += 1;
            this._scheduleDrain();
            return 0;
        }

        return buffer.length;
    }

    end(): void {}

    private _shouldBackpressure(buffer: Buffer): boolean {
        return this.writeCount % 3 === 0 || (buffer.length >= 160 && this.writeCount % 2 === 0);
    }

    private _scheduleDrain(): void {
        if (this._drainScheduled) {
            return;
        }

        this._drainScheduled = true;
        setTimeout(() => {
            this._drainScheduled = false;
            this.drainCount += 1;
            const channel = this._channel as (EventloopChannel & { _onDrain(): void }) | null;
            channel?._onDrain();
        }, (this.writeCount % 4) + 1);
    }
}

function sampleData(peerIndex: number, messageIndex: number, extraBytes: number): HeapData {
    const bytes = Buffer.alloc(8 + extraBytes);
    for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = (peerIndex * 17 + messageIndex * 29 + index) & 0xff;
    }

    return new HeapData(bytes);
}

function buildOperationMessage(peerIndex: number, messageIndex: number): OperationMessage {
    const encoded = serializeOperation(new SetOperation(
        `scatter-runtime-${messageIndex % 13}`,
        sampleData(peerIndex, messageIndex, 12),
        sampleData(peerIndex + 1, messageIndex, 64 + ((peerIndex + messageIndex) % 64)),
        messageIndex,
        messageIndex + 1,
    ));

    return {
        type: 'OPERATION',
        callId: messageIndex + 1,
        partitionId: (peerIndex * 31 + messageIndex) % 271,
        senderId: `stress-node-${peerIndex}`,
        factoryId: encoded.factoryId,
        classId: encoded.classId,
        payload: encoded.payload,
    };
}

function countFrames(writes: readonly Buffer[]): number {
    const frames = Buffer.concat(writes);
    let offset = 0;
    let count = 0;

    while (offset < frames.length) {
        const frameLength = frames.readUInt32BE(offset);
        offset += 4 + frameLength;
        count += 1;
    }

    return count;
}

function decodeFrames(writes: readonly Buffer[]): OperationMessage[] {
    const frames = Buffer.concat(writes);
    const messages: OperationMessage[] = [];
    let offset = 0;

    while (offset < frames.length) {
        const frameLength = frames.readUInt32BE(offset);
        offset += 4;
        const message = strategy.deserialize(frames.subarray(offset, offset + frameLength));
        assert.equal(message.type, 'OPERATION');
        messages.push(message);
        offset += frameLength;
    }

    return messages;
}

function compactMessages(messages: readonly OperationMessage[]): string[] {
    return messages.map((message) => [
        message.callId,
        message.partitionId,
        message.senderId,
        message.factoryId,
        message.classId,
        message.payload.toString('base64'),
    ].join(':'));
}

function samplePeer(peer: StressPeer): void {
    peer.maxQueuedFrames = Math.max(peer.maxQueuedFrames, peer.channel.queuedFrames());
    peer.maxPendingBytes = Math.max(peer.maxPendingBytes, peer.channel.pendingBytes());
    peer.maxBufferedBytes = Math.max(peer.maxBufferedBytes, peer.batcher.bufferedBytes());
}

async function waitUntil(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() >= deadline) {
            throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
        }
        await Bun.sleep(10);
    }
}

function disposePeer(peer: StressPeer): void {
    peer.encoder.dispose();
    peer.batcher.dispose();
    peer.channel.close();
}

async function run(): Promise<StressSummary> {
    const peers: StressPeer[] = Array.from({ length: PEER_COUNT }, (_value, index) => {
        const socket = new CongestedRecordingSocket();
        const channel = new EventloopChannel(socket, CHANNEL_MAX_OUTBOUND_BYTES);
        socket.attach(channel);
        const batcher = new OutboundBatcher(channel, BATCH_CAPACITY_BYTES);
        const encoder = new ScatterOutboundEncoder(batcher, {
            inputCapacityBytes: SCATTER_CHANNEL_CAPACITY_BYTES,
            outputCapacityBytes: SCATTER_CHANNEL_CAPACITY_BYTES,
        });

        return {
            peerId: `peer-${index}`,
            socket,
            channel,
            batcher,
            encoder,
            accepted: [],
            maxQueuedFrames: 0,
            maxPendingBytes: 0,
            maxBufferedBytes: 0,
        };
    });

    try {
        for (let messageIndex = 0; messageIndex < MESSAGES_PER_PEER; messageIndex += 1) {
            for (let peerIndex = 0; peerIndex < peers.length; peerIndex += 1) {
                const peer = peers[peerIndex]!;
                const message = buildOperationMessage(peerIndex, messageIndex);
                assert.equal(peer.encoder.enqueue(message), true, `${peer.peerId} rejected message ${messageIndex}`);
                peer.accepted.push(message);
                samplePeer(peer);
            }

            if (messageIndex % 8 === 0) {
                await Bun.sleep(0);
                for (const peer of peers) {
                    samplePeer(peer);
                }
            }

            if (messageIndex % 24 === 23) {
                await Bun.sleep(2);
                for (const peer of peers) {
                    samplePeer(peer);
                }
            }
        }

        await waitUntil(() => peers.every((peer) => countFrames(peer.socket.writes) >= peer.accepted.length));
        await Bun.sleep(20);

        const totalAccepted = peers.reduce((sum, peer) => sum + peer.accepted.length, 0);
        const decodedPerPeer = peers.map((peer) => decodeFrames(peer.socket.writes));
        const totalEmitted = decodedPerPeer.reduce((sum, messages) => sum + messages.length, 0);

        assert.ok(totalAccepted >= WORK_THRESHOLD, `expected at least ${WORK_THRESHOLD} accepted messages, saw ${totalAccepted}`);

        for (let index = 0; index < peers.length; index += 1) {
            const peer = peers[index]!;
            const decoded = decodedPerPeer[index]!;
            const encoderState = peer.encoder as unknown as EncoderDebugState;
            const peerState = JSON.stringify({
                scatterHealthy: encoderState._scatterHealthy,
                workerFailure: encoderState._workerFailure,
                workerAlive: encoderState._worker.alive,
                acceptedMessages: encoderState._acceptedMessages.length,
                submittedCount: encoderState._submittedCount,
                partialWrites: peer.socket.partialWriteCount,
                drains: peer.socket.drainCount,
                queuedFrames: peer.channel.queuedFrames(),
                pendingBytes: peer.channel.pendingBytes(),
                bufferedBytes: peer.batcher.bufferedBytes(),
            });

            assert.equal(decoded.length, peer.accepted.length, `${peer.peerId} emitted unexpected message count`);
            assert.deepEqual(compactMessages(decoded), compactMessages(peer.accepted), `${peer.peerId} did not preserve exact per-peer ordering`);
            assert.equal(new Set(decoded.map((message) => message.callId)).size, decoded.length, `${peer.peerId} duplicated a callId`);
            assert.equal(encoderState._scatterHealthy, true, `${peer.peerId} scatter worker silently failed over: ${peerState}`);
            assert.equal(encoderState._workerFailure, null, `${peer.peerId} recorded worker failure: ${peerState}`);
            assert.equal(encoderState._worker.alive, true, `${peer.peerId} worker died unexpectedly: ${peerState}`);
            assert.equal(encoderState._acceptedMessages.length, 0, `${peer.peerId} still has accepted messages queued: ${peerState}`);
            assert.equal(encoderState._submittedCount, 0, `${peer.peerId} still has submitted messages pending: ${peerState}`);
            assert.ok(peer.socket.partialWriteCount > 0, `${peer.peerId} never experienced backpressure`);
            assert.ok(peer.socket.drainCount > 0, `${peer.peerId} never drained`);
            assert.ok(peer.maxPendingBytes > 0, `${peer.peerId} never accumulated pending bytes`);
            assert.ok(peer.maxBufferedBytes > 0, `${peer.peerId} never buffered a batch`);
            assert.ok(peer.maxQueuedFrames > 0, `${peer.peerId} never queued outbound frames`);
        }

        return {
            peerCount: peers.length,
            messagesPerPeer: MESSAGES_PER_PEER,
            totalAccepted,
            totalEmitted,
            totalPartialWrites: peers.reduce((sum, peer) => sum + peer.socket.partialWriteCount, 0),
            totalDrains: peers.reduce((sum, peer) => sum + peer.socket.drainCount, 0),
            maxQueuedFrames: Math.max(...peers.map((peer) => peer.maxQueuedFrames)),
            maxPendingBytes: Math.max(...peers.map((peer) => peer.maxPendingBytes)),
            maxBufferedBytes: Math.max(...peers.map((peer) => peer.maxBufferedBytes)),
        };
    } finally {
        for (const peer of peers) {
            disposePeer(peer);
        }
    }
}

void run()
    .then((summary) => {
        process.stdout.write(`${JSON.stringify(summary)}\n`);
    })
    .catch((error: unknown) => {
        const message = error instanceof Error ? error.stack ?? error.message : String(error);
        process.stderr.write(`${message}\n`);
        process.exit(1);
    });
