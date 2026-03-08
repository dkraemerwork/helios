/**
 * A delayed result-bearing future for a scheduled task with enhanced
 * statistics, lifecycle control, and handler access.
 *
 * Hazelcast parity: com.hazelcast.scheduledexecutor.IScheduledFuture<V>
 */

import type { ScheduledTaskHandler } from './ScheduledTaskHandler.js';
import type { ScheduledTaskStatistics } from './ScheduledTaskStatistics.js';

export interface IScheduledFuture<V> {

    /** Get the resource handler for this future, usable for reconstruction. */
    getHandler(): ScheduledTaskHandler;

    /** Get execution statistics for this task. */
    getStats(): Promise<ScheduledTaskStatistics>;

    /**
     * Destroy this future in the executor — subsequent access throws.
     * Removes task state and frees the task name.
     */
    dispose(): Promise<void>;

    /**
     * Cancel further scheduling of this task.
     * @param mayInterruptIfRunning - hint; Helios does not interrupt in-flight runs.
     * @returns true if the task was cancelled, false if already done/cancelled.
     */
    cancel(mayInterruptIfRunning: boolean): Promise<boolean>;

    /** Whether the task has completed (normally or via cancellation). */
    isDone(): Promise<boolean>;

    /** Whether the task was cancelled. */
    isCancelled(): Promise<boolean>;

    /** Get the result of the one-shot task, waiting if necessary. */
    get(): Promise<V>;

    /** Get the remaining delay before the next execution, in milliseconds. */
    getDelay(): Promise<number>;
}
