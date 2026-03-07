# Helios

**Helios** is a distributed in-memory data platform written in TypeScript for [Bun](https://bun.sh). It brings Hazelcast-style distributed data structures, clustering, and stream processing to the JavaScript ecosystem — no JVM required.

- **3,461 tests** passing across 287 files
- **Zero external runtime dependencies** for the core
- **Production serialization** — full binary wire format compatible with Hazelcast clients
- **Multi-node TCP clustering** — partition replication, anti-entropy repair, vector clock conflict resolution
- **Embedded NATS** — stream processing without a separate NATS server

---

## Packages

| Package                                        | Description                                                        | Status      |
| ---------------------------------------------- | ------------------------------------------------------------------ | ----------- |
| [`@zenystx/helios-core`](#helioscore)                  | Distributed data structures, clustering, serialization, near-cache | **Shipped** |
| [`@zenystx/helios-nestjs`](#heliosnestjs)              | NestJS 11 integration — DI, decorators, health checks              | **Shipped** |
| [`@zenystx/helios-blitz`](#heliosblitz)                | NATS JetStream-backed stream & batch processing engine             | **Shipped** |
| [`@zenystx/helios-s3`](#helios-mapstore-packages)      | S3-backed MapStore for IMap persistence                            | **Shipped** |
| [`@zenystx/helios-mongodb`](#helios-mapstore-packages) | MongoDB-backed MapStore for IMap persistence                       | **Shipped** |
| [`@zenystx/helios-turso`](#helios-mapstore-packages)   | Turso/SQLite-backed MapStore for IMap persistence                  | **Shipped** |

---

## Quick Start

```bash
bun add @zenystx/helios-core
```

```typescript
import { Helios } from "@zenystx/helios-core";

const hz = Helios.newInstance();
const map = hz.getMap<string, number>("scores");

map.put("alice", 42);
map.put("bob", 99);

console.log(map.get("alice")); // 42
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

Connect to a running Helios cluster from a separate process using the binary client protocol.

```typescript
import { HeliosClient, ClientConfig } from "@zenystx/helios-core";

const config = new ClientConfig();
config.setClusterName("dev");
config.getNetworkConfig().addAddress("127.0.0.1:5701");

const client = HeliosClient.newHeliosClient(config);

const map = client.getMap<string, number>("scores");
await map.put("alice", 42);
console.log(await map.get("alice")); // 42

const queue = client.getQueue<string>("tasks");
await queue.offer("build");

const topic = client.getTopic<string>("events");
topic.addMessageListener((msg) => console.log(msg.getMessageObject()));
topic.publish("hello");

client.shutdown();
```

The remote client supports Map, Queue, Topic, ReliableTopic, distributed object lifecycle, near-cache, authentication, and automatic reconnect with listener re-registration. See `examples/native-app/src/client-*.ts` for auth, reconnect, and near-cache examples.

> **Note:** Some member-only data structures (IList, ISet, MultiMap, ReplicatedMap) are not available on the remote client. Use `HeliosInstanceImpl` directly for these. See `DEFERRED_CLIENT_FEATURES` for the full list of deferred capabilities.

---

## Standalone Server

Run Helios headless from the CLI, with a REST API included:

```bash
bun run helios-server.ts --port 5701
```

Or with the multi-node demo app (three nodes + REST + topic control API):

```bash
# From examples/native-app/
docker compose up --build

# In another shell
bash demo.sh
```

Manual startup also works:

```bash
# Terminal 1
bun run examples/native-app/src/app.ts --name node3 --tcp-port 5703 --rest-port 8083 --control-port 9093 --expected-cluster-size 3

# Terminal 2
bun run examples/native-app/src/app.ts --name node2 --tcp-port 5702 --rest-port 8082 --control-port 9092 --peer localhost:5703 --expected-cluster-size 3

# Terminal 3
bun run examples/native-app/src/app.ts --name node1 --tcp-port 5701 --rest-port 8081 --control-port 9091 --peer localhost:5702 --peer localhost:5703 --expected-cluster-size 3

# Write on node1, read from node3
curl -X POST http://localhost:8081/hazelcast/rest/maps/demo/user1 \
     -H 'Content-Type: application/json' -d '{"name":"Alice"}'
curl http://localhost:8083/hazelcast/rest/maps/demo/user1

# Publish to a topic and inspect what another node observed
curl -X POST http://localhost:9091/demo/topics/demo-events/publish \
     -H 'Content-Type: application/json' -d '{"message":"hello cluster"}'
curl http://localhost:9092/demo/topics/demo-events/messages

# K8s health probes
curl http://localhost:8081/hazelcast/health/ready
curl http://localhost:8081/hazelcast/rest/cluster
```

---

## `@zenystx/helios-core`

### Data Structures

| Structure          | Description                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| **IMap**           | Distributed key-value map — CRUD, putIfAbsent, getAll/putAll, entry processors, predicate queries, aggregations |
| **IQueue**         | Distributed FIFO queue with blocking offer/poll                                                                 |
| **ISet**           | Distributed set — add, remove, contains, iteration                                                              |
| **IList**          | Distributed list with index-based access                                                                        |
| **ITopic**         | Classic pub/sub messaging with async message listeners                                                          |
| **ReliableTopic**  | Ringbuffer-backed pub/sub with sequence-tracked consumption, overload policies, and bounded retention           |
| **MultiMap**       | One key, many values — add/get/remove per value                                                                 |
| **ReplicatedMap**  | Fully replicated map on every node — vector clock conflict resolution                                           |
| **Ringbuffer**     | Fixed-capacity circular buffer — add, readOne, readMany, TTL expiry, overflow policies                          |
| **Cache (JCache)** | CacheRecordStore, eviction policies, deferred values                                                            |

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

map.put("k", "v"); // written to map + propagated
map.get("k"); // near-cache MISS — fetched and cached locally
map.get("k"); // near-cache HIT — served instantly from memory
```

### Transactions

ACID transactions across data structures — ONE_PHASE for single-partition, TWO_PHASE for cross-partition.

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
| **Partition Replication**   | Data split across N partitions; backups replicated to peer nodes |
| **Anti-Entropy Repair**     | Background reconciliation detects and heals partition divergence |
| **Vector Clock Resolution** | ReplicatedMap conflict resolution on concurrent writes           |
| **Cluster Events**          | Member join/leave lifecycle events                               |

### REST API

Built-in HTTP REST server via `Bun.serve()` — zero extra dependencies.

| Endpoint group | Examples                                                |
| -------------- | ------------------------------------------------------- |
| `HEALTH_CHECK` | `GET /hazelcast/health/ready`, `/hazelcast/health/live` |
| `CLUSTER_READ` | `GET /hazelcast/rest/cluster`                           |
| `DATA`         | `GET/POST/DELETE /hazelcast/rest/maps/{name}/{key}`     |

```typescript
import { HeliosRestServer, RestEndpointGroup } from "@zenystx/helios-core";

const server = new HeliosRestServer(hz, {
  port: 8080,
  groups: [RestEndpointGroup.HEALTH_CHECK, RestEndpointGroup.DATA],
});
server.start();
```

### Other

| Feature          | Description                                                                          |
| ---------------- | ------------------------------------------------------------------------------------ |
| **HyperLogLog**  | Cardinality estimation — dense + sparse representation, merge support                |
| **Security**     | Password/token credentials, permission collection with wildcard matching             |
| **Config Model** | Typed config — MapConfig, NearCacheConfig, NetworkConfig, JoinConfig, EvictionConfig |

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

## Building from Source

```bash
git clone <repo-url>
cd helios
bun install
bun test              # 3,461 tests across 287 files
bun run tsc --noEmit  # type-check only
```

### Per-package tests

```bash
bun test packages/nestjs/   # 315 tests
bun test packages/blitz/    # 393 tests
```

---

## Project Structure

```
helios/
├── src/                    # @zenystx/helios-core source
│   ├── internal/           # Serialization, NIO, partitioning, near-cache internals
│   ├── cluster/            # Cluster join, member management
│   ├── map/ queue/ topic/  # Distributed data structure implementations
│   ├── rest/               # Built-in REST API server
│   └── instance/           # HeliosInstance lifecycle
├── test/                   # Core tests
├── packages/
│   ├── nestjs/             # @zenystx/helios-nestjs — NestJS integration (315 tests)
│   ├── blitz/              # @zenystx/helios-blitz — stream processing (393 tests)
│   ├── s3/                 # @zenystx/helios-s3 — S3 MapStore (14 tests)
│   ├── mongodb/            # @zenystx/helios-mongodb — MongoDB MapStore (15 tests)
│   └── turso/              # @zenystx/helios-turso — Turso/SQLite MapStore (18 tests)
├── examples/
│   ├── native-app/         # Two-node demo with REST API
│   └── nestjs-app/         # NestJS demo application
├── scripts/                # Build tooling, Java test converter
├── plans/                  # Implementation plans and architecture docs
└── helios-server.ts        # Standalone server entry point
```

---

## Helios MapStore Packages

Plug persistent storage into any `IMap` via the MapStore SPI — write-through on every `put`, or write-behind with batching and retry. Three backends are available out of the box.

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

| Package               | Backend                 | Install                   |
| --------------------- | ----------------------- | ------------------------- |
| **`@zenystx/helios-s3`**      | AWS S3 / S3-compatible  | `bun add @zenystx/helios-s3`      |
| **`@zenystx/helios-mongodb`** | MongoDB                 | `bun add @zenystx/helios-mongodb` |
| **`@zenystx/helios-turso`**   | Turso / LibSQL / SQLite | `bun add @zenystx/helios-turso`   |

All three implement the same `MapStore` interface — swap backends without changing application code.

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

| Item                    | Reason                                                            |
| ----------------------- | ----------------------------------------------------------------- |
| **SQL Engine**          | Requires porting Apache Calcite (~500k lines of Java)             |
| **CP Subsystem (Raft)** | Strong consistency via Raft consensus — significant protocol work |
| **Scheduled Executor**  | Distributed cron-style task execution                             |

### Not Porting

OSGi, WAN replication, CRDT, vector search, durable executor, flake ID generator, data connections, audit log, Hot Restart (enterprise), HD Memory (enterprise).

---

## License

Apache 2.0
