/**
 * NearCacheService — demonstrates two caching patterns using @zenystx/helios-nestjs.
 *
 * ── Pattern 1: Helios near-cache (transparent, infrastructure-level) ──────────
 *
 *   The 'catalog' IMap has a NearCacheConfig registered on the HeliosInstance
 *   (see main.ts). Every map.get(key) is automatically served from the local
 *   near-cache after the first miss — no application code change required.
 *   Call trackingGet() to see miss vs. hit counts accumulate.
 *
 * ── Pattern 2: @Cacheable (application-level, Spring-Cache-style) ─────────────
 *
 *   @Cacheable wraps a method so its return value is stored in CACHE_MANAGER
 *   on the first call and returned directly on subsequent calls with the same key.
 *   HeliosCacheModule wires a Helios IMap as the CACHE_MANAGER backing store.
 */

import type { Cache } from "@nestjs/cache-manager";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Inject, Injectable } from "@nestjs/common";
import type { IMap } from "@zenystx/helios-core/map/IMap";
import { Cacheable, CacheEvict, InjectMap } from "@zenystx/helios-nestjs";

export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
}

@Injectable()
export class NearCacheService {
  // ── Pattern 1 state ───────────────────────────────────────────────────────
  private _totalGets = 0;

  constructor(
    /**
     * 'catalog' map: has NearCacheConfig — transparent near-cache on every get().
     * Injected via HeliosObjectExtractionModule + @InjectMap.
     */
    @InjectMap("catalog") private readonly catalogMap: IMap<string, Product>,
    /**
     * CACHE_MANAGER is injected so @Cacheable can find it via findCacheOnInstance().
     * HeliosCacheModule registers this provider with an in-memory backing store.
     */
    @Inject(CACHE_MANAGER) readonly cacheManager: Cache,
  ) {}

  // ── Pattern 1: Helios near-cache ──────────────────────────────────────────

  /** Seed products directly into the distributed 'catalog' map. */
  async seed(products: Product[]): Promise<void> {
    for (const p of products) {
      await this.catalogMap.put(p.id, p);
    }
  }

  /**
   * Read a product from the 'catalog' map.
   *
   * First call for a key → near-cache MISS: reads from the map store and
   * populates the local near-cache.
   *
   * Subsequent calls for the same key → near-cache HIT: returns the cached
   * copy without touching the backing store.
   *
   * The near-cache is fully transparent — this method just calls map.get().
   */
  async getFromMap(id: string): Promise<Product | null> {
    this._totalGets++;
    return await this.catalogMap.get(id);
  }

  /** Current total number of map.get() calls (across hits and misses). */
  getTotalGets(): number {
    return this._totalGets;
  }

  /** Read current near-cache size from the map's near-cache store. */
  getNearCacheSize(): number {
    // NearCachedIMapWrapper exposes getNearCache() which has size().
    const nc = (
      this.catalogMap as unknown as { getNearCache?(): { size(): number } }
    ).getNearCache?.();
    return nc?.size() ?? 0;
  }

  // ── Pattern 2: @Cacheable (application-level) ─────────────────────────────

  /**
   * Method-level cache-aside via @Cacheable.
   *
   * CACHE_MANAGER (backed by HeliosCacheModule) is consulted first.
   * On a miss the method body runs and the result is stored.
   * On a hit the method body is skipped entirely.
   *
   * Key is derived from the 'id' argument via the key function.
   */
  @Cacheable({ key: (id: string) => `catalog:${id}` })
  async cachedLookup(id: string): Promise<Product | null> {
    // This body only executes on a CACHE_MANAGER miss.
    return this.catalogMap.get(id);
  }

  /** Evict a single product entry from the CACHE_MANAGER. */
  @CacheEvict({ key: (id: string) => `catalog:${id}` })
  async evict(_id: string): Promise<void> {
    /* eviction handled by decorator */
  }

  /** Evict all entries from the CACHE_MANAGER. */
  @CacheEvict({ allEntries: true })
  async evictAll(): Promise<void> {
    /* eviction handled by decorator */
  }
}
