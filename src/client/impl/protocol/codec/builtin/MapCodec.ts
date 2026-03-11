/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.builtin.MapCodec}.
 *
 * Encodes/decodes a Map<string, string>.
 */
import { ClientMessage } from '../../ClientMessage';
import { StringCodec } from './StringCodec';

export class MapCodec {
    private constructor() {}

    static encode(clientMessage: ClientMessage, map: Map<string, string> | null): void {
        if (map === null || map === undefined) {
            clientMessage.add(ClientMessage.Frame.createStaticFrame(ClientMessage.IS_NULL_FLAG));
            return;
        }
        clientMessage.add(ClientMessage.Frame.createStaticFrame(ClientMessage.BEGIN_DATA_STRUCTURE_FLAG));
        for (const [k, v] of map) {
            StringCodec.encode(clientMessage, k);
            StringCodec.encode(clientMessage, v);
        }
        clientMessage.add(ClientMessage.Frame.createStaticFrame(ClientMessage.END_DATA_STRUCTURE_FLAG));
    }

    static decode(iterator: ClientMessage.ForwardFrameIterator): Map<string, string> {
        const result = new Map<string, string>();
        const next = iterator.peekNext();
        if (next !== null && ClientMessage.isFlagSet(next.flags, ClientMessage.IS_NULL_FLAG)) {
            iterator.next();
            return result;
        }
        // consume BEGIN
        iterator.next();
        while (iterator.peekNext() !== null && !iterator.peekNext()!.isEndFrame()) {
            const key = StringCodec.decode(iterator);
            const value = StringCodec.decode(iterator);
            result.set(key, value);
        }
        // consume END
        iterator.next();
        return result;
    }
}
