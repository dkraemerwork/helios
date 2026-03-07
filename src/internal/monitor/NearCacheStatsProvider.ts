import type { NearCacheStats } from '@zenystx/helios-core/nearcache/NearCacheStats';

/**
 * Monitoring-side contract for Near Cache statistics.
 *
 * Placed here so that config and monitoring can compile against the
 * NearCacheStats type without depending on Phase 3 runtime classes.
 */
export interface NearCacheStatsProvider {
    /** Returns the Near Cache statistics for this data structure. */
    getNearCacheStats(): NearCacheStats;
}
