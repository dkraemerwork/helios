# Helios

**Helios** is a TypeScript/Bun port of [Hazelcast](https://hazelcast.com/) — a distributed in-memory data platform.

This project is currently in alpha and I do not recommend production use.

Built from scratch in TypeScript targeting Bun and ES2025.

---

## Feature Status

### Working Now

| Feature | Status | Tests |
|---|---|---|
| **IMap** — distributed key-value map | Full CRUD, putIfAbsent, getAll/putAll, entry processors, partition-wide ops | 77 |
| **Predicate Queries** — filter map entries | equal, notEqual, greaterThan, lessThan, between, like, ilike, regex, in, and, or, not | 61 |
| **Aggregations** — count, sum, avg, min, max, distinct | All aggregator types with BigDecimal/BigInteger/Double/Integer/Long variants | 90 |
| **Near-Cache** — client-side read cache | TTL, LRU/LFU eviction, size limits, invalidation (single + batch), preloader, repair | 180+ |
| **Near-Cache TCP Invalidation** — cross-node cache coherence | PUT on node A invalidates near-cache on node B via TCP | 10 |
| **IQueue / ISet / IList** — distributed collections | Full Java Collection-equivalent API | 149 |
| **ITopic** — pub/sub messaging | Publish, subscribe, message listeners | included |
| **MultiMap** — one key, many values | put, get, remove, containsKey, keySet, values, entrySet | included |
| **ReplicatedMap** — fully replicated map | Lazy replication with vector clock conflict resolution | included |
| **Ringbuffer** — fixed-capacity circular buffer | Add, readOne, readMany, TTL expiry, overflow policies | 42 |
| **Cache (JCache)** — javax.cache compatible | CacheRecordStore, eviction checker, deferred values | 51 |
| **Transactions** — ACID across data structures | ONE_PHASE + TWO_PHASE commit, TransactionLog, TransactionManager | 44 |
| **Security** — credentials + permissions | Password/token credentials, permission collection with wildcard matching | 57 |
| **Binary Serialization** — zero-copy wire format | HeapData, ByteArrayObjectDataInput/Output, DataSerializableHeader | 134 |
| **Client Protocol** — binary client codec layer | ClientMessage encode/decode, frame splitting, codec infrastructure | 80+ |
| **TCP Clustering** — multi-node communication | Peer-to-peer TCP transport, data replication, cluster join | 6 |
| **NestJS Integration** — DI module for NestJS apps | HeliosModule, HeliosCacheModule, HeliosTransactionModule, @Transactional | 141 |
| **Standalone Server** — run headless from CLI | `bun run helios-server.ts --port 5701` | 36 |
| **HTTP Demo App** — REST API over Helios | Map CRUD, near-cache stats, predicate queries via HTTP | 25 |
| **HyperLogLog** — cardinality estimation | Dense + sparse representation, merge support | 19 |
| **JSON Parser** — custom zero-dep parser/writer | Full JSON spec, pretty print, streaming writer | 380 |
| **Config Model** — typed configuration | MapConfig, NearCacheConfig, NetworkConfig, JoinConfig, EvictionConfig, TcpIpConfig | 72 |

### Planned (Phase 9 — NestJS Package Modernization)

| Feature | Description |
|---|---|
| `ConfigurableModuleBuilder` | Replace hand-rolled `forRoot()`/`forRootAsync()` with NestJS builder pattern |
| `@InjectHelios()` / `@InjectMap()` | Convenience decorators for DI injection of Helios instances and data structures |
| `registerAsync` | Async factory support for HeliosCacheModule and HeliosTransactionModule |
| DI-based `@Transactional` | Remove static singleton, resolve via NestJS dependency injection |
| `HeliosHealthIndicator` | Health check integration for `@nestjs/terminus` |
| `@Cacheable` / `@CacheEvict` / `@CachePut` | Method-level cache decorators (Spring Cache equivalent) |
| Event Bridge | Bridge Helios map/topic/lifecycle events to `@nestjs/event-emitter` |
| Symbol-based tokens | Replace string tokens with Symbol injection tokens + `OnModuleDestroy` hooks |
| `@helios/nestjs` package | Extract NestJS code to separate `packages/nestjs/` with subpath exports |

### Deferred (v1.5 / v2)

| Feature | Version | Reason |
|---|---|---|
| SQL Engine | v2 | Requires porting Apache Calcite (~500k lines) |
| Jet Stream Processing | v1.5 | DAG-based stream engine, complex but tractable |
| CP Subsystem (Raft) | v2 | Strong consistency via Raft consensus |
| Scheduled Executor | v2 | Distributed scheduled task execution |

### Not Porting

OSGi, WAN replication, CRDT, vector search, durable executor, flake ID generator,
data connections, Kafka/Hadoop/MongoDB/S3 extensions, audit log, hot restart, persistence.

---

## Quick Start

```typescript
import { Helios } from 'helios';

const hz = Helios.newInstance();
const map = hz.getMap<string, number>('my-map');
map.put('key', 42);
console.log(map.get('key')); // 42
hz.shutdown();
```

---

## Multi-Node TCP Cluster

```typescript
import { Helios, HeliosConfig, NetworkConfig, TcpIpConfig } from 'helios';

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
import { Helios, HeliosConfig, MapConfig, NearCacheConfig } from 'helios';

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
import { Predicates } from 'helios';

const map = hz.getMap<string, { name: string; age: number; dept: string }>('employees');

// Simple predicates
const engineers = map.values(Predicates.equal('dept', 'Engineering'));
const seniors = map.values(Predicates.greaterThan('age', 30));
const midRange = map.values(Predicates.between('age', 25, 40));

// Compound predicates
const seniorEngineers = map.values(
  Predicates.and(
    Predicates.equal('dept', 'Engineering'),
    Predicates.greaterEqual('age', 30)
  )
);

// Pattern matching
const aNames = map.values(Predicates.like('name', 'A%'));
const regex = map.values(Predicates.regex('name', '^[A-D].*$'));
```

---

## NestJS Integration

```typescript
import { Module } from '@nestjs/common';
import { HeliosModule, HeliosCacheModule } from 'helios';

@Module({
  imports: [
    HeliosModule.forRoot({ instanceName: 'nestjs-helios' }),
    HeliosCacheModule.register({ ttl: 60_000 }),
  ],
})
export class AppModule {}
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

The demo shows: data replication, near-cache hit/miss/invalidation, and predicate queries over HTTP.

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
bun test           # 2,271 tests
bun run tsc --noEmit  # typecheck

# Demo app
cd app && bun install && bun test  # 25 tests
```

---

## Project Structure

```
helios/
├── src/           # Core library (482 source files)
├── test/          # Tests (227 test files, 2,271 tests)
├── app/           # Demo app (HTTP + near-cache + predicates, 25 tests)
├── packages/
│   └── nestjs/    # @helios/nestjs NestJS integration (141 tests)
├── scripts/       # Java-to-TypeScript test converter
├── examples/      # Smoke test example
└── plans/         # Porting plan and roadmap
```

---

## Runtime

- **Bun** 1.x
- **TypeScript** 6.0 beta (ES2025 target)
- **NestJS** 11.x (for DI integration)

---

## License

Apache 2.0
