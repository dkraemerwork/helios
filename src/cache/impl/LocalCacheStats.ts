/**
 * LocalCacheStats — per-ICache statistics.
 * Port of {@code com.hazelcast.cache.CacheStatistics} / JSR-107 CacheStatistics.
 */

// ── Interface ──────────────────────────────────────────────────────────────────

export interface LocalCacheStats {
    /** Number of cache hits (key found in cache). */
    getCacheHits(): number;
    /** Number of cache misses (key not found in cache). */
    getCacheMisses(): number;
    /** Number of put operations (cache.put / cache.putIfAbsent). */
    getCachePuts(): number;
    /** Number of remove operations. */
    getCacheRemovals(): number;
    /** Number of evictions. */
    getCacheEvictions(): number;
    /** Average time in ms for a get operation (0 when no gets). */
    getAverageGetTimeMs(): number;
    /** Average time in ms for a put operation (0 when no puts). */
    getAveragePutTimeMs(): number;
    /** Average time in ms for a remove operation (0 when no removes). */
    getAverageRemoveTimeMs(): number;
    /** Number of owned entries on this member. */
    getOwnedEntryCount(): number;
    /** Hit ratio in [0, 1] (0 when no gets). */
    getCacheHitPercentage(): number;
    /** Miss ratio in [0, 1] (0 when no gets). */
    getCacheMissPercentage(): number;
    /** Snapshot of all stats as a plain object. */
    toJSON(): LocalCacheStatsSnapshot;
}

export interface LocalCacheStatsSnapshot {
    cacheHits: number;
    cacheMisses: number;
    cachePuts: number;
    cacheRemovals: number;
    cacheEvictions: number;
    averageGetTimeMs: number;
    averagePutTimeMs: number;
    averageRemoveTimeMs: number;
    ownedEntryCount: number;
    cacheHitPercentage: number;
    cacheMissPercentage: number;
}

// ── Implementation ─────────────────────────────────────────────────────────────

export class LocalCacheStatsImpl implements LocalCacheStats {
    private _hits = 0;
    private _misses = 0;
    private _puts = 0;
    private _removals = 0;
    private _evictions = 0;
    private _totalGetTimeMs = 0;
    private _totalPutTimeMs = 0;
    private _totalRemoveTimeMs = 0;
    private _ownedEntryCount = 0;

    // ── Increment helpers ─────────────────────────────────────────────────────

    incrementHit(getTimeMs = 0): void {
        this._hits++;
        this._totalGetTimeMs += getTimeMs;
    }

    incrementMiss(getTimeMs = 0): void {
        this._misses++;
        this._totalGetTimeMs += getTimeMs;
    }

    incrementPut(putTimeMs = 0): void {
        this._puts++;
        this._totalPutTimeMs += putTimeMs;
    }

    incrementRemoval(removeTimeMs = 0): void {
        this._removals++;
        this._totalRemoveTimeMs += removeTimeMs;
    }

    incrementEviction(): void {
        this._evictions++;
    }

    setOwnedEntryCount(count: number): void {
        this._ownedEntryCount = count;
    }

    // ── Accessors ─────────────────────────────────────────────────────────────

    getCacheHits(): number {
        return this._hits;
    }

    getCacheMisses(): number {
        return this._misses;
    }

    getCachePuts(): number {
        return this._puts;
    }

    getCacheRemovals(): number {
        return this._removals;
    }

    getCacheEvictions(): number {
        return this._evictions;
    }

    getAverageGetTimeMs(): number {
        const total = this._hits + this._misses;
        return total > 0
            ? Math.round((this._totalGetTimeMs / total) * 100) / 100
            : 0;
    }

    getAveragePutTimeMs(): number {
        return this._puts > 0
            ? Math.round((this._totalPutTimeMs / this._puts) * 100) / 100
            : 0;
    }

    getAverageRemoveTimeMs(): number {
        return this._removals > 0
            ? Math.round((this._totalRemoveTimeMs / this._removals) * 100) / 100
            : 0;
    }

    getOwnedEntryCount(): number {
        return this._ownedEntryCount;
    }

    getCacheHitPercentage(): number {
        const total = this._hits + this._misses;
        return total > 0
            ? Math.round((this._hits / total) * 10_000) / 100
            : 0;
    }

    getCacheMissPercentage(): number {
        const total = this._hits + this._misses;
        return total > 0
            ? Math.round((this._misses / total) * 10_000) / 100
            : 0;
    }

    // ── Snapshot ──────────────────────────────────────────────────────────────

    toJSON(): LocalCacheStatsSnapshot {
        return {
            cacheHits: this._hits,
            cacheMisses: this._misses,
            cachePuts: this._puts,
            cacheRemovals: this._removals,
            cacheEvictions: this._evictions,
            averageGetTimeMs: this.getAverageGetTimeMs(),
            averagePutTimeMs: this.getAveragePutTimeMs(),
            averageRemoveTimeMs: this.getAverageRemoveTimeMs(),
            ownedEntryCount: this._ownedEntryCount,
            cacheHitPercentage: this.getCacheHitPercentage(),
            cacheMissPercentage: this.getCacheMissPercentage(),
        };
    }

    /** Reset all counters. */
    reset(): void {
        this._hits = 0;
        this._misses = 0;
        this._puts = 0;
        this._removals = 0;
        this._evictions = 0;
        this._totalGetTimeMs = 0;
        this._totalPutTimeMs = 0;
        this._totalRemoveTimeMs = 0;
        this._ownedEntryCount = 0;
    }
}
