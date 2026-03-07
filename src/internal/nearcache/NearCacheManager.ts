/**
 * Port of {@code com.hazelcast.internal.nearcache.NearCacheManager}.
 *
 * Contract to manage all existing NearCache instances.
 */
import type { NearCacheConfig } from '@zenystx/helios-core/config/NearCacheConfig';
import type { NearCache } from '@zenystx/helios-core/internal/nearcache/NearCache';

export interface NearCacheManager {
    getNearCache<K, V>(name: string): NearCache<K, V> | null;
    getOrCreateNearCache<K, V>(name: string, nearCacheConfig: NearCacheConfig): NearCache<K, V>;
    startPreloading(nearCache: NearCache, dataStructureAdapter: unknown): void;
    listAllNearCaches(): NearCache[];
    clearNearCache(name: string): boolean;
    clearAllNearCaches(): void;
    destroyNearCache(name: string): boolean;
    destroyAllNearCaches(): void;
}
