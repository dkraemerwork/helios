/**
 * Port of com.hazelcast.client.impl.protocol.util.ClientMessageSplitterTest
 * and ClientMessageSplitAndBuildTest
 */
import { ClientMessage, ClientMessageFrame } from '../../../../src/client/impl/protocol/ClientMessage';
import { ClientMessageSplitter } from '../../../../src/client/impl/protocol/util/ClientMessageSplitter';
import { describe, expect, it } from 'bun:test';

const SIZE = 6; // SIZE_OF_FRAME_LENGTH_AND_FLAGS

function buildMessage(frames: Buffer[]): ClientMessage {
    const msg = ClientMessage.createForEncode();
    for (const f of frames) {
        msg.add(new ClientMessageFrame(Buffer.from(f)));
    }
    msg.setFinal();
    return msg;
}

describe('ClientMessageSplitter', () => {
    it('testGetFragments_whenMessageAlreadySmaller — no split needed', () => {
        const content = Buffer.allocUnsafe(10);
        content.fill(0x01);
        const msg = buildMessage([content]);
        const fragments = ClientMessageSplitter.getFragments(1024, msg);
        expect(fragments.length).toBe(1);
        expect(fragments[0]).toBe(msg); // same reference
    });

    it('testGetSubFrames — 1000-byte max with many small frames produces multiple fragments', () => {
        // Build a message with many small frames to exceed maxFrameSize
        const frames: Buffer[] = [];
        for (let i = 0; i < 20; i++) {
            const f = Buffer.allocUnsafe(50);
            f.fill(i + 1);
            frames.push(f);
        }
        // Total: 20 * (6 + 50) = 1120 bytes > 500
        const msg = buildMessage(frames);
        const fragments = ClientMessageSplitter.getFragments(500, msg);
        expect(fragments.length).toBeGreaterThan(1);
    });

    it('testGetSubFrame_whenFrameSizeGreater — single large frame goes in one fragment', () => {
        // A single frame larger than maxFrameSize cannot be split — still 1 fragment
        const payload = Buffer.allocUnsafe(500);
        payload.fill(0xCC);
        const msg = buildMessage([payload]);
        const fragments = ClientMessageSplitter.getFragments(64, msg);
        // The single frame MUST be included, so at least 1 fragment
        expect(fragments.length).toBeGreaterThanOrEqual(1);
        // Since it's a single oversized frame, it should be exactly 1 fragment
        expect(fragments.length).toBe(1);
    });

    it('splitAndBuild — multi-frame message with split produces correct fragment flags', () => {
        const frames: Buffer[] = [];
        for (let i = 0; i < 10; i++) {
            const f = Buffer.allocUnsafe(80);
            f.fill(i + 1);
            frames.push(f);
        }
        // Total: 10 * (6 + 80) = 860 > 300
        const msg = buildMessage(frames);
        const fragments = ClientMessageSplitter.getFragments(300, msg);
        expect(fragments.length).toBeGreaterThan(1);

        // First fragment: header frame has BEGIN_FRAGMENT_FLAG
        expect(ClientMessage.isFlagSet(
            fragments[0].getStartFrame().flags,
            ClientMessage.BEGIN_FRAGMENT_FLAG
        )).toBe(true);

        // Last fragment: last frame has END_FRAGMENT_FLAG
        const lastFrag = fragments[fragments.length - 1];
        let lastFrame = lastFrag.getStartFrame();
        while (lastFrame.next !== null) lastFrame = lastFrame.next;
        expect(ClientMessage.isFlagSet(lastFrame.flags, ClientMessage.END_FRAGMENT_FLAG)).toBe(true);
        expect(ClientMessage.isFlagSet(lastFrame.flags, ClientMessage.IS_FINAL_FLAG)).toBe(true);
    });

    it('splitAndBuild_multipleMessages — different fragmentation IDs', () => {
        const frames: Buffer[] = [];
        for (let i = 0; i < 10; i++) {
            const f = Buffer.allocUnsafe(80);
            f.fill(0xFF);
            frames.push(f);
        }
        const msg1 = buildMessage(frames);
        const msg2 = buildMessage(frames);

        const frags1 = ClientMessageSplitter.getFragments(300, msg1);
        const frags2 = ClientMessageSplitter.getFragments(300, msg2);

        expect(frags1.length).toBeGreaterThan(1);
        expect(frags2.length).toBeGreaterThan(1);

        // Fragmentation IDs come from header frame content
        const getId = (frag: ClientMessage) => frag.getStartFrame().content.readBigInt64LE(0);
        const id1 = getId(frags1[0]);
        const id2 = getId(frags2[0]);
        expect(id1).not.toBe(id2);
    });

    it('fragmentFieldAccessTest — fragmentation header frame has correct flags', () => {
        const frames: Buffer[] = [];
        for (let i = 0; i < 10; i++) {
            const f = Buffer.allocUnsafe(80);
            f.fill(0x55);
            frames.push(f);
        }
        const msg = buildMessage(frames);
        const fragments = ClientMessageSplitter.getFragments(300, msg);
        expect(fragments.length).toBeGreaterThan(1);

        expect(ClientMessage.isFlagSet(
            fragments[0].getStartFrame().flags,
            ClientMessage.BEGIN_FRAGMENT_FLAG
        )).toBe(true);
    });
});
