/**
 * Port of {@code com.hazelcast.client.impl.protocol.codec.QueueRemoveCodec}.
 * Opcode: 0x030400
 */
import { ClientMessage } from '../ClientMessage';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { DataCodec } from './builtin/DataCodec';
import { BOOLEAN_SIZE_IN_BYTES, INT_SIZE_IN_BYTES } from './builtin/FixedSizeTypesCodec';
import { StringCodec } from './builtin/StringCodec';

export class QueueRemoveCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x030400;
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x030401;

    static readonly REQUEST_INITIAL_FRAME_SIZE = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;

    private static readonly RESPONSE_RESULT_OFFSET = ClientMessage.RESPONSE_BACKUP_ACKS_FIELD_OFFSET + 1;
    private static readonly RESPONSE_HEADER_SIZE = QueueRemoveCodec.RESPONSE_RESULT_OFFSET + BOOLEAN_SIZE_IN_BYTES;

    private constructor() {}

    static encodeRequest(name: string, value: Data): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(QueueRemoveCodec.REQUEST_INITIAL_FRAME_SIZE);
        initialFrame.writeUInt32LE(QueueRemoveCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET + 4);
        initialFrame.writeInt32LE(0, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        msg.add(new ClientMessage.Frame(initialFrame));
        StringCodec.encode(msg, name);
        DataCodec.encode(msg, value);
        msg.setFinal();
        return msg;
    }

    static decodeRequest(msg: ClientMessage): { name: string; value: Data } {
        const iter = msg.forwardFrameIterator();
        iter.next(); // skip initial frame
        const name = StringCodec.decode(iter);
        const value = DataCodec.decode(iter);
        return { name, value };
    }

    static encodeResponse(result: boolean): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(QueueRemoveCodec.RESPONSE_HEADER_SIZE);
        initialFrame.fill(0);
        initialFrame.writeUInt32LE(QueueRemoveCodec.RESPONSE_MESSAGE_TYPE >>> 0, 0);
        initialFrame.writeUInt8(result ? 1 : 0, QueueRemoveCodec.RESPONSE_RESULT_OFFSET);
        msg.add(new ClientMessage.Frame(initialFrame));
        msg.setFinal();
        return msg;
    }

    static decodeResponse(msg: ClientMessage): boolean {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        return initialFrame.content.readUInt8(QueueRemoveCodec.RESPONSE_RESULT_OFFSET) !== 0;
    }
}
