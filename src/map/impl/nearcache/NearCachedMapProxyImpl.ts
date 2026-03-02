/**
 * Port of {@code com.hazelcast.map.impl.proxy.NearCachedMapProxyImpl}.
 *
 * Server-side IMap proxy fronted by a Near Cache.
 *
 * Read path: get() checks the near cache first. On a miss, fetches from the
 * backing store and populates the near cache.
 *
 * Write path: put()/remove() write to the backing store and then invalidate
 * the corresponding near cache entry so the next read gets fresh data.
 */
import type { NearCache } from '@helios/internal/nearcache/NearCache';
import { CACHED_AS_NULL, NOT_CACHED } from '@helios/internal/nearcache/NearCache';
import { NOT_RESERVED } from '@helios/internal/nearcache/NearCacheRecord';

/** Minimal backing store interface — matches DefaultRecordStore's public surface. */
export interface MapBackingStore<K, V> {
    get(key: K): V | null;
    put(key: K, value: V): V | null;
    remove(key: K): V | null;
}

export class NearCachedMapProxyImpl<K, V> {
    private readonly _name: string;
    private readonly _nearCache: NearCache<K, V>;
    private readonly _backing: MapBackingStore<K, V>;

    constructor(
        name: string,
        nearCache: NearCache<K, V>,
        backing: MapBackingStore<K, V>,
    ) {
        this._name = name;
        this._nearCache = nearCache;
        this._backing = backing;
    }

    getName(): string {
        return this._name;
    }

    /**
     * Returns the value for the given key.
     *
     * 1. Check near cache — return if present (including cached null).
     * 2. On cache miss, fetch from backing store.
     * 3. Populate the near cache with the fetched value.
     *
     * Port of {@code NearCachedMapProxyImpl.getInternal}.
     */
    get(key: K): V | null {
        const cached = this._nearCache.get(key);
        if (cached === CACHED_AS_NULL) return null;
        if (cached !== NOT_CACHED) return cached as V;

        // cache miss — reserve, fetch, publish
        const reservationId = this._nearCache.tryReserveForUpdate(key, null, 'READ_UPDATE');
        const value = this._backing.get(key);

        if (reservationId !== NOT_RESERVED) {
            this._nearCache.tryPublishReserved(key, value, reservationId, false);
        }

        return value;
    }

    /**
     * Stores the value in the backing store and invalidates the near cache for the key.
     *
     * Port of {@code NearCachedMapProxyImpl} write invalidation path.
     */
    put(key: K, value: V): V | null {
        const old = this._backing.put(key, value);
        this._nearCache.invalidate(key);
        return old;
    }

    /**
     * Removes the value from the backing store and invalidates the near cache.
     */
    remove(key: K): V | null {
        const old = this._backing.remove(key);
        this._nearCache.invalidate(key);
        return old;
    }

    /** Returns the number of entries currently held in the near cache. */
    nearCacheSize(): number {
        return this._nearCache.size();
    }

    getNearCache(): NearCache<K, V> {
        return this._nearCache;
    }
}
