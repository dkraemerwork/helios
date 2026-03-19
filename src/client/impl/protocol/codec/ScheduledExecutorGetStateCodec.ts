/**
 * Client protocol codec for getting scheduled task state (isDone, isCancelled, delay).
 *
 * Hazelcast parity: combines IsDone/IsCancelled/GetDelay codecs into a single request.
 */
import { ClientMessage } from '../ClientMessage';
import { BOOLEAN_SIZE_IN_BYTES, INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES } from './builtin/FixedSizeTypesCodec';
import { StringCodec } from './builtin/StringCodec';

export class ScheduledExecutorGetStateCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x1A0D00;
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x1A0D01;

    private static readonly REQUEST_TARGET_PARTITION_OFFSET = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;
    static readonly REQUEST_INITIAL_FRAME_SIZE = ScheduledExecutorGetStateCodec.REQUEST_TARGET_PARTITION_OFFSET + INT_SIZE_IN_BYTES;

    private constructor() {}

    static encodeRequest(schedulerName: string, taskName: string, partitionId: number): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(ScheduledExecutorGetStateCodec.REQUEST_INITIAL_FRAME_SIZE);
        initialFrame.writeUInt32LE(ScheduledExecutorGetStateCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET + 4);
        initialFrame.writeInt32LE(0, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        initialFrame.writeInt32LE(partitionId, ScheduledExecutorGetStateCodec.REQUEST_TARGET_PARTITION_OFFSET);
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
        const partitionId = initialFrame.content.readInt32LE(ScheduledExecutorGetStateCodec.REQUEST_TARGET_PARTITION_OFFSET);

        const schedulerName = StringCodec.decode(iter);
        const taskName = StringCodec.decode(iter);

        return { schedulerName, taskName, partitionId };
    }

    // Response: isDone(1) + isCancelled(1) + delayMs(8)
    private static readonly RESPONSE_IS_DONE_OFFSET = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES;
    private static readonly RESPONSE_IS_CANCELLED_OFFSET = ScheduledExecutorGetStateCodec.RESPONSE_IS_DONE_OFFSET + BOOLEAN_SIZE_IN_BYTES;
    private static readonly RESPONSE_DELAY_OFFSET = ScheduledExecutorGetStateCodec.RESPONSE_IS_CANCELLED_OFFSET + BOOLEAN_SIZE_IN_BYTES;
    static readonly RESPONSE_INITIAL_FRAME_SIZE = ScheduledExecutorGetStateCodec.RESPONSE_DELAY_OFFSET + LONG_SIZE_IN_BYTES;

    static encodeResponse(isDone: boolean, isCancelled: boolean, delayMs: number): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(ScheduledExecutorGetStateCodec.RESPONSE_INITIAL_FRAME_SIZE);
        initialFrame.fill(0);
        initialFrame.writeUInt32LE(ScheduledExecutorGetStateCodec.RESPONSE_MESSAGE_TYPE >>> 0, 0);
        initialFrame.writeUInt8(isDone ? 1 : 0, ScheduledExecutorGetStateCodec.RESPONSE_IS_DONE_OFFSET);
        initialFrame.writeUInt8(isCancelled ? 1 : 0, ScheduledExecutorGetStateCodec.RESPONSE_IS_CANCELLED_OFFSET);
        initialFrame.writeBigInt64LE(BigInt(delayMs), ScheduledExecutorGetStateCodec.RESPONSE_DELAY_OFFSET);
        msg.add(new ClientMessage.Frame(initialFrame));
        msg.setFinal();
        return msg;
    }

    static decodeResponse(msg: ClientMessage): {
        isDone: boolean;
        isCancelled: boolean;
        delayMs: number;
    } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        return {
            isDone: initialFrame.content.readUInt8(ScheduledExecutorGetStateCodec.RESPONSE_IS_DONE_OFFSET) !== 0,
            isCancelled: initialFrame.content.readUInt8(ScheduledExecutorGetStateCodec.RESPONSE_IS_CANCELLED_OFFSET) !== 0,
            delayMs: Number(initialFrame.content.readBigInt64LE(ScheduledExecutorGetStateCodec.RESPONSE_DELAY_OFFSET)),
        };
    }
}
