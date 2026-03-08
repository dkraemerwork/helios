/**
 * Client protocol codec for submitting a scheduled task to a specific member.
 *
 * Hazelcast parity: ScheduledExecutorSubmitToMemberCodec (0x1A0300)
 */
import { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage';
import { INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES, BOOLEAN_SIZE_IN_BYTES } from './builtin/FixedSizeTypesCodec';
import { StringCodec } from './builtin/StringCodec';

export class ScheduledExecutorSubmitToMemberCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x1A0300;
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x1A0301;

    private static readonly REQUEST_TYPE_OFFSET = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;
    private static readonly REQUEST_INITIAL_DELAY_OFFSET = ScheduledExecutorSubmitToMemberCodec.REQUEST_TYPE_OFFSET + INT_SIZE_IN_BYTES;
    private static readonly REQUEST_PERIOD_OFFSET = ScheduledExecutorSubmitToMemberCodec.REQUEST_INITIAL_DELAY_OFFSET + LONG_SIZE_IN_BYTES;
    private static readonly REQUEST_AUTO_DISPOSABLE_OFFSET = ScheduledExecutorSubmitToMemberCodec.REQUEST_PERIOD_OFFSET + LONG_SIZE_IN_BYTES;
    static readonly REQUEST_INITIAL_FRAME_SIZE = ScheduledExecutorSubmitToMemberCodec.REQUEST_AUTO_DISPOSABLE_OFFSET + BOOLEAN_SIZE_IN_BYTES;

    private constructor() {}

    static encodeRequest(
        schedulerName: string,
        memberUuid: string,
        type: number,
        taskName: string,
        taskType: string,
        initialDelayMs: number,
        periodMs: number,
        autoDisposable: boolean,
    ): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(ScheduledExecutorSubmitToMemberCodec.REQUEST_INITIAL_FRAME_SIZE);
        initialFrame.writeUInt32LE(ScheduledExecutorSubmitToMemberCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET + 4);
        initialFrame.writeInt32LE(0, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        initialFrame.writeInt32LE(type, ScheduledExecutorSubmitToMemberCodec.REQUEST_TYPE_OFFSET);
        initialFrame.writeBigInt64LE(BigInt(initialDelayMs), ScheduledExecutorSubmitToMemberCodec.REQUEST_INITIAL_DELAY_OFFSET);
        initialFrame.writeBigInt64LE(BigInt(periodMs), ScheduledExecutorSubmitToMemberCodec.REQUEST_PERIOD_OFFSET);
        initialFrame.writeUInt8(autoDisposable ? 1 : 0, ScheduledExecutorSubmitToMemberCodec.REQUEST_AUTO_DISPOSABLE_OFFSET);
        msg.add(new ClientMessage.Frame(initialFrame));

        StringCodec.encode(msg, schedulerName);
        StringCodec.encode(msg, memberUuid);
        StringCodec.encode(msg, taskName);
        StringCodec.encode(msg, taskType);

        msg.setFinal();
        return msg;
    }

    static decodeRequest(msg: ClientMessage): {
        schedulerName: string;
        memberUuid: string;
        type: number;
        taskName: string;
        taskType: string;
        initialDelayMs: number;
        periodMs: number;
        autoDisposable: boolean;
    } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        const type = initialFrame.content.readInt32LE(ScheduledExecutorSubmitToMemberCodec.REQUEST_TYPE_OFFSET);
        const initialDelayMs = Number(initialFrame.content.readBigInt64LE(ScheduledExecutorSubmitToMemberCodec.REQUEST_INITIAL_DELAY_OFFSET));
        const periodMs = Number(initialFrame.content.readBigInt64LE(ScheduledExecutorSubmitToMemberCodec.REQUEST_PERIOD_OFFSET));
        const autoDisposable = initialFrame.content.readUInt8(ScheduledExecutorSubmitToMemberCodec.REQUEST_AUTO_DISPOSABLE_OFFSET) !== 0;

        const schedulerName = StringCodec.decode(iter);
        const memberUuid = StringCodec.decode(iter);
        const taskName = StringCodec.decode(iter);
        const taskType = StringCodec.decode(iter);

        return { schedulerName, memberUuid, type, taskName, taskType, initialDelayMs, periodMs, autoDisposable };
    }

    static encodeResponse(handlerUrn: string): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        initialFrame.fill(0);
        initialFrame.writeUInt32LE(ScheduledExecutorSubmitToMemberCodec.RESPONSE_MESSAGE_TYPE >>> 0, 0);
        msg.add(new ClientMessage.Frame(initialFrame));
        StringCodec.encode(msg, handlerUrn);
        msg.setFinal();
        return msg;
    }

    static decodeResponse(msg: ClientMessage): string {
        const iter = msg.forwardFrameIterator();
        iter.next();
        return StringCodec.decode(iter);
    }
}
