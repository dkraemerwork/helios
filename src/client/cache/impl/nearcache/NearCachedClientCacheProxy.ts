/**
 * Port of {@code com.hazelcast.client.cache.impl.nearcache.NearCachedClientCacheProxy}.
 *
 * Client-side JCache proxy fronted by a Near Cache.
 * All backing operations go through the binary client protocol (async).
 *
 * Read path:
 *   1. Check near cache — return if hit (NOT_CACHED sentinel = miss).
 *   2. On miss: reserve → fetch via protocol → publish.
 *
 * Write path (INVALIDATE policy — default):
 *   Put / remove → write through protocol, then invalidate near cache.
 *
 * Write path (CACHE_ON_UPDATE policy):
 *   Put → reserve with WRITE_UPDATE → write through protocol → publish if reservation succeeded,
 *         otherwise invalidate.
 *
 * Note: JCache does not support null values; CACHED_AS_NULL is not used here.
 *
 * This proxy is deferred — the full JCache client surface is not yet wired.
 * This class provides the near-cache pattern for when it is enabled.
 */
import type { NearCache } from '@zenystx/helios-core/internal/nearcache/NearCache';
import { NOT_CACHED } from '@zenystx/helios-core/internal/nearcache/NearCache';
import { NOT_RESERVED } from '@zenystx/helios-core/internal/nearcache/NearCacheRecord';
import { LocalUpdatePolicy } from '@zenystx/helios-core/config/NearCacheConfig';

/**
 * Async backing store interface for cache protocol operations.
 * Used instead of a synchronous backing store to support real protocol invocations.
 */
export interface AsyncCacheBackingStore<K, V> {
    get(key: K): Promise<V | null>;
    put(key: K, value: V): Promise<V | null>;
    remove(key: K): Promise<V | null>;
}

export class NearCachedClientCacheProxy<K, V> {
    private readonly _name: string;
    private readonly _nearCache: NearCache<K, V>;
    private readonly _backing: AsyncCacheBackingStore<K, V>;
    private readonly _cacheOnUpdate: boolean;

    constructor(
        name: string,
        nearCache: NearCache<K, V>,
        backing: AsyncCacheBackingStore<K, V>,
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

    async get(key: K): Promise<V | null> {
        const cached = this._nearCache.get(key);
        if (cached !== NOT_CACHED) return cached as V | null;

        const reservationId = this._nearCache.tryReserveForUpdate(key, null, 'READ_UPDATE');
        let value: V | null;
        try {
            value = await this._backing.get(key);
        } catch (err) {
            this._nearCache.invalidate(key);
            throw err;
        }

        if (reservationId !== NOT_RESERVED) {
            this._nearCache.tryPublishReserved(key, value, reservationId, false);
        }

        return value;
    }

    async put(key: K, value: V): Promise<V | null> {
        if (this._cacheOnUpdate) {
            const reservationId = this._nearCache.tryReserveForUpdate(key, null, 'WRITE_UPDATE');
            try {
                const result = await this._backing.put(key, value);
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

        try {
            return await this._backing.put(key, value);
        } finally {
            this._nearCache.invalidate(key);
        }
    }

    async remove(key: K): Promise<V | null> {
        try {
            return await this._backing.remove(key);
        } finally {
            this._nearCache.invalidate(key);
        }
    }

    nearCacheSize(): number {
        return this._nearCache.size();
    }

    getNearCache(): NearCache<K, V> {
        return this._nearCache;
    }
}
