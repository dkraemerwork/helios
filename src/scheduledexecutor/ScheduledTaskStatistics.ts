/**
 * Statistics and timing information for a scheduled task, accessible via
 * {@link IScheduledFuture.getStats}.
 *
 * All duration fields are in milliseconds (TypeScript-native convention).
 *
 * Hazelcast parity: com.hazelcast.scheduledexecutor.ScheduledTaskStatistics
 */
export interface ScheduledTaskStatistics {

    /** Total number of times the task has been executed. */
    readonly totalRuns: number;

    /** Duration of the task's last execution in milliseconds. */
    readonly lastRunDurationMs: number;

    /** Last period the task was idle waiting to be scheduled, in milliseconds. */
    readonly lastIdleTimeMs: number;

    /** Total time spent executing across all runs, in milliseconds. */
    readonly totalRunTimeMs: number;

    /** Total time spent idle waiting to be scheduled, in milliseconds. */
    readonly totalIdleTimeMs: number;
}
