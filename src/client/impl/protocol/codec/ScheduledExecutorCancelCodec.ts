/**
 * Client protocol codec for cancelling a scheduled task.
 *
 * Hazelcast parity: ScheduledExecutorCancelFromPartitionCodec (0x1A0900)
 */
import { ClientMessage } from '../ClientMessage';
import { BOOLEAN_SIZE_IN_BYTES, INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES } from './builtin/FixedSizeTypesCodec';
import { StringCodec } from './builtin/StringCodec';

export class ScheduledExecutorCancelCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x1A0900;
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x1A0901;

    // Initial frame: messageType(4) + correlationId(8) + partitionId(4) + targetPartitionId(4) + mayInterrupt(1) = 21
    private static readonly REQUEST_TARGET_PARTITION_OFFSET = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;
    private static readonly REQUEST_MAY_INTERRUPT_OFFSET = ScheduledExecutorCancelCodec.REQUEST_TARGET_PARTITION_OFFSET + INT_SIZE_IN_BYTES;
    static readonly REQUEST_INITIAL_FRAME_SIZE = ScheduledExecutorCancelCodec.REQUEST_MAY_INTERRUPT_OFFSET + BOOLEAN_SIZE_IN_BYTES;

    private constructor() {}

    static encodeRequest(
        schedulerName: string,
        taskName: string,
        partitionId: number,
        mayInterruptIfRunning: boolean,
    ): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(ScheduledExecutorCancelCodec.REQUEST_INITIAL_FRAME_SIZE);
        initialFrame.writeUInt32LE(ScheduledExecutorCancelCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET + 4);
        initialFrame.writeInt32LE(0, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        initialFrame.writeInt32LE(partitionId, ScheduledExecutorCancelCodec.REQUEST_TARGET_PARTITION_OFFSET);
        initialFrame.writeUInt8(mayInterruptIfRunning ? 1 : 0, ScheduledExecutorCancelCodec.REQUEST_MAY_INTERRUPT_OFFSET);
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
        mayInterruptIfRunning: boolean;
    } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const partitionId = initialFrame.content.readInt32LE(ScheduledExecutorCancelCodec.REQUEST_TARGET_PARTITION_OFFSET);
        const mayInterruptIfRunning = initialFrame.content.readUInt8(ScheduledExecutorCancelCodec.REQUEST_MAY_INTERRUPT_OFFSET) !== 0;

        const schedulerName = StringCodec.decode(iter);
        const taskName = StringCodec.decode(iter);

        return { schedulerName, taskName, partitionId, mayInterruptIfRunning };
    }

    // Response: boolean
    private static readonly RESPONSE_RESULT_OFFSET = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES; // after header
    static readonly RESPONSE_INITIAL_FRAME_SIZE = ScheduledExecutorCancelCodec.RESPONSE_RESULT_OFFSET + BOOLEAN_SIZE_IN_BYTES;

    static encodeResponse(result: boolean): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(ScheduledExecutorCancelCodec.RESPONSE_INITIAL_FRAME_SIZE);
        initialFrame.fill(0);
        initialFrame.writeUInt32LE(ScheduledExecutorCancelCodec.RESPONSE_MESSAGE_TYPE >>> 0, 0);
        initialFrame.writeUInt8(result ? 1 : 0, ScheduledExecutorCancelCodec.RESPONSE_RESULT_OFFSET);
        msg.add(new ClientMessage.Frame(initialFrame));
        msg.setFinal();
        return msg;
    }

    static decodeResponse(msg: ClientMessage): boolean {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        return initialFrame.content.readUInt8(ScheduledExecutorCancelCodec.RESPONSE_RESULT_OFFSET) !== 0;
    }
}
