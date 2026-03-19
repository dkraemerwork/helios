/**
 * Manages QueryCache instances for each map.
 */
import type { QueryCacheConfig } from '@zenystx/helios-core/config/QueryCacheConfig';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { QueryCacheImpl } from '@zenystx/helios-core/map/impl/querycache/QueryCacheImpl';
import type { QueryCache } from '@zenystx/helios-core/map/QueryCache';

interface SerializationBridge {
    toData(obj: unknown): Data | null;
    toObject<T>(data: Data): T;
}

interface MapDataSource {
    getAllEntries(mapName: string): IterableIterator<readonly [Data, Data]>;
}

export class QueryCacheManager {
    /** Key: `${mapName}:${cacheName}` */
    private readonly _caches = new Map<string, QueryCacheImpl<unknown, unknown>>();
    private readonly _serialization: SerializationBridge;
    private readonly _dataSource: MapDataSource;

    constructor(serialization: SerializationBridge, dataSource: MapDataSource) {
        this._serialization = serialization;
        this._dataSource = dataSource;
    }

    async getOrCreate<K, V>(
        mapName: string,
        cacheName: string,
        config: QueryCacheConfig,
    ): Promise<QueryCache<K, V>> {
        const key = `${mapName}:${cacheName}`;
        const existing = this._caches.get(key);
        if (existing) return existing as unknown as QueryCache<K, V>;

        const predicate = config.getPredicate();
        if (!predicate) {
            throw new Error(`QueryCacheConfig for '${cacheName}' must have a predicate`);
        }

        const cache = new QueryCacheImpl<unknown, unknown>(
            cacheName,
            mapName,
            config,
            predicate,
            this._serialization,
            this._dataSource,
        );
        this._caches.set(key, cache);

        if (config.isPopulate()) {
            await cache.populate();
        }

        return cache as unknown as QueryCache<K, V>;
    }

    /** Notify all QueryCaches for a map of a mutation event. */
    onMapEvent(
        mapName: string,
        type: 'put' | 'remove' | 'evict',
        keyData: Data,
        oldValueData: Data | null,
        newValueData: Data | null,
    ): void {
        const prefix = `${mapName}:`;
        for (const [cacheKey, cache] of this._caches) {
            if (cacheKey.startsWith(prefix)) {
                cache.onMapEvent(type, keyData, oldValueData, newValueData);
            }
        }
    }

    async destroyMap(mapName: string): Promise<void> {
        const prefix = `${mapName}:`;
        for (const [key, cache] of this._caches) {
            if (key.startsWith(prefix)) {
                await cache.destroy();
                this._caches.delete(key);
            }
        }
    }

    async destroyCache(mapName: string, cacheName: string): Promise<void> {
        const key = `${mapName}:${cacheName}`;
        const cache = this._caches.get(key);
        if (cache) {
            await cache.destroy();
            this._caches.delete(key);
        }
    }
}
