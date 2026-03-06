/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.builtin.EntryListUUIDListIntegerCodec}.
 */
import { ClientMessage } from '@zenystx/core/client/impl/protocol/ClientMessage';
import { ListMultiFrameCodec } from './ListMultiFrameCodec';
import { ListUUIDCodec } from './ListUUIDCodec';
import { ListIntegerCodec } from './ListIntegerCodec';

export class EntryListUUIDListIntegerCodec {
    private constructor() {}

    static encode(
        clientMessage: ClientMessage,
        entries: Array<[string | null, number[]]>
    ): void {
        const keys = entries.map(e => e[0]);
        const values = entries.map(e => e[1]);
        ListUUIDCodec.encode(clientMessage, keys);
        ListMultiFrameCodec.encode(clientMessage, values, (msg, v) => ListIntegerCodec.encode(msg, v));
    }

    static decode(
        iterator: ClientMessage.ForwardFrameIterator
    ): Array<[string | null, number[]]> {
        const keys = ListUUIDCodec.decode(iterator);
        const values = ListMultiFrameCodec.decode(iterator, iter => ListIntegerCodec.decode(iter));
        return keys.map((k, i) => [k, values[i]] as [string | null, number[]]);
    }
}
