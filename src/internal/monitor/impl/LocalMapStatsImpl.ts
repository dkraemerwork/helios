/**
 * Port of {@code com.hazelcast.internal.monitor.impl.LocalMapStatsImpl}.
 *
 * Holds per-map stats counters used by query, eviction, and monitoring infrastructure.
 * Counters are monotonically increasing and thread-safe via the single-threaded JS event loop.
 */

/** Snapshot of per-map statistics — safe to serialise / transmit. */
export interface LocalMapStats {
    /** Number of get operations completed. */
    getCount: number;
    /** Number of put operations completed. */
    putCount: number;
    /** Number of remove operations completed. */
    removeCount: number;
    /** Number of set operations completed (set has no return value unlike put). */
    setCount: number;
    /** Aggregate latency of all get operations (ms). */
    totalGetLatencyMs: number;
    /** Aggregate latency of all put operations (ms). */
    totalPutLatencyMs: number;
    /** Aggregate latency of all remove operations (ms). */
    totalRemoveLatencyMs: number;
    /** Average get latency (ms), 0 when getCount is 0. */
    avgGetLatencyMs: number;
    /** Average put latency (ms), 0 when putCount is 0. */
    avgPutLatencyMs: number;
    /** Average remove latency (ms), 0 when removeCount is 0. */
    avgRemoveLatencyMs: number;
    /** Number of owned (primary) entries. */
    ownedEntryCount: number;
    /** Number of backup entries on this node. */
    backupEntryCount: number;
    /** Estimated heap cost of owned entries (bytes). */
    heapCostBytes: number;
    /** Number of times a predicate query result size was exceeded. */
    queryResultSizeExceededCount: number;
}

export class LocalMapStatsImpl {
    private _getCount = 0;
    private _putCount = 0;
    private _removeCount = 0;
    private _setCount = 0;
    private _totalGetLatencyMs = 0;
    private _totalPutLatencyMs = 0;
    private _totalRemoveLatencyMs = 0;
    private _ownedEntryCount = 0;
    private _backupEntryCount = 0;
    private _heapCostBytes = 0;
    private _queryResultSizeExceededCount = 0;

    // ── Increment helpers ─────────────────────────────────────────────────────

    incrementGetCount(latencyMs = 0): void {
        this._getCount++;
        this._totalGetLatencyMs += latencyMs;
    }

    incrementPutCount(latencyMs = 0): void {
        this._putCount++;
        this._totalPutLatencyMs += latencyMs;
    }

    incrementRemoveCount(latencyMs = 0): void {
        this._removeCount++;
        this._totalRemoveLatencyMs += latencyMs;
    }

    incrementSetCount(): void {
        this._setCount++;
    }

    setOwnedEntryCount(count: number): void {
        this._ownedEntryCount = count;
    }

    setBackupEntryCount(count: number): void {
        this._backupEntryCount = count;
    }

    setHeapCostBytes(bytes: number): void {
        this._heapCostBytes = bytes;
    }

    incrementQueryResultSizeExceededCount(): void {
        this._queryResultSizeExceededCount++;
    }

    // ── Query helpers (legacy compat) ─────────────────────────────────────────

    getQueryResultSizeExceededCount(): number {
        return this._queryResultSizeExceededCount;
    }

    // ── Snapshot ──────────────────────────────────────────────────────────────

    /** Returns an immutable stats snapshot. */
    toSnapshot(): LocalMapStats {
        return {
            getCount: this._getCount,
            putCount: this._putCount,
            removeCount: this._removeCount,
            setCount: this._setCount,
            totalGetLatencyMs: this._totalGetLatencyMs,
            totalPutLatencyMs: this._totalPutLatencyMs,
            totalRemoveLatencyMs: this._totalRemoveLatencyMs,
            avgGetLatencyMs: this._getCount > 0
                ? Math.round((this._totalGetLatencyMs / this._getCount) * 100) / 100
                : 0,
            avgPutLatencyMs: this._putCount > 0
                ? Math.round((this._totalPutLatencyMs / this._putCount) * 100) / 100
                : 0,
            avgRemoveLatencyMs: this._removeCount > 0
                ? Math.round((this._totalRemoveLatencyMs / this._removeCount) * 100) / 100
                : 0,
            ownedEntryCount: this._ownedEntryCount,
            backupEntryCount: this._backupEntryCount,
            heapCostBytes: this._heapCostBytes,
            queryResultSizeExceededCount: this._queryResultSizeExceededCount,
        };
    }

    toJSON(): LocalMapStats {
        return this.toSnapshot();
    }
}
