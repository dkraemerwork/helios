/**
 * Port of {@code com.hazelcast.client.impl.protocol.util.ClientMessageEncoder}.
 *
 * OutboundHandler<Supplier<ClientMessage>, ByteBuffer>
 */
import { ByteBuffer } from '@zenystx/helios-core/internal/networking/ByteBuffer';
import { HandlerStatus } from '@zenystx/helios-core/internal/networking/HandlerStatus';
import { ClientMessage } from '../ClientMessage';
import { ClientMessageWriter } from '../ClientMessageWriter';

export class ClientMessageEncoder {
    private readonly _writer: ClientMessageWriter = new ClientMessageWriter();
    private _currentMessage: ClientMessage | null = null;
    private _src: (() => ClientMessage | null) | null = null;
    private _dst: ByteBuffer | null = null;

    src(supplier: () => ClientMessage | null): this {
        this._src = supplier;
        return this;
    }

    dst(dst: ByteBuffer): this {
        this._dst = dst;
        return this;
    }

    onWrite(): HandlerStatus {
        const dst = this._dst!;
        ByteBuffer.compactOrClear(dst);

        // eslint-disable-next-line no-constant-condition
        while (true) {
            if (this._currentMessage === null) {
                this._currentMessage = this._src!();
                if (this._currentMessage === null) {
                    dst.flip();
                    return HandlerStatus.CLEAN;
                }
            }

            const done = this._writer.writeTo(dst, this._currentMessage);
            if (done) {
                this._currentMessage = null;
                this._writer.reset();
            } else {
                dst.flip();
                return HandlerStatus.DIRTY;
            }
        }
    }
}
