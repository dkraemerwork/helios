/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.QueuePeekCodec}.
 */
import { ClientMessage } from '../ClientMessage';
import type { SerializationServiceImpl } from '@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl';
import { DataCodec } from './builtin/DataCodec';
import { INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES } from './builtin/FixedSizeTypesCodec';
import { StringCodec } from './builtin/StringCodec';

export class QueuePeekCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x030700;
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x030701;

    static readonly REQUEST_INITIAL_FRAME_SIZE = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;
    private static readonly RESPONSE_HEADER_SIZE = ClientMessage.RESPONSE_BACKUP_ACKS_FIELD_OFFSET + 1;

    private constructor() {}

    static encodeRequest(name: string): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(QueuePeekCodec.REQUEST_INITIAL_FRAME_SIZE);
        initialFrame.writeUInt32LE(QueuePeekCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET + 4);
        initialFrame.writeInt32LE(0, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        msg.add(new ClientMessage.Frame(initialFrame));
        StringCodec.encode(msg, name);
        msg.setFinal();
        return msg;
    }

    static decodeRequest(msg: ClientMessage): { name: string } {
        const iter = msg.forwardFrameIterator();
        iter.next(); // skip initial
        const name = StringCodec.decode(iter);
        return { name };
    }

    static encodeResponse(response: import('@zenystx/helios-core/internal/serialization/Data').Data | null): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(QueuePeekCodec.RESPONSE_HEADER_SIZE);
        initialFrame.fill(0);
        initialFrame.writeUInt32LE(QueuePeekCodec.RESPONSE_MESSAGE_TYPE >>> 0, 0);
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
