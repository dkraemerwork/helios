/**
 * Client protocol codec for getting scheduled task statistics.
 *
 * Hazelcast parity: ScheduledExecutorGetStatsFromPartitionCodec (0x1A0500)
 */
import { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage';
import { INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES } from './builtin/FixedSizeTypesCodec';
import { StringCodec } from './builtin/StringCodec';

export class ScheduledExecutorGetStatsCodec {
    static readonly REQUEST_MESSAGE_TYPE: number = 0x1A0500;
    static readonly RESPONSE_MESSAGE_TYPE: number = 0x1A0501;

    private static readonly REQUEST_TARGET_PARTITION_OFFSET = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;
    static readonly REQUEST_INITIAL_FRAME_SIZE = ScheduledExecutorGetStatsCodec.REQUEST_TARGET_PARTITION_OFFSET + INT_SIZE_IN_BYTES;

    private constructor() {}

    static encodeRequest(schedulerName: string, taskName: string, partitionId: number): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(ScheduledExecutorGetStatsCodec.REQUEST_INITIAL_FRAME_SIZE);
        initialFrame.writeUInt32LE(ScheduledExecutorGetStatsCodec.REQUEST_MESSAGE_TYPE >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET);
        initialFrame.writeInt32LE(0, ClientMessage.CORRELATION_ID_FIELD_OFFSET + 4);
        initialFrame.writeInt32LE(0, ClientMessage.PARTITION_ID_FIELD_OFFSET);
        initialFrame.writeInt32LE(partitionId, ScheduledExecutorGetStatsCodec.REQUEST_TARGET_PARTITION_OFFSET);
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
        const partitionId = initialFrame.content.readInt32LE(ScheduledExecutorGetStatsCodec.REQUEST_TARGET_PARTITION_OFFSET);

        const schedulerName = StringCodec.decode(iter);
        const taskName = StringCodec.decode(iter);

        return { schedulerName, taskName, partitionId };
    }

    // Response: totalRuns(8) + lastRunDurationMs(8) + lastIdleTimeMs(8) + totalRunTimeMs(8) + totalIdleTimeMs(8)
    private static readonly RESPONSE_TOTAL_RUNS_OFFSET = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES;
    private static readonly RESPONSE_LAST_RUN_DURATION_OFFSET = ScheduledExecutorGetStatsCodec.RESPONSE_TOTAL_RUNS_OFFSET + LONG_SIZE_IN_BYTES;
    private static readonly RESPONSE_LAST_IDLE_OFFSET = ScheduledExecutorGetStatsCodec.RESPONSE_LAST_RUN_DURATION_OFFSET + LONG_SIZE_IN_BYTES;
    private static readonly RESPONSE_TOTAL_RUN_TIME_OFFSET = ScheduledExecutorGetStatsCodec.RESPONSE_LAST_IDLE_OFFSET + LONG_SIZE_IN_BYTES;
    private static readonly RESPONSE_TOTAL_IDLE_OFFSET = ScheduledExecutorGetStatsCodec.RESPONSE_TOTAL_RUN_TIME_OFFSET + LONG_SIZE_IN_BYTES;
    static readonly RESPONSE_INITIAL_FRAME_SIZE = ScheduledExecutorGetStatsCodec.RESPONSE_TOTAL_IDLE_OFFSET + LONG_SIZE_IN_BYTES;

    static encodeResponse(
        totalRuns: number,
        lastRunDurationMs: number,
        lastIdleTimeMs: number,
        totalRunTimeMs: number,
        totalIdleTimeMs: number,
    ): ClientMessage {
        const msg = ClientMessage.createForEncode();
        const initialFrame = Buffer.allocUnsafe(ScheduledExecutorGetStatsCodec.RESPONSE_INITIAL_FRAME_SIZE);
        initialFrame.fill(0);
        initialFrame.writeUInt32LE(ScheduledExecutorGetStatsCodec.RESPONSE_MESSAGE_TYPE >>> 0, 0);
        initialFrame.writeBigInt64LE(BigInt(totalRuns), ScheduledExecutorGetStatsCodec.RESPONSE_TOTAL_RUNS_OFFSET);
        initialFrame.writeBigInt64LE(BigInt(lastRunDurationMs), ScheduledExecutorGetStatsCodec.RESPONSE_LAST_RUN_DURATION_OFFSET);
        initialFrame.writeBigInt64LE(BigInt(lastIdleTimeMs), ScheduledExecutorGetStatsCodec.RESPONSE_LAST_IDLE_OFFSET);
        initialFrame.writeBigInt64LE(BigInt(totalRunTimeMs), ScheduledExecutorGetStatsCodec.RESPONSE_TOTAL_RUN_TIME_OFFSET);
        initialFrame.writeBigInt64LE(BigInt(totalIdleTimeMs), ScheduledExecutorGetStatsCodec.RESPONSE_TOTAL_IDLE_OFFSET);
        msg.add(new ClientMessage.Frame(initialFrame));
        msg.setFinal();
        return msg;
    }

    static decodeResponse(msg: ClientMessage): {
        totalRuns: number;
        lastRunDurationMs: number;
        lastIdleTimeMs: number;
        totalRunTimeMs: number;
        totalIdleTimeMs: number;
    } {
        const iter = msg.forwardFrameIterator();
        const initialFrame = iter.next();
        return {
            totalRuns: Number(initialFrame.content.readBigInt64LE(ScheduledExecutorGetStatsCodec.RESPONSE_TOTAL_RUNS_OFFSET)),
            lastRunDurationMs: Number(initialFrame.content.readBigInt64LE(ScheduledExecutorGetStatsCodec.RESPONSE_LAST_RUN_DURATION_OFFSET)),
            lastIdleTimeMs: Number(initialFrame.content.readBigInt64LE(ScheduledExecutorGetStatsCodec.RESPONSE_LAST_IDLE_OFFSET)),
            totalRunTimeMs: Number(initialFrame.content.readBigInt64LE(ScheduledExecutorGetStatsCodec.RESPONSE_TOTAL_RUN_TIME_OFFSET)),
            totalIdleTimeMs: Number(initialFrame.content.readBigInt64LE(ScheduledExecutorGetStatsCodec.RESPONSE_TOTAL_IDLE_OFFSET)),
        };
    }
}
