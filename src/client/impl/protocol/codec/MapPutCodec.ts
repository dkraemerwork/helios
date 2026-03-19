/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.MapPutCodec}.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { SerializationServiceImpl } from '@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl';
import { ClientMessage } from '../ClientMessage';
import { DataCodec } from './builtin/DataCodec';
import { INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES } from './builtin/FixedSizeTypesCodec';
import { StringCodec } from './builtin/StringCodec';

export class MapPutCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x010100; // 65792
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x010101;

    // request initial frame: messageType(4) + correlationId(8) + partitionId(4) + threadId(8) + ttl(8) = 32
    // Actually the request initial frame layout (content, offset from 0):
    // [0..3]  messageType (written by setMessageType / header)
    // [4..11] correlationId (8 bytes)
    // [12..15] partitionId
    // [16..23] threadId (long)
    // [24..31] ttl (long)
    private static readonly REQUEST_THREAD_ID_OFFSET = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES; // 16
    private static readonly REQUEST_TTL_OFFSET = MapPutCodec.REQUEST_THREAD_ID_OFFSET + LONG_SIZE_IN_BYTES; // 24
    static readonly REQUEST_INITIAL_FRAME_SIZE = MapPutCodec.REQUEST_TTL_OFFSET + LONG_SIZE_IN_BYTES; // 32

    private constructor() {}

    static encodeRequest(
        name: string,
        key: Data,
        value: Data,
        threadId: bigint,
        ttl: bigint
    ): ClientMessage {
        const msg = ClientMessage.createForEncode();

        // initial frame
        const initialFrame = Buffer.allocUnsafe(MapPutCodec.REQUEST_INITIAL_FRAME_SIZE);
        initialFrame.writeUInt32LE(MapPutCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET); // correlationId lower
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET + 4); // correlationId upper
        initialFrame.writeInt32LE(0, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        initialFrame.writeBigInt64LE(threadId, MapPutCodec.REQUEST_THREAD_ID_OFFSET);
        initialFrame.writeBigInt64LE(ttl, MapPutCodec.REQUEST_TTL_OFFSET);
        msg.add(new ClientMessage.Frame(initialFrame));

        StringCodec.encode(msg, name);
        DataCodec.encode(msg, key);
        DataCodec.encode(msg, value);

        msg.setFinal();
        return msg;
    }

    static decodeRequest(msg: ClientMessage): {
        name: string;
        key: Data;
        value: Data;
        threadId: bigint;
        ttl: bigint;
    } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const threadId = initialFrame.content.readBigInt64LE(MapPutCodec.REQUEST_THREAD_ID_OFFSET);
        const ttl = initialFrame.content.readBigInt64LE(MapPutCodec.REQUEST_TTL_OFFSET);

        const name = StringCodec.decode(iter);
        const key = DataCodec.decode(iter);
        const value = DataCodec.decode(iter);

        return { name, key, value, threadId, ttl };
    }

    private static readonly RESPONSE_HEADER_SIZE = ClientMessage.RESPONSE_BACKUP_ACKS_FIELD_OFFSET + 1; // 13

    static encodeResponse(response: Data | null): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(MapPutCodec.RESPONSE_HEADER_SIZE);
        initialFrame.fill(0);
        initialFrame.writeUInt32LE(MapPutCodec.RESPONSE_MESSAGE_TYPE >>> 0, 0);
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
