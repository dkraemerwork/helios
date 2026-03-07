/**
 * Port of {@code com.hazelcast.client.map.impl.nearcache.NearCachedClientMapProxy}.
 *
 * Client-side IMap proxy fronted by a Near Cache.
 * Extends ClientMapProxy so all operations go through the binary client protocol.
 *
 * Read path:
 *   1. Check near cache — return if present (including CACHED_AS_NULL → null).
 *   2. On cache miss, reserve a slot, fetch from remote via super.get(), publish the reservation.
 *
 * Write path:
 *   Put / remove / set / delete / clear — write through ClientMapProxy, then invalidate near cache.
 */
import type { NearCache } from '@zenystx/helios-core/internal/nearcache/NearCache';
import { CACHED_AS_NULL, NOT_CACHED } from '@zenystx/helios-core/internal/nearcache/NearCache';
import { NOT_RESERVED } from '@zenystx/helios-core/internal/nearcache/NearCacheRecord';
import { ClientMapProxy } from '@zenystx/helios-core/client/proxy/ClientMapProxy';
import type { ClientInvocationService } from '@zenystx/helios-core/client/invocation/ClientInvocationService';
import type { ClientPartitionService } from '@zenystx/helios-core/client/spi/ClientPartitionService';
import type { SerializationServiceImpl } from '@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl';

export class NearCachedClientMapProxy<K = any, V = any> extends ClientMapProxy<K, V> {
    private readonly _nearCache: NearCache<K, V>;

    constructor(
        name: string,
        serviceName: string,
        serializationService: SerializationServiceImpl,
        invocationService: ClientInvocationService | null,
        partitionService: ClientPartitionService,
        nearCache: NearCache<K, V>,
    ) {
        super(name, serviceName, serializationService, invocationService, partitionService);
        this._nearCache = nearCache;
    }

    /**
     * Check near cache first. On miss: reserve → fetch via protocol → publish.
     */
    override async get(key: K): Promise<V | null> {
        const cached = this._nearCache.get(key);
        if (cached === CACHED_AS_NULL) return null;
        if (cached !== NOT_CACHED) return cached as V;

        const reservationId = this._nearCache.tryReserveForUpdate(key, null, 'READ_UPDATE');
        let value: V | null;
        try {
            value = await super.get(key);
        } catch (err) {
            this._nearCache.invalidate(key);
            throw err;
        }

        if (reservationId !== NOT_RESERVED) {
            this._nearCache.tryPublishReserved(key, value, reservationId, false);
        }

        return value;
    }

    override async put(key: K, value: V, ttlMs?: number): Promise<V | null> {
        try {
            return await super.put(key, value, ttlMs);
        } finally {
            this._nearCache.invalidate(key);
        }
    }

    override async remove(key: K): Promise<V | null> {
        try {
            return await super.remove(key);
        } finally {
            this._nearCache.invalidate(key);
        }
    }

    override async set(key: K, value: V, ttlMs?: number): Promise<void> {
        try {
            await super.set(key, value, ttlMs);
        } finally {
            this._nearCache.invalidate(key);
        }
    }

    override async delete(key: K): Promise<void> {
        try {
            await super.delete(key);
        } finally {
            this._nearCache.invalidate(key);
        }
    }

    override async clear(): Promise<void> {
        try {
            await super.clear();
        } finally {
            this._nearCache.clear();
        }
    }

    nearCacheSize(): number {
        return this._nearCache.size();
    }

    getNearCache(): NearCache<K, V> {
        return this._nearCache;
    }

    protected override onDestroy(): void {
        this._nearCache.destroy();
        super.onDestroy();
    }
}
