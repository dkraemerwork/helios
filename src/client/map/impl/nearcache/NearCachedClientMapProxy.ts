/**
 * Port of {@code com.hazelcast.client.map.impl.nearcache.NearCachedClientMapProxy}.
 *
 * Client-side IMap proxy fronted by a Near Cache.
 *
 * Read path:
 *   1. Check near cache — return if present (including CACHED_AS_NULL → null).
 *   2. On cache miss, reserve a slot, fetch from backing store, publish the reservation.
 *
 * Write path:
 *   Put / remove — write to backing store, then invalidate the near cache entry.
 */
import type { NearCache } from '@zenystx/core/internal/nearcache/NearCache';
import { CACHED_AS_NULL, NOT_CACHED } from '@zenystx/core/internal/nearcache/NearCache';
import { NOT_RESERVED } from '@zenystx/core/internal/nearcache/NearCacheRecord';

/** Minimal backing store interface for a client map proxy. */
export interface ClientMapBackingStore<K, V> {
    get(key: K): V | null;
    put(key: K, value: V): V | null;
    remove(key: K): V | null;
}

export class NearCachedClientMapProxy<K, V> {
    private readonly _name: string;
    private readonly _nearCache: NearCache<K, V>;
    private readonly _backing: ClientMapBackingStore<K, V>;

    constructor(
        name: string,
        nearCache: NearCache<K, V>,
        backing: ClientMapBackingStore<K, V>,
    ) {
        this._name = name;
        this._nearCache = nearCache;
        this._backing = backing;
    }

    getName(): string {
        return this._name;
    }

    /**
     * Returns the value for {@code key}.
     *
     * Check near cache first (hit path). On a miss: reserve → fetch → publish.
     *
     * Port of {@code NearCachedClientMapProxy.getInternal}.
     */
    get(key: K): V | null {
        const cached = this._nearCache.get(key);
        if (cached === CACHED_AS_NULL) return null;
        if (cached !== NOT_CACHED) return cached as V;

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
     * Stores {@code value} in the backing store and invalidates the near cache.
     *
     * Port of {@code NearCachedClientMapProxy} write invalidation path.
     */
    put(key: K, value: V): V | null {
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
