/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.DefaultNearCacheManager}.
 *
 * Manages all NearCache instances by name.
 */
import type { NearCache } from '@helios/internal/nearcache/NearCache';
import type { NearCacheManager } from '@helios/internal/nearcache/NearCacheManager';
import type { NearCacheConfig } from '@helios/config/NearCacheConfig';
import type { SerializationService } from '@helios/internal/serialization/SerializationService';
import type { TaskScheduler } from '@helios/internal/nearcache/impl/TaskScheduler';
import type { HeliosProperties } from '@helios/spi/properties/HeliosProperties';
import { DefaultNearCache } from '@helios/internal/nearcache/impl/DefaultNearCache';
import { MapHeliosProperties } from '@helios/spi/properties/HeliosProperties';
import { NoOpTaskScheduler } from '@helios/internal/nearcache/impl/TaskScheduler';

export class DefaultNearCacheManager implements NearCacheManager {
    private readonly _ss: SerializationService;
    private readonly _scheduler: TaskScheduler;
    private readonly _properties: HeliosProperties;
    private readonly _nearCacheMap = new Map<string, NearCache>();

    constructor(
        serializationService: SerializationService,
        scheduler: TaskScheduler = new NoOpTaskScheduler(),
        _classLoader: unknown = null,
        properties: HeliosProperties = new MapHeliosProperties(),
    ) {
        this._ss = serializationService;
        this._scheduler = scheduler;
        this._properties = properties;
    }

    getNearCache<K, V>(name: string): NearCache<K, V> | null {
        return (this._nearCacheMap.get(name) as NearCache<K, V> | undefined) ?? null;
    }

    getOrCreateNearCache<K, V>(name: string, nearCacheConfig: NearCacheConfig): NearCache<K, V> {
        let nc = this._nearCacheMap.get(name) as NearCache<K, V> | undefined;
        if (nc !== undefined) return nc;

        nc = this.createNearCache<K, V>(name, nearCacheConfig);
        nc.initialize();
        this._nearCacheMap.set(name, nc as NearCache);
        return nc;
    }

    protected createNearCache<K, V>(name: string, nearCacheConfig: NearCacheConfig): NearCache<K, V> {
        return new DefaultNearCache<K, V>(name, nearCacheConfig, this._ss, this._scheduler, null, this._properties);
    }

    startPreloading(_nearCache: NearCache, _adapter: unknown): void {
        // Preloading is a no-op in this implementation (no persistent storage)
    }

    listAllNearCaches(): NearCache[] {
        return Array.from(this._nearCacheMap.values());
    }

    clearNearCache(name: string): boolean {
        const nc = this._nearCacheMap.get(name);
        if (nc !== undefined) {
            nc.clear();
            return true;
        }
        return false;
    }

    clearAllNearCaches(): void {
        for (const nc of this._nearCacheMap.values()) {
            nc.clear();
        }
    }

    destroyNearCache(name: string): boolean {
        const nc = this._nearCacheMap.get(name);
        if (nc !== undefined) {
            this._nearCacheMap.delete(name);
            nc.destroy();
            return true;
        }
        return false;
    }

    destroyAllNearCaches(): void {
        const names = Array.from(this._nearCacheMap.keys());
        for (const name of names) {
            this.destroyNearCache(name);
        }
    }
}
