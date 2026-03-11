/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.QueueClearCodec}.
 */
import { ClientMessage } from '../ClientMessage';
import { INT_SIZE_IN_BYTES } from './builtin/FixedSizeTypesCodec';
import { StringCodec } from './builtin/StringCodec';

export class QueueClearCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x030f00;
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x030f01;

    static readonly REQUEST_INITIAL_FRAME_SIZE = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;
    static readonly RESPONSE_INITIAL_FRAME_SIZE = ClientMessage.RESPONSE_BACKUP_ACKS_FIELD_OFFSET + 1;

    private constructor() {}

    static encodeRequest(name: string): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(QueueClearCodec.REQUEST_INITIAL_FRAME_SIZE);
        initialFrame.writeUInt32LE(QueueClearCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
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

    static encodeResponse(): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(QueueClearCodec.RESPONSE_INITIAL_FRAME_SIZE);
        initialFrame.fill(0);
        initialFrame.writeUInt32LE(QueueClearCodec.RESPONSE_MESSAGE_TYPE >>> 0, 0);
        msg.add(new ClientMessage.Frame(initialFrame));
        msg.setFinal();
        return msg;
    }
}
