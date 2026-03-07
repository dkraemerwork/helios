/**
 * Port of {@code com.hazelcast.internal.server.tcp.PacketDecoderTest}.
 */
import { ByteBuffer } from '@zenystx/helios-core/internal/networking/ByteBuffer';
import { Packet } from '@zenystx/helios-core/internal/nio/Packet';
import { PacketIOHelper } from '@zenystx/helios-core/internal/nio/PacketIOHelper';
import { PacketDecoder } from '@zenystx/helios-core/internal/server/tcp/PacketDecoder';
import { SwCounter } from '@zenystx/helios-core/internal/util/counters/SwCounter';
import { beforeEach, describe, expect, test } from 'bun:test';

describe('PacketDecoderTest', () => {
    let dispatcher: Packet[];
    let decoder: PacketDecoder;
    let normalPacketCounter: SwCounter;
    let priorityPacketCounter: SwCounter;

    beforeEach(() => {
        dispatcher = [];
        const dispatchFn = (p: Packet) => dispatcher.push(p);

        // null connection — PacketDecoder stores it but we don't need it in these tests
        decoder = new PacketDecoder(null as never, dispatchFn);

        normalPacketCounter = SwCounter.newSwCounter();
        priorityPacketCounter = SwCounter.newSwCounter();
        decoder.setNormalPacketsRead(normalPacketCounter);
        decoder.setPriorityPacketsRead(priorityPacketCounter);
    });

    test('whenPriorityPacket', () => {
        const src = ByteBuffer.allocate(1000);
        // payload must be >= 8 bytes (HeapData minimum)
        const packet = new Packet(Buffer.from('foobarbaz')).raiseFlags(Packet.FLAG_URGENT);
        new PacketIOHelper().writeTo(packet, src);

        decoder.src(src);
        decoder.onRead();

        expect(dispatcher).toHaveLength(1);
        const found = dispatcher[0];
        expect(found.getFlags()).toBe(packet.getFlags());
        expect(normalPacketCounter.get()).toBe(0n);
        expect(priorityPacketCounter.get()).toBe(1n);
    });

    test('whenNormalPacket', () => {
        const src = ByteBuffer.allocate(1000);
        const packet = new Packet(Buffer.from('foobarbaz'));
        new PacketIOHelper().writeTo(packet, src);

        decoder.src(src);
        decoder.onRead();

        expect(dispatcher).toHaveLength(1);
        const found = dispatcher[0];
        expect(found.getFlags()).toBe(packet.getFlags());
        expect(normalPacketCounter.get()).toBe(1n);
        expect(priorityPacketCounter.get()).toBe(0n);
    });

    test('whenMultiplePackets', () => {
        const src = ByteBuffer.allocate(1000);
        const helper = new PacketIOHelper();

        // payloads must be >= 8 bytes (HeapData minimum)
        const packet1 = new Packet(Buffer.from('packet1!!'));
        helper.writeTo(packet1, src);

        const packet2 = new Packet(Buffer.from('packet2!!'));
        helper.writeTo(packet2, src);

        const packet3 = new Packet(Buffer.from('packet3!!'));
        helper.writeTo(packet3, src);

        const packet4 = new Packet(Buffer.from('packet4!!')).raiseFlags(Packet.FLAG_URGENT);
        helper.writeTo(packet4, src);

        decoder.src(src);
        decoder.onRead();

        expect(dispatcher).toHaveLength(4);
        expect(dispatcher[0].getFlags()).toBe(packet1.getFlags());
        expect(dispatcher[1].getFlags()).toBe(packet2.getFlags());
        expect(dispatcher[2].getFlags()).toBe(packet3.getFlags());
        expect(dispatcher[3].getFlags()).toBe(packet4.getFlags());
        expect(normalPacketCounter.get()).toBe(3n);
        expect(priorityPacketCounter.get()).toBe(1n);
    });
});
