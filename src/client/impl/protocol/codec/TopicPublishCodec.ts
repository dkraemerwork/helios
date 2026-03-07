/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.TopicPublishCodec}.
 */
import { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage';
import { DataCodec } from './builtin/DataCodec';
import { StringCodec } from './builtin/StringCodec';
import { INT_SIZE_IN_BYTES } from './builtin/FixedSizeTypesCodec';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';

export class TopicPublishCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x040100;
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x040101;

    static readonly REQUEST_INITIAL_FRAME_SIZE = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;

    private constructor() {}

    static encodeRequest(name: string, message: Data): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(TopicPublishCodec.REQUEST_INITIAL_FRAME_SIZE);
        initialFrame.writeUInt32LE(TopicPublishCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET + 4);
        initialFrame.writeInt32LE(0, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        msg.add(new ClientMessage.Frame(initialFrame));
        StringCodec.encode(msg, name);
        DataCodec.encode(msg, message);
        msg.setFinal();
        return msg;
    }

    static decodeRequest(msg: ClientMessage): { name: string; message: Data } {
        const iter = msg.forwardFrameIterator();
        iter.next(); // skip initial
        const name = StringCodec.decode(iter);
        const message = DataCodec.decode(iter);
        return { name, message };
    }

    static encodeResponse(): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(INT_SIZE_IN_BYTES);
        initialFrame.fill(0);
        initialFrame.writeUInt32LE(TopicPublishCodec.RESPONSE_MESSAGE_TYPE >>> 0, 0);
        msg.add(new ClientMessage.Frame(initialFrame));
        msg.setFinal();
        return msg;
    }
}
