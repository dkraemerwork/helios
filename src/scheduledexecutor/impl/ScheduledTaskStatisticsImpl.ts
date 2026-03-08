import type { ScheduledTaskStatistics } from '@zenystx/helios-core/scheduledexecutor/ScheduledTaskStatistics.js';

/**
 * Mutable per-task statistics tracker following the Hazelcast
 * {@code ScheduledTaskStatisticsImpl} + {@code TaskRuncycleHook} pattern.
 *
 * Call {@link onBeforeRun} and {@link onAfterRun} from the scheduler dispatch
 * path; call {@link snapshot} to produce an immutable {@link ScheduledTaskStatistics}.
 *
 * All times are in milliseconds (TypeScript-native convention).
 *
 * Hazelcast parity: com.hazelcast.scheduledexecutor.impl.ScheduledTaskStatisticsImpl
 */
export class ScheduledTaskStatisticsImpl {
    private _runs = 0;
    private _lastRunDuration = 0;
    private _lastIdleDuration = 0;
    private _totalRunDuration = 0;
    private _totalIdleDuration = 0;

    /** Transient: start time of the current run (ms). */
    private _currentRunStart = 0;

    /**
     * Called immediately before task execution begins.
     *
     * @param scheduledTime - the wall-clock time the task was *supposed* to fire (nextRunAt).
     * @param startTime     - the wall-clock time execution actually started (Date.now()).
     */
    onBeforeRun(scheduledTime: number, startTime: number): void {
        this._currentRunStart = startTime;
        const idle = Math.max(0, startTime - scheduledTime);
        this._lastIdleDuration = idle;
        this._totalIdleDuration += idle;
    }

    /**
     * Called immediately after task execution completes (success or failure).
     *
     * @param endTime - wall-clock time execution ended (Date.now()).
     */
    onAfterRun(endTime: number): void {
        const duration = Math.max(0, endTime - this._currentRunStart);
        this._lastRunDuration = duration;
        this._totalRunDuration += duration;
        this._runs++;
    }

    /**
     * Produce an immutable snapshot conforming to {@link ScheduledTaskStatistics}.
     */
    snapshot(): ScheduledTaskStatistics {
        return {
            totalRuns: this._runs,
            lastRunDurationMs: this._lastRunDuration,
            lastIdleTimeMs: this._lastIdleDuration,
            totalRunTimeMs: this._totalRunDuration,
            totalIdleTimeMs: this._totalIdleDuration,
        };
    }
}
