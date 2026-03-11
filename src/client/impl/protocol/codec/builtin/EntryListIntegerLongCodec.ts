/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.builtin.EntryListIntegerLongCodec}.
 */
import { ClientMessage } from '../../ClientMessage';
import { FixedSizeTypesCodec, INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES } from './FixedSizeTypesCodec';

const ENTRY_SIZE_IN_BYTES = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES; // 12

export class EntryListIntegerLongCodec {
    private constructor() {}

    static encode(clientMessage: ClientMessage, entries: Array<[number, bigint]>): void {
        const buf = Buffer.allocUnsafe(entries.length * ENTRY_SIZE_IN_BYTES);
        for (let i = 0; i < entries.length; i++) {
            FixedSizeTypesCodec.encodeInt(buf, i * ENTRY_SIZE_IN_BYTES, entries[i][0]);
            FixedSizeTypesCodec.encodeLong(buf, i * ENTRY_SIZE_IN_BYTES + INT_SIZE_IN_BYTES, entries[i][1]);
        }
        clientMessage.add(new ClientMessage.Frame(buf));
    }

    static decode(iterator: ClientMessage.ForwardFrameIterator): Array<[number, bigint]> {
        const frame = iterator.next();
        const count = frame.content.length / ENTRY_SIZE_IN_BYTES;
        const result: Array<[number, bigint]> = [];
        for (let i = 0; i < count; i++) {
            const key = FixedSizeTypesCodec.decodeInt(frame.content, i * ENTRY_SIZE_IN_BYTES);
            const value = FixedSizeTypesCodec.decodeLong(frame.content, i * ENTRY_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
            result.push([key, value]);
        }
        return result;
    }
}
