/**
 * Port of com.hazelcast.client.impl.protocol.ClientMessageReaderTest
 */
import { ClientMessage } from '../../../../src/client/impl/protocol/ClientMessage';
import { ClientMessageReader } from '../../../../src/client/impl/protocol/ClientMessageReader';
import { ClientMessageWriter } from '../../../../src/client/impl/protocol/ClientMessageWriter';
import { ByteBuffer } from '@zenystx/helios-core/internal/networking/ByteBuffer';
import { describe, expect, it } from 'bun:test';

/** Encode message to buffer using writer */
function encodeToBuffer(msg: ClientMessage, bufSize: number): ByteBuffer {
    const buf = ByteBuffer.allocate(bufSize);
    const writer = new ClientMessageWriter();
    msg.setFinal();
    const done = writer.writeTo(buf, msg);
    expect(done).toBe(true);
    buf.flip();
    return buf;
}

/** Build a simple single-frame message */
function buildSimpleMessage(content: Buffer): ClientMessage {
    const msg = ClientMessage.createForEncode();
    const frame = new ClientMessage.Frame(content);
    msg.add(frame);
    msg.setFinal();
    return msg;
}

describe('ClientMessageReader', () => {
    it('readSingleFrame — reads a complete single-frame message', () => {
        const content = Buffer.from('hello world');
        const msg = buildSimpleMessage(content);
        const buf = encodeToBuffer(msg, 1024);

        const reader = new ClientMessageReader();
        const done = reader.readFrom(buf, true);
        expect(done).toBe(true);

        const result = reader.getClientMessage();
        const frame = result.getStartFrame();
        expect(frame.content.toString()).toBe('hello world');
    });

    it('readMultiFrame — reads a multi-frame message', () => {
        const msg = ClientMessage.createForEncode();
        msg.add(new ClientMessage.Frame(Buffer.from('frame1')));
        msg.add(new ClientMessage.Frame(Buffer.from('frame2')));
        msg.setFinal();

        const buf = encodeToBuffer(msg, 1024);

        const reader = new ClientMessageReader();
        const done = reader.readFrom(buf, true);
        expect(done).toBe(true);

        const result = reader.getClientMessage();
        const iter = result.forwardFrameIterator();
        expect(iter.next().content.toString()).toBe('frame1');
        expect(iter.next().content.toString()).toBe('frame2');
    });

    it('readInMultipleCalls — reads incrementally byte by byte', () => {
        const content = Buffer.allocUnsafe(20);
        content.fill(0x42);
        const msg = buildSimpleMessage(content);
        const fullBuf = encodeToBuffer(msg, 1024);
        const totalBytes = fullBuf.remaining();
        const rawBytes = fullBuf.buffer().slice(0, totalBytes);

        const reader = new ClientMessageReader();
        let done = false;
        for (let i = 0; i < totalBytes; i++) {
            const slice = ByteBuffer.wrap(rawBytes.slice(i, i + 1));
            done = reader.readFrom(slice, true);
        }
        expect(done).toBe(true);

        const result = reader.getClientMessage();
        expect(result.getStartFrame().content).toEqual(content);
    });

    it('readFramesInMultipleCallsWhenLastPieceSmall — reads when last chunk is tiny', () => {
        const content = Buffer.allocUnsafe(100);
        content.fill(0xAB);
        const msg = buildSimpleMessage(content);
        const fullBuf = encodeToBuffer(msg, 1024);
        const totalBytes = fullBuf.remaining();
        const rawBytes = fullBuf.buffer().slice(0, totalBytes);

        const reader = new ClientMessageReader();
        // Feed most of the data, then just 1 byte at a time for the last part
        const bigChunk = ByteBuffer.wrap(rawBytes.slice(0, totalBytes - 3));
        let done = reader.readFrom(bigChunk, true);
        expect(done).toBe(false);

        for (let i = totalBytes - 3; i < totalBytes; i++) {
            done = reader.readFrom(ByteBuffer.wrap(rawBytes.slice(i, i + 1)), true);
        }
        expect(done).toBe(true);
    });

    it('readWhenLengthAndFlagsNotReceivedAtFirst — partial header then rest', () => {
        const content = Buffer.from('testcontent');
        const msg = buildSimpleMessage(content);
        const fullBuf = encodeToBuffer(msg, 1024);
        const totalBytes = fullBuf.remaining();
        const rawBytes = fullBuf.buffer().slice(0, totalBytes);

        const reader = new ClientMessageReader();
        // Send only 3 bytes (less than SIZE_OF_FRAME_LENGTH_AND_FLAGS=6)
        let done = reader.readFrom(ByteBuffer.wrap(rawBytes.slice(0, 3)), true);
        expect(done).toBe(false);

        // Send the rest
        done = reader.readFrom(ByteBuffer.wrap(rawBytes.slice(3)), true);
        expect(done).toBe(true);

        const result = reader.getClientMessage();
        expect(result.getStartFrame().content.toString()).toBe('testcontent');
    });
});
