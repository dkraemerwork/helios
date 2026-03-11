/**
 * Client protocol codec for shutting down a scheduled executor.
 *
 * Hazelcast parity: ScheduledExecutorShutdownCodec (0x1A0100)
 */
import { ClientMessage } from '../ClientMessage';
import { INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES } from './builtin/FixedSizeTypesCodec';
import { StringCodec } from './builtin/StringCodec';

export class ScheduledExecutorShutdownCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x1A0100;
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x1A0101;

    static readonly REQUEST_INITIAL_FRAME_SIZE = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;

    private constructor() {}

    static encodeRequest(schedulerName: string): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(ScheduledExecutorShutdownCodec.REQUEST_INITIAL_FRAME_SIZE);
        initialFrame.writeUInt32LE(ScheduledExecutorShutdownCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET + 4);
        initialFrame.writeInt32LE(0, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        msg.add(new ClientMessage.Frame(initialFrame));

        StringCodec.encode(msg, schedulerName);

        msg.setFinal();
        return msg;
    }

    static decodeRequest(msg: ClientMessage): { schedulerName: string } {
        const iter = msg.forwardFrameIterator();
        iter.next(); // skip initial frame
        const schedulerName = StringCodec.decode(iter);
        return { schedulerName };
    }

    static encodeResponse(): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        initialFrame.fill(0);
        initialFrame.writeUInt32LE(ScheduledExecutorShutdownCodec.RESPONSE_MESSAGE_TYPE >>> 0, 0);
        msg.add(new ClientMessage.Frame(initialFrame));
        msg.setFinal();
        return msg;
    }
}
