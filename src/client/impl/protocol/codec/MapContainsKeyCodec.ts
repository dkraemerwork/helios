/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.MapContainsKeyCodec}.
 */
import { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage';
import { DataCodec } from './builtin/DataCodec';
import { StringCodec } from './builtin/StringCodec';
import { INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES, BOOLEAN_SIZE_IN_BYTES } from './builtin/FixedSizeTypesCodec';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';

export class MapContainsKeyCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x010500;
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x010501;

    private static readonly REQUEST_THREAD_ID_OFFSET = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;
    static readonly REQUEST_INITIAL_FRAME_SIZE = MapContainsKeyCodec.REQUEST_THREAD_ID_OFFSET + LONG_SIZE_IN_BYTES;
    private static readonly RESPONSE_HEADER_SIZE = ClientMessage.PARTITION_ID_FIELD_OFFSET + BOOLEAN_SIZE_IN_BYTES;
    private static readonly RESPONSE_RESULT_OFFSET = ClientMessage.PARTITION_ID_FIELD_OFFSET;

    private constructor() {}

    static encodeRequest(name: string, key: Data, threadId: bigint): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(MapContainsKeyCodec.REQUEST_INITIAL_FRAME_SIZE);
        initialFrame.writeUInt32LE(MapContainsKeyCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET + 4);
        initialFrame.writeInt32LE(0, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        initialFrame.writeBigInt64LE(threadId, MapContainsKeyCodec.REQUEST_THREAD_ID_OFFSET);
        msg.add(new ClientMessage.Frame(initialFrame));
        StringCodec.encode(msg, name);
        DataCodec.encode(msg, key);
        msg.setFinal();
        return msg;
    }

    static decodeRequest(msg: ClientMessage): { name: string; key: Data; threadId: bigint } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const threadId = initialFrame.content.readBigInt64LE(MapContainsKeyCodec.REQUEST_THREAD_ID_OFFSET);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        return { name, key, threadId };
    }

    static encodeResponse(result: boolean): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(MapContainsKeyCodec.RESPONSE_HEADER_SIZE);
        initialFrame.fill(0);
        initialFrame.writeUInt32LE(MapContainsKeyCodec.RESPONSE_MESSAGE_TYPE >>> 0, 0);
        initialFrame.writeUInt8(result ? 1 : 0, MapContainsKeyCodec.RESPONSE_RESULT_OFFSET);
        msg.add(new ClientMessage.Frame(initialFrame));
        msg.setFinal();
        return msg;
    }

    static decodeResponse(msg: ClientMessage): boolean {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        return initialFrame.content.readUInt8(MapContainsKeyCodec.RESPONSE_RESULT_OFFSET) !== 0;
    }
}
