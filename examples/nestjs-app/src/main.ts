#!/usr/bin/env bun
/**
 * main.ts — @zenystx/helios-nestjs example entry point.
 *
 * Bootstraps a NestJS application context (no HTTP server) and runs ten demos:
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
 *
 *   Demo 7 — DynamoDB-backed MapStore (trading signals via Scylla/Alternator)
 *     DynamoDbMapStore provides write-behind persistence to Scylla Cloud via the
 *     Alternator (DynamoDB-compatible) API. Puts are buffered and flushed every 2s.
 *     Requires Scylla Cloud credentials (skipped gracefully if unavailable).
 *
 *   Demo 8 — Binance WebSocket → Helios IMap (production-grade streaming)
 *     BinanceWebSocketSource → accumulator → periodic flush → IMap('quotes')
 *
 *   Demo 9 — Blitz raw tick stream (hot path — every tick, zero buffering)
 *     BinanceWebSocketSource → Blitz Source → for-await consumer → real-time output
 *
 *   Demo 10 — NATS consumer mode + Cluster status dashboard
 *     Embedded NATS server stays alive. BinanceQuotesService switches to NATS mode.
 *     External client (bun run stream) publishes ticks to 'market.ticks'.
 *     Periodic cluster metrics dashboard printed to console.
 */

import { NestFactory } from "@nestjs/core";
import { BlitzService } from "@zenystx/helios-blitz";
import { Helios } from "@zenystx/helios-core/Helios";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import { MapConfig } from "@zenystx/helios-core/config/MapConfig";
import { MapStoreConfig } from "@zenystx/helios-core/config/MapStoreConfig";
import { NearCacheConfig } from "@zenystx/helios-core/config/NearCacheConfig";
import type { HeliosInstanceImpl } from "@zenystx/helios-core/instance/impl/HeliosInstanceImpl";
import { DynamoDbMapStore } from "@zenystx/helios-dynamodb";
import { MongoMapStore } from "@zenystx/helios-mongodb";
import { S3MapStore } from "@zenystx/helios-s3";
import { TursoMapStore } from "@zenystx/helios-turso";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import "reflect-metadata";
import { AppModule } from "./app.module";
import { BinanceQuotesService } from "./binance-quotes/binance-quotes.service";
import { BinanceTickStreamService } from "./binance-quotes/binance-tick-stream.service";
import { DynamoDbStoreService } from "./dynamodb-store/dynamodb-store.service";
import { MongoDbStoreService } from "./mongodb-store/mongodb-store.service";
import { NearCacheService } from "./near-cache/near-cache.service";
import { PredicatesService } from "./predicates/predicates.service";
import { S3StoreService } from "./s3-store/s3-store.service";
import { TursoStoreService } from "./turso-store/turso-store.service";

// ── Configure Helios ──────────────────────────────────────────────────────────

const config = new HeliosConfig("nestjs-example");

// 'catalog' map: near-cache enabled with 60s TTL, caches local entries.
const catalogMapConfig = new MapConfig("catalog");
const nearCacheConfig = new NearCacheConfig();
nearCacheConfig.setTimeToLiveSeconds(60);
nearCacheConfig.setCacheLocalEntries(true);
catalogMapConfig.setNearCacheConfig(nearCacheConfig);
config.addMapConfig(catalogMapConfig);

// 'products' map: plain distributed map for predicate query demo.
config.addMapConfig(new MapConfig("products"));

// 'quotes' map: materialized view of real-time Binance quotes.
config.addMapConfig(new MapConfig("quotes"));

// ── MapStore-backed maps ──────────────────────────────────────────────────────

// 'user-profiles' map: backed by MongoDB via MongoMapStore.
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

// 'trading-signals' map: backed by Scylla/Alternator via DynamoDbMapStore (write-behind).
const dynamoEndpoints = process.env['DYNAMODB_ENDPOINTS']?.split(',').map(s => s.trim()).filter(Boolean);
if (dynamoEndpoints && dynamoEndpoints.length > 0) {
  const dynamoMapConfig = new MapConfig('trading-signals');
  const dynamoStoreConfig = new MapStoreConfig();
  dynamoStoreConfig.setEnabled(true);
  dynamoStoreConfig.setWriteDelaySeconds(2);  // write-behind: flush every 2s
  dynamoStoreConfig.setWriteCoalescing(true);
  dynamoStoreConfig.setImplementation(
    new DynamoDbMapStore({
      endpoints: dynamoEndpoints,
      endpointStrategy: 'round-robin',
      region: process.env['DYNAMODB_REGION'] ?? 'us-east-1',
      credentials: {
        accessKeyId: process.env['DYNAMODB_ACCESS_KEY_ID'] ?? '',
        secretAccessKey: process.env['DYNAMODB_SECRET_ACCESS_KEY'] ?? '',
      },
      bucketCount: 16,
      tableName: 'helios_trading_signals',
      consistentRead: true,
      tls: {
        rejectUnauthorized: true,
      },
      requestTimeoutMs: 10_000,
      maxRetries: 5,
    }),
  );
  dynamoMapConfig.setMapStoreConfig(dynamoStoreConfig);
  config.addMapConfig(dynamoMapConfig);
}

