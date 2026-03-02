/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.builtin.ListUUIDCodec}.
 */
import { ClientMessage } from '@helios/client/impl/protocol/ClientMessage';
import { FixedSizeTypesCodec, UUID_SIZE_IN_BYTES } from './FixedSizeTypesCodec';

export class ListUUIDCodec {
    private constructor() {}

    static encode(clientMessage: ClientMessage, list: (string | null)[]): void {
        const buf = Buffer.allocUnsafe(list.length * UUID_SIZE_IN_BYTES);
        for (let i = 0; i < list.length; i++) {
            FixedSizeTypesCodec.encodeUUID(buf, i * UUID_SIZE_IN_BYTES, list[i]);
        }
        clientMessage.add(new ClientMessage.Frame(buf));
    }

    static decode(iterator: ClientMessage.ForwardFrameIterator): (string | null)[] {
        const frame = iterator.next();
        const count = frame.content.length / UUID_SIZE_IN_BYTES;
        const result: (string | null)[] = [];
        for (let i = 0; i < count; i++) {
            result.push(FixedSizeTypesCodec.decodeUUID(frame.content, i * UUID_SIZE_IN_BYTES));
        }
        return result;
    }
}
