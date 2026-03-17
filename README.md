# Helios

**Helios** is a distributed in-memory data platform written in TypeScript for [Bun](https://bun.sh). It brings Hazelcast-style distributed data structures, clustering, and stream processing to the JavaScript ecosystem — no JVM required.

- **Comprehensive automated test suite** — 1680 core tests, 316 NestJS tests, 435 Blitz tests
- **Production serialization** — full binary wire format compatible with Hazelcast clients
- **Multi-node TCP clustering** — partition replication, anti-entropy repair, vector clock conflict resolution
- **300+ client protocol opcodes** — direct interop with `hazelcast-client@5.6.0`
- **Embedded NATS** — stream processing without a separate NATS server

---

## Packages

| Package                                                    | Description                                                       | Status      |
| ---------------------------------------------------------- | ----------------------------------------------------------------- | ----------- |
| [`@zenystx/helios-core`](#helioscore)                      | Distributed data structures, clustering, serialization, near-cache | **Shipped** |
| [`@zenystx/helios-nestjs`](#heliosnestjs)                  | NestJS 11 integration — DI, decorators, health checks             | **Shipped** |
| [`@zenystx/helios-blitz`](#heliosblitz)                    | NATS JetStream-backed stream & batch processing engine            | **Shipped** |
| `@zenystx/helios-management-center`                        | Real-time cluster monitoring, metrics visualization, alerting     | **Shipped** |
| [`@zenystx/helios-s3`](#helios-mapstore-packages)          | S3-backed MapStore for IMap persistence                           | **Shipped** |
| [`@zenystx/helios-mongodb`](#helios-mapstore-packages)     | MongoDB-backed MapStore for IMap persistence                      | **Shipped** |
| [`@zenystx/helios-turso`](#helios-mapstore-packages)       | Turso/SQLite-backed MapStore for IMap persistence                 | **Shipped** |
| [`@zenystx/helios-dynamodb`](#helios-mapstore-packages)    | DynamoDB-compatible MapStore for IMap persistence                 | **Shipped** |
| [`@zenystx/helios-scylla`](#helios-mapstore-packages)      | ScyllaDB/Alternator-backed MapStore for IMap persistence          | **Shipped** |

---

## Quick Start

```bash
bun add @zenystx/helios-core
```

```typescript
import { Helios, Predicates } from "@zenystx/helios-core";

const hz = Helios.newInstance();
const map = hz.getMap<string, number>("scores");

await map.put("alice", 42);
await map.put("bob", 99);

console.log(await map.get("alice")); // 42
console.log(map.values(Predicates.greaterThan("", 50))); // [99]

hz.shutdown();
```

---

## Multi-Node Cluster

Spin up a TCP cluster in a few lines. Nodes auto-discover each other and replicate data across partitions.

```typescript
import { Helios, HeliosConfig, NetworkConfig, TcpIpConfig } from "@zenystx/helios-core";

const cfg = new HeliosConfig();
cfg.setInstanceName("node-1");

const net = new NetworkConfig();
net.setPort(5701);

const tcp = new TcpIpConfig();
tcp.setEnabled(true);
tcp.addMember("127.0.0.1:5702"); // peer address
net.setTcpIpConfig(tcp);
cfg.setNetworkConfig(net);

const hz = Helios.newInstance(cfg);
```

Run a second node on port 5702 pointing back at 5701 — they'll form a cluster, split partitions between them, and replicate backups automatically.

---

## Remote Client

Connect to a running Helios cluster with the official `hazelcast-client` package.

```typescript
import { Client } from "hazelcast-client";

const client = await Client.newHazelcastClient({
  clusterName: "dev",
  network: {
    clusterMembers: ["127.0.0.1:5701"],
  },
});

try {
  const map = await client.getMap<string, number>("scores");
  await map.put("alice", 42);
  console.log(await map.get("alice"));

  const queue = await client.getQueue<string>("tasks");
  await queue.offer("build");

  const topic = await client.getReliableTopic<string>("events");
  topic.addMessageListener((msg) => console.log(msg.messageObject));
  await topic.publish("hello");
} finally {
  await client.shutdown();
}
```

Helios' supported remote boundary is the server-side client protocol plus live interoperability with the pinned official `hazelcast-client@5.6.0` package in `test/interop`.

To require credentials on the member-side client protocol, configure the server and official client with matching values:

```typescript
import { Helios, HeliosConfig } from "@zenystx/helios-core";
import { Client } from "hazelcast-client";

const serverConfig = new HeliosConfig("secured-cluster");
serverConfig.getNetworkConfig().setClientProtocolPort(5701);
serverConfig.getNetworkConfig().setClientProtocolUsernamePasswordAuth("admin", "secret");

const member = Helios.newInstance(serverConfig);

const client = await Client.newHazelcastClient({
  clusterName: "secured-cluster",
  network: {
    clusterMembers: ["127.0.0.1:5701"],
  },
  security: {
    usernamePassword: {
      username: "admin",
      password: "secret",
    },
  },
});
```

---

## `@zenystx/helios-core`

### Data Structures

| Structure              | Description                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| **IMap**               | Distributed key-value map — CRUD, putIfAbsent, getAll/putAll, entry processors, predicate queries, aggregations |
| **IQueue**             | Distributed FIFO queue with blocking offer/poll                                                                 |
| **ISet**               | Distributed set — add, remove, contains, iteration                                                              |
| **IList**              | Distributed list with index-based access                                                                        |
| **ITopic**             | Classic pub/sub messaging with async message listeners                                                          |
| **ReliableTopic**      | Ringbuffer-backed pub/sub with owner-routed publish acks, overload policies, and bounded retention              |
| **MultiMap**           | One key, many values — add/get/remove per value                                                                 |
| **ReplicatedMap**      | Fully replicated map on every node — vector clock conflict resolution                                           |
| **Ringbuffer**         | Fixed-capacity circular buffer — add, readOne, readMany, TTL expiry, overflow policies                          |
| **Distributed Cache**  | JSR-107-style cache with eviction policies and deferred values                                                  |

### Compute

| Service                       | Description                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **IExecutorService**          | Distributed task execution — submit to partition, member, or all members with cancel, shutdown, task pooling |
| **DurableExecutor**           | Durable executor protocol — submit, retrieve, dispose results by sequence via client protocol                |
| **IScheduledExecutorService** | Delayed and recurring task execution — cron-style scheduling with crash recovery and anti-entropy             |

### CP Subsystem

Single-node CP data structures with session management. Multi-node Raft consensus is deferred to v2.

| Service              | Description                                                                  |
| -------------------- | ---------------------------------------------------------------------------- |
| **AtomicLong**       | Linearizable 64-bit counter — get, set, compareAndSet, getAndAdd, alter      |
| **AtomicReference**  | Linearizable object reference — get, set, compareAndSet, alter, apply        |
| **FencedLock**       | Reentrant distributed lock with fencing tokens, FIFO waiter queuing          |
| **Semaphore**        | Distributed counting semaphore — acquire, release, drain, session-aware      |
| **CountDownLatch**   | Distributed latch — trySetCount, countDown, await with timeout               |

### SQL

Subset SQL engine operating on IMap data:

```typescript
const result = hz.getSql().execute("SELECT * FROM employees WHERE age > ?", [30]);
for await (const row of result) {
  console.log(row);
}
```

Supports `SELECT`, `INSERT`, `UPDATE`, `DELETE` with `WHERE`, `ORDER BY`, `LIMIT`, `OFFSET`.

### Querying & Aggregations

```typescript
import { Predicates } from "@zenystx/helios-core";

const map = hz.getMap<string, Employee>("employees");

// Filter with predicates
const engineers = map.values(Predicates.equal("dept", "Engineering"));
const seniors = map.values(Predicates.greaterThan("age", 30));
const top = map.values(
  Predicates.and(
    Predicates.equal("dept", "Engineering"),
    Predicates.greaterEqual("age", 30),
  ),
);

// Pattern matching
const aNames = map.values(Predicates.like("name", "A%"));
```

Supported predicates: `equal`, `notEqual`, `greaterThan`, `greaterEqual`, `lessThan`, `lessEqual`, `between`, `like`, `ilike`, `regex`, `in`, `and`, `or`, `not`.

Aggregations: `count`, `sum`, `avg`, `min`, `max`, `distinct` — all with BigDecimal / BigInteger / Double / Integer / Long variants.

### Near-Cache

Cache hot data client-side to eliminate round trips. Supports TTL, max-idle, LRU/LFU eviction, size limits, TCP cross-node invalidation, and anti-entropy repair.

```typescript
const ncCfg = new NearCacheConfig();
ncCfg.setTimeToLiveSeconds(300);
ncCfg.setMaxIdleSeconds(60);
ncCfg.setMaxSize(10_000);

const mapCfg = new MapConfig();
mapCfg.setNearCacheConfig(ncCfg);

const cfg = new HeliosConfig();
cfg.addMapConfig("hot-data", mapCfg);

const hz = Helios.newInstance(cfg);
const map = hz.getMap<string, unknown>("hot-data");

await map.put("k", "v"); // written to map + propagated
await map.get("k"); // near-cache MISS — fetched and cached locally
await map.get("k"); // near-cache HIT — served instantly from memory
```

### Transactions

ACID transactions across data structures — ONE_PHASE for single-partition, TWO_PHASE for cross-partition. Full protocol support for transactional Map, Queue, List, Set, and MultiMap.

```typescript
const ctx = hz.newTransactionContext();
ctx.beginTransaction();
try {
  const map = ctx.getMap<string, number>("accounts");
  map.put("alice", map.get("alice") - 100);
  map.put("bob", map.get("bob") + 100);
  ctx.commitTransaction();
} catch (e) {
  ctx.rollbackTransaction();
}
```

### Serialization

Full binary wire format — HeapData, built-in type serializers (all Java primitives + arrays + UUID + JSON), DataSerializable, Portable, GenericRecord. Custom serializers supported via `SerializerConfig`.

```typescript
const cfg = new HeliosConfig();
cfg.getSerializationConfig().addCustomSerializer(MySerializer);
```

> **Note:** Plain Java `DataSerializable` objects (without `IdentifiedDataSerializable`) are not wire-compatible — Helios v1 uses `JavaScriptJsonSerializer` for complex objects by default.

### Clustering

| Feature                     | Description                                                      |
| --------------------------- | ---------------------------------------------------------------- |
| **TCP Peer-to-Peer**        | Nodes discover and connect via configured member addresses       |
| **Multicast Discovery**     | UDP multicast auto-discovery for LAN deployments                 |
| **Partition Replication**   | Data split across 271 partitions; backups replicated to peers    |
| **Partition Migration**     | Live data migration when members join or leave                   |
| **Anti-Entropy Repair**     | Background reconciliation detects and heals partition divergence |
| **Vector Clock Resolution** | ReplicatedMap conflict resolution on concurrent writes           |
| **Cluster Events**          | Member join/leave lifecycle events                               |

### REST API

Built-in HTTP REST server via `Bun.serve()`.

| Endpoint group  | Examples                                                |
| --------------- | ------------------------------------------------------- |
| `HEALTH_CHECK`  | `GET /hazelcast/health/ready`, `/hazelcast/health/live` |
| `CLUSTER_READ`  | `GET /hazelcast/rest/cluster`                           |
| `CLUSTER_WRITE` | `POST /hazelcast/rest/management/...`                   |
| `DATA`          | `GET/POST/DELETE /hazelcast/rest/maps/{name}/{key}`     |
| `ADMIN`         | `POST /helios/admin/...`                                |
| `MONITOR`       | `GET /helios/monitor/...`                               |

```typescript
import { HeliosRestServer, RestEndpointGroup } from "@zenystx/helios-core";

const server = new HeliosRestServer(hz, {
  port: 8080,
  groups: [RestEndpointGroup.HEALTH_CHECK, RestEndpointGroup.DATA],
});
server.start();
```

### Other

| Feature               | Description                                                                          |
| --------------------- | ------------------------------------------------------------------------------------ |
| **FlakeIdGenerator**  | Globally unique, time-ordered 64-bit ID generation with client-side batching         |
| **PNCounter**         | Conflict-free replicated counter (CRDT) — increment/decrement across nodes           |
| **HyperLogLog**       | Cardinality estimation — dense + sparse representation, merge support                |
| **Diagnostics**       | SlowOperationDetector, StoreLatencyTracker, SystemEventLog                           |
| **Production Logger** | Level-filtered logger with timestamps — replaces test-support ConsoleLogger           |
| **Security**          | Password/token credentials, permission collection with wildcard matching             |
| **Config Model**      | Typed config — MapConfig, NearCacheConfig, NetworkConfig, JoinConfig, EvictionConfig |

---

## `@zenystx/helios-nestjs`

First-class NestJS 11 integration.

```bash
bun add @zenystx/helios-nestjs
```

```typescript
import { Module, Injectable } from "@nestjs/common";
import {
  HeliosModule,
  HeliosCacheModule,
  InjectHelios,
  InjectMap,
  Cacheable,
  CacheEvict,
  Transactional,
} from "@zenystx/helios-nestjs";

@Module({
  imports: [
    HeliosModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        instanceConfig: new HeliosConfig(config.get("NODE_NAME")),
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
    @InjectMap("users") private readonly users: IMap<string, User>,
  ) {}

  @Cacheable({ mapName: "users", key: (id: string) => `user:${id}` })
  async getUser(id: string): Promise<User> {
    return this.db.findUser(id); // only called on cache miss
  }

  @CacheEvict({ mapName: "users", key: (id: string) => `user:${id}` })
  async updateUser(id: string, data: Partial<User>): Promise<void> {
    await this.db.updateUser(id, data);
  }

  @Transactional()
  async transfer(from: string, to: string, amount: number): Promise<void> {
    // runs inside a Helios transaction — auto-commit or rollback
  }
}
```

| Feature                                                  | Description                                                                                                       |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **HeliosModule**                                         | `forRoot()` / `forRootAsync()` via `ConfigurableModuleBuilder` — supports `useFactory`, `useClass`, `useExisting` |
| **`@InjectHelios()`**                                    | Inject the `HeliosInstance` directly                                                                              |
| **`@InjectMap()` / `@InjectQueue()` / `@InjectTopic()`** | Typed injection of individual data structures by name                                                             |
| **`@Cacheable` / `@CacheEvict` / `@CachePut`**           | Method-level cache decorators (Spring Cache equivalent)                                                           |
| **`@Transactional`**                                     | DI-based transaction decorator — resolves context via `AsyncLocalStorage`, no static singleton                    |
| **HeliosHealthIndicator**                                | Health check integration for `@nestjs/terminus`                                                                   |
| **Event Bridge**                                         | Bridge Helios map/topic/lifecycle events to `@nestjs/event-emitter`                                               |
| **Lifecycle Safety**                                     | `OnModuleDestroy` → `instance.shutdown()` — no leaked connections                                                 |

---

## `@zenystx/helios-blitz`

NATS JetStream-backed stream and batch processing — an embedded, TypeScript-native replacement for Hazelcast Jet. Includes an embedded NATS server, so no separate broker is needed.

```bash
bun add @zenystx/helios-blitz
```

```typescript
import { BlitzService } from "@zenystx/helios-blitz";

// Start with embedded single-node NATS (no external broker needed)
const blitz = await BlitzService.start();

// Or connect to an existing cluster
const blitz = await BlitzService.start({
  servers: ["nats://localhost:4222"],
});

// Build a pipeline
const pipeline = blitz
  .newPipeline()
  .source(Sources.natsSubject("orders"))
  .filter((order) => order.total > 100)
  .map((order) => ({ ...order, vip: true }))
  .sink(Sinks.heliosMap(hz, "vip-orders"));

await pipeline.submit();
await blitz.shutdown();
```

| Feature             | Description                                                                  |
| ------------------- | ---------------------------------------------------------------------------- |
| **Embedded NATS**   | Auto-spins up a `nats-server` process — zero broker setup for dev/test       |
| **Pipeline API**    | Fluent DAG builder — source, map, filter, flatMap, merge, branch, sink       |
| **Windowing**       | Tumbling, sliding, and session windows with NATS KV-backed state             |
| **Aggregations**    | count, sum, min, max, avg, distinct — windowed and grouped                   |
| **Stream Joins**    | Hash join (stream-table via IMap) + windowed stream-stream join              |
| **Fault Tolerance** | At-least-once delivery, configurable retry, dead-letter routing              |
| **Batch Mode**      | Bounded pipelines with `BatchResult` — file, IMap snapshot, JetStream replay |
| **Sources**         | NATS subject, JetStream stream, Helios IMap/ITopic, file, HTTP webhook       |
| **Sinks**           | NATS subject/stream, Helios IMap/ITopic, file                                |
| **NestJS Module**   | `HeliosBlitzModule.forRoot()` / `forRootAsync()` + `@InjectBlitz()`          |

---

## Helios MapStore Packages

Plug persistent storage into any `IMap` via the MapStore SPI — write-through on every `put`, or write-behind with batching and retry. Five backends are available out of the box.

```typescript
import { S3MapStore } from "@zenystx/helios-s3";

const cfg = new HeliosConfig();
const mapCfg = new MapConfig();
mapCfg.setMapStoreConfig(
  new MapStoreConfig()
    .setEnabled(true)
    .setImplementation(
      new S3MapStore({ bucket: "my-bucket", region: "us-east-1" }),
    )
    .setWriteDelaySeconds(5), // 0 = write-through, >0 = write-behind
);
cfg.addMapConfig("persistent-map", mapCfg);
```

| Package                        | Backend                          | Install                          |
| ------------------------------ | -------------------------------- | -------------------------------- |
| **`@zenystx/helios-s3`**      | AWS S3 / S3-compatible           | `bun add @zenystx/helios-s3`      |
| **`@zenystx/helios-mongodb`** | MongoDB                          | `bun add @zenystx/helios-mongodb` |
| **`@zenystx/helios-turso`**   | Turso / LibSQL / SQLite          | `bun add @zenystx/helios-turso`   |
| **`@zenystx/helios-dynamodb`** | DynamoDB-compatible             | `bun add @zenystx/helios-dynamodb` |
| **`@zenystx/helios-scylla`**  | ScyllaDB / Alternator            | `bun add @zenystx/helios-scylla`  |

All five implement the same `MapStore` interface — swap backends without changing application code.

---

## Building from Source

```bash
git clone <repo-url>
cd helios
bun install
bun test              # run the full test suite
bun run tsc --noEmit  # type-check only
```

### Per-package tests

```bash
bun test packages/nestjs/   # 316 tests
bun test packages/blitz/    # 435 tests
```

---

## Project Structure

```
helios/
├── src/                    # @zenystx/helios-core source
│   ├── internal/           # Serialization, NIO, partitioning, near-cache internals
│   ├── cluster/            # TCP clustering, multicast discovery, member management
│   ├── map/ collection/ topic/ # Distributed data structure implementations (IMap, IQueue, IList, ISet)
│   ├── executor/           # Distributed executor service (IExecutorService)
│   ├── scheduledexecutor/  # Scheduled executor with crash recovery
│   ├── cp/                 # CP Subsystem — AtomicLong, FencedLock, Semaphore, etc.
│   ├── sql/                # SQL engine for IMap queries
│   ├── rest/               # Built-in REST API server
│   ├── logging/            # Production logger with level filtering
│   ├── diagnostics/        # SlowOperationDetector, latency tracking, event log
│   └── instance/           # HeliosInstance lifecycle
├── test/                   # Core tests (1680 tests)
├── packages/
│   ├── nestjs/             # @zenystx/helios-nestjs — NestJS integration (316 tests)
│   ├── blitz/              # @zenystx/helios-blitz — stream processing (435 tests)
│   ├── management-center/  # @zenystx/helios-management-center — cluster monitoring
│   ├── s3/                 # @zenystx/helios-s3 — S3 MapStore
│   ├── mongodb/            # @zenystx/helios-mongodb — MongoDB MapStore
│   ├── turso/              # @zenystx/helios-turso — Turso/SQLite MapStore
│   ├── dynamodb/           # @zenystx/helios-dynamodb — DynamoDB MapStore
│   └── scylla/             # @zenystx/helios-scylla — ScyllaDB/Alternator MapStore
├── examples/
│   └── nestjs-app/         # NestJS demo application
├── scripts/                # Build tooling, Java test converter
├── plans/                  # Implementation plans and architecture docs
└── helios-server.ts        # Standalone server entry point
```

---

## Runtime Requirements

| Requirement     | Version                                    |
| --------------- | ------------------------------------------ |
| **Bun**         | 1.x                                        |
| **TypeScript**  | 6.0 beta (ES2025 target)                   |
| **NestJS**      | 11.x (for `@zenystx/helios-nestjs` only)           |
| **nats-server** | Auto-downloaded by `@zenystx/helios-blitz` via npm |

---

## Roadmap

### Deferred to v2

| Item                              | Reason                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| **CP Subsystem (distributed Raft)** | CP atomics are fully implemented (single-node Raft); only multi-node Raft consensus is deferred |

### Not Porting

OSGi, WAN replication, vector search, data connections, audit log, Hot Restart (enterprise), HD Memory (enterprise).

---

## License

Apache 2.0
