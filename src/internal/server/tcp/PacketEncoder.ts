/**
 * Port of {@code com.hazelcast.internal.server.tcp.PacketEncoder}.
 * OutboundHandler that writes Packet instances to a ByteBuffer.
 */
import { ByteBuffer } from '@zenystx/helios-core/internal/networking/ByteBuffer';
import { HandlerStatus } from '@zenystx/helios-core/internal/networking/HandlerStatus';
import { OutboundHandler } from '@zenystx/helios-core/internal/networking/OutboundHandler';
import { Packet } from '@zenystx/helios-core/internal/nio/Packet';
import { PacketIOHelper } from '@zenystx/helios-core/internal/nio/PacketIOHelper';

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
