/**
 * Port of {@code com.hazelcast.internal.server.tcp.PacketEncoder}.
 * OutboundHandler that writes Packet instances to a ByteBuffer.
 */
import { OutboundHandler } from '@helios/internal/networking/OutboundHandler';
import { HandlerStatus } from '@helios/internal/networking/HandlerStatus';
import { Packet } from '@helios/internal/nio/Packet';
import { PacketIOHelper } from '@helios/internal/nio/PacketIOHelper';
import { ByteBuffer } from '@helios/internal/networking/ByteBuffer';

const { CLEAN, DIRTY } = HandlerStatus;

export class PacketEncoder extends OutboundHandler<() => Packet | null, ByteBuffer> {
    private readonly _packetWriter = new PacketIOHelper();
    private _packet: Packet | null = null;

    onWrite(): HandlerStatus {
        // compact or clear: if buffer has remaining data, compact; otherwise clear.
        const dst = this._dst;
        if (dst.remaining() > 0) {
            dst.compact();
        } else {
            dst.clear();
        }

        try {
            for (;;) {
                if (this._packet === null) {
                    this._packet = this._src();
                    if (this._packet === null) {
                        return CLEAN;
                    }
                }

                if (this._packetWriter.writeTo(this._packet, dst)) {
                    this._packet = null;
                } else {
                    return DIRTY;
                }
            }
        } finally {
            dst.flip();
        }
    }
}
