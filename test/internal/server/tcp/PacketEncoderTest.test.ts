/**
 * Port of {@code com.hazelcast.internal.server.tcp.PacketEncoderTest}.
 */
import { ByteBuffer } from '@zenystx/helios-core/internal/networking/ByteBuffer';
import { HandlerStatus } from '@zenystx/helios-core/internal/networking/HandlerStatus';
import { Packet } from '@zenystx/helios-core/internal/nio/Packet';
import { PacketIOHelper } from '@zenystx/helios-core/internal/nio/PacketIOHelper';
import { PacketEncoder } from '@zenystx/helios-core/internal/server/tcp/PacketEncoder';
import { beforeEach, describe, expect, test } from 'bun:test';

const { CLEAN, DIRTY } = HandlerStatus;

describe('PacketEncoderTest', () => {
    let encoder: PacketEncoder;

    beforeEach(() => {
        encoder = new PacketEncoder();
    });

    test('whenPacketFullyWritten', () => {
        // payload must be >= 8 bytes (HeapData minimum)
        const packet = new Packet(Buffer.from('foobarbaz'));
        const dst = ByteBuffer.allocate(1000);
        dst.flip(); // start in reading mode (empty)

        const queue: Packet[] = [packet];
        const src = () => queue.shift() ?? null;

        encoder.dst(dst);
        encoder.src(src);

        const result = encoder.onWrite();

        expect(result).toBe(CLEAN);

        // now read out the dst and verify we can reconstruct the packet
        const resultPacket = new PacketIOHelper().readFrom(dst);
        expect(resultPacket).not.toBeNull();
        expect(resultPacket!.getFlags()).toBe(packet.getFlags());
        const origBytes = packet.toByteArray();
        const clonedBytes = resultPacket!.toByteArray();
        if (origBytes) {
            expect(Buffer.compare(origBytes, clonedBytes!)).toBe(0);
        }
    });

    test('whenNotEnoughSpace', () => {
        const largePayload = Buffer.alloc(2000);
        const packet = new Packet(largePayload);
        const dst = ByteBuffer.allocate(1000);
        dst.flip(); // start in reading mode (empty)

        const queue: Packet[] = [packet];
        const src = () => queue.shift() ?? null;

        encoder.dst(dst);
        encoder.src(src);

        const result = encoder.onWrite();

        expect(result).toBe(DIRTY);
    });
});
