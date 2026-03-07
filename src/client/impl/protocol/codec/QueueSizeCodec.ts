/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.QueueSizeCodec}.
 */
import { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage';
import { StringCodec } from './builtin/StringCodec';
import { INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES } from './builtin/FixedSizeTypesCodec';

export class QueueSizeCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x030300;
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x030301;

    static readonly REQUEST_INITIAL_FRAME_SIZE = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;
    private static readonly RESPONSE_HEADER_SIZE = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES;
    private static readonly RESPONSE_SIZE_OFFSET = INT_SIZE_IN_BYTES;

    private constructor() {}

    static encodeRequest(name: string): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(QueueSizeCodec.REQUEST_INITIAL_FRAME_SIZE);
        initialFrame.writeUInt32LE(QueueSizeCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET + 4);
        initialFrame.writeInt32LE(0, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        msg.add(new ClientMessage.Frame(initialFrame));
        StringCodec.encode(msg, name);
        msg.setFinal();
        return msg;
    }

    static encodeResponse(size: number): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(QueueSizeCodec.RESPONSE_HEADER_SIZE);
        initialFrame.fill(0);
        initialFrame.writeUInt32LE(QueueSizeCodec.RESPONSE_MESSAGE_TYPE >>> 0, 0);
        initialFrame.writeInt32LE(size, QueueSizeCodec.RESPONSE_SIZE_OFFSET);
        msg.add(new ClientMessage.Frame(initialFrame));
        msg.setFinal();
        return msg;
    }

    static decodeResponse(msg: ClientMessage): number {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        return initialFrame.content.readInt32LE(QueueSizeCodec.RESPONSE_SIZE_OFFSET);
    }
}
