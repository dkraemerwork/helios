/**
 * Port of {@code com.hazelcast.internal.monitor.impl.NearCacheStatsImpl}.
 *
 * Mutable implementation of NearCacheStats. All mutation methods are
 * safe to call in Bun's single-threaded runtime.
 */
import type { NearCacheStats } from '@zenystx/core/nearcache/NearCacheStats';

export class NearCacheStatsImpl implements NearCacheStats {
    private readonly _creationTime: number;
    private _ownedEntryCount = 0;
    private _ownedEntryMemoryCost = 0;
    private _hits = 0;
    private _misses = 0;
    private _evictions = 0;
    private _expirations = 0;
    private _invalidations = 0;
    private _invalidationRequests = 0;
    private _persistenceCount = 0;
    private _lastPersistenceTime = 0;
    private _lastPersistenceDuration = 0;
    private _lastPersistenceWrittenBytes = 0;
    private _lastPersistenceKeyCount = 0;
    private _lastPersistenceFailure = '';

    constructor(stats?: NearCacheStats) {
        if (stats !== undefined) {
            this._creationTime = stats.getCreationTime();
            this._ownedEntryCount = stats.getOwnedEntryCount();
            this._ownedEntryMemoryCost = stats.getOwnedEntryMemoryCost();
            this._hits = stats.getHits();
            this._misses = stats.getMisses();
            this._evictions = stats.getEvictions();
            this._expirations = stats.getExpirations();
            this._invalidations = stats.getInvalidations();
            this._invalidationRequests = stats.getInvalidationRequests();
            this._persistenceCount = stats.getPersistenceCount();
            this._lastPersistenceTime = stats.getLastPersistenceTime();
            this._lastPersistenceDuration = stats.getLastPersistenceDuration();
            this._lastPersistenceWrittenBytes = stats.getLastPersistenceWrittenBytes();
            this._lastPersistenceKeyCount = stats.getLastPersistenceKeyCount();
            this._lastPersistenceFailure = stats.getLastPersistenceFailure();
        } else {
            this._creationTime = Date.now();
        }
    }

    getCreationTime(): number { return this._creationTime; }

    getOwnedEntryCount(): number { return this._ownedEntryCount; }
    setOwnedEntryCount(count: number): void { this._ownedEntryCount = count; }
    incrementOwnedEntryCount(): void { this._ownedEntryCount++; }
    decrementOwnedEntryCount(): void { this._ownedEntryCount--; }

    getOwnedEntryMemoryCost(): number { return this._ownedEntryMemoryCost; }
    setOwnedEntryMemoryCost(cost: number): void { this._ownedEntryMemoryCost = cost; }
    incrementOwnedEntryMemoryCost(cost: number): void { this._ownedEntryMemoryCost += cost; }
    decrementOwnedEntryMemoryCost(cost: number): void { this._ownedEntryMemoryCost -= cost; }

    getHits(): number { return this._hits; }
    setHits(hits: number): void { this._hits = hits; }
    incrementHits(): void { this._hits++; }

    getMisses(): number { return this._misses; }
    setMisses(misses: number): void { this._misses = misses; }
    incrementMisses(): void { this._misses++; }

    getRatio(): number {
        if (this._misses === 0) {
            return this._hits === 0 ? NaN : Infinity;
        }
        return (this._hits / this._misses) * 100;
    }

    getEvictions(): number { return this._evictions; }
    incrementEvictions(): void { this._evictions++; }

    getExpirations(): number { return this._expirations; }
    incrementExpirations(): void { this._expirations++; }

    getInvalidations(): number { return this._invalidations; }
    incrementInvalidations(delta = 1): void { this._invalidations += delta; }

    getInvalidationRequests(): number { return this._invalidationRequests; }
    incrementInvalidationRequests(): void { this._invalidationRequests++; }
    resetInvalidationEvents(): void { this._invalidationRequests = 0; }

    getPersistenceCount(): number { return this._persistenceCount; }
    getLastPersistenceTime(): number { return this._lastPersistenceTime; }
    getLastPersistenceDuration(): number { return this._lastPersistenceDuration; }
    getLastPersistenceWrittenBytes(): number { return this._lastPersistenceWrittenBytes; }
    getLastPersistenceKeyCount(): number { return this._lastPersistenceKeyCount; }
    getLastPersistenceFailure(): string { return this._lastPersistenceFailure; }

    addPersistence(duration: number, writtenBytes: number, keyCount: number): void {
        this._persistenceCount++;
        this._lastPersistenceTime = Date.now();
        this._lastPersistenceDuration = duration;
        this._lastPersistenceWrittenBytes = writtenBytes;
        this._lastPersistenceKeyCount = keyCount;
        this._lastPersistenceFailure = '';
    }

    addPersistenceFailure(error: Error): void {
        this._persistenceCount++;
        this._lastPersistenceTime = Date.now();
        this._lastPersistenceDuration = 0;
        this._lastPersistenceWrittenBytes = 0;
        this._lastPersistenceKeyCount = 0;
        this._lastPersistenceFailure = `${error.constructor.name}: ${error.message}`;
    }

    toString(): string {
        return `NearCacheStatsImpl{ownedEntryCount=${this._ownedEntryCount}, ownedEntryMemoryCost=${this._ownedEntryMemoryCost}, creationTime=${this._creationTime}, hits=${this._hits}, misses=${this._misses}, ratio=${this.getRatio().toFixed(1)}%, evictions=${this._evictions}, expirations=${this._expirations}, invalidations=${this._invalidations}, invalidationRequests=${this._invalidationRequests}, lastPersistenceTime=${this._lastPersistenceTime}, persistenceCount=${this._persistenceCount}, lastPersistenceDuration=${this._lastPersistenceDuration}, lastPersistenceWrittenBytes=${this._lastPersistenceWrittenBytes}, lastPersistenceKeyCount=${this._lastPersistenceKeyCount}, lastPersistenceFailure='${this._lastPersistenceFailure}'}`;
    }
}
