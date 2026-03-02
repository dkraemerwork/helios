# Helios

**Helios** is a distributed in-memory data platform built from scratch in TypeScript for Bun and ES2025. Inspired by [Hazelcast](https://hazelcast.com/) — production-grade, zero JVM dependency.

---

## Packages

| Package | Description | Status |
|---|---|---|
| **`@helios/core`** | Distributed data structures, clustering, serialization, near-cache | Shipped |
| **`@helios/nestjs`** | First-class NestJS 11 integration with modern DI patterns | Shipped |
| **`@helios/blitz`** | NATS JetStream-backed stream & batch processing engine | Planned |
| **`@helios/s3`** | S3-backed MapStore for IMap persistence | Planned |
| **`@helios/mongodb`** | MongoDB-backed MapStore for IMap persistence | Planned |
| **`@helios/turso`** | Turso/SQLite-backed MapStore for IMap persistence | Planned |

---

## `@helios/core`

| Feature | Description |
|---|---|
| **IMap** | Distributed key-value map — CRUD, putIfAbsent, getAll/putAll, entry processors, partition-wide ops, predicate queries, aggregations |
| **Near-Cache** | Client-side read cache — TTL, LRU/LFU eviction, size limits, single + batch invalidation, preloader, anti-entropy repair, TCP cross-node invalidation |
| **Predicate Queries** | Filter map entries — equal, notEqual, greaterThan, lessThan, between, like, ilike, regex, in, and, or, not |
| **Aggregations** | count, sum, avg, min, max, distinct — all types with BigDecimal/BigInteger/Double/Integer/Long variants |
| **IQueue / ISet / IList** | Distributed collections with full Collection-equivalent API |
| **ITopic** | Pub/sub messaging with message listeners |
| **MultiMap** | One key, many values |
| **ReplicatedMap** | Fully replicated map with vector clock conflict resolution |
| **Ringbuffer** | Fixed-capacity circular buffer — add, readOne, readMany, TTL expiry, overflow policies |
| **Cache (JCache)** | CacheRecordStore, eviction checker, deferred values |
| **Transactions** | ACID across data structures — ONE_PHASE + TWO_PHASE commit |
| **Security** | Password/token credentials, permission collection with wildcard matching |
| **Binary Serialization** | Zero-copy wire format — HeapData, DataSerializable, Portable, GenericRecord |
| **Client Protocol** | Binary client codec layer — ClientMessage encode/decode, frame splitting |
| **TCP Clustering** | Peer-to-peer TCP transport, data replication, cluster join |
| **HyperLogLog** | Cardinality estimation — dense + sparse representation, merge support |
| **Config Model** | Typed configuration — MapConfig, NearCacheConfig, NetworkConfig, JoinConfig, EvictionConfig |
| **Standalone Server** | Run headless from CLI — `bun run helios-server.ts --port 5701` |

## `@helios/nestjs`

| Feature | Description |
|---|---|
| **HeliosModule** | `forRoot()` / `forRootAsync()` via `ConfigurableModuleBuilder` — supports `useFactory`, `useClass`, `useExisting` |
| **`@InjectHelios()`** | Convenience decorator for injecting `HeliosInstance` |
| **`@InjectMap()` / `@InjectQueue()` / `@InjectTopic()`** | Typed injection of individual data structures by name |
| **`@Cacheable` / `@CacheEvict` / `@CachePut`** | Method-level cache decorators (Spring Cache equivalent) |
| **`@Transactional`** | DI-based transaction decorator — resolves via `AsyncLocalStorage`, no static singleton |
| **`registerAsync`** | Async factory support for `HeliosCacheModule` and `HeliosTransactionModule` |
| **HeliosHealthIndicator** | Health check integration for `@nestjs/terminus` |
| **Event Bridge** | Bridge Helios map/topic/lifecycle events to `@nestjs/event-emitter` |
| **Lifecycle Safety** | `OnModuleDestroy` → `instance.shutdown()` — no leaked connections |
| **Symbol Tokens** | Collision-safe `Symbol()` injection tokens |

## `@helios/blitz` (Planned)

NATS JetStream-backed stream and batch processing engine — replaces Hazelcast Jet with a TypeScript-idiomatic pipeline API.

| Feature | Description |
|---|---|
| **Pipeline API** | Fluent DAG builder — source, map, filter, flatMap, merge, branch, sink |
| **Windowing** | Tumbling, sliding, and session windows with NATS KV-backed state |
| **Aggregations** | count, sum, min, max, avg, distinct — windowed and grouped |
| **Stream Joins** | Hash join (stream-table via IMap) + windowed stream-stream join |
| **Fault Tolerance** | At-least-once delivery, configurable retry, dead-letter routing, checkpoint/restart |
| **Batch Mode** | Bounded pipelines with `BatchResult` — file, IMap snapshot, JetStream replay |
| **Sources** | NATS subject, JetStream stream, Helios IMap/ITopic, file, HTTP webhook |
| **Sinks** | NATS subject/stream, Helios IMap/ITopic, file |
| **NestJS Module** | `HeliosBlitzModule.forRoot()` / `forRootAsync()` + `@InjectBlitz()` |

## Planned Extensions

| Package | Description |
|---|---|
| **Built-in REST API** | K8s health probes, cluster info, IMap CRUD, IQueue ops — via `Bun.serve()`, zero dependencies |
| **MapStore SPI** | Pluggable persistence layer for IMap — write-through, write-behind with batching and retry |
| **`@helios/s3`** | S3-backed MapStore with per-map key prefix scoping |
| **`@helios/mongodb`** | MongoDB-backed MapStore with per-map collection scoping |
| **`@helios/turso`** | Turso/LibSQL-backed MapStore with per-map table scoping |

## Deferred to v2

| Feature | Reason |
|---|---|
| SQL Engine | Requires porting Apache Calcite (~500k lines) |
| CP Subsystem (Raft) | Strong consistency via Raft consensus |
| Scheduled Executor | Distributed scheduled task execution |

## Not Porting

OSGi, WAN replication, CRDT, vector search, durable executor, flake ID generator,
data connections, audit log, Hot Restart (enterprise), HD Memory (enterprise).

---

## Quick Start

```typescript
import { Helios } from '@helios/core';

const hz = Helios.newInstance();
const map = hz.getMap<string, number>('my-map');
map.put('key', 42);
console.log(map.get('key')); // 42
hz.shutdown();
```

---

## Multi-Node TCP Cluster

```typescript
import { Helios, HeliosConfig, NetworkConfig, TcpIpConfig } from '@helios/core';

const cfg = new HeliosConfig();
cfg.setInstanceName('node-1');
const net = new NetworkConfig();
net.setPort(5701);
const tcp = new TcpIpConfig();
tcp.setEnabled(true);
tcp.addMember('127.0.0.1:5702');
net.setTcpIpConfig(tcp);
cfg.setNetworkConfig(net);

const hz = Helios.newInstance(cfg);
```

---

## Near-Cache

```typescript
import { Helios, HeliosConfig, MapConfig, NearCacheConfig } from '@helios/core';

const cfg = new HeliosConfig();
const mapCfg = new MapConfig();
const ncCfg = new NearCacheConfig();
ncCfg.setTimeToLiveSeconds(300);
ncCfg.setMaxIdleSeconds(60);
ncCfg.setMaxSize(10_000);
mapCfg.setNearCacheConfig(ncCfg);
cfg.addMapConfig('hot-data', mapCfg);

const hz = Helios.newInstance(cfg);
const map = hz.getMap<string, unknown>('hot-data');

map.put('k', 'v');     // stored in map + replicated
map.get('k');           // near-cache MISS (fetched from store, cached locally)
map.get('k');           // near-cache HIT (served from local cache)
```

---

## Predicate Queries

```typescript
import { Predicates } from '@helios/core';

const map = hz.getMap<string, { name: string; age: number; dept: string }>('employees');

// Simple predicates
const engineers = map.values(Predicates.equal('dept', 'Engineering'));
const seniors = map.values(Predicates.greaterThan('age', 30));

// Compound predicates
const seniorEngineers = map.values(
  Predicates.and(
    Predicates.equal('dept', 'Engineering'),
    Predicates.greaterEqual('age', 30)
  )
);

// Pattern matching
const aNames = map.values(Predicates.like('name', 'A%'));
```

---

## NestJS Integration

```typescript
import { Module, Injectable } from '@nestjs/common';
import { HeliosModule, HeliosCacheModule, InjectHelios, InjectMap, Cacheable } from '@helios/nestjs';

@Module({
  imports: [
    HeliosModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        config: new HeliosConfig(config.get('HELIOS_NAME')),
      }),
      inject: [ConfigService],
    }),
    HeliosCacheModule.registerAsync({
      useFactory: () => ({ ttl: 60_000 }),
    }),
  ],
})
export class AppModule {}

@Injectable()
class UserService {
  constructor(
    @InjectHelios() private readonly helios: HeliosInstance,
    @InjectMap('users') private readonly users: IMap<string, User>,
  ) {}

  @Cacheable({ mapName: 'users', key: (id: string) => `user:${id}` })
  async getUser(id: string): Promise<User> {
    return this.db.findUser(id); // only called on cache miss
  }
}
```

---

## Demo App

The `app/` directory contains a runnable demo with two Helios nodes communicating over TCP:

```bash
# Terminal 1
bun run app/src/app.ts --name node1 --tcp-port 5701 --http-port 3001

# Terminal 2
bun run app/src/app.ts --name node2 --tcp-port 5702 --http-port 3002 --peer localhost:5701

# Run the demo script
bash app/demo.sh
```

---

## Standalone Server

```bash
bun run helios-server.ts --port 5701
```

---

## Building from Source

```bash
git clone <repo-url>
cd helios
bun install
bun test                # ~2,471 tests
bun run tsc --noEmit    # typecheck
```

---

## Project Structure

```
helios/
├── src/             # @helios/core library
├── test/            # Core tests (~2,271 tests)
├── packages/
│   ├── nestjs/      # @helios/nestjs NestJS integration (~175 tests)
│   └── blitz/       # @helios/blitz stream processing (planned)
├── app/             # Demo app (HTTP + near-cache + predicates, 25 tests)
├── scripts/         # Build and test tooling
├── examples/        # Smoke test example
└── plans/           # Implementation plans and roadmap
```

---

## Runtime

- **Bun** 1.x
- **TypeScript** 6.0 beta (ES2025 target)
- **NestJS** 11.x (for `@helios/nestjs`)

---

## License

Apache 2.0
