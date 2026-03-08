import type { ScheduledTaskDescriptor } from './ScheduledTaskDescriptor.js';
import { ScheduledTaskState } from './ScheduledTaskState.js';

/**
 * A completion commit from a task executor (possibly from a previous owner).
 */
export interface CompletionCommit {
    readonly taskName: string;
    readonly ownerEpoch: number;
    readonly version: number;
    readonly attemptId: string;
    readonly outcome: 'SUCCESS' | 'FAILURE';
}

/**
 * Result of attempting to commit a completion.
 */
export interface CommitResult {
    readonly accepted: boolean;
    readonly reason?: 'epoch-fenced' | 'attempt-fenced' | 'version-fenced';
}

/**
 * Recovery plan produced by analyzing suspended tasks after a crash/promotion.
 */
export interface RecoveryPlan {
    /** Tasks eligible for replay (not durably completed, matching epoch). */
    readonly eligibleForReplay: ScheduledTaskDescriptor[];
    /** Tasks fenced out due to epoch mismatch. */
    readonly fencedOut: ScheduledTaskDescriptor[];
    /** One-shot tasks that were durably completed before suspension. */
    readonly durablyCompleted: ScheduledTaskDescriptor[];
}

/**
 * Service responsible for crash recovery and at-least-once replay semantics
 * for the scheduled executor.
 *
 * After a partition owner crashes and a backup is promoted, this service:
 * 1. Fences out tasks from retired epochs
 * 2. Identifies one-shot tasks not durably completed for re-run
 * 3. Coalesces overdue periodic catch-up to one immediate run
 * 4. Validates completion commits via version/attempt fencing
 *
 * Hazelcast parity: promotion logic from ScheduledExecutorContainer.promoteSuspended()
 * + result atomicity from ScheduledTaskDescriptor.setTaskResult()
 */
export class CrashRecoveryService {

    /**
     * Analyze suspended tasks and produce a recovery plan.
     *
     * Tasks with ownerEpoch < promotedEpoch are fenced out.
     * One-shot tasks with completedDurably=true are skipped.
     * All other suspended tasks are eligible for replay.
     */
    planRecovery(tasks: ScheduledTaskDescriptor[], promotedEpoch: number): RecoveryPlan {
        const eligibleForReplay: ScheduledTaskDescriptor[] = [];
        const fencedOut: ScheduledTaskDescriptor[] = [];
        const durablyCompleted: ScheduledTaskDescriptor[] = [];

        for (const task of tasks) {
            // Epoch fencing: reject tasks from retired epochs
            if (task.ownerEpoch < promotedEpoch) {
                fencedOut.push(task);
                continue;
            }

            // One-shot durable completion check
            if (task.scheduleKind === 'ONE_SHOT' && task.completedDurably) {
                durablyCompleted.push(task);
                continue;
            }

            eligibleForReplay.push(task);
        }

        return { eligibleForReplay, fencedOut, durablyCompleted };
    }

    /**
     * Apply the recovery plan: transition eligible tasks to SCHEDULED,
     * set their epoch, and handle periodic catch-up coalescing.
     */
    applyRecovery(plan: RecoveryPlan, promotedEpoch: number): void {
        const now = Date.now();

        for (const task of plan.eligibleForReplay) {
            task.ownerEpoch = promotedEpoch;

            // Transition to SCHEDULED if currently SUSPENDED
            if (task.state === ScheduledTaskState.SUSPENDED) {
                task.transitionTo(ScheduledTaskState.SCHEDULED);
            }

            // Periodic catch-up coalescing: if overdue, set nextRunAt to now
            // (one immediate catch-up run). If not overdue, keep original slot.
            if (task.scheduleKind === 'FIXED_RATE' && task.nextRunAt < now) {
                task.nextRunAt = now;
            }
            // One-shot tasks keep their original nextRunAt (or now if overdue)
            if (task.scheduleKind === 'ONE_SHOT' && task.nextRunAt < now) {
                task.nextRunAt = now;
            }
        }
    }

    /**
     * Validate and commit a completion from a task executor.
     *
     * Rejects stale completions via three-level fencing:
     * 1. Epoch fencing: commit epoch must match descriptor epoch
     * 2. Version fencing: commit version must match descriptor version
     * 3. Attempt fencing: commit attemptId must match descriptor attemptId
     */
    tryCommitCompletion(descriptor: ScheduledTaskDescriptor, commit: CompletionCommit): CommitResult {
        // Epoch fencing
        if (commit.ownerEpoch !== descriptor.ownerEpoch) {
            return { accepted: false, reason: 'epoch-fenced' };
        }

        // Version fencing
        if (commit.version !== descriptor.version) {
            return { accepted: false, reason: 'version-fenced' };
        }

        // Attempt fencing
        if (commit.attemptId !== descriptor.attemptId) {
            return { accepted: false, reason: 'attempt-fenced' };
        }

        // Accept: transition to DONE
        descriptor.version++;
        descriptor.transitionTo(ScheduledTaskState.DONE);
        descriptor.completedDurably = true;

        return { accepted: true };
    }
}
