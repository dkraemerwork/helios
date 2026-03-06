/**
 * Port of {@code com.hazelcast.internal.serialization.impl.PacketTest}.
 */
import { describe, test, expect } from 'bun:test';
import { Packet } from '@zenystx/helios-core/internal/nio/Packet';

const { FLAG_4_0, FLAG_OP_CONTROL, FLAG_URGENT } = Packet;

describe('PacketTest', () => {
    test('isFlag_4_xSet', () => {
        const payload = Buffer.alloc(0);
        const packet = new Packet();
        const packet2 = new Packet(payload);
        const packet3 = new Packet(payload, 1);

        expect(packet.isFlagRaised(FLAG_4_0)).toBe(true);
        expect(packet2.isFlagRaised(FLAG_4_0)).toBe(true);
        expect(packet3.isFlagRaised(FLAG_4_0)).toBe(true);
    });

    test('raiseFlags', () => {
        const packet = new Packet();
        packet.raiseFlags(FLAG_URGENT);

        expect(packet.getFlags()).toBe(FLAG_4_0 | FLAG_URGENT);
    });

    test('setPacketType', () => {
        const packet = new Packet();
        const allTypes = [
            Packet.Type.NULL, Packet.Type.OPERATION, Packet.Type.EVENT, Packet.Type.JET,
            Packet.Type.SERVER_CONTROL, Packet.Type.UNDEFINED5, Packet.Type.UNDEFINED6, Packet.Type.UNDEFINED7,
        ];
        for (const type of allTypes) {
            packet.setPacketType(type);
            expect(packet.getPacketType()).toBe(type);
        }
    });

    test('isFlagSet', () => {
        const packet = new Packet();
        packet.setPacketType(Packet.Type.OPERATION);
        packet.raiseFlags(FLAG_URGENT);

        expect(packet.getPacketType()).toBe(Packet.Type.OPERATION);
        expect(packet.isFlagRaised(FLAG_URGENT)).toBe(true);
        expect(packet.isFlagRaised(FLAG_OP_CONTROL)).toBe(false);
    });

    test('resetFlagsTo', () => {
        const packet = new Packet().setPacketType(Packet.Type.OPERATION);
        packet.resetFlagsTo(FLAG_URGENT);

        expect(packet.getPacketType()).toBe(Packet.Type.NULL);
        expect(packet.getFlags()).toBe(FLAG_URGENT);
    });
});
