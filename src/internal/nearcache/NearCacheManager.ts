/**
 * Port of {@code com.hazelcast.internal.nearcache.NearCacheManager}.
 *
 * Contract to manage all existing NearCache instances.
 */
import type { NearCache } from '@helios/internal/nearcache/NearCache';
import type { NearCacheConfig } from '@helios/config/NearCacheConfig';

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
