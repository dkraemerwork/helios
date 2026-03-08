/**
 * Proxy implementation of {@link IScheduledFuture} backed by a container service.
 *
 * Routes all operations (cancel, dispose, isDone, isCancelled, get, getDelay, getStats)
 * through the container service using the handler's partition/member assignment.
 *
 * Hazelcast parity: com.hazelcast.scheduledexecutor.impl.ScheduledFutureProxy
 */

import type { IScheduledFuture } from '@zenystx/helios-core/scheduledexecutor/IScheduledFuture.js';
import type { ScheduledTaskHandler } from '@zenystx/helios-core/scheduledexecutor/ScheduledTaskHandler.js';
import type { ScheduledTaskStatistics } from '@zenystx/helios-core/scheduledexecutor/ScheduledTaskStatistics.js';
import type { ScheduledExecutorContainerService } from './ScheduledExecutorContainerService.js';
import { ScheduledTaskState } from './ScheduledTaskState.js';

export class ScheduledFutureProxy<V> implements IScheduledFuture<V> {
    private readonly _handler: ScheduledTaskHandler;
    private readonly _containerService: ScheduledExecutorContainerService;

    constructor(handler: ScheduledTaskHandler, containerService: ScheduledExecutorContainerService) {
        this._handler = handler;
        this._containerService = containerService;
    }

    getHandler(): ScheduledTaskHandler {
        return this._handler;
    }

    async getStats(): Promise<ScheduledTaskStatistics> {
        const descriptor = this._containerService.getTaskDescriptor(
            this._handler.getSchedulerName(),
            this._handler.getTaskName(),
            this._handler.getPartitionId(),
        );

        const lastRunDuration = descriptor.lastRunCompletedAt > 0
            ? descriptor.lastRunCompletedAt - descriptor.lastRunStartedAt
            : 0;

        return {
            totalRuns: descriptor.runCount,
            lastRunDurationMs: lastRunDuration,
            lastIdleTimeMs: 0,
            totalRunTimeMs: lastRunDuration * descriptor.runCount,
            totalIdleTimeMs: 0,
        };
    }

    async dispose(): Promise<void> {
        this._containerService.disposeTask(
            this._handler.getSchedulerName(),
            this._handler.getTaskName(),
            this._handler.getPartitionId(),
        );
    }

    async cancel(_mayInterruptIfRunning: boolean): Promise<boolean> {
        return this._containerService.cancelTask(
            this._handler.getSchedulerName(),
            this._handler.getTaskName(),
            this._handler.getPartitionId(),
        );
    }

    async isDone(): Promise<boolean> {
        const descriptor = this._containerService.getTaskDescriptor(
            this._handler.getSchedulerName(),
            this._handler.getTaskName(),
            this._handler.getPartitionId(),
        );
        return descriptor.state === ScheduledTaskState.DONE
            || descriptor.state === ScheduledTaskState.CANCELLED;
    }

    async isCancelled(): Promise<boolean> {
        const descriptor = this._containerService.getTaskDescriptor(
            this._handler.getSchedulerName(),
            this._handler.getTaskName(),
            this._handler.getPartitionId(),
        );
        return descriptor.state === ScheduledTaskState.CANCELLED;
    }

    async get(): Promise<V> {
        const descriptor = this._containerService.getTaskDescriptor(
            this._handler.getSchedulerName(),
            this._handler.getTaskName(),
            this._handler.getPartitionId(),
        );
        if (descriptor.state === ScheduledTaskState.DONE) {
            return undefined as V;
        }
        if (descriptor.state === ScheduledTaskState.CANCELLED) {
            throw new Error('Task was cancelled');
        }
        throw new Error('Task has not completed yet');
    }

    async getDelay(): Promise<number> {
        const descriptor = this._containerService.getTaskDescriptor(
            this._handler.getSchedulerName(),
            this._handler.getTaskName(),
            this._handler.getPartitionId(),
        );
        return Math.max(0, descriptor.nextRunAt - Date.now());
    }
}
