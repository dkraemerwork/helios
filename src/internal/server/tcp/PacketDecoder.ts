/**
 * Port of {@code com.hazelcast.internal.server.tcp.PacketDecoder}.
 * InboundHandler that reads Packet instances from a ByteBuffer.
 */
import { InboundHandlerWithCounters } from '@zenystx/helios-core/internal/networking/InboundHandlerWithCounters';
import { HandlerStatus } from '@zenystx/helios-core/internal/networking/HandlerStatus';
import { Packet } from '@zenystx/helios-core/internal/nio/Packet';
import { PacketIOHelper } from '@zenystx/helios-core/internal/nio/PacketIOHelper';
import { ByteBuffer } from '@zenystx/helios-core/internal/networking/ByteBuffer';

const { CLEAN } = HandlerStatus;

export class PacketDecoder extends InboundHandlerWithCounters<ByteBuffer, (packet: Packet) => void> {
    private readonly _connection: unknown;
    private readonly _packetReader = new PacketIOHelper();

    constructor(connection: unknown, dst: (packet: Packet) => void) {
        super();
        this._connection = connection;
        this._dst = dst;
    }

    onRead(): HandlerStatus {
        const src = this._src;
        src.flip();
        try {
            while (src.hasRemaining()) {
                const packet = this._packetReader.readFrom(src);
                if (packet === null) break;
                this._onPacketComplete(packet);
            }
            return CLEAN;
        } finally {
            // compact or clear
            if (src.remaining() > 0) {
                src.compact();
            } else {
                src.clear();
            }
        }
    }

    protected _onPacketComplete(packet: Packet): void {
        if (packet.isFlagRaised(Packet.FLAG_URGENT)) {
            this.priorityPacketsRead.inc();
        } else {
            this.normalPacketsRead.inc();
        }
        packet.setConn(this._connection);
        this._dst(packet);
    }
}
