/**
 * Port of {@code com.hazelcast.spi.impl.PacketDispatcher}.
 * Dispatches Packets to the correct service handler.
 */
import { Packet } from '@zenystx/helios-core/internal/nio/Packet';

const { FLAG_OP_RESPONSE, FLAG_OP_CONTROL } = Packet;

export class PacketDispatcher {
    private readonly _operationExecutor: (p: Packet) => void;
    private readonly _responseHandler: (p: Packet) => void;
    private readonly _invocationMonitor: (p: Packet) => void;
    private readonly _eventService: (p: Packet) => void;
    private readonly _jetServiceBackend: (p: Packet) => void;

    constructor(
        operationExecutor: (p: Packet) => void,
        responseHandler: (p: Packet) => void,
        invocationMonitor: (p: Packet) => void,
        eventService: (p: Packet) => void,
        jetServiceBackend: (p: Packet) => void,
    ) {
        this._operationExecutor = operationExecutor;
        this._responseHandler = responseHandler;
        this._invocationMonitor = invocationMonitor;
        this._eventService = eventService;
        this._jetServiceBackend = jetServiceBackend;
    }

    accept(packet: Packet): void {
        try {
            switch (packet.getPacketType()) {
                case Packet.Type.OPERATION:
                    if (packet.isFlagRaised(FLAG_OP_RESPONSE)) {
                        this._responseHandler(packet);
                    } else if (packet.isFlagRaised(FLAG_OP_CONTROL)) {
                        this._invocationMonitor(packet);
                    } else {
                        this._operationExecutor(packet);
                    }
                    break;
                case Packet.Type.EVENT:
                    this._eventService(packet);
                    break;
                case Packet.Type.JET:
                    this._jetServiceBackend(packet);
                    break;
                case Packet.Type.SERVER_CONTROL: {
                    const conn = packet.getConn() as { getConnectionManager?: () => { accept: (p: Packet) => void } } | null;
                    if (conn?.getConnectionManager) {
                        conn.getConnectionManager().accept(packet);
                    }
                    break;
                }
                default:
                    console.error(`Header flags [${packet.getFlags().toString(2)}] specify an undefined packet type ${packet.getPacketType().name}`);
            }
        } catch (t: unknown) {
            const msg = t instanceof Error ? `${t.message}\n${t.stack ?? ''}` : String(t);
            console.error(`Failed to process: ${packet} — ${msg}`);
        }
    }
}
