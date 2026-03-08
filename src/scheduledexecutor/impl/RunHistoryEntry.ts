/**
 * Outcome of a single scheduled-task execution attempt.
 */
export type RunOutcome = 'SUCCESS' | 'FAILURE' | 'CANCELLED';

/**
 * Audit-trail record for one execution attempt of a scheduled task.
 */
export interface RunHistoryEntry {
    readonly attemptId: string;
    readonly scheduledTime: number;
    readonly startTime: number;
    readonly endTime: number;
    readonly outcome: RunOutcome;
    readonly errorSummary?: string;
    readonly ownerEpoch: number;
    readonly version: number;
}
