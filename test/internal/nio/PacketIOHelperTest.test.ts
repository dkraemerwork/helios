/**
 * Port of {@code com.hazelcast.nio.PacketIOHelperTest}.
 * Tests for PacketIOHelper: write/read round-trips using raw byte arrays.
 * The SerializationService-dependent tests (testPacketWriteRead, testPacketWriteRead_usingPortable)
 * are adapted to use raw byte payloads since the full serialization service is ported later.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { Packet } from '@zenystx/core/internal/nio/Packet';
import { PacketIOHelper } from '@zenystx/core/internal/nio/PacketIOHelper';
import { ByteBuffer } from '@zenystx/core/internal/networking/ByteBuffer';

function generateRandomString(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

describe('PacketIOHelperTest', () => {
    let packetWriter: PacketIOHelper;
    let packetReader: PacketIOHelper;

    beforeEach(() => {
        packetWriter = new PacketIOHelper();
        packetReader = new PacketIOHelper();
    });

    test('cloningOfPacket', () => {
        const originalPacket = new Packet(Buffer.from('foobarbaz'));
        const bb = ByteBuffer.allocate(100);

        const written = packetWriter.writeTo(originalPacket, bb);
        expect(written).toBe(true);

        bb.flip();

        const clonedPacket = packetReader.readFrom(bb);
        expect(clonedPacket).not.toBeNull();

        assertPacketEquals(originalPacket, clonedPacket!);
    });

    test('largeValue', () => {
        const originalPacket = new Packet(Buffer.from(generateRandomString(100000)));

        let clonedPacket: Packet | null = null;
        const bb = ByteBuffer.allocate(20);
        let writeCompleted: boolean;
        do {
            writeCompleted = packetWriter.writeTo(originalPacket, bb);
            bb.flip();
            clonedPacket = packetReader.readFrom(bb);
            bb.clear();
        } while (!writeCompleted);

        expect(clonedPacket).not.toBeNull();
        assertPacketEquals(originalPacket, clonedPacket!);
    });

    test('lotsOfPackets', () => {
        const originalPackets: Packet[] = [];
        for (let k = 0; k < 1000; k++) {
            const len = Math.floor(Math.random() * 1000) + 8;
            const bytes = Buffer.from(generateRandomString(len));
            originalPackets.push(new Packet(bytes));
        }

        const bb = ByteBuffer.allocate(20);

        for (const originalPacket of originalPackets) {
            let clonedPacket: Packet | null = null;
            let writeCompleted: boolean;
            do {
                writeCompleted = packetWriter.writeTo(originalPacket, bb);
                bb.flip();
                clonedPacket = packetReader.readFrom(bb);
                bb.clear();
            } while (!writeCompleted);

            expect(clonedPacket).not.toBeNull();
            assertPacketEquals(originalPacket, clonedPacket!);
        }
    });

    test('flagsPreservedAfterRoundTrip', () => {
        // payload must be >= 8 bytes (HeapData minimum)
        const originalPacket = new Packet(Buffer.from('test1234'))
            .raiseFlags(Packet.FLAG_URGENT)
            .setPacketType(Packet.Type.OPERATION);

        const bb = ByteBuffer.allocate(100);
        packetWriter.writeTo(originalPacket, bb);
        bb.flip();

        const clonedPacket = packetReader.readFrom(bb);
        expect(clonedPacket).not.toBeNull();
        expect(clonedPacket!.getFlags()).toBe(originalPacket.getFlags());
        expect(clonedPacket!.getPartitionId()).toBe(originalPacket.getPartitionId());
    });
});

function assertPacketEquals(original: Packet, cloned: Packet): void {
    expect(cloned.getFlags()).toBe(original.getFlags());
    const origBytes = original.toByteArray();
    const clonedBytes = cloned.toByteArray();
    if (origBytes === null) {
        expect(clonedBytes === null || clonedBytes.length === 0).toBe(true);
    } else {
        expect(clonedBytes).not.toBeNull();
        expect(Buffer.compare(origBytes, clonedBytes!)).toBe(0);
    }
}
