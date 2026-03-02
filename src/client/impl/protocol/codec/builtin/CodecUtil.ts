/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.builtin.CodecUtil}.
 */
import { ClientMessage } from '@helios/client/impl/protocol/ClientMessage';

export class CodecUtil {
    private constructor() {}

    static fastForwardToEndFrame(iterator: ClientMessage.ForwardFrameIterator): void {
        let depth = 1;
        while (iterator.hasNext()) {
            const frame = iterator.next();
            if (ClientMessage.isFlagSet(frame.flags, ClientMessage.END_DATA_STRUCTURE_FLAG)) {
                depth--;
                if (depth === 0) return;
            } else if (ClientMessage.isFlagSet(frame.flags, ClientMessage.BEGIN_DATA_STRUCTURE_FLAG)) {
                depth++;
            }
        }
    }

    static encodeNullable<T>(
        clientMessage: ClientMessage,
        value: T | null,
        encoder: (msg: ClientMessage, v: T) => void
    ): void {
        if (value === null || value === undefined) {
            clientMessage.add(ClientMessage.Frame.createStaticFrame(ClientMessage.IS_NULL_FLAG));
        } else {
            encoder(clientMessage, value);
        }
    }

    static decodeNullable<T>(
        iterator: ClientMessage.ForwardFrameIterator,
        decoder: (iter: ClientMessage.ForwardFrameIterator) => T
    ): T | null {
        const nextFrame = iterator.peekNext();
        if (nextFrame !== null && ClientMessage.isFlagSet(nextFrame.flags, ClientMessage.IS_NULL_FLAG)) {
            iterator.next(); // consume null frame
            return null;
        }
        return decoder(iterator);
    }
}
