#!/usr/bin/env bun
/**
 * main.ts — @zenystx/nestjs example entry point.
 *
 * Bootstraps a NestJS application context (no HTTP server) and runs six demos:
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
 *
 *   Demo 4 — Turso/libSQL-backed MapStore (session management)
 *     TursoMapStore provides write-through/read-through persistence to Turso/libSQL.
 *     Sessions are stored in a local SQLite file (./data/sessions.db) that survives
 *     process restarts. No external service required.
 *
 *   Demo 5 — MongoDB-backed MapStore (user profiles)
 *     MongoMapStore provides write-through/read-through persistence to MongoDB.
 *     Every put() writes to both memory and MongoDB; get() on a miss reads from MongoDB.
 *     Requires a running MongoDB instance (skipped gracefully if unavailable).
 *
 *   Demo 6 — S3-backed MapStore (document metadata)
 *     S3MapStore provides write-through/read-through persistence to S3-compatible storage.
 *     Each map entry is stored as a JSON object in an S3 bucket.
 *     Requires a running S3-compatible endpoint (skipped gracefully if unavailable).
 */

import "reflect-metadata";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import { Helios } from "@zenystx/core/Helios";
import { HeliosConfig } from "@zenystx/core/config/HeliosConfig";
import { MapConfig } from "@zenystx/core/config/MapConfig";
import { MapStoreConfig } from "@zenystx/core/config/MapStoreConfig";
import { NearCacheConfig } from "@zenystx/core/config/NearCacheConfig";
import { MongoMapStore } from "@zenystx/mongodb";
import { S3MapStore } from "@zenystx/s3";
import { TursoMapStore } from "@zenystx/turso";
import { AppModule } from "./app.module";
import { MongoDbStoreService } from "./mongodb-store/mongodb-store.service";
import { NearCacheService } from "./near-cache/near-cache.service";
import { PredicatesService } from "./predicates/predicates.service";
import { S3StoreService } from "./s3-store/s3-store.service";
import { TursoStoreService } from "./turso-store/turso-store.service";

// ── Configure Helios ──────────────────────────────────────────────────────────

const config = new HeliosConfig("nestjs-example");

// 'catalog' map: near-cache enabled with 60s TTL, caches local entries.
// IMap.get() on this map will transparently read from the near-cache after
// the first miss, without any change to application code.
const catalogMapConfig = new MapConfig("catalog");
const nearCacheConfig = new NearCacheConfig();
nearCacheConfig.setTimeToLiveSeconds(60);
nearCacheConfig.setCacheLocalEntries(true);
catalogMapConfig.setNearCacheConfig(nearCacheConfig);
config.addMapConfig(catalogMapConfig);

// 'products' map: plain distributed map for predicate query demo.
config.addMapConfig(new MapConfig("products"));

// ── MapStore-backed maps ──────────────────────────────────────────────────────

// 'user-profiles' map: backed by MongoDB via MongoMapStore.
// Write-through: every put() persists to MongoDB. Read-through: get() on a
// miss loads from MongoDB. This survives process restarts.
const mongoMapConfig = new MapConfig("user-profiles");
const mongoStoreConfig = new MapStoreConfig();
mongoStoreConfig.setEnabled(true);
mongoStoreConfig.setImplementation(
  new MongoMapStore({
    uri: process.env["MONGO_URI"] ?? "mongodb://localhost:27017",
    database: process.env["MONGO_DB"] ?? "helios-example",
  }),
);
mongoMapConfig.setMapStoreConfig(mongoStoreConfig);
config.addMapConfig(mongoMapConfig);

