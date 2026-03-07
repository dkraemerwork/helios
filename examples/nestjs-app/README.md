# Helios NestJS Example

A comprehensive NestJS application demonstrating all major Helios features — from distributed caching and predicate queries to MapStore persistence and real-time stream processing.

Runs as a CLI application (no HTTP server). Demos 1-9 execute sequentially on `bun run start`, then the server stays alive with an embedded NATS cluster and a real-time cluster status dashboard. Demo 10 uses a two-terminal workflow where a standalone NATS client streams market data into the cluster.

## Prerequisites

- [Bun](https://bun.sh) v1.3+
- Internet connection (for Binance WebSocket demos)

Optional (demos skip gracefully if unavailable):

- MongoDB on `localhost:27017` (Demo 5)
- S3-compatible endpoint on `localhost:9000` (Demo 6 — MinIO, LocalStack, etc.)
- Scylla Cloud with Alternator API (Demo 7 — configure via `.env`)

## Quick Start

```bash
cd examples/nestjs-app
bun install
bun run start
```

Demos 1-9 run automatically. Demos that need external services (MongoDB, S3, Scylla Cloud) skip gracefully with a message. After Demo 9, the server stays alive with an embedded NATS cluster and periodic cluster status dashboard.

For Demo 10 (NATS market data streaming), open a second terminal:

```bash
# Terminal 2: Start the standalone Binance → NATS streamer
bun run stream

# Or with custom symbols:
bun run stream -- BTCUSDT ETHUSDT SOLUSDT DOGEUSDT
```

The streamer publishes Binance ticks to `market.ticks` on the embedded NATS server. The NestJS app consumes them and materializes into the IMap. Press `Ctrl+C` in either terminal to stop.

## Demos

### Demo 1 — Near-Cache (Infrastructure-Level)

**What it shows:** Helios near-cache is transparent. You configure it on the `MapConfig`, and every `IMap.get()` is automatically served from a local cache after the first miss. No application code changes.

**Key concepts:**

- `NearCacheConfig` attached to a `MapConfig`
- First `get()` = cache miss (loads from backing store)
- Subsequent `get()` = cache hit (served locally)
- Near-cache size grows as new keys are accessed

**Files:** `src/near-cache/`

```ts
// Just call map.get() — near-cache is infrastructure, not app code
const product = await this.catalogMap.get('c1'); // miss → hit on repeat
```

### Demo 2 — @Cacheable (Application-Level, Spring-Cache-Style)

**What it shows:** Method-level cache-aside with `@Cacheable`. On first call, the method runs and the result is stored in `CACHE_MANAGER`. On repeat calls with the same key, the method body is skipped entirely.

**Key concepts:**

- `HeliosCacheModule.register()` provides `CACHE_MANAGER`
- `@Cacheable({ key: ... })` on service methods
- `@CacheEvict({ key: ... })` to invalidate
- Backed by a Helios IMap (or in-memory for testing)

**Files:** `src/near-cache/near-cache.service.ts`

```ts
@Cacheable({ key: (id: string) => `catalog:${id}` })
async cachedLookup(id: string): Promise<Product | null> {
    // This body only runs on a CACHE_MANAGER miss
    return this.catalogMap.get(id);
}
```

### Demo 3 — Predicate Queries

**What it shows:** Helios Predicates API for querying distributed IMaps with SQL-like filters — without pulling all data to the client.

**Key concepts:**

- `Predicates.equal()`, `greaterThan()`, `between()`, `lessThan()`
- Boolean combinators: `Predicates.and()`, `Predicates.or()`
- Projection methods: `values()`, `keySet()`, `entrySet()`

**Files:** `src/predicates/`

```ts
const electronics = this.products.values(
    Predicates.equal<string, Product>('category', 'electronics'),
);

const cheapElectronics = this.products.values(
    Predicates.and(
        Predicates.equal('category', 'electronics'),
        Predicates.lessThan('price', 50),
    ),
);
```

### Demo 4 — Turso/libSQL MapStore (Session Management)

**What it shows:** Write-through / read-through persistence to Turso/libSQL via `TursoMapStore`. Sessions are stored in a local SQLite file that survives process restarts. No external service required.

**Key concepts:**

- `MapStoreConfig` + `TursoMapStore` on a `MapConfig`
- `put()` → write-through (INSERT OR REPLACE)
- `get()` → read-through on cache miss
- `remove()` → delete-through
- Data persists in `./data/sessions.db`

**Files:** `src/turso-store/`

```ts
// All operations go through IMap — Turso persistence is transparent
await this.sessionsMap.put('sess-abc', { userId: 'u1', active: true });
const session = await this.sessionsMap.get('sess-abc');
```

### Demo 5 — MongoDB MapStore (User Profiles)

**What it shows:** Same MapStore pattern as Demo 4, but backed by MongoDB. Every `put()` writes to both Helios and MongoDB; `get()` on a miss loads from MongoDB.

**Requires:** MongoDB on `localhost:27017` (or set `MONGO_URI` env). Skips gracefully if unavailable.

**Files:** `src/mongodb-store/`

```bash
# To run this demo:
docker run -d -p 27017:27017 mongo:7
bun run start
```

### Demo 6 — S3 MapStore (Document Metadata)

**What it shows:** MapStore backed by S3-compatible storage. Each map entry is stored as a JSON object in an S3 bucket. Works with AWS S3, MinIO, or LocalStack.

**Requires:** S3-compatible endpoint on `localhost:9000` (or set `S3_ENDPOINT` env). Skips gracefully if unavailable.

**Files:** `src/s3-store/`

```bash
# To run this demo with MinIO:
docker run -d -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ":9001"
bun run start
```

### Demo 7 — DynamoDB MapStore (Trading Signals via Scylla/Alternator)

**What it shows:** Write-behind persistence to Scylla Cloud via the DynamoDB-compatible Alternator API. Trading signals are buffered in Helios memory and flushed to Scylla every 2 seconds, smoothing write latency while providing durable storage.

**Requires:** Scylla Cloud cluster with Alternator enabled. Copy `.env.example` to `.env` and fill in your credentials. Skips gracefully if `DYNAMODB_ENDPOINTS` is not set.

**Key concepts:**

- `DynamoDbMapStore` with write-behind (2s flush interval)
- Multi-endpoint round-robin for Scylla Cloud nodes
- Write-coalescing: multiple puts to the same key within a flush window produce one DynamoDB write
- `consistentRead: true` for strong consistency on reads

**Files:** `src/dynamodb-store/`

```bash
# To run this demo:
# 1. Copy .env.example to .env
cp .env.example .env
# 2. Fill in your Scylla Cloud Alternator credentials
# 3. Run
bun run start
```

```ts
// Write-behind: put() returns immediately, flush happens asynchronously
await signals.put('sig-1', { symbol: 'BTCUSDT', action: 'BUY', price: 67500.50, ... });

// Read from memory (or load-on-miss from Scylla)
const signal = await signals.get('sig-1');
```

### Demo 8 — Binance Live Quotes → Helios IMap (Warm Path)

**What it shows:** A production-grade streaming pipeline that consumes real-time Binance WebSocket market data and materializes it into a Helios IMap as a queryable snapshot.

**Architecture:**

```
Binance WS (thousands of ticks/sec)
  → BinanceWebSocketSource (custom Blitz Source<T>)
  → Write-coalescing accumulator (latest quote per symbol)
  → Periodic flush (configurable interval)
  → Helios IMap 'quotes' (materialized view)
```

**Why this is production-grade:**

- The IMap is **not** hammered on every tick. The accumulator collapses all ticks for a symbol into the latest quote. The IMap receives `N` writes per flush (N = tracked symbols), regardless of raw tick throughput.
- Flush interval is configurable (1s for demo, 2s default).
- Full observability: ticks received, flush count, quotes written, write amplification ratio.

**Key concepts:**

- Custom Blitz `Source<T>` (WebSocket → async iterable)
- Write-coalescing buffer (micro-batching)
- `HeliosMapSink` — the IMap as a materialized view
- `@InjectMap('quotes')` — any service can query the live data

**Files:** `src/binance-quotes/binance-quotes.service.ts`, `src/binance-quotes/binance-ws.source.ts`

```ts
// Start the pipeline — quotes flow into IMap('quotes') automatically
await quotesService.start(['BTCUSDT', 'ETHUSDT', 'SOLUSDT'], 2_000);

// Query the materialized view from anywhere
const btc = await quotesService.getQuote('BTCUSDT');
console.log(`BTC: $${btc.price}`);

// Top 5 by 24h volume
const top5 = quotesService.getTopByVolume(5);
```

### Demo 9 — Blitz Raw Tick Stream (Hot Path)

**What it shows:** The other side of the coin — consuming the raw Binance tick stream with full fidelity, zero buffering, and per-tick delivery. Every single tick hits your listeners immediately.

**Architecture:**

```
Binance WS → Blitz Source<T> → for-await loop → emit to listeners
```

**Contrast with Demo 8:**

| | Demo 8 (Warm Path) | Demo 9 (Hot Path) |
|---|---|---|
| Writes to IMap | Yes (controlled rate) | No |
| Data loss | By design (coalesced) | None (full fidelity) |
| Use case | Dashboards, REST APIs | Alerting, analytics, audit |
| IMap load | O(symbols × flush_rate) | Zero |

**Key concepts:**

- Blitz `Source<T>` async iterator — same contract as NatsSource, FileSource, etc.
- Listener pattern with `onTick()` / unsubscribe
- Real-time console logging with directional arrows, 24h change %, volume
- Programmatic listeners for price movement alerts

**Files:** `src/binance-quotes/binance-tick-stream.service.ts`

```ts
// Register a listener — fires on every tick
const unsub = tickStreamService.onTick((quote) => {
    if (quote.symbol === 'BTCUSDT' && quote.price > 70_000) {
        alert('BTC above 70k!');
    }
});

// Start streaming with console output
await tickStreamService.start(['BTCUSDT', 'ETHUSDT'], true);

// Later: stop and unsubscribe
await tickStreamService.stop();
unsub();
```

### Demo 10 — NATS Consumer + Cluster Status Dashboard (Two-Terminal)

**What it shows:** The server stays alive after Demos 1-9. An embedded NATS server runs on `nats://localhost:4222`. The `BinanceQuotesService` switches to NATS consumer mode — subscribing to `market.ticks` and materializing incoming quotes into the IMap. A standalone client script streams Binance WebSocket ticks directly into NATS.

**Architecture:**

```
Terminal 1 (bun run start):
  Embedded NATS (port 4222) + BinanceQuotesService (NATS mode)
    → subscribe('market.ticks') → accumulator → flush → IMap('quotes')
    → Periodic cluster status dashboard (transport, near-cache, objects, metrics)

Terminal 2 (bun run stream):
  Binance WS → normalize to Quote → nc.publish('market.ticks', JSON)
  Pure NATS publish. No Helios binary protocol. No partition load.
```

**Why two terminals?**

The standalone client publishes ticks directly to NATS — it never touches the Helios binary protocol, IMap partitions, or the server's main thread. This is the production pattern for high-throughput ingestion: decouple the data producer from the Helios instance entirely.

**Cluster Status Dashboard:**

The dashboard prints every 10 seconds and shows:

- **Transport:** bytes read/written, open channels, peer count
- **Distributed Objects:** maps, queues, topics, executors with names
- **Near-Cache:** hit/miss ratio, evictions, size per cache
- **NATS Consumer Pipeline:** ticks received, flush cycles, quotes written, symbols tracked
- **Materialized View:** top 5 symbols by 24h volume with live prices

**Files:** `src/main.ts` (dashboard), `src/client-market-streamer.ts` (standalone streamer)

```bash
# Terminal 1
bun run start

# Terminal 2 (after "Server is alive!" message appears)
bun run stream
```

## Project Structure

```
src/
├── main.ts                          # Entry point — configures Helios, bootstraps NestJS, runs all demos
├── app.module.ts                    # Root NestJS module — wires all feature modules
├── client-market-streamer.ts        # Standalone NATS publisher (Demo 9 — run with 'bun run stream')
│
├── near-cache/                      # Demo 1 + 2: Near-cache & @Cacheable
│   ├── near-cache.module.ts
│   └── near-cache.service.ts
│
├── predicates/                      # Demo 3: Predicate queries
│   ├── predicates.module.ts
│   └── predicates.service.ts
│
├── turso-store/                     # Demo 4: Turso/libSQL MapStore
│   ├── turso-store.module.ts
│   └── turso-store.service.ts
│
├── mongodb-store/                   # Demo 5: MongoDB MapStore
│   ├── mongodb-store.module.ts
│   └── mongodb-store.service.ts
│
├── s3-store/                        # Demo 6: S3 MapStore
│   ├── s3-store.module.ts
│   └── s3-store.service.ts
│
├── dynamodb-store/                  # Demo 7: DynamoDB/Scylla MapStore
│   ├── dynamodb-store.module.ts
│   └── dynamodb-store.service.ts
│
└── binance-quotes/                  # Demo 8 + 9 + 10: Binance streaming
    ├── binance-ws.source.ts         # Custom Blitz Source<T> — Binance WS connector
    ├── binance-quotes.service.ts    # Warm path: WS or NATS → accumulator → IMap
    ├── binance-tick-stream.service.ts  # Hot path: WS → raw tick delivery
    └── binance-quotes.module.ts     # Wires both services + IMap extraction
```

## Helios Features Demonstrated

| Feature | Module | Pattern |
|---------|--------|---------|
| `HeliosModule.forRoot()` | Core | Synchronous instance registration |
| `@InjectHelios()` | Core | HeliosInstance injection |
| `@InjectMap()` | Core | Named distributed object injection |
| `HeliosObjectExtractionModule` | Core | Auto-register IMap/ITopic/IQueue as providers |
| `HeliosCacheModule` | Cache | CACHE_MANAGER backed by Helios |
| `@Cacheable` / `@CacheEvict` | Cache | Spring-Cache-style method decorators |
| `NearCacheConfig` | Near-Cache | Transparent infrastructure-level caching |
| `Predicates` API | Query | SQL-like IMap filtering |
| `MapStoreConfig` | Persistence | Write-through / read-through to external stores |
| `TursoMapStore` | Persistence | libSQL/SQLite-backed MapStore |
| `MongoMapStore` | Persistence | MongoDB-backed MapStore |
| `S3MapStore` | Persistence | S3-backed MapStore |
| `DynamoDbMapStore` | Persistence | DynamoDB/Scylla-backed MapStore (write-behind) |
| Blitz `Source<T>` | Streaming | Custom async iterable sources |
| `HeliosMapSink` | Streaming | IMap as a pipeline sink |
| Write-coalescing | Streaming | Micro-batch accumulator pattern |
| `HeliosBlitzModule` | Blitz NestJS | Embedded NATS integration via `forHeliosInstance` |
| `BlitzService.start()` | Blitz | Embedded NATS server lifecycle |
| `BlitzService.connect()` | Blitz | Lightweight NATS client (standalone streamer) |
| `NatsSource.fromSubject()` | Blitz | NATS core subject → Source\<T\> |
| `getTransportStats()` | Observability | Transport bytes, channels, peers |
| `getKnownDistributedObjectNames()` | Observability | Map/queue/topic/executor inventory |
| Near-cache stats | Observability | Hit/miss ratio, evictions, owned entries |

## Environment Variables

| Variable | Default | Demo | Description |
|----------|---------|------|-------------|
| `MONGO_URI` | `mongodb://localhost:27017` | 5 | MongoDB connection string |
| `MONGO_DB` | `helios-example` | 5 | MongoDB database name |
| `S3_ENDPOINT` | `http://localhost:9000` | 6 | S3-compatible endpoint |
| `S3_BUCKET` | `helios-example` | 6 | S3 bucket name |
| `AWS_REGION` | `us-east-1` | 6 | AWS region |
| `AWS_ACCESS_KEY_ID` | `minioadmin` | 6 | S3 access key |
| `AWS_SECRET_ACCESS_KEY` | `minioadmin` | 6 | S3 secret key |
| `TURSO_URL` | `file:./data/sessions.db` | 4 | Turso/libSQL connection URL |
| `TURSO_AUTH_TOKEN` | — | 4 | Turso auth token (cloud only) |
| `DYNAMODB_ENDPOINTS` | — | 7 | Comma-separated Scylla/Alternator endpoints |
| `DYNAMODB_REGION` | `eu-central-1` | 7 | AWS region for Alternator |
| `DYNAMODB_ACCESS_KEY_ID` | — | 7 | Scylla Cloud access key |
| `DYNAMODB_SECRET_ACCESS_KEY` | — | 7 | Scylla Cloud secret key |
| `NATS_URL` | `nats://localhost:4222` | 10 | NATS server URL (for standalone streamer) |

## Scripts

```bash
bun run start       # Run all demos, then keep server alive (Demo 9 ready)
bun run stream      # Standalone Binance → NATS streamer (run in Terminal 2)
bun run typecheck   # Type-check without emitting
```
