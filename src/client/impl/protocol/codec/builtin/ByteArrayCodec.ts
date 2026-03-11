/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.builtin.ByteArrayCodec}.
 */
import { ClientMessage } from '../../ClientMessage';

export class ByteArrayCodec {
    private constructor() {}

    static encode(clientMessage: ClientMessage, value: Buffer): void {
        clientMessage.add(new ClientMessage.Frame(value));
    }

    static decode(iterator: ClientMessage.ForwardFrameIterator): Buffer {
        return iterator.next().content;
    }
}
