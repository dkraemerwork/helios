/**
 * StoreLatencyTracker — port of {@code com.hazelcast.map.impl.mapstore.StoreLatencyPlugin}.
 *
 * Tracks per-operation-type latency for MapStore/MapLoader calls.
 * Record latency by calling recordLatency(operationType, durationMs) immediately
 * after each store/loader call returns.
 *
 * Operation types mirror MapStore/MapLoader interface methods:
 *   load, loadAll, loadAllKeys, store, storeAll, delete, deleteAll
 */

/** Supported MapStore/MapLoader operation types. */
export type StoreOperationType =
    | 'load'
    | 'loadAll'
    | 'loadAllKeys'
    | 'store'
    | 'storeAll'
    | 'delete'
    | 'deleteAll';

/** Per-operation-type latency stats. */
export interface StoreOperationStats {
    /** Total number of calls recorded. */
    count: number;
    /** Sum of all recorded durations (ms). */
    totalLatencyMs: number;
    /** Maximum single-call duration observed (ms). */
    maxLatencyMs: number;
    /** Average duration (ms), computed as totalLatencyMs / count (0 when count is 0). */
    avgLatencyMs: number;
}

/** Full latency breakdown returned by getStats(). */
export type StoreLatencyMetrics = Record<StoreOperationType, StoreOperationStats>;

const ALL_OPERATION_TYPES: StoreOperationType[] = [
    'load',
    'loadAll',
    'loadAllKeys',
    'store',
    'storeAll',
    'delete',
    'deleteAll',
];

function emptyStats(): StoreOperationStats {
    return { count: 0, totalLatencyMs: 0, maxLatencyMs: 0, avgLatencyMs: 0 };
}

export class StoreLatencyTracker {
    private readonly _stats: Map<StoreOperationType, {
        count: number;
        totalLatencyMs: number;
        maxLatencyMs: number;
    }> = new Map(
        ALL_OPERATION_TYPES.map((type) => [
            type,
            { count: 0, totalLatencyMs: 0, maxLatencyMs: 0 },
        ]),
    );

    /**
     * Record the latency of a single MapStore/MapLoader call.
     *
     * @param operationType - one of the MapStore/MapLoader method names
     * @param durationMs    - wall-clock duration of the call in milliseconds
     */
    recordLatency(operationType: StoreOperationType, durationMs: number): void {
        const entry = this._stats.get(operationType);
        if (entry === undefined) return;
        entry.count++;
        entry.totalLatencyMs += durationMs;
        if (durationMs > entry.maxLatencyMs) {
            entry.maxLatencyMs = durationMs;
        }
    }

    /**
     * Returns a full latency breakdown for all tracked operation types.
     * avgLatencyMs is computed on the fly from totalLatencyMs / count.
     */
    getStats(): StoreLatencyMetrics {
        const result = {} as StoreLatencyMetrics;
        for (const type of ALL_OPERATION_TYPES) {
            const entry = this._stats.get(type)!;
            result[type] = {
                count: entry.count,
                totalLatencyMs: entry.totalLatencyMs,
                maxLatencyMs: entry.maxLatencyMs,
                avgLatencyMs: entry.count > 0
                    ? Math.round((entry.totalLatencyMs / entry.count) * 100) / 100
                    : 0,
            };
        }
        return result;
    }

    /** Reset all counters. Useful for rolling-window diagnostics. */
    reset(): void {
        for (const entry of this._stats.values()) {
            entry.count = 0;
            entry.totalLatencyMs = 0;
            entry.maxLatencyMs = 0;
        }
    }
}
