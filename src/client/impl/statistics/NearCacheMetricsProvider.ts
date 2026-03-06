/**
 * Port of {@code com.hazelcast.client.impl.statistics.NearCacheMetricsProvider}.
 *
 * Collects NearCacheStats from all near caches across all registered
 * NearCacheManagers, keyed by near cache name.
 */
import type { NearCacheManager } from '@zenystx/helios-core/internal/nearcache/NearCacheManager';
import type { NearCacheStats } from '@zenystx/helios-core/nearcache/NearCacheStats';

export class NearCacheMetricsProvider {
    private readonly _managers: NearCacheManager[];

    constructor(managers: NearCacheManager[]) {
        this._managers = managers;
    }

    /**
     * Returns a map of near cache name → NearCacheStats for all near caches
     * in all registered managers.
     *
     * Port of {@code NearCacheMetricsProvider.provideDynamicMetrics}.
     */
    collectAll(): Map<string, NearCacheStats> {
        const result = new Map<string, NearCacheStats>();
        for (const manager of this._managers) {
            for (const nearCache of manager.listAllNearCaches()) {
                result.set(nearCache.getName(), nearCache.getNearCacheStats());
            }
        }
        return result;
    }
}
