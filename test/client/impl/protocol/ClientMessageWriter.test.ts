/**
 * Port of com.hazelcast.client.impl.protocol.ClientMessageWriterTest
 */
import { describe, it, expect } from 'bun:test';
import { ClientMessage } from '@helios/client/impl/protocol/ClientMessage';
import { ClientMessageWriter } from '@helios/client/impl/protocol/ClientMessageWriter';
import { ByteBuffer } from '@helios/internal/networking/ByteBuffer';

const SIZE = ClientMessage.SIZE_OF_FRAME_LENGTH_AND_FLAGS;

function buildMessage(contentSize: number): ClientMessage {
    const msg = ClientMessage.createForEncode();
    msg.add(new ClientMessage.Frame(Buffer.allocUnsafe(contentSize)));
    msg.setFinal();
    return msg;
}

describe('ClientMessageWriter', () => {
    it('writeAttemptInsufficientSpace — 50-byte buffer not enough for 100-byte content frame', () => {
        // Frame total = SIZE(6) + 100 = 106 bytes; buffer = 50 → not done
        const msg = buildMessage(100);
        const buf = ByteBuffer.allocate(50);
        const writer = new ClientMessageWriter();
        const done = writer.writeTo(buf, msg);
        expect(done).toBe(false);
    });

    it('writeAttemptLessThanFrameLengthAndFlags — buffer smaller than header (5 bytes)', () => {
        const msg = buildMessage(100);
        const buf = ByteBuffer.allocate(SIZE - 1); // 5 bytes
        const writer = new ClientMessageWriter();
        const done = writer.writeTo(buf, msg);
        expect(done).toBe(false);
    });

    it('writeExact — buffer exactly fits message', () => {
        const content = Buffer.from('hello');
        const msg = ClientMessage.createForEncode();
        msg.add(new ClientMessage.Frame(content));
        msg.setFinal();
        const frameLen = SIZE + content.length; // 11
        const buf = ByteBuffer.allocate(frameLen);
        const writer = new ClientMessageWriter();
        const done = writer.writeTo(buf, msg);
        expect(done).toBe(true);
    });
});
