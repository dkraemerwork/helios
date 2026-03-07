/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.ClientGetDistributedObjectsCodec}.
 */
import { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage';
import { StringCodec } from './builtin/StringCodec';
import { INT_SIZE_IN_BYTES } from './builtin/FixedSizeTypesCodec';

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
        // Response header with count
        const headerSize = INT_SIZE_IN_BYTES + INT_SIZE_IN_BYTES; // messageType + count
        const initialFrame = Buffer.allocUnsafe(headerSize);
        initialFrame.fill(0);
        initialFrame.writeUInt32LE(ClientGetDistributedObjectsCodec.RESPONSE_MESSAGE_TYPE >>> 0, 0);
        initialFrame.writeInt32LE(objects.length, INT_SIZE_IN_BYTES);
        msg.add(new ClientMessage.Frame(initialFrame));

        for (const obj of objects) {
            StringCodec.encode(msg, obj.serviceName);
            StringCodec.encode(msg, obj.name);
        }

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
