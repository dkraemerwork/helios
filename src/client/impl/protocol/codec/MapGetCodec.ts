/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.MapGetCodec}.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { SerializationServiceImpl } from '@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl';
import { ClientMessage } from '../ClientMessage';
import { DataCodec } from './builtin/DataCodec';
import { INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES } from './builtin/FixedSizeTypesCodec';
import { StringCodec } from './builtin/StringCodec';

export class MapGetCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x010200;
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x010201;

    private static readonly REQUEST_THREAD_ID_OFFSET = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;
    static readonly REQUEST_INITIAL_FRAME_SIZE = MapGetCodec.REQUEST_THREAD_ID_OFFSET + LONG_SIZE_IN_BYTES;

    private static readonly RESPONSE_HEADER_SIZE = ClientMessage.RESPONSE_BACKUP_ACKS_FIELD_OFFSET + 1;

    private constructor() {}

    static encodeRequest(name: string, key: Data, threadId: bigint): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(MapGetCodec.REQUEST_INITIAL_FRAME_SIZE);
        initialFrame.writeUInt32LE(MapGetCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET + 4);
        initialFrame.writeInt32LE(0, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        initialFrame.writeBigInt64LE(threadId, MapGetCodec.REQUEST_THREAD_ID_OFFSET);
        msg.add(new ClientMessage.Frame(initialFrame));
        StringCodec.encode(msg, name);
        DataCodec.encode(msg, key);
        msg.setFinal();
        return msg;
    }

    static decodeRequest(msg: ClientMessage): { name: string; key: Data; threadId: bigint } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const threadId = initialFrame.content.readBigInt64LE(MapGetCodec.REQUEST_THREAD_ID_OFFSET);
        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        return { name, key, threadId };
    }

    static encodeResponse(response: Data | null): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(MapGetCodec.RESPONSE_HEADER_SIZE);
        initialFrame.fill(0);
        initialFrame.writeUInt32LE(MapGetCodec.RESPONSE_MESSAGE_TYPE >>> 0, 0);
        msg.add(new ClientMessage.Frame(initialFrame));
        if (response === null) {
            msg.add(ClientMessage.Frame.createStaticFrame(ClientMessage.IS_NULL_FLAG));
        } else {
            DataCodec.encode(msg, response);
        }
        msg.setFinal();
        return msg;
    }

    static decodeResponseValue<V>(msg: ClientMessage, serializationService: SerializationServiceImpl): V | null {
        const iter = msg.forwardFrameIterator();
        iter.next(); // skip initial frame
        if (!iter.hasNext()) return null;
        const frame = iter.peekNext();
        if (frame && frame.isNullFrame()) return null;
        const data = DataCodec.decode(iter);
        if (data.toByteArray() === null || data.totalSize() === 0) return null;
        return serializationService.toObject(data);
    }
}
