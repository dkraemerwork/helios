/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.builtin.ListIntegerCodec}.
 */
import { ClientMessage } from '@zenystx/core/client/impl/protocol/ClientMessage';
import { INT_SIZE_IN_BYTES } from './FixedSizeTypesCodec';

export class ListIntegerCodec {
    private constructor() {}

    static encode(clientMessage: ClientMessage, list: number[]): void {
        const buf = Buffer.allocUnsafe(list.length * INT_SIZE_IN_BYTES);
        for (let i = 0; i < list.length; i++) {
            buf.writeInt32LE(list[i] | 0, i * INT_SIZE_IN_BYTES);
        }
        clientMessage.add(new ClientMessage.Frame(buf));
    }

    static decode(iterator: ClientMessage.ForwardFrameIterator): number[] {
        const frame = iterator.next();
        const count = frame.content.length / INT_SIZE_IN_BYTES;
        const result: number[] = [];
        for (let i = 0; i < count; i++) {
            result.push(frame.content.readInt32LE(i * INT_SIZE_IN_BYTES));
        }
        return result;
    }
}