// ── Start Helios + Blitz (embedded NATS) ──────────────────────────────────────

const heliosInstance = await Helios.newInstance(config);

console.log("\n  Starting embedded NATS server (Blitz)...");
const blitzService = await BlitzService.start({ embedded: {} });
console.log("  Embedded NATS server running on nats://localhost:4222\n");

// ── Bootstrap NestJS (no HTTP) ────────────────────────────────────────────────

const app = await NestFactory.createApplicationContext(
  AppModule.create(heliosInstance, blitzService),
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
await predicateSvc.seed();
predicateSvc.runQueries();

// ─────────────────────────────────────────────────────────────────────────────
//  Demo 4 — Turso/libSQL-backed MapStore (session management)
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
//  Demo 7 — DynamoDB-backed MapStore (trading signals via Scylla/Alternator)
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════════");
console.log("  Demo 7: DynamoDB MapStore (Scylla/Alternator)");
console.log("══════════════════════════════════════════════");
console.log("  DynamoDbMapStore: write-behind to Scylla Cloud via Alternator.");
console.log("  Requires: DYNAMODB_ENDPOINTS env var (or skipped gracefully)\n");

if (dynamoEndpoints && dynamoEndpoints.length > 0) {
  const dynamoSvc = app.get(DynamoDbStoreService);
  try {
    await Promise.race([
      dynamoSvc.runDemo(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 15_000),
      ),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ⏭ Skipped: Scylla/Alternator not reachable (${msg}).`);
    console.log(
      "  Set DYNAMODB_ENDPOINTS and credentials in .env to enable this demo.",
    );
  }
} else {
  console.log("  ⏭ Skipped: DYNAMODB_ENDPOINTS not set.");
  console.log("  Copy .env.example to .env and fill in your Scylla Cloud credentials.");
}

// ─────────────────────────────────────────────────────────────────────────────
//  Demo 8 — Binance WebSocket → Helios IMap (production-grade streaming)
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════════");
console.log("  Demo 8: Binance live quotes → Helios IMap");
console.log("══════════════════════════════════════════════");
console.log("  BinanceWebSocketSource → accumulator → periodic flush → IMap('quotes')");
console.log("  Write-coalescing: only latest quote per symbol survives to each flush.");
console.log("  IMap receives ~N writes per flush (N = tracked symbols), not per tick.\n");

const quotesSvc = app.get(BinanceQuotesService);

// Track a handful of major pairs to keep output readable
const trackedSymbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];

try {
  console.log(`  Starting pipeline for ${trackedSymbols.join(", ")}...`);
  await quotesSvc.start(trackedSymbols, 1_000); // 1s flush interval for demo
  console.log("  Pipeline running — consuming Binance WS feed.\n");

  // Let the pipeline accumulate quotes for 8 seconds
  const collectSeconds = 8;
  for (let i = 1; i <= collectSeconds; i++) {
    await new Promise((r) => setTimeout(r, 1_000));
    const m = quotesSvc.getMetrics();
    const elapsed = `${i}s`;
    console.log(
      `  [${elapsed}] ticks=${m.ticksReceived} | flushes=${m.flushCount} | ` +
        `written=${m.quotesWritten} | symbols=${m.symbolsTracked}`,
    );
  }

  // Read the materialized view from the Helios IMap
  console.log(`\n  ── Materialized view (IMap 'quotes') ──`);
  console.log(`  Total symbols in IMap: ${quotesSvc.getQuoteCount()}\n`);

  for (const sym of trackedSymbols) {
    const quote = await quotesSvc.getQuote(sym);
    if (quote) {
      const priceStr = quote.price.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      const volStr = quote.quoteVolume.toLocaleString("en-US", {
        maximumFractionDigits: 0,
      });
      const age = Date.now() - quote.timestamp;
      console.log(
        `  ${sym.padEnd(10)} $${priceStr.padStart(12)}  |  ` +
          `24h vol: $${volStr.padStart(18)}  |  ` +
          `H: ${quote.high.toFixed(2)} L: ${quote.low.toFixed(2)}  |  ` +
          `age: ${age}ms`,
      );
    } else {
      console.log(`  ${sym.padEnd(10)} — no data yet`);
    }
  }

  // Show top 5 by volume
  const top5 = quotesSvc.getTopByVolume(5);
  if (top5.length > 0) {
    console.log(`\n  ── Top ${top5.length} by 24h quote volume ──`);
    for (const q of top5) {
      console.log(
        `  ${q.symbol.padEnd(10)} $${q.price.toFixed(2).padStart(12)}  |  vol: $${q.quoteVolume.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
      );
    }
  }

  // Final metrics
  const finalMetrics = quotesSvc.getMetrics();
  console.log(`\n  ── Pipeline metrics ──`);
  console.log(`  Raw ticks received:   ${finalMetrics.ticksReceived.toLocaleString()}`);
  console.log(`  Flush cycles:         ${finalMetrics.flushCount}`);
  console.log(`  Quotes written:       ${finalMetrics.quotesWritten}`);
  console.log(`  Write amplification:  ${(finalMetrics.ticksReceived / Math.max(finalMetrics.quotesWritten, 1)).toFixed(1)}x reduction`);
  console.log(`  Uptime:               ${finalMetrics.uptimeMs}ms`);

  await quotesSvc.stop();
  console.log("\n  Pipeline stopped.");
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`  ⏭ Skipped: Binance WS not reachable (${msg}).`);
  console.log("  Check your internet connection and try again.");
  try { await quotesSvc.stop(); } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Demo 9 — Blitz raw tick stream (hot path — every tick, zero buffering)
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════════");
console.log("  Demo 9: Blitz raw tick stream (hot path)");
console.log("══════════════════════════════════════════════");
console.log("  BinanceWebSocketSource → Blitz Source iterator → log every tick");
console.log("  No IMap writes. No buffering. Full-fidelity per-tick delivery.\n");

const tickStreamSvc = app.get(BinanceTickStreamService);

try {
  // Register a programmatic listener to track BTC price deltas
  let lastBtcPrice = 0;
  let btcTicks = 0;
  const unsub = tickStreamSvc.onTick((quote) => {
    if (quote.symbol === "BTCUSDT") {
      if (lastBtcPrice > 0) {
        const delta = quote.price - lastBtcPrice;
        const bps = (delta / lastBtcPrice) * 10_000;
        if (Math.abs(bps) >= 1) {
          console.log(
            `  [listener] BTCUSDT moved ${delta >= 0 ? "+" : ""}${delta.toFixed(2)} ` +
              `(${bps >= 0 ? "+" : ""}${bps.toFixed(1)} bps)`,
          );
        }
      }
      lastBtcPrice = quote.price;
      btcTicks++;
    }
  });

  console.log("  Starting raw tick stream for BTCUSDT, ETHUSDT, SOLUSDT...\n");
  await tickStreamSvc.start(["BTCUSDT", "ETHUSDT", "SOLUSDT"], true);

  // Stream for 5 seconds
  await new Promise((r) => setTimeout(r, 5_000));

  await tickStreamSvc.stop();
  unsub();

  const m = tickStreamSvc.getMetrics();
  console.log(`\n  ── Tick stream metrics ──`);
  console.log(`  Total ticks emitted:  ${m.ticksEmitted}`);
  console.log(`  Symbols seen:         ${m.symbolsSeen}`);
  console.log(`  BTC tick count:       ${btcTicks}`);
  console.log(`  Stream duration:      ${m.uptimeMs}ms`);
  console.log(`  Throughput:           ${(m.ticksEmitted / (m.uptimeMs / 1000)).toFixed(1)} ticks/sec`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`  ⏭ Skipped: Binance WS not reachable (${msg}).`);
  try { await tickStreamSvc.stop(); } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Demo 10 — NATS consumer mode + Cluster status dashboard + Keep-alive
//
//  The server now stays alive. The BinanceQuotesService switches to NATS
//  consumer mode: it subscribes to 'market.ticks' on the embedded NATS
//  server and materializes incoming quotes into the IMap.
//
//  To feed ticks, run in a second terminal:
//    bun run stream
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════════");
console.log("  Demo 10: NATS consumer + Cluster status dashboard");
console.log("══════════════════════════════════════════════");
console.log("  BinanceQuotesService → NATS mode: subscribing to 'market.ticks'");
console.log("  Embedded NATS running on nats://localhost:4222");
console.log("  Materialized view: IMap('quotes') updated at flush interval.\n");

// Start NATS consumer mode (2s flush interval)
await quotesSvc.startFromNats(2_000);
console.log("  NATS consumer started — waiting for ticks on 'market.ticks'.");

console.log("\n  ┌─────────────────────────────────────────────────────┐");
console.log("  │  Server is alive! Open a second terminal and run:   │");
console.log("  │                                                     │");
console.log("  │    bun run stream                                   │");
console.log("  │                                                     │");
console.log("  │  to stream Binance ticks into NATS.                 │");
console.log("  │  Press Ctrl+C to shut down.                         │");
console.log("  └─────────────────────────────────────────────────────┘\n");

// ── Cluster status dashboard (periodic) ───────────────────────────────────

// Cast to HeliosInstanceImpl for access to getTransportStats/getKnownDistributedObjectNames
const impl = heliosInstance as unknown as HeliosInstanceImpl;

function printClusterStatus(): void {
  const transport = impl.getTransportStats();
  const inventory = impl.getKnownDistributedObjectNames();
  const quotesMetrics = quotesSvc.getMetrics();

  const now = new Date().toLocaleTimeString();

  console.log(`\n  ╔══ Cluster Status Dashboard ══ ${now} ══╗`);

  // Transport stats
  console.log("  ║");
  console.log("  ║  Transport");
  console.log(`  ║    Bytes read:     ${transport.bytesRead.toLocaleString()}`);
  console.log(`  ║    Bytes written:  ${transport.bytesWritten.toLocaleString()}`);
  console.log(`  ║    Open channels:  ${transport.openChannels}`);
  console.log(`  ║    Peer count:     ${transport.peerCount}`);

  // Object inventory
  console.log("  ║");
  console.log("  ║  Distributed Objects");
  console.log(`  ║    Maps:      ${inventory.maps.length} (${inventory.maps.join(", ") || "none"})`);
  console.log(`  ║    Queues:    ${inventory.queues.length} (${inventory.queues.join(", ") || "none"})`);
  console.log(`  ║    Topics:    ${inventory.topics.length} (${inventory.topics.join(", ") || "none"})`);
  console.log(`  ║    Executors: ${inventory.executors.length} (${inventory.executors.join(", ") || "none"})`);

  // Near-cache stats (for the 'catalog' map)
  const nearCacheManager = impl.getNearCacheManager();
  const allNearCaches = nearCacheManager.listAllNearCaches();
  if (allNearCaches.length > 0) {
    console.log("  ║");
    console.log("  ║  Near-Cache");
    for (const nc of allNearCaches) {
      const stats = nc.getNearCacheStats();
      console.log(`  ║    '${nc.getName()}': hits=${stats.getHits()} misses=${stats.getMisses()} ` +
        `ratio=${(stats.getRatio() * 100).toFixed(1)}% ` +
        `evictions=${stats.getEvictions()} size=${stats.getOwnedEntryCount()}`);
    }
  }

  // NATS consumer metrics
  console.log("  ║");
  console.log("  ║  NATS Consumer Pipeline");
  console.log(`  ║    Mode:           ${quotesMetrics.mode}`);
  console.log(`  ║    Ticks received: ${quotesMetrics.ticksReceived.toLocaleString()}`);
  console.log(`  ║    Flush cycles:   ${quotesMetrics.flushCount}`);
  console.log(`  ║    Quotes written: ${quotesMetrics.quotesWritten}`);
  console.log(`  ║    Symbols:        ${quotesMetrics.symbolsTracked}`);
  console.log(`  ║    Uptime:         ${(quotesMetrics.uptimeMs / 1000).toFixed(1)}s`);

  // IMap materialized view snapshot
  const quoteCount = quotesSvc.getQuoteCount();
  if (quoteCount > 0) {
    console.log("  ║");
    console.log(`  ║  Materialized View (IMap 'quotes': ${quoteCount} symbols)`);
    const topQuotes = quotesSvc.getTopByVolume(5);
    for (const q of topQuotes) {
      console.log(
        `  ║    ${q.symbol.padEnd(10)} $${q.price.toFixed(2).padStart(12)}  vol: $${(q.quoteVolume / 1e6).toFixed(1)}M`,
      );
    }
  }

  console.log("  ║");
  console.log("  ╚══════════════════════════════════════════════════════╝");
}

// Print dashboard every 10 seconds
const dashboardTimer = setInterval(printClusterStatus, 10_000);

// Print initial dashboard after a short delay
setTimeout(printClusterStatus, 2_000);

// ── Graceful shutdown ─────────────────────────────────────────────────────────

const shutdown = async (): Promise<void> => {
  console.log("\n\n  Shutting down...");
  clearInterval(dashboardTimer);

  await quotesSvc.stop();
  console.log("  NATS consumer stopped.");

  await app.close();
  console.log("  NestJS context closed.");

  // BlitzService shutdown (drains NATS + kills embedded nats-server)
  await blitzService.shutdown();
  console.log("  Blitz shutdown (NATS drained).");

  heliosInstance.shutdown();
  console.log("  Helios instance shut down.");
  console.log("  Goodbye.\n");

  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
