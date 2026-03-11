/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.MapSetCodec}.
 */
import { ClientMessage } from '../ClientMessage';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { DataCodec } from './builtin/DataCodec';
import { INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES } from './builtin/FixedSizeTypesCodec';
import { StringCodec } from './builtin/StringCodec';

export class MapSetCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x010800;
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x010801;
    static readonly RESPONSE_INITIAL_FRAME_SIZE = ClientMessage.RESPONSE_BACKUP_ACKS_FIELD_OFFSET + 1;

    private static readonly REQUEST_THREAD_ID_OFFSET = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;
    private static readonly REQUEST_TTL_OFFSET = MapSetCodec.REQUEST_THREAD_ID_OFFSET + LONG_SIZE_IN_BYTES;
    static readonly REQUEST_INITIAL_FRAME_SIZE = MapSetCodec.REQUEST_TTL_OFFSET + LONG_SIZE_IN_BYTES;

    private constructor() {}

    static encodeRequest(name: string, key: Data, value: Data, threadId: bigint, ttl: bigint): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(MapSetCodec.REQUEST_INITIAL_FRAME_SIZE);
        initialFrame.writeUInt32LE(MapSetCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET + 4);
        initialFrame.writeInt32LE(0, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        initialFrame.writeBigInt64LE(threadId, MapSetCodec.REQUEST_THREAD_ID_OFFSET);
        initialFrame.writeBigInt64LE(ttl, MapSetCodec.REQUEST_TTL_OFFSET);
        msg.add(new ClientMessage.Frame(initialFrame));
        StringCodec.encode(msg, name);
        DataCodec.encode(msg, key);
        DataCodec.encode(msg, value);
        msg.setFinal();
        return msg;
    }

    static decodeRequest(msg: ClientMessage): { name: string; key: Data; value: Data; threadId: bigint; ttl: bigint } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const threadId = initialFrame.content.readBigInt64LE(MapSetCodec.REQUEST_THREAD_ID_OFFSET);
        const ttl = initialFrame.content.readBigInt64LE(MapSetCodec.REQUEST_TTL_OFFSET);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);
        return { name, key, value, threadId, ttl };
    }

    static encodeResponse(): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(MapSetCodec.RESPONSE_INITIAL_FRAME_SIZE);
        initialFrame.fill(0);
        initialFrame.writeUInt32LE(MapSetCodec.RESPONSE_MESSAGE_TYPE >>> 0, 0);
        msg.add(new ClientMessage.Frame(initialFrame));
        msg.setFinal();
        return msg;
    }
}
