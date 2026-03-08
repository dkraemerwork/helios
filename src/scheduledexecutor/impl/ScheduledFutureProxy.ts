/**
 * Proxy implementation of {@link IScheduledFuture} backed by a container service.
 *
 * Routes all operations (cancel, dispose, isDone, isCancelled, get, getDelay, getStats)
 * through the container service using the handler's partition/member assignment.
 *
 * Member-owned futures check for member-loss before every access (Hazelcast parity:
 * ScheduledFutureProxy.checkAccessibleOwner()).
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
        this._checkAccessibleOwner();
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
        this._checkAccessibleOwner();
        this._containerService.disposeTask(
            this._handler.getSchedulerName(),
            this._handler.getTaskName(),
            this._handler.getPartitionId(),
        );
    }

    async cancel(_mayInterruptIfRunning: boolean): Promise<boolean> {
        this._checkAccessibleOwner();
        return this._containerService.cancelTask(
            this._handler.getSchedulerName(),
            this._handler.getTaskName(),
            this._handler.getPartitionId(),
        );
    }

    async isDone(): Promise<boolean> {
        this._checkAccessibleOwner();
        const descriptor = this._containerService.getTaskDescriptor(
            this._handler.getSchedulerName(),
            this._handler.getTaskName(),
            this._handler.getPartitionId(),
        );
        return descriptor.state === ScheduledTaskState.DONE
            || descriptor.state === ScheduledTaskState.CANCELLED;
    }

    async isCancelled(): Promise<boolean> {
        this._checkAccessibleOwner();
        const descriptor = this._containerService.getTaskDescriptor(
            this._handler.getSchedulerName(),
            this._handler.getTaskName(),
            this._handler.getPartitionId(),
        );
        return descriptor.state === ScheduledTaskState.CANCELLED;
    }

    async get(): Promise<V> {
        this._checkAccessibleOwner();
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
        this._checkAccessibleOwner();
        const descriptor = this._containerService.getTaskDescriptor(
            this._handler.getSchedulerName(),
            this._handler.getTaskName(),
            this._handler.getPartitionId(),
        );
        return Math.max(0, descriptor.nextRunAt - Date.now());
    }

    /**
     * Validate that the owning member/partition is still accessible.
     * For member-owned tasks, throws if the member has departed.
     *
     * Hazelcast parity: ScheduledFutureProxy.checkAccessibleOwner()
     */
    private _checkAccessibleOwner(): void {
        if (this._handler.isAssignedToMember()) {
            const memberUuid = this._handler.getMemberUuid()!;
            if (this._containerService.isMemberRemoved(memberUuid)) {
                throw new Error(
                    `Member with UUID: ${memberUuid}, holding this scheduled task is not part of this cluster.`,
                );
            }
        }
    }
}