// 'documents' map: backed by S3 via S3MapStore.
// Each map entry is stored as a JSON object in an S3 bucket.
// Works with AWS S3, MinIO, or LocalStack.
const s3MapConfig = new MapConfig("documents");
const s3StoreConfig = new MapStoreConfig();
s3StoreConfig.setEnabled(true);
s3StoreConfig.setImplementation(
  new S3MapStore({
    bucket: process.env["S3_BUCKET"] ?? "helios-example",
    prefix: "documents/",
    region: process.env["AWS_REGION"] ?? "us-east-1",
    endpoint: process.env["S3_ENDPOINT"] ?? "http://localhost:9000",
    credentials: {
      accessKeyId: process.env["AWS_ACCESS_KEY_ID"] ?? "minioadmin",
      secretAccessKey: process.env["AWS_SECRET_ACCESS_KEY"] ?? "minioadmin",
    },
  }),
);
s3MapConfig.setMapStoreConfig(s3StoreConfig);
config.addMapConfig(s3MapConfig);

// 'sessions' map: backed by Turso/libSQL via TursoMapStore.
// Uses a local SQLite file so data survives process restarts.
// Switch to 'libsql://...' + authToken for Turso cloud.
const tursoDbPath = resolve(import.meta.dirname, "..", "data", "sessions.db");
mkdirSync(dirname(tursoDbPath), { recursive: true });

const tursoMapConfig = new MapConfig("sessions");
const tursoStoreConfig = new MapStoreConfig();
tursoStoreConfig.setEnabled(true);
tursoStoreConfig.setImplementation(
  new TursoMapStore({
    url: process.env["TURSO_URL"] ?? `file:${tursoDbPath}`,
    authToken: process.env["TURSO_AUTH_TOKEN"],
  }),
);
tursoMapConfig.setMapStoreConfig(tursoStoreConfig);
config.addMapConfig(tursoMapConfig);

const heliosInstance = await Helios.newInstance(config);

// ── Bootstrap NestJS (no HTTP) ────────────────────────────────────────────────

const app = await NestFactory.createApplicationContext(
  AppModule.create(heliosInstance),
  { logger: false },
);

// ─────────────────────────────────────────────────────────────────────────────
//  Demo 1 — Helios near-cache (transparent)
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════════");
console.log("  Demo 1: Helios near-cache (IMap + NearCacheConfig)");
console.log("══════════════════════════════════════════════");
console.log('  The "catalog" map has NearCacheConfig attached.');
console.log(
  "  IMap.get() is transparent — near-cache is infrastructure, not app code.\n",
);

const nearCacheSvc = app.get(NearCacheService);

// Seed data into the distributed map
await nearCacheSvc.seed([
  { id: "c1", name: "Gaming Headset", price: 79.99, category: "electronics" },
  { id: "c2", name: "Ergonomic Chair", price: 299.0, category: "furniture" },
]);
console.log("  Seeded 2 products into the catalog map.");

// First get: near-cache MISS → fetches from backing store, populates near-cache
const hit1 = await nearCacheSvc.getFromMap("c1");
console.log(
  `\n  get('c1') #1 → ${JSON.stringify(hit1)}  [near-cache MISS — loaded from store]`,
);
console.log(`  Near-cache size: ${nearCacheSvc.getNearCacheSize()} entry(ies)`);

// Second get for same key: near-cache HIT → no backing store access
const hit2 = await nearCacheSvc.getFromMap("c1");
console.log(
  `\n  get('c1') #2 → ${JSON.stringify(hit2)}  [near-cache HIT — served from local cache]`,
);

// Different key: another MISS
const hit3 = await nearCacheSvc.getFromMap("c2");
console.log(
  `\n  get('c2') #1 → ${JSON.stringify(hit3)}  [near-cache MISS — loaded from store]`,
);
console.log(`  Near-cache size: ${nearCacheSvc.getNearCacheSize()} entry(ies)`);

// Same key again: HIT
const hit4 = await nearCacheSvc.getFromMap("c2");
console.log(
  `\n  get('c2') #2 → ${JSON.stringify(hit4)}  [near-cache HIT — served from local cache]`,
);

console.log(`\n  Total map.get() calls: ${nearCacheSvc.getTotalGets()}`);

