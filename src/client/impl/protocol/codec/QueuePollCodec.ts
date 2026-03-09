/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.QueuePollCodec}.
 */
import { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage';
import type { SerializationServiceImpl } from '@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl';
import { DataCodec } from './builtin/DataCodec';
import { INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES } from './builtin/FixedSizeTypesCodec';
import { StringCodec } from './builtin/StringCodec';

export class QueuePollCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x030500;
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x030501;

    private static readonly REQUEST_TIMEOUT_OFFSET = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;
    static readonly REQUEST_INITIAL_FRAME_SIZE = QueuePollCodec.REQUEST_TIMEOUT_OFFSET + LONG_SIZE_IN_BYTES;
    private static readonly RESPONSE_HEADER_SIZE = ClientMessage.RESPONSE_BACKUP_ACKS_FIELD_OFFSET + 1;

    private constructor() {}

    static encodeRequest(name: string, timeoutMs: bigint): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(QueuePollCodec.REQUEST_INITIAL_FRAME_SIZE);
        initialFrame.writeUInt32LE(QueuePollCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET + 4);
        initialFrame.writeInt32LE(0, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        initialFrame.writeBigInt64LE(timeoutMs, QueuePollCodec.REQUEST_TIMEOUT_OFFSET);
        msg.add(new ClientMessage.Frame(initialFrame));
        StringCodec.encode(msg, name);
        msg.setFinal();
        return msg;
    }

    static decodeRequest(msg: ClientMessage): { name: string; timeoutMs: bigint } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const timeoutMs = initialFrame.content.readBigInt64LE(QueuePollCodec.REQUEST_TIMEOUT_OFFSET);
        const name = StringCodec.decode(iter);
        return { name, timeoutMs };
    }

    static encodeResponse(response: import('@zenystx/helios-core/internal/serialization/Data').Data | null): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(QueuePollCodec.RESPONSE_HEADER_SIZE);
        initialFrame.fill(0);
        initialFrame.writeUInt32LE(QueuePollCodec.RESPONSE_MESSAGE_TYPE >>> 0, 0);
        msg.add(new ClientMessage.Frame(initialFrame));
        if (response === null) {
            msg.add(ClientMessage.Frame.createStaticFrame(ClientMessage.IS_NULL_FLAG));
        } else {
            DataCodec.encode(msg, response);
        }
        msg.setFinal();
        return msg;
    }

    static decodeResponseValue<E>(msg: ClientMessage, serializationService: SerializationServiceImpl): E | null {
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
