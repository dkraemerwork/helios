/**
 * LocalMultiMapStats — per-MultiMap statistics.
 * Port of {@code com.hazelcast.multimap.LocalMultiMapStats}.
 */

// ── Interface ──────────────────────────────────────────────────────────────────

export interface LocalMultiMapStats {
    /** Number of put operations completed. */
    getPutOperationCount(): number;
    /** Number of get operations completed. */
    getGetOperationCount(): number;
    /** Number of remove operations completed. */
    getRemoveOperationCount(): number;
    /** Number of other operations (size, contains, etc.). */
    getOtherOperationCount(): number;
    /** Number of event operations (listener dispatches). */
    getEventOperationCount(): number;
    /** Number of owned (primary-partition) entries on this member. */
    getOwnedEntryCount(): number;
    /** Number of backup entries on this member. */
    getBackupEntryCount(): number;
    /** Total hits across all owned entries. */
    getHits(): number;
    /** Total put latency in ms. */
    getTotalPutLatencyMs(): number;
    /** Total get latency in ms. */
    getTotalGetLatencyMs(): number;
    /** Total remove latency in ms. */
    getTotalRemoveLatencyMs(): number;
    /** Snapshot of all stats as a plain object. */
    toJSON(): LocalMultiMapStatsSnapshot;
}

export interface LocalMultiMapStatsSnapshot {
    putOperationCount: number;
    getOperationCount: number;
    removeOperationCount: number;
    otherOperationCount: number;
    eventOperationCount: number;
    ownedEntryCount: number;
    backupEntryCount: number;
    hits: number;
    totalPutLatencyMs: number;
    totalGetLatencyMs: number;
    totalRemoveLatencyMs: number;
    avgPutLatencyMs: number;
    avgGetLatencyMs: number;
    avgRemoveLatencyMs: number;
}

// ── Implementation ─────────────────────────────────────────────────────────────

export class LocalMultiMapStatsImpl implements LocalMultiMapStats {
    private _putCount = 0;
    private _getCount = 0;
    private _removeCount = 0;
    private _otherCount = 0;
    private _eventCount = 0;
    private _ownedEntryCount = 0;
    private _backupEntryCount = 0;
    private _hits = 0;
    private _totalPutLatencyMs = 0;
    private _totalGetLatencyMs = 0;
    private _totalRemoveLatencyMs = 0;

    // ── Increment helpers ────────────────────────────────────────────────────

    incrementPut(latencyMs = 0): void {
        this._putCount++;
        this._totalPutLatencyMs += latencyMs;
    }

    incrementGet(latencyMs = 0): void {
        this._getCount++;
        this._totalGetLatencyMs += latencyMs;
    }

    incrementRemove(latencyMs = 0): void {
        this._removeCount++;
        this._totalRemoveLatencyMs += latencyMs;
    }

    incrementOther(): void {
        this._otherCount++;
    }

    incrementEvent(): void {
        this._eventCount++;
    }

    incrementHits(count = 1): void {
        this._hits += count;
    }

    setOwnedEntryCount(count: number): void {
        this._ownedEntryCount = count;
    }

    setBackupEntryCount(count: number): void {
        this._backupEntryCount = count;
    }

    // ── Accessors ────────────────────────────────────────────────────────────

    getPutOperationCount(): number {
        return this._putCount;
    }

    getGetOperationCount(): number {
        return this._getCount;
    }

    getRemoveOperationCount(): number {
        return this._removeCount;
    }

    getOtherOperationCount(): number {
        return this._otherCount;
    }

    getEventOperationCount(): number {
        return this._eventCount;
    }

    getOwnedEntryCount(): number {
        return this._ownedEntryCount;
    }

    getBackupEntryCount(): number {
        return this._backupEntryCount;
    }

    getHits(): number {
        return this._hits;
    }

    getTotalPutLatencyMs(): number {
        return this._totalPutLatencyMs;
    }

    getTotalGetLatencyMs(): number {
        return this._totalGetLatencyMs;
    }

    getTotalRemoveLatencyMs(): number {
        return this._totalRemoveLatencyMs;
    }

    // ── Snapshot ──────────────────────────────────────────────────────────────

    toJSON(): LocalMultiMapStatsSnapshot {
        return {
            putOperationCount: this._putCount,
            getOperationCount: this._getCount,
            removeOperationCount: this._removeCount,
            otherOperationCount: this._otherCount,
            eventOperationCount: this._eventCount,
            ownedEntryCount: this._ownedEntryCount,
            backupEntryCount: this._backupEntryCount,
            hits: this._hits,
            totalPutLatencyMs: this._totalPutLatencyMs,
            totalGetLatencyMs: this._totalGetLatencyMs,
            totalRemoveLatencyMs: this._totalRemoveLatencyMs,
            avgPutLatencyMs: this._putCount > 0
                ? Math.round((this._totalPutLatencyMs / this._putCount) * 100) / 100
                : 0,
            avgGetLatencyMs: this._getCount > 0
                ? Math.round((this._totalGetLatencyMs / this._getCount) * 100) / 100
                : 0,
            avgRemoveLatencyMs: this._removeCount > 0
                ? Math.round((this._totalRemoveLatencyMs / this._removeCount) * 100) / 100
                : 0,
        };
    }

    /** Reset all counters. Useful for rolling-window diagnostics. */
    reset(): void {
        this._putCount = 0;
        this._getCount = 0;
        this._removeCount = 0;
        this._otherCount = 0;
        this._eventCount = 0;
        this._ownedEntryCount = 0;
        this._backupEntryCount = 0;
        this._hits = 0;
        this._totalPutLatencyMs = 0;
        this._totalGetLatencyMs = 0;
        this._totalRemoveLatencyMs = 0;
    }
}