// ─────────────────────────────────────────────────────────────────────────────
//  Demo 2 — @Cacheable (application-level, Spring-Cache-style)
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════════");
console.log("  Demo 2: @Cacheable (application-level caching)");
console.log("══════════════════════════════════════════════");
console.log("  @Cacheable stores the method return value in CACHE_MANAGER.");
console.log("  On a HIT the method body is skipped entirely.\n");

// First call: CACHE_MANAGER miss → method runs → result stored
const r1 = await nearCacheSvc.cachedLookup("c1");
console.log(
  `  cachedLookup('c1') #1 → ${JSON.stringify(r1)}  [CACHE_MANAGER miss — method ran]`,
);

// Second call: CACHE_MANAGER hit → method NOT called
const r2 = await nearCacheSvc.cachedLookup("c1");
console.log(
  `  cachedLookup('c1') #2 → ${JSON.stringify(r2)}  [CACHE_MANAGER hit — method skipped]`,
);

// Evict and re-fetch
await nearCacheSvc.evict("c1");
const r3 = await nearCacheSvc.cachedLookup("c1");
console.log(
  `  evict('c1') then cachedLookup → ${JSON.stringify(r3)}  [CACHE_MANAGER miss after eviction]`,
);

// ─────────────────────────────────────────────────────────────────────────────
//  Demo 3 — Predicate queries
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════════");
console.log("  Demo 3: Predicate queries");
console.log("══════════════════════════════════════════════\n");

const predicateSvc = app.get(PredicatesService);
predicateSvc.seed();
predicateSvc.runQueries();

// ─────────────────────────────────────────────────────────────────────────────
//  Demo 4 — Turso/libSQL-backed MapStore (session management)
//  Runs first: uses in-memory SQLite, no external service needed.
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════════");
console.log("  Demo 4: Turso MapStore (session management)");
console.log("══════════════════════════════════════════════");
console.log("  TursoMapStore: write-through/read-through to Turso/libSQL.");
console.log(
  "  Sessions persisted to ./data/sessions.db (survives restarts).\n",
);

const tursoSvc = app.get(TursoStoreService);
await tursoSvc.runDemo();

// ─────────────────────────────────────────────────────────────────────────────
//  Demo 5 — MongoDB-backed MapStore (user profiles)
//  Requires: MongoDB on localhost:27017 (or set MONGO_URI env var).
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════════");
console.log("  Demo 5: MongoDB MapStore (user profiles)");
console.log("══════════════════════════════════════════════");
console.log("  MongoMapStore: write-through/read-through to MongoDB.");
console.log("  Requires: MongoDB on localhost:27017 (or MONGO_URI env)\n");

const mongoSvc = app.get(MongoDbStoreService);
try {
  await Promise.race([
    mongoSvc.runDemo(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 5_000),
    ),
  ]);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`  ⏭ Skipped: MongoDB not reachable (${msg}).`);
  console.log(
    "  Start MongoDB and re-run, or set MONGO_URI=mongodb://host:port",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Demo 6 — S3-backed MapStore (document metadata)
//  Requires: S3-compatible endpoint (MinIO, LocalStack, or AWS S3).
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════════");
console.log("  Demo 6: S3 MapStore (document metadata)");
console.log("══════════════════════════════════════════════");
console.log("  S3MapStore: write-through/read-through to S3.");
console.log(
  "  Requires: MinIO/LocalStack on localhost:9000 (or S3_ENDPOINT env)\n",
);

const s3Svc = app.get(S3StoreService);
try {
  await Promise.race([
    s3Svc.runDemo(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 5_000),
    ),
  ]);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`  ⏭ Skipped: S3 endpoint not reachable (${msg}).`);
  console.log(
    "  Start MinIO/LocalStack and re-run, or set S3_ENDPOINT=http://host:port",
  );
}

// ─────────────────────────────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════════");
console.log("  All demos complete — shutting down");
console.log("══════════════════════════════════════════════\n");

await app.close();
heliosInstance.shutdown();
process.exit(0);
