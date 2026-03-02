#!/usr/bin/env bun
/**
 * main.ts — @helios/nestjs example entry point.
 *
 * Bootstraps a NestJS application context (no HTTP server) and runs two demos:
 *
 *   Demo 1 — Helios near-cache (transparent, infrastructure-level)
 *     MapConfig + NearCacheConfig is registered on the HeliosInstance.
 *     IMap.get() reads are automatically served from the local near-cache after
 *     the first miss. No application-layer code changes required.
 *
 *   Demo 2 — @Cacheable application-level caching (Spring-Cache-style)
 *     HeliosCacheModule provides a CACHE_MANAGER. @Cacheable stores method
 *     return values so subsequent calls with the same key skip the method.
 *
 *   Demo 3 — Predicate queries on a distributed IMap
 *     Helios Predicates API: equal, greaterThan, between, and, or, keySet, entrySet.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Helios } from '@helios/core/Helios';
import { HeliosConfig } from '@helios/core/config/HeliosConfig';
import { MapConfig } from '@helios/core/config/MapConfig';
import { NearCacheConfig } from '@helios/core/config/NearCacheConfig';
import { AppModule } from './app.module';
import { NearCacheService } from './near-cache/near-cache.service';
import { PredicatesService } from './predicates/predicates.service';

// ── Configure Helios ──────────────────────────────────────────────────────────

const config = new HeliosConfig('nestjs-example');

// 'catalog' map: near-cache enabled with 60s TTL, caches local entries.
// IMap.get() on this map will transparently read from the near-cache after
// the first miss, without any change to application code.
const catalogMapConfig = new MapConfig('catalog');
const nearCacheConfig = new NearCacheConfig();
nearCacheConfig.setTimeToLiveSeconds(60);
nearCacheConfig.setCacheLocalEntries(true);
catalogMapConfig.setNearCacheConfig(nearCacheConfig);
config.addMapConfig(catalogMapConfig);

// 'products' map: plain distributed map for predicate query demo.
config.addMapConfig(new MapConfig('products'));

const heliosInstance = await Helios.newInstance(config);

// ── Bootstrap NestJS (no HTTP) ────────────────────────────────────────────────

const app = await NestFactory.createApplicationContext(
    AppModule.create(heliosInstance),
    { logger: false },
);

// ─────────────────────────────────────────────────────────────────────────────
//  Demo 1 — Helios near-cache (transparent)
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════');
console.log('  Demo 1: Helios near-cache (IMap + NearCacheConfig)');
console.log('══════════════════════════════════════════════');
console.log('  The "catalog" map has NearCacheConfig attached.');
console.log('  IMap.get() is transparent — near-cache is infrastructure, not app code.\n');

const nearCacheSvc = app.get(NearCacheService);

// Seed data into the distributed map
nearCacheSvc.seed([
    { id: 'c1', name: 'Gaming Headset',  price: 79.99,  category: 'electronics' },
    { id: 'c2', name: 'Ergonomic Chair', price: 299.00, category: 'furniture'   },
]);
console.log('  Seeded 2 products into the catalog map.');

// First get: near-cache MISS → fetches from backing store, populates near-cache
const hit1 = nearCacheSvc.getFromMap('c1');
console.log(`\n  get('c1') #1 → ${JSON.stringify(hit1)}  [near-cache MISS — loaded from store]`);
console.log(`  Near-cache size: ${nearCacheSvc.getNearCacheSize()} entry(ies)`);

// Second get for same key: near-cache HIT → no backing store access
const hit2 = nearCacheSvc.getFromMap('c1');
console.log(`\n  get('c1') #2 → ${JSON.stringify(hit2)}  [near-cache HIT — served from local cache]`);

// Different key: another MISS
const hit3 = nearCacheSvc.getFromMap('c2');
console.log(`\n  get('c2') #1 → ${JSON.stringify(hit3)}  [near-cache MISS — loaded from store]`);
console.log(`  Near-cache size: ${nearCacheSvc.getNearCacheSize()} entry(ies)`);

// Same key again: HIT
const hit4 = nearCacheSvc.getFromMap('c2');
console.log(`\n  get('c2') #2 → ${JSON.stringify(hit4)}  [near-cache HIT — served from local cache]`);

console.log(`\n  Total map.get() calls: ${nearCacheSvc.getTotalGets()}`);

// ─────────────────────────────────────────────────────────────────────────────
//  Demo 2 — @Cacheable (application-level, Spring-Cache-style)
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════');
console.log('  Demo 2: @Cacheable (application-level caching)');
console.log('══════════════════════════════════════════════');
console.log('  @Cacheable stores the method return value in CACHE_MANAGER.');
console.log('  On a HIT the method body is skipped entirely.\n');

// First call: CACHE_MANAGER miss → method runs → result stored
const r1 = await nearCacheSvc.cachedLookup('c1');
console.log(`  cachedLookup('c1') #1 → ${JSON.stringify(r1)}  [CACHE_MANAGER miss — method ran]`);

// Second call: CACHE_MANAGER hit → method NOT called
const r2 = await nearCacheSvc.cachedLookup('c1');
console.log(`  cachedLookup('c1') #2 → ${JSON.stringify(r2)}  [CACHE_MANAGER hit — method skipped]`);

// Evict and re-fetch
await nearCacheSvc.evict('c1');
const r3 = await nearCacheSvc.cachedLookup('c1');
console.log(`  evict('c1') then cachedLookup → ${JSON.stringify(r3)}  [CACHE_MANAGER miss after eviction]`);

// ─────────────────────────────────────────────────────────────────────────────
//  Demo 3 — Predicate queries
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════');
console.log('  Demo 3: Predicate queries');
console.log('══════════════════════════════════════════════\n');

const predicateSvc = app.get(PredicatesService);
predicateSvc.seed();
predicateSvc.runQueries();

// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════');
console.log('  All demos complete — shutting down');
console.log('══════════════════════════════════════════════\n');

await app.close();
heliosInstance.shutdown();
process.exit(0);
