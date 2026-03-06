/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.builtin.StringCodec}.
 */
import { ClientMessage } from '@zenystx/core/client/impl/protocol/ClientMessage';

export class StringCodec {
    private constructor() {}

    static encode(clientMessage: ClientMessage, value: string): void {
        clientMessage.add(new ClientMessage.Frame(Buffer.from(value, 'utf8')));
    }

    static decode(iterator: ClientMessage.ForwardFrameIterator): string {
        return iterator.next().content.toString('utf8');
    }
}
