/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.ClientDestroyProxyCodec}.
 */
import { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage';
import { INT_SIZE_IN_BYTES } from './builtin/FixedSizeTypesCodec';
import { StringCodec } from './builtin/StringCodec';

export class ClientDestroyProxyCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x000500;
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x000501;

    static readonly REQUEST_INITIAL_FRAME_SIZE = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;

    private constructor() {}

    static encodeRequest(name: string, serviceName: string): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(ClientDestroyProxyCodec.REQUEST_INITIAL_FRAME_SIZE);
        initialFrame.writeUInt32LE(ClientDestroyProxyCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET + 4);
        initialFrame.writeInt32LE(-1, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        msg.add(new ClientMessage.Frame(initialFrame));
        StringCodec.encode(msg, name);
        StringCodec.encode(msg, serviceName);
        msg.setFinal();
        return msg;
    }

    static decodeRequest(msg: ClientMessage): { name: string; serviceName: string } {
        const iter = msg.forwardFrameIterator();
        iter.next(); // skip initial
        const name = StringCodec.decode(iter);
        const serviceName = StringCodec.decode(iter);
        return { name, serviceName };
    }

    static encodeResponse(): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(ClientMessage.PARTITION_ID_FIELD_OFFSET);
        initialFrame.fill(0);
        initialFrame.writeUInt32LE(ClientDestroyProxyCodec.RESPONSE_MESSAGE_TYPE >>> 0, 0);
        msg.add(new ClientMessage.Frame(initialFrame));
        msg.setFinal();
        return msg;
    }
}
