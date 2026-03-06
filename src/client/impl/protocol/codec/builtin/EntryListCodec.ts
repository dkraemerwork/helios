/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.builtin.EntryListCodec}.
 */
import { ClientMessage } from '@zenystx/core/client/impl/protocol/ClientMessage';

export class EntryListCodec {
    private constructor() {}

    static encode<K, V>(
        clientMessage: ClientMessage,
        entries: Array<[K, V]>,
        encodeKey: (msg: ClientMessage, key: K) => void,
        encodeValue: (msg: ClientMessage, value: V) => void
    ): void {
        clientMessage.add(ClientMessage.Frame.createStaticFrame(ClientMessage.BEGIN_DATA_STRUCTURE_FLAG));
        for (const [key, value] of entries) {
            encodeKey(clientMessage, key);
            encodeValue(clientMessage, value);
        }
        clientMessage.add(ClientMessage.Frame.createStaticFrame(ClientMessage.END_DATA_STRUCTURE_FLAG));
    }

    static decode<K, V>(
        iterator: ClientMessage.ForwardFrameIterator,
        decodeKey: (iter: ClientMessage.ForwardFrameIterator) => K,
        decodeValue: (iter: ClientMessage.ForwardFrameIterator) => V
    ): Array<[K, V]> {
        const result: Array<[K, V]> = [];
        // consume BEGIN frame
        iterator.next();
        while (!iterator.peekNext()!.isEndFrame()) {
            const key = decodeKey(iterator);
            const value = decodeValue(iterator);
            result.push([key, value]);
        }
        // consume END frame
        iterator.next();
        return result;
    }
}
