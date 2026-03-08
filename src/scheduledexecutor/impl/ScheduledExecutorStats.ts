/**
 * Executor-level counters for the scheduled executor service.
 *
 * Tracks pending, started, completed, cancelled, failed counts and
 * start-latency / execution-time totals per executor name.
 *
 * Hazelcast parity: com.hazelcast.map.impl.ExecutorStats (shared pattern)
 *   + com.hazelcast.internal.monitor.impl.LocalExecutorStatsImpl
 */

export interface ScheduledExecutorStatsSnapshot {
    readonly pending: number;
    readonly started: number;
    readonly completed: number;
    readonly cancelled: number;
    readonly failed: number;
    readonly totalStartLatencyMs: number;
    readonly totalExecutionTimeMs: number;
}

interface MutableCounters {
    pending: number;
    started: number;
    completed: number;
    cancelled: number;
    failed: number;
    totalStartLatencyMs: number;
    totalExecutionTimeMs: number;
}

export class ScheduledExecutorStats {
    private readonly _counters = new Map<string, MutableCounters>();

    private _getOrCreate(executorName: string): MutableCounters {
        let c = this._counters.get(executorName);
        if (!c) {
            c = { pending: 0, started: 0, completed: 0, cancelled: 0, failed: 0, totalStartLatencyMs: 0, totalExecutionTimeMs: 0 };
            this._counters.set(executorName, c);
        }
        return c;
    }

    startPending(executorName: string): void {
        this._getOrCreate(executorName).pending++;
    }

    startExecution(executorName: string, startLatencyMs: number): void {
        const c = this._getOrCreate(executorName);
        c.pending = Math.max(0, c.pending - 1);
        c.started++;
        c.totalStartLatencyMs += startLatencyMs;
    }

    finishExecution(executorName: string, executionTimeMs?: number): void {
        const c = this._getOrCreate(executorName);
        c.completed++;
        if (executionTimeMs !== undefined) {
            c.totalExecutionTimeMs += executionTimeMs;
        }
    }

    cancelExecution(executorName: string): void {
        const c = this._getOrCreate(executorName);
        c.cancelled++;
        c.pending = Math.max(0, c.pending - 1);
    }

    failExecution(executorName: string): void {
        this._getOrCreate(executorName).failed++;
    }

    getSnapshot(executorName: string): ScheduledExecutorStatsSnapshot {
        const c = this._getOrCreate(executorName);
        return { ...c };
    }

    getExecutorNames(): string[] {
        return [...this._counters.keys()];
    }
}
