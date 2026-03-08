/**
 * Client protocol codec for disposing a scheduled task.
 *
 * Hazelcast parity: ScheduledExecutorDisposeFromPartitionCodec (0x1A1100)
 */
import { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage';
import { INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES } from './builtin/FixedSizeTypesCodec';
import { StringCodec } from './builtin/StringCodec';

export class ScheduledExecutorDisposeCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x1A1100;
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x1A1101;

    private static readonly REQUEST_TARGET_PARTITION_OFFSET = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;
    static readonly REQUEST_INITIAL_FRAME_SIZE = ScheduledExecutorDisposeCodec.REQUEST_TARGET_PARTITION_OFFSET + INT_SIZE_IN_BYTES;

    private constructor() {}

    static encodeRequest(
        schedulerName: string,
        taskName: string,
        partitionId: number,
    ): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(ScheduledExecutorDisposeCodec.REQUEST_INITIAL_FRAME_SIZE);
        initialFrame.writeUInt32LE(ScheduledExecutorDisposeCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET + 4);
        initialFrame.writeInt32LE(0, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        initialFrame.writeInt32LE(partitionId, ScheduledExecutorDisposeCodec.REQUEST_TARGET_PARTITION_OFFSET);
        msg.add(new ClientMessage.Frame(initialFrame));

        StringCodec.encode(msg, schedulerName);
        StringCodec.encode(msg, taskName);

        msg.setFinal();
        return msg;
    }

    static decodeRequest(msg: ClientMessage): {
        schedulerName: string;
        taskName: string;
        partitionId: number;
    } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const partitionId = initialFrame.content.readInt32LE(ScheduledExecutorDisposeCodec.REQUEST_TARGET_PARTITION_OFFSET);

        const schedulerName = StringCodec.decode(iter);
        const taskName = StringCodec.decode(iter);

        return { schedulerName, taskName, partitionId };
    }

    static encodeResponse(): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        initialFrame.fill(0);
        initialFrame.writeUInt32LE(ScheduledExecutorDisposeCodec.RESPONSE_MESSAGE_TYPE >>> 0, 0);
        msg.add(new ClientMessage.Frame(initialFrame));
        msg.setFinal();
        return msg;
    }
}
