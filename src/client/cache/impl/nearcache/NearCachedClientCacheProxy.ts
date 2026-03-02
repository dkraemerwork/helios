/**
 * Port of {@code com.hazelcast.client.cache.impl.nearcache.NearCachedClientCacheProxy}.
 *
 * Client-side JCache proxy fronted by a Near Cache.
 *
 * Read path:
 *   1. Check near cache — return if hit (NOT_CACHED sentinel = miss).
 *   2. On miss: reserve → fetch → publish.
 *
 * Write path (INVALIDATE policy — default):
 *   Put / remove → write to backing, then invalidate near cache.
 *
 * Write path (CACHE_ON_UPDATE policy):
 *   Put → reserve with WRITE_UPDATE → write to backing → publish if reservation succeeded,
 *         otherwise invalidate.
 *
 * Note: JCache does not support null values; CACHED_AS_NULL is not used here.
 */
import type { NearCache } from '@helios/internal/nearcache/NearCache';
import { NOT_CACHED } from '@helios/internal/nearcache/NearCache';
import { NOT_RESERVED } from '@helios/internal/nearcache/NearCacheRecord';
import { LocalUpdatePolicy } from '@helios/config/NearCacheConfig';

/** Minimal backing store interface for a client cache proxy. */
export interface ClientCacheBackingStore<K, V> {
    get(key: K): V | null;
    put(key: K, value: V): V | null;
    remove(key: K): V | null;
}

export class NearCachedClientCacheProxy<K, V> {
    private readonly _name: string;
    private readonly _nearCache: NearCache<K, V>;
    private readonly _backing: ClientCacheBackingStore<K, V>;
    private readonly _cacheOnUpdate: boolean;

    constructor(
        name: string,
        nearCache: NearCache<K, V>,
        backing: ClientCacheBackingStore<K, V>,
        localUpdatePolicy: LocalUpdatePolicy = LocalUpdatePolicy.INVALIDATE,
    ) {
        this._name = name;
        this._nearCache = nearCache;
        this._backing = backing;
        this._cacheOnUpdate = localUpdatePolicy === LocalUpdatePolicy.CACHE_ON_UPDATE;
    }

    getName(): string {
        return this._name;
    }

    /**
     * Returns the value for {@code key}.
     *
     * Checks near cache first; on a miss fetches from the backing store
     * and publishes the reservation.
     *
     * Port of {@code NearCachedClientCacheProxy.callGetSync}.
     */
    get(key: K): V | null {
        const cached = this._nearCache.get(key);
        if (cached !== NOT_CACHED) return cached as V | null;

        // Cache miss — reserve, fetch, publish
        const reservationId = this._nearCache.tryReserveForUpdate(key, null, 'READ_UPDATE');
        let value: V | null;
        try {
            value = this._backing.get(key);
        } catch (err) {
            this._nearCache.invalidate(key);
            throw err;
        }

        if (reservationId !== NOT_RESERVED) {
            this._nearCache.tryPublishReserved(key, value, reservationId, false);
        }

        return value;
    }

    /**
     * Stores {@code value} in the backing store.
     *
     * - CACHE_ON_UPDATE: reserves with WRITE_UPDATE before the call,
     *   publishes on success, invalidates if reservation failed or on error.
     * - INVALIDATE (default): writes then always invalidates.
     *
     * Port of {@code NearCachedClientCacheProxy.byUpdatingNearCache} / invalidation path.
     */
    put(key: K, value: V): V | null {
        if (this._cacheOnUpdate) {
            const reservationId = this._nearCache.tryReserveForUpdate(key, null, 'WRITE_UPDATE');
            try {
                const result = this._backing.put(key, value);
                if (reservationId !== NOT_RESERVED) {
                    this._nearCache.tryPublishReserved(key, value, reservationId, false);
                } else {
                    this._nearCache.invalidate(key);
                }
                return result;
            } catch (err) {
                this._nearCache.invalidate(key);
                throw err;
            }
        }

        // INVALIDATE policy
        try {
            return this._backing.put(key, value);
        } finally {
            this._nearCache.invalidate(key);
        }
    }

    /**
     * Removes the entry from the backing store and invalidates the near cache.
     */
    remove(key: K): V | null {
        try {
            return this._backing.remove(key);
        } finally {
            this._nearCache.invalidate(key);
        }
    }

    /** Number of entries currently held in the near cache. */
    nearCacheSize(): number {
        return this._nearCache.size();
    }

    getNearCache(): NearCache<K, V> {
        return this._nearCache;
    }
}
