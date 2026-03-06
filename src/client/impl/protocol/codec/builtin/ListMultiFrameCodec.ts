/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.builtin.ListMultiFrameCodec}.
 */
import { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage';

export class ListMultiFrameCodec {
    private constructor() {}

    static encode<T>(
        clientMessage: ClientMessage,
        list: T[],
        encoder: (msg: ClientMessage, item: T) => void
    ): void {
        clientMessage.add(ClientMessage.Frame.createStaticFrame(ClientMessage.BEGIN_DATA_STRUCTURE_FLAG));
        for (const item of list) {
            encoder(clientMessage, item);
        }
        clientMessage.add(ClientMessage.Frame.createStaticFrame(ClientMessage.END_DATA_STRUCTURE_FLAG));
    }

    static encodeNullable<T>(
        clientMessage: ClientMessage,
        list: T[] | null,
        encoder: (msg: ClientMessage, item: T) => void
    ): void {
        if (list === null || list === undefined) {
            clientMessage.add(ClientMessage.Frame.createStaticFrame(ClientMessage.IS_NULL_FLAG));
        } else {
            ListMultiFrameCodec.encode(clientMessage, list, encoder);
        }
    }

    static decode<T>(
        iterator: ClientMessage.ForwardFrameIterator,
        decoder: (iter: ClientMessage.ForwardFrameIterator) => T
    ): T[] {
        const result: T[] = [];
        // consume BEGIN frame
        iterator.next();
        while (!iterator.peekNext()!.isEndFrame()) {
            result.push(decoder(iterator));
        }
        // consume END frame
        iterator.next();
        return result;
    }

    static decodeNullable<T>(
        iterator: ClientMessage.ForwardFrameIterator,
        decoder: (iter: ClientMessage.ForwardFrameIterator) => T
    ): T[] | null {
        const next = iterator.peekNext();
        if (next !== null && ClientMessage.isFlagSet(next.flags, ClientMessage.IS_NULL_FLAG)) {
            iterator.next();
            return null;
        }
        return ListMultiFrameCodec.decode(iterator, decoder);
    }
}
