/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.builtin.ListLongCodec}.
 */
import { ClientMessage } from '@zenystx/core/client/impl/protocol/ClientMessage';
import { FixedSizeTypesCodec, LONG_SIZE_IN_BYTES } from './FixedSizeTypesCodec';

export class ListLongCodec {
    private constructor() {}

    static encode(clientMessage: ClientMessage, list: bigint[]): void {
        const buf = Buffer.allocUnsafe(list.length * LONG_SIZE_IN_BYTES);
        for (let i = 0; i < list.length; i++) {
            FixedSizeTypesCodec.encodeLong(buf, i * LONG_SIZE_IN_BYTES, list[i]);
        }
        clientMessage.add(new ClientMessage.Frame(buf));
    }

    static decode(iterator: ClientMessage.ForwardFrameIterator): bigint[] {
        return ListLongCodec.decodeFrame(iterator.next());
    }

    static decodeFrame(frame: ClientMessage.Frame): bigint[] {
        const count = frame.content.length / LONG_SIZE_IN_BYTES;
        const result: bigint[] = [];
        for (let i = 0; i < count; i++) {
            result.push(FixedSizeTypesCodec.decodeLong(frame.content, i * LONG_SIZE_IN_BYTES));
        }
        return result;
    }
}
