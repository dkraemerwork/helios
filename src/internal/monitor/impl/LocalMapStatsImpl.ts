/**
 * Port of {@code com.hazelcast.internal.monitor.impl.LocalMapStatsImpl} (minimal surface).
 *
 * Holds per-map stats counters used by query and eviction infrastructure.
 */
export class LocalMapStatsImpl {
    private _queryResultSizeExceededCount = 0;

    incrementQueryResultSizeExceededCount(): void {
        this._queryResultSizeExceededCount++;
    }

    getQueryResultSizeExceededCount(): number {
        return this._queryResultSizeExceededCount;
    }
}
