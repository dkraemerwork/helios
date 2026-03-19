/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.builtin.DataCodec}.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { HeapData } from '@zenystx/helios-core/internal/serialization/impl/HeapData';
import { ClientMessage } from '../../ClientMessage';

export class DataCodec {
    private constructor() {}

    static encode(clientMessage: ClientMessage, data: Data): void {
        const buf = data.toByteArray();
        if (buf === null) {
            clientMessage.add(new ClientMessage.Frame(Buffer.alloc(0)));
        } else {
            clientMessage.add(new ClientMessage.Frame(Buffer.from(buf)));
        }
    }

    static decode(iterator: ClientMessage.ForwardFrameIterator): Data {
        const frame = iterator.next();
        return new HeapData(frame.content.length === 0 ? null : frame.content);
    }
}
