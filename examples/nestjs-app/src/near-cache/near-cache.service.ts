/**
 * NearCacheService — demonstrates cache-aside reads with a Helios near-cache.
 *
 * The service holds a reference to a "products" IMap that has a NearCacheConfig
 * attached. On the first get() the value is fetched from the map store (miss);
 * subsequent get() calls for the same key are served from the local near-cache
 * (hit), avoiding a round-trip to the backing store.
 *
 * The @Cacheable decorator is applied on top to show the method-level caching
 * pattern familiar from Spring Cache — it uses an in-memory ICacheStore
 * (HeliosCacheModule) as its backing store.
 */

import 'reflect-metadata';
import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from '@nestjs/cache-manager';
import { Cacheable } from '@helios/nestjs';
import { InjectMap } from '@helios/nestjs';
import type { IMap } from '@helios/core/map/IMap';

export interface Product {
    id: string;
    name: string;
    price: number;
    category: string;
}

@Injectable()
export class NearCacheService {
    /** Hit/miss counters for the @Cacheable layer (method-level cache). */
    private _hits = 0;
    private _misses = 0;

    constructor(
        /** CACHE_MANAGER is injected by HeliosCacheModule — the @Cacheable decorator picks it up. */
        @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
        /** The "catalog" map is backed by a MapProxy with NearCacheConfig attached. */
        @InjectMap('catalog') private readonly catalogMap: IMap<string, Product>,
    ) {}

    /**
     * Cache-aside read via @Cacheable.
     *
     * First call: CACHE_MANAGER miss → reads from catalogMap → stores in cache.
     * Subsequent calls with the same id: CACHE_MANAGER hit → returns immediately.
     */
    @Cacheable({ key: (id: string) => `catalog:${id}` })
    async getProduct(id: string): Promise<Product | null> {
        this._misses++;
        return this.catalogMap.get(id);
    }

    /** Seed data into the backing map. */
    seedData(products: Product[]): void {
        for (const p of products) {
            this.catalogMap.put(p.id, p);
        }
    }

    /** Return hit/miss totals accumulated by manual tracking. */
    getStats(): { hits: number; misses: number } {
        return { hits: this._hits, misses: this._misses };
    }

    /** Manually count a hit (called from the demo after verifying cache state). */
    recordHit(): void {
        this._hits++;
    }

    /** Expose the underlying CACHE_MANAGER for demo introspection. */
    getCacheManager(): Cache {
        return this.cacheManager;
    }
}
