/**
 * Port of {@code com.hazelcast.client.impl.protocol.util.ClientMessageDecoder}.
 *
 * InboundHandler<ByteBuffer, Consumer<ClientMessage>>
 * Handles fragmentation reassembly using a Map<bigint, ClientMessage>.
 */
import { ClientMessage } from '@zenystx/core/client/impl/protocol/ClientMessage';
import { ClientMessageReader } from '@zenystx/core/client/impl/protocol/ClientMessageReader';
import { ByteBuffer } from '@zenystx/core/internal/networking/ByteBuffer';
import { HandlerStatus } from '@zenystx/core/internal/networking/HandlerStatus';

export class ClientMessageDecoder {
    private readonly _reader: ClientMessageReader = new ClientMessageReader();
    private readonly _fragments = new Map<bigint, ClientMessage>();
    private _src: ByteBuffer | null = null;
    private _dst: ((msg: ClientMessage) => void) | null = null;

    src(src: ByteBuffer): this {
        this._src = src;
        return this;
    }

    dst(consumer: (msg: ClientMessage) => void): this {
        this._dst = consumer;
        return this;
    }

    onRead(): HandlerStatus {
        const src = this._src!;
        const consumer = this._dst!;

        while (src.hasRemaining()) {
            const done = this._reader.readFrom(src, true);
            if (!done) break;

            const msg = this._reader.getClientMessage();
            this._reader.reset();

            const startFrame = msg.getStartFrame();
            const flags = startFrame.flags;

            if (ClientMessage.isFlagSet(flags, ClientMessage.BEGIN_FRAGMENT_FLAG)) {
                // Start of a fragmented message; store it keyed by fragmentation ID
                const fragId = msg.getFragmentationId();
                // Strip the fragmentation header frame and store the rest
                startFrame.next; // skip
                // Store the message starting from the frame AFTER the fragmentation header
                const payloadStart = startFrame.next;
                if (payloadStart !== null) {
                    const payloadMsg = ClientMessage.createForDecode(payloadStart);
                    this._fragments.set(fragId, payloadMsg);
                }
            } else if (ClientMessage.isFlagSet(flags, ClientMessage.END_FRAGMENT_FLAG)) {
                // End of a fragmented message; merge and dispatch
                const fragId = msg.getFragmentationId();
                const existing = this._fragments.get(fragId);
                if (existing !== null && existing !== undefined) {
                    // Append frames from msg (after header frame) to existing
                    const payloadStart = startFrame.next;
                    if (payloadStart !== null) {
                        // Find end of existing
                        let lastFrame = existing.getStartFrame();
                        while (lastFrame.next !== null) lastFrame = lastFrame.next;
                        lastFrame.next = payloadStart;
                    }
                    this._fragments.delete(fragId);
                    consumer(existing);
                }
            } else if (!ClientMessage.isFlagSet(flags, ClientMessage.BEGIN_FRAGMENT_FLAG) &&
                       !ClientMessage.isFlagSet(flags, ClientMessage.END_FRAGMENT_FLAG)) {
                // Non-fragmented or continuation fragment
                const fragId = msg.getFragmentationId();
                if (fragId !== 0n && this._fragments.has(fragId)) {
                    // Continuation
                    const existing = this._fragments.get(fragId)!;
                    const payloadStart = startFrame.next;
                    if (payloadStart !== null) {
                        let lastFrame = existing.getStartFrame();
                        while (lastFrame.next !== null) lastFrame = lastFrame.next;
                        lastFrame.next = payloadStart;
                    }
                } else {
                    // Complete message
                    consumer(msg);
                }
            }
        }

        return HandlerStatus.CLEAN;
    }
}
