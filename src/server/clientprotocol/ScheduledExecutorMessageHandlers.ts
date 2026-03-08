/**
 * Server-side message handlers for scheduled executor client protocol.
 *
 * Creates a map of message type → handler function that can be registered
 * with the {@link ClientMessageDispatcher}.
 *
 * Hazelcast parity: ScheduledExecutorSubmitToPartitionMessageTask, etc.
 */
import type { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage';
import { ScheduledExecutorSubmitToPartitionCodec } from '@zenystx/helios-core/client/impl/protocol/codec/ScheduledExecutorSubmitToPartitionCodec';
import { ScheduledExecutorSubmitToMemberCodec } from '@zenystx/helios-core/client/impl/protocol/codec/ScheduledExecutorSubmitToMemberCodec';
import { ScheduledExecutorCancelCodec } from '@zenystx/helios-core/client/impl/protocol/codec/ScheduledExecutorCancelCodec';
import { ScheduledExecutorDisposeCodec } from '@zenystx/helios-core/client/impl/protocol/codec/ScheduledExecutorDisposeCodec';
import { ScheduledExecutorGetAllScheduledFuturesCodec } from '@zenystx/helios-core/client/impl/protocol/codec/ScheduledExecutorGetAllScheduledFuturesCodec';
import { ScheduledExecutorGetStatsCodec } from '@zenystx/helios-core/client/impl/protocol/codec/ScheduledExecutorGetStatsCodec';
import { ScheduledExecutorGetStateCodec } from '@zenystx/helios-core/client/impl/protocol/codec/ScheduledExecutorGetStateCodec';
import { ScheduledExecutorShutdownCodec } from '@zenystx/helios-core/client/impl/protocol/codec/ScheduledExecutorShutdownCodec';
import type { ScheduledExecutorContainerService } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorContainerService';
import { ScheduledTaskHandler } from '@zenystx/helios-core/scheduledexecutor/ScheduledTaskHandler';
import { ScheduledTaskState } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledTaskState';
import type { ClientSession } from '@zenystx/helios-core/server/clientprotocol/ClientSession';

type MessageHandler = (msg: ClientMessage, session: ClientSession) => Promise<ClientMessage | null>;

export function createScheduledExecutorMessageHandlers(
    containerService: ScheduledExecutorContainerService,
): Map<number, MessageHandler> {
    const handlers = new Map<number, MessageHandler>();

    // Submit to partition
    handlers.set(ScheduledExecutorSubmitToPartitionCodec.REQUEST_MESSAGE_TYPE, async (msg) => {
        const req = ScheduledExecutorSubmitToPartitionCodec.decodeRequest(msg);
        const partitionId = msg.getPartitionId();
        const descriptor = containerService.scheduleOnPartition(req.schedulerName, {
            name: req.taskName,
            command: req.taskType,
            delay: req.initialDelayMs,
            period: req.periodMs,
            type: req.type === 0 ? 'SINGLE_RUN' : 'AT_FIXED_RATE',
            autoDisposable: req.autoDisposable,
        }, partitionId);

        const handler = ScheduledTaskHandler.ofPartition(req.schedulerName, descriptor.taskName, partitionId);
        return ScheduledExecutorSubmitToPartitionCodec.encodeResponse(handler.toUrn());
    });

    // Submit to member
    handlers.set(ScheduledExecutorSubmitToMemberCodec.REQUEST_MESSAGE_TYPE, async (msg) => {
        const req = ScheduledExecutorSubmitToMemberCodec.decodeRequest(msg);
        const descriptor = containerService.scheduleOnMember(req.schedulerName, {
            name: req.taskName,
            command: req.taskType,
            delay: req.initialDelayMs,
            period: req.periodMs,
            type: req.type === 0 ? 'SINGLE_RUN' : 'AT_FIXED_RATE',
            autoDisposable: req.autoDisposable,
        }, req.memberUuid);

        const handler = ScheduledTaskHandler.ofMember(req.schedulerName, descriptor.taskName, req.memberUuid);
        return ScheduledExecutorSubmitToMemberCodec.encodeResponse(handler.toUrn());
    });

    // Cancel
    handlers.set(ScheduledExecutorCancelCodec.REQUEST_MESSAGE_TYPE, async (msg) => {
        const req = ScheduledExecutorCancelCodec.decodeRequest(msg);
        const result = containerService.cancelTask(req.schedulerName, req.taskName, req.partitionId);
        return ScheduledExecutorCancelCodec.encodeResponse(result);
    });

    // Dispose
    handlers.set(ScheduledExecutorDisposeCodec.REQUEST_MESSAGE_TYPE, async (msg) => {
        const req = ScheduledExecutorDisposeCodec.decodeRequest(msg);
        containerService.disposeTask(req.schedulerName, req.taskName, req.partitionId);
        return ScheduledExecutorDisposeCodec.encodeResponse();
    });

    // Get all scheduled futures
    handlers.set(ScheduledExecutorGetAllScheduledFuturesCodec.REQUEST_MESSAGE_TYPE, async (msg) => {
        const req = ScheduledExecutorGetAllScheduledFuturesCodec.decodeRequest(msg);
        const urns: string[] = [];

        // Collect from all partitions
        for (let pid = 0; pid < 271; pid++) {
            try {
                const partition = containerService.getPartition(pid);
                const store = partition.getOrCreateContainer(req.schedulerName);
                for (const desc of store.getAll()) {
                    const handler = ScheduledTaskHandler.ofPartition(req.schedulerName, desc.taskName, pid);
                    urns.push(handler.toUrn());
                }
            } catch {
                break; // partition out of range
            }
        }

        // Collect from member bin
        const memberBin = containerService.getMemberBin();
        const memberStore = memberBin.getOrCreateContainer(req.schedulerName);
        for (const desc of memberStore.getAll()) {
            const handler = ScheduledTaskHandler.ofMember(req.schedulerName, desc.taskName, desc.memberUuid ?? '');
            urns.push(handler.toUrn());
        }

        return ScheduledExecutorGetAllScheduledFuturesCodec.encodeResponse(urns);
    });

    // Get stats
    handlers.set(ScheduledExecutorGetStatsCodec.REQUEST_MESSAGE_TYPE, async (msg) => {
        const req = ScheduledExecutorGetStatsCodec.decodeRequest(msg);
        const descriptor = containerService.getTaskDescriptor(req.schedulerName, req.taskName, req.partitionId);

        const lastRunDuration = descriptor.lastRunCompletedAt > 0
            ? descriptor.lastRunCompletedAt - descriptor.lastRunStartedAt
            : 0;

        return ScheduledExecutorGetStatsCodec.encodeResponse(
            descriptor.runCount,
            lastRunDuration,
            0,
            lastRunDuration * descriptor.runCount,
            0,
        );
    });

    // Get state (isDone, isCancelled, delay)
    handlers.set(ScheduledExecutorGetStateCodec.REQUEST_MESSAGE_TYPE, async (msg) => {
        const req = ScheduledExecutorGetStateCodec.decodeRequest(msg);
        const descriptor = containerService.getTaskDescriptor(req.schedulerName, req.taskName, req.partitionId);

        const isDone = descriptor.state === ScheduledTaskState.DONE
            || descriptor.state === ScheduledTaskState.CANCELLED;
        const isCancelled = descriptor.state === ScheduledTaskState.CANCELLED;
        const delayMs = Math.max(0, descriptor.nextRunAt - Date.now());

        return ScheduledExecutorGetStateCodec.encodeResponse(isDone, isCancelled, delayMs);
    });

    // Shutdown
    handlers.set(ScheduledExecutorShutdownCodec.REQUEST_MESSAGE_TYPE, async (msg) => {
        // Note: shutdown is per-executor, not per-service
        // The container service doesn't support per-executor shutdown natively,
        // so we destroy the distributed object
        const req = ScheduledExecutorShutdownCodec.decodeRequest(msg);
        containerService.destroyDistributedObject(req.schedulerName);
        return ScheduledExecutorShutdownCodec.encodeResponse();
    });

    return handlers;
}
