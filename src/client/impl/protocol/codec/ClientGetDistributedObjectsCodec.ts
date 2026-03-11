/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.ClientGetDistributedObjectsCodec}.
 */
import { ClientMessage } from '../ClientMessage';
import { INT_SIZE_IN_BYTES } from './builtin/FixedSizeTypesCodec';
import { ListMultiFrameCodec } from './builtin/ListMultiFrameCodec';
import { StringCodec } from './builtin/StringCodec';

export interface DistributedObjectInfo {
    serviceName: string;
    name: string;
}

export class ClientGetDistributedObjectsCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x000800;
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x000801;

    static readonly REQUEST_INITIAL_FRAME_SIZE = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;

    private constructor() {}

    static encodeRequest(): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(ClientGetDistributedObjectsCodec.REQUEST_INITIAL_FRAME_SIZE);
        initialFrame.writeUInt32LE(ClientGetDistributedObjectsCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET + 4);
        initialFrame.writeInt32LE(-1, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        msg.add(new ClientMessage.Frame(initialFrame));
        msg.setFinal();
        return msg;
    }

    static encodeResponse(objects: DistributedObjectInfo[]): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(ClientMessage.RESPONSE_BACKUP_ACKS_FIELD_OFFSET + 1);
        initialFrame.fill(0);
        initialFrame.writeUInt32LE(ClientGetDistributedObjectsCodec.RESPONSE_MESSAGE_TYPE >>> 0, 0);
        msg.add(new ClientMessage.Frame(initialFrame));

        ListMultiFrameCodec.encode(msg, objects, (clientMessage, obj) => {
            clientMessage.add(new ClientMessage.Frame(Buffer.alloc(0), ClientMessage.BEGIN_DATA_STRUCTURE_FLAG));
            StringCodec.encode(clientMessage, obj.serviceName);
            StringCodec.encode(clientMessage, obj.name);
            clientMessage.add(new ClientMessage.Frame(Buffer.alloc(0), ClientMessage.END_DATA_STRUCTURE_FLAG));
        });

        msg.setFinal();
        return msg;
    }

    static decodeResponse(msg: ClientMessage): DistributedObjectInfo[] {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const count = initialFrame.content.readInt32LE(INT_SIZE_IN_BYTES);
        const result: DistributedObjectInfo[] = [];

        for (let i = 0; i < count; i++) {
            const serviceName = StringCodec.decode(iter);
            const name = StringCodec.decode(iter);
            result.push({ serviceName, name });
        }

        return result;
    }
}
