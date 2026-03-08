/**
 * Client-side future proxy for scheduled tasks.
 *
 * Routes all operations through the container service using the handler's
 * partition/member assignment. Supports handler reacquisition: a new proxy
 * can be created from a serialized handler URN after client reconnect.
 *
 * After dispose(), the handler is nulled and all subsequent operations throw
 * {@link StaleTaskException}, matching Hazelcast's ClientScheduledFutureProxy behavior.
 *
 * Hazelcast parity: com.hazelcast.client.impl.proxy.ClientScheduledFutureProxy
 */

import type { IScheduledFuture } from '@zenystx/helios-core/scheduledexecutor/IScheduledFuture.js';
import type { ScheduledTaskHandler } from '@zenystx/helios-core/scheduledexecutor/ScheduledTaskHandler.js';
import type { ScheduledTaskStatistics } from '@zenystx/helios-core/scheduledexecutor/ScheduledTaskStatistics.js';
import { StaleTaskException } from '@zenystx/helios-core/scheduledexecutor/StaleTaskException.js';
import type { ScheduledExecutorContainerService } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorContainerService.js';
import { ScheduledTaskState } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledTaskState.js';

export class ClientScheduledFutureProxy<V> implements IScheduledFuture<V> {
    private _handler: ScheduledTaskHandler | null;
    private readonly _containerService: ScheduledExecutorContainerService;

    constructor(handler: ScheduledTaskHandler, containerService: ScheduledExecutorContainerService) {
        this._handler = handler;
        this._containerService = containerService;
    }

    getHandler(): ScheduledTaskHandler {
        this._checkAccessibleHandler();
        return this._handler!;
    }

    async getStats(): Promise<ScheduledTaskStatistics> {
        this._checkAccessibleHandler();
        this._checkAccessibleOwner();
        const descriptor = this._containerService.getTaskDescriptor(
            this._handler!.getSchedulerName(),
            this._handler!.getTaskName(),
            this._handler!.getPartitionId(),
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
        this._checkAccessibleHandler();
        this._checkAccessibleOwner();
        this._containerService.disposeTask(
            this._handler!.getSchedulerName(),
            this._handler!.getTaskName(),
            this._handler!.getPartitionId(),
        );
        this._handler = null;
    }

    async cancel(_mayInterruptIfRunning: boolean): Promise<boolean> {
        this._checkAccessibleHandler();
        this._checkAccessibleOwner();
        return this._containerService.cancelTask(
            this._handler!.getSchedulerName(),
            this._handler!.getTaskName(),
            this._handler!.getPartitionId(),
        );
    }

    async isDone(): Promise<boolean> {
        this._checkAccessibleHandler();
        this._checkAccessibleOwner();
        const descriptor = this._containerService.getTaskDescriptor(
            this._handler!.getSchedulerName(),
            this._handler!.getTaskName(),
            this._handler!.getPartitionId(),
        );
        return descriptor.state === ScheduledTaskState.DONE
            || descriptor.state === ScheduledTaskState.CANCELLED;
    }

    async isCancelled(): Promise<boolean> {
        this._checkAccessibleHandler();
        this._checkAccessibleOwner();
        const descriptor = this._containerService.getTaskDescriptor(
            this._handler!.getSchedulerName(),
            this._handler!.getTaskName(),
            this._handler!.getPartitionId(),
        );
        return descriptor.state === ScheduledTaskState.CANCELLED;
    }

    async get(): Promise<V> {
        this._checkAccessibleHandler();
        this._checkAccessibleOwner();
        const descriptor = this._containerService.getTaskDescriptor(
            this._handler!.getSchedulerName(),
            this._handler!.getTaskName(),
            this._handler!.getPartitionId(),
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
        this._checkAccessibleHandler();
        this._checkAccessibleOwner();
        const descriptor = this._containerService.getTaskDescriptor(
            this._handler!.getSchedulerName(),
            this._handler!.getTaskName(),
            this._handler!.getPartitionId(),
        );
        return Math.max(0, descriptor.nextRunAt - Date.now());
    }

    /**
     * Check that the handler has not been disposed.
     * Throws StaleTaskException if the handler was nulled by dispose().
     */
    private _checkAccessibleHandler(): void {
        if (this._handler === null) {
            throw new StaleTaskException('disposed');
        }
    }

    /**
     * Check that the owning member is still accessible.
     */
    private _checkAccessibleOwner(): void {
        if (this._handler!.isAssignedToMember()) {
            const memberUuid = this._handler!.getMemberUuid()!;
            if (this._containerService.isMemberRemoved(memberUuid)) {
                throw new Error(
                    `Member with UUID: ${memberUuid}, holding this scheduled task is not part of this cluster.`,
                );
            }
        }
    }
}
