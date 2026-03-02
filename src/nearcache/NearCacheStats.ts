/**
 * Near Cache statistics contract.
 *
 * TypeScript port of com.hazelcast.nearcache.NearCacheStats.
 * Provides compile-time types for config and monitoring without requiring
 * the Phase 3 runtime implementation.
 */
export interface NearCacheStats {
    /** Creation time of this Near Cache on this member (epoch ms). */
    getCreationTime(): number;

    /** Number of Near Cache entries owned by this member. */
    getOwnedEntryCount(): number;

    /** Memory cost (bytes) of Near Cache entries owned by this member. */
    getOwnedEntryMemoryCost(): number;

    /** Number of hits (reads) of Near Cache entries owned by this member. */
    getHits(): number;

    /** Number of misses of Near Cache entries owned by this member. */
    getMisses(): number;

    /** Hit/miss ratio of Near Cache entries owned by this member. */
    getRatio(): number;

    /** Number of evictions of Near Cache entries owned by this member. */
    getEvictions(): number;

    /** Number of TTL and max-idle expirations of Near Cache entries owned by this member. */
    getExpirations(): number;

    /** Number of successful invalidations of Near Cache entries owned by this member. */
    getInvalidations(): number;

    /**
     * Number of requested invalidations of Near Cache entries owned by this member.
     * One request may cover multiple keys (e.g. clear), includes failed invalidations.
     */
    getInvalidationRequests(): number;

    /** Number of Near Cache key persistences (when pre-load feature is enabled). */
    getPersistenceCount(): number;

    /** Timestamp of the last Near Cache key persistence (epoch ms). */
    getLastPersistenceTime(): number;

    /** Duration in milliseconds of the last Near Cache key persistence. */
    getLastPersistenceDuration(): number;

    /** Written bytes of the last Near Cache key persistence. */
    getLastPersistenceWrittenBytes(): number;

    /** Number of persisted keys of the last Near Cache key persistence. */
    getLastPersistenceKeyCount(): number;

    /** Failure reason of the last Near Cache persistence (empty string if none). */
    getLastPersistenceFailure(): string;
}
