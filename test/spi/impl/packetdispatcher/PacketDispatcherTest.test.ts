/**
 * Port of {@code com.hazelcast.spi.impl.packetdispatcher.impl.PacketDispatcherTest}.
 */
import { Packet } from '@zenystx/helios-core/internal/nio/Packet';
import { PacketDispatcher } from '@zenystx/helios-core/spi/impl/PacketDispatcher';
import { beforeEach, describe, expect, mock, test } from 'bun:test';

const { FLAG_OP_CONTROL, FLAG_OP_RESPONSE, FLAG_URGENT } = Packet;

describe('PacketDispatcherTest', () => {
    let operationExecutor: ReturnType<typeof mock>;
    let eventService: ReturnType<typeof mock>;
    let responseHandler: ReturnType<typeof mock>;
    let invocationMonitor: ReturnType<typeof mock>;
    let jetService: ReturnType<typeof mock>;
    let dispatcher: PacketDispatcher;

    beforeEach(() => {
        operationExecutor = mock(() => {});
        responseHandler = mock(() => {});
        eventService = mock(() => {});
        invocationMonitor = mock(() => {});
        jetService = mock(() => {});

        dispatcher = new PacketDispatcher(
            operationExecutor,
            responseHandler,
            invocationMonitor,
            eventService,
            jetService,
        );
    });

    test('whenOperationPacket', () => {
        const packet = new Packet().setPacketType(Packet.Type.OPERATION);
        dispatcher.accept(packet);
        expect(operationExecutor).toHaveBeenCalledTimes(1);
        expect(operationExecutor).toHaveBeenCalledWith(packet);
        expect(responseHandler).toHaveBeenCalledTimes(0);
        expect(eventService).toHaveBeenCalledTimes(0);
        expect(invocationMonitor).toHaveBeenCalledTimes(0);
        expect(jetService).toHaveBeenCalledTimes(0);
    });

    test('whenUrgentOperationPacket', () => {
        const packet = new Packet().setPacketType(Packet.Type.OPERATION).raiseFlags(FLAG_URGENT);
        dispatcher.accept(packet);
        expect(operationExecutor).toHaveBeenCalledTimes(1);
        expect(operationExecutor).toHaveBeenCalledWith(packet);
        expect(responseHandler).toHaveBeenCalledTimes(0);
        expect(eventService).toHaveBeenCalledTimes(0);
        expect(invocationMonitor).toHaveBeenCalledTimes(0);
        expect(jetService).toHaveBeenCalledTimes(0);
    });

    test('whenOperationResponsePacket', () => {
        const packet = new Packet().setPacketType(Packet.Type.OPERATION).raiseFlags(FLAG_OP_RESPONSE);
        dispatcher.accept(packet);
        expect(responseHandler).toHaveBeenCalledTimes(1);
        expect(responseHandler).toHaveBeenCalledWith(packet);
        expect(operationExecutor).toHaveBeenCalledTimes(0);
        expect(eventService).toHaveBeenCalledTimes(0);
        expect(invocationMonitor).toHaveBeenCalledTimes(0);
        expect(jetService).toHaveBeenCalledTimes(0);
    });

    test('whenUrgentOperationResponsePacket', () => {
        const packet = new Packet().setPacketType(Packet.Type.OPERATION).raiseFlags(FLAG_OP_RESPONSE | FLAG_URGENT);
        dispatcher.accept(packet);
        expect(responseHandler).toHaveBeenCalledTimes(1);
        expect(responseHandler).toHaveBeenCalledWith(packet);
        expect(operationExecutor).toHaveBeenCalledTimes(0);
        expect(eventService).toHaveBeenCalledTimes(0);
        expect(invocationMonitor).toHaveBeenCalledTimes(0);
        expect(jetService).toHaveBeenCalledTimes(0);
    });

    test('whenOperationControlPacket', () => {
        const packet = new Packet().setPacketType(Packet.Type.OPERATION).raiseFlags(FLAG_OP_CONTROL);
        dispatcher.accept(packet);
        expect(invocationMonitor).toHaveBeenCalledTimes(1);
        expect(invocationMonitor).toHaveBeenCalledWith(packet);
        expect(responseHandler).toHaveBeenCalledTimes(0);
        expect(operationExecutor).toHaveBeenCalledTimes(0);
        expect(eventService).toHaveBeenCalledTimes(0);
        expect(jetService).toHaveBeenCalledTimes(0);
    });

    test('whenEventPacket', () => {
        const packet = new Packet().setPacketType(Packet.Type.EVENT);
        dispatcher.accept(packet);
        expect(eventService).toHaveBeenCalledTimes(1);
        expect(eventService).toHaveBeenCalledWith(packet);
        expect(responseHandler).toHaveBeenCalledTimes(0);
        expect(operationExecutor).toHaveBeenCalledTimes(0);
        expect(invocationMonitor).toHaveBeenCalledTimes(0);
        expect(jetService).toHaveBeenCalledTimes(0);
    });

    test('whenJetPacket', () => {
        const packet = new Packet().setPacketType(Packet.Type.JET);
        dispatcher.accept(packet);
        expect(jetService).toHaveBeenCalledTimes(1);
        expect(jetService).toHaveBeenCalledWith(packet);
        expect(responseHandler).toHaveBeenCalledTimes(0);
        expect(operationExecutor).toHaveBeenCalledTimes(0);
        expect(eventService).toHaveBeenCalledTimes(0);
        expect(invocationMonitor).toHaveBeenCalledTimes(0);
    });

    test('whenUnrecognizedPacket_thenSwallowed', () => {
        const packet = new Packet().setPacketType(Packet.Type.NULL);
        // should not throw
        dispatcher.accept(packet);
        expect(operationExecutor).toHaveBeenCalledTimes(0);
        expect(responseHandler).toHaveBeenCalledTimes(0);
        expect(eventService).toHaveBeenCalledTimes(0);
        expect(invocationMonitor).toHaveBeenCalledTimes(0);
        expect(jetService).toHaveBeenCalledTimes(0);
    });

    test('whenProblemHandlingPacket_thenSwallowed', () => {
        const packet = new Packet().setPacketType(Packet.Type.OPERATION);
        // Use a plain function (not mock()) — bun's mock() re-throws after recording,
        // which would escape the dispatcher's try/catch. A plain function throws only once,
        // letting the dispatcher swallow it correctly.
        const throwingExecutor = (_p: Packet): void => { throw new Error('ExpectedRuntimeException'); };
        const testDispatcher = new PacketDispatcher(
            throwingExecutor,
            responseHandler,
            invocationMonitor,
            eventService,
            jetService,
        );
        // should not throw — the dispatcher swallows the exception
        expect(() => testDispatcher.accept(packet)).not.toThrow();
    });
});
