#!/usr/bin/env bun
/**
 * main.ts — entry point for the @helios/nestjs example.
 *
 * Bootstraps a NestJS application context (no HTTP server), runs two demos:
 *   1. Near-cache demo  — cache-aside reads with hit/miss tracking via @Cacheable
 *   2. Predicate query demo — equal, greaterThan, between, and/or combinations
 *
 * Then shuts the app down cleanly.
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

// ── 1. Create the HeliosInstance with MapConfigs ──────────────────────────────

const config = new HeliosConfig('nestjs-example');

// 'catalog' map: near-cache enabled (60s TTL, caches local entries)
const catalogNearCache = new NearCacheConfig('catalog')
    .setTimeToLiveSeconds(60)
    .setCacheLocalEntries(true);

const catalogMapConfig = new MapConfig('catalog')
    .setNearCacheConfig(catalogNearCache);

// 'products' map: plain distributed map used for predicate queries
const productsMapConfig = new MapConfig('products');

config.addMapConfig(catalogMapConfig);
config.addMapConfig(productsMapConfig);

const heliosInstance = await Helios.newInstance(config);

// ── 2. Bootstrap the NestJS application context (no HTTP) ────────────────────

const app = await NestFactory.createApplicationContext(AppModule.create(heliosInstance), {
    logger: false, // suppress NestJS framework logs for clean demo output
});

// ── 3. Near-cache demo ───────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════');
console.log('  Demo 1: Near-Cache with @Cacheable');
console.log('══════════════════════════════════════════════');

const nearCacheSvc = app.get(NearCacheService);

// Seed the backing 'catalog' map with products
const sampleProducts = [
    { id: 'c1', name: 'Gaming Headset',  price: 79.99,  category: 'electronics' },
    { id: 'c2', name: 'Ergonomic Chair', price: 299.00, category: 'furniture' },
];
nearCacheSvc.seedData(sampleProducts);
console.log(`\n  Seeded ${sampleProducts.length} products into 'catalog' map`);

// First read — cache MISS: method is invoked, result stored in CACHE_MANAGER
console.log('\n  --- First read (cache MISS) ---');
const result1 = await nearCacheSvc.getProduct('c1');
console.log(`  getProduct('c1') → ${JSON.stringify(result1)}`);
console.log('  [MISS] Method was invoked; result stored in cache');

// Second read — cache HIT: @Cacheable returns the cached value immediately
console.log('\n  --- Second read (cache HIT) ---');
const result2 = await nearCacheSvc.getProduct('c1');
console.log(`  getProduct('c1') → ${JSON.stringify(result2)}`);
console.log('  [HIT]  Returned from cache; method NOT invoked again');

// Different key — another MISS
console.log('\n  --- Third read, different key (cache MISS) ---');
const result3 = await nearCacheSvc.getProduct('c2');
console.log(`  getProduct('c2') → ${JSON.stringify(result3)}`);
console.log('  [MISS] New key; method invoked and result cached');

// Same key again — HIT
console.log('\n  --- Fourth read, same key as third (cache HIT) ---');
const result4 = await nearCacheSvc.getProduct('c2');
console.log(`  getProduct('c2') → ${JSON.stringify(result4)}`);
console.log('  [HIT]  Returned from cache');

// Missing key — always MISS (null not cached)
console.log('\n  --- Fifth read, non-existent key ---');
const result5 = await nearCacheSvc.getProduct('does-not-exist');
console.log(`  getProduct('does-not-exist') → ${JSON.stringify(result5)}`);
console.log('  [MISS] Key absent in map; null returned (not cached)');

// Show what is stored in the CACHE_MANAGER
const cacheManager = nearCacheSvc.getCacheManager();
const cachedC1 = await cacheManager.get('catalog:c1');
const cachedC2 = await cacheManager.get('catalog:c2');
console.log('\n  CACHE_MANAGER state after demo:');
console.log(`    catalog:c1 = ${JSON.stringify(cachedC1)}`);
console.log(`    catalog:c2 = ${JSON.stringify(cachedC2)}`);

// ── 4. Predicate query demo ──────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════');
console.log('  Demo 2: Predicate Queries');
console.log('══════════════════════════════════════════════');

const predicateSvc = app.get(PredicatesService);
predicateSvc.seed();
predicateSvc.runQueries();

// ── 5. Shutdown ───────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════');
console.log('  All demos complete — shutting down');
console.log('══════════════════════════════════════════════\n');

await app.close();

// Prevent any lingering async operations from keeping the process alive
process.exit(0);
