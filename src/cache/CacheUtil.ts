/**
 * Port of {@code com.hazelcast.cache.CacheUtil}.
 * Utility class for cache name prefixing and distributed-object naming.
 */
import { CACHE_MANAGER_PREFIX } from '@zenystx/helios-core/cache/HazelcastCacheManager';

export class CacheUtil {
    private constructor() {}

    /**
     * Returns the prefix derived from {@code uri} and {@code classLoader}, or {@code null} if both are null.
     * Equivalent to Java {@code CacheUtil.getPrefix(URI, ClassLoader)}.
     */
    static getPrefix(uri: string | null, classLoader: string | null): string | null {
        if (uri === null && classLoader === null) {
            return null;
        }
        let sb = '';
        if (uri !== null) {
            sb += uri + '/';
        }
        if (classLoader !== null) {
            sb += classLoader + '/';
        }
        return sb;
    }

    /**
     * Returns the cache name with optional uri/classLoader prefix but without
     * {@link CACHE_MANAGER_PREFIX}.
     */
    static getPrefixedCacheName(name: string, uri: string | null, classLoader: string | null): string {
        const prefix = CacheUtil.getPrefix(uri, classLoader);
        return prefix !== null ? prefix + name : name;
    }

    /**
     * Returns the full distributed-object name: {@link CACHE_MANAGER_PREFIX} + prefixed cache name.
     */
    static getDistributedObjectName(cacheName: string, uri: string | null = null, classLoader: string | null = null): string {
        return CACHE_MANAGER_PREFIX + CacheUtil.getPrefixedCacheName(cacheName, uri, classLoader);
    }
}
