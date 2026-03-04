# Hazelcast → Helios Port: End-to-End TDD Plan

---

## What Is Helios

Helios is a production TypeScript/Bun/NestJS port of Hazelcast — a distributed in-memory
data platform. The Java source (read-only spec) lives in `../helios-1/` (the original
Hazelcast monorepo). This repo (`helios/`) is the standalone TypeScript project.

**Goal**: A production-ready, end-to-end running Helios — not a 1:1 academic port of every
Hazelcast file. We port what is required for production. Everything else is deferred or
replaced with idiomatic TypeScript equivalents.

**Tool versions**: Bun 1.x | TypeScript 6.0 beta (`typescript@beta`) | NestJS 11.1.14

---

## TypeScript 6.0 Beta Context

> Source: https://devblogs.microsoft.com/typescript/announcing-typescript-6-0-beta/

TS 6.0 is the last JS-based compiler. TS 7.0 will be the native Go port. All TS 6.0
deprecations become **hard errors in 7.0**. This project is pre-aligned.

### New defaults (already reflected in our tsconfig)

| Option | New default (TS 6.0) | Our setting |
|---|---|---|
| `strict` | `true` | `true` ✅ |
| `module` | `esnext` | `ESNext` ✅ |
| `target` | `es2025` (floating) | `ES2025` ✅ |
| `noUncheckedSideEffectImports` | `true` | `true` ✅ |
| `types` | `[]` (empty — explicit required) | `["bun-types"]` ✅ |
| `rootDir` | `.` (tsconfig dir) | `"."` ✅ |

### Deprecated → hard errors in TS 7.0 (all avoided)

| Deprecated | Action |
|---|---|
| `baseUrl` | Removed — `paths` use explicit `"./src/*"` prefix |
| `moduleResolution: node` (node10) | Not used — using `"bundler"` |
| `target: es5`, `downlevelIteration` | Not used |
| `module: amd/umd/systemjs` | Not used |
| `outFile` | Not used |
| `moduleResolution: classic` | Not used |
| `esModuleInterop: false` / `allowSyntheticDefaultImports: false` | Both always `true` |
| `alwaysStrict: false` | Not set |
| `asserts` import keyword | Not used — use `with` |
| `module Foo {}` namespace syntax | Not used — use `namespace` |

### New ES2025 features — use these instead of Java equivalents

| Feature | Helios use case |
|---|---|
| `Temporal` API (via `TimeSource`/`Clock`) | TTL, scheduling, time math — replaces `java.time.*` without hard runtime coupling |
| `Map.getOrInsert()` / `getOrInsertComputed()` | Replaces Java `computeIfAbsent` |
| `RegExp.escape()` | Safe dynamic regex |
| `Promise.try()` | Cleaner async error wrapping |
| `Iterator` methods (map, filter, take) | Replaces Java stream patterns |
| `Set` methods (union, intersection, difference) | Replaces `Sets` utility class |
| `#/` subpath imports | Supported under `moduleResolution: bundler` |

### TS 7.0 migration note

When ready to validate against the Go compiler: add `"stableTypeOrdering": true` to
tsconfig temporarily (~25% slower type-check, aligns union ordering with TS 7.0).
Fix any new errors. Remove before committing — it is a diagnostic flag only.

---

## NestJS + Bun Test Compatibility

NestJS works with `bun test`. The setup is already correct:

- `reflect-metadata` preloaded in `bunfig.toml` — required for all NestJS decorators
- `emitDecoratorMetadata: true` in tsconfig — Bun applies this during transpilation
- `@nestjs/testing` `Test.createTestingModule()` is test-runner-agnostic

**In Phase 6 test conversion, replace Jest APIs with Bun equivalents:**

| Jest | Bun (`import { ... } from "bun:test"`) |
|---|---|
| `jest.mock(...)` | `mock(...)` |
| `jest.spyOn(...)` | `spyOn(...)` |
| `jest.fn()` | `mock(() => {})` |
| `jest.resetAllMocks()` | `mock.restore()` |

---

## Scope Decisions

### Port — Core production modules (required for production Helios)

1. `internal/serialization` — binary serialization, HeapData, DataSerializable, Portable, GenericRecord
2. `internal/nio` — byte buffer primitives (Bits, BufferObjectDataInput/Output)
3. `internal/networking` — Packet framing, Channel abstractions
4. `internal/cluster` — ClusterServiceImpl, MembershipManager, HeartbeatManager
5. `internal/partition` — PartitionService, MigrationManager, PartitionReplica
6. `internal/util` — pure utilities: collections, math, concurrency primitives, counters
7. `internal/json` — custom JSON parser/writer (no external deps)
8. `internal/nearcache` — **core near cache engine**: NearCache, NearCacheManager, NearCacheRecordStore, eviction checker, invalidation (batch + single), preloader, record stores (data + object), HeapNearCacheRecordMap
9. `spi/` — NodeEngine, OperationService, Operation base, InvocationFuture → Promise
10. `core/` — HeliosInstance lifecycle
11. `instance/` — HeliosInstanceImpl, bootstrap, lifecycle
12. `config/` — full config model including **NearCacheConfig, NearCachePreloaderConfig, NearCacheConfigAccessor** + XML/YAML parsers
13. `map/` — IMap, RecordStore, MapService, all operations, MapQueryEngine, **MapNearCacheManager, NearCachedMapProxyImpl**
14. `collection/` — IQueue, ISet, IList + services + operations
15. `topic/` — ITopic, Message, TopicService, ReliableTopic
16. `multimap/` — MultiMap + service + operations
17. `ringbuffer/` — ArrayRingbuffer, RingbufferContainer, all operations
18. `cache/` — ICache, CacheRecordStore, CacheService, all operations (JCache), **CacheNearCacheStateHolder**
19. `transaction/` — TransactionContext, TransactionService, @Transactional, **TxnMapNearCache invalidation**
20. `security/` — Credentials, PasswordCredentials, TokenCredentials, PermissionCollection
21. `query/` — all predicates, IndexRegistry, QueryOptimizer, Extractors
22. `aggregation/` — Count, Sum, Avg, Min, Max, Distinct
23. `cardinality/` — HyperLogLog, CardinalityEstimator
24. `version/` — Version, MemberVersion
25. `nearcache/NearCacheStats` — public stats contract (compile-time in Phase 1; runtime impl in Phase 3)
26. `client/` — binary client protocol, ClientMessage, all codecs, **NearCache invalidation codecs** (MapAddNearCacheInvalidationListenerCodec, MapFetchNearCacheInvalidationMetadataCodec, CacheAddNearCacheInvalidationListenerCodec, CacheFetchNearCacheInvalidationMetadataCodec, NearCacheConfigHolderCodec, NearCachePreloaderConfigCodec), **NearCachedClientMapProxy, NearCachedClientCacheProxy**, ClientConnectionManager, NearCacheMetricsProvider
27. `replicatedmap/` — ReplicatedMap + **ReplicatedMapAddNearCacheEntryListenerCodec**
28. `hazelcast-spring/` → NestJS integration: HeliosModule, HeliosCacheModule, HeliosTransactionModule

### Drop entirely — never port

| Package | Reason |
|---|---|
| `osgi/` | OSGi is dead technology |
| `console/` | CLI debug console, not needed |
| `auditlog/` | Enterprise feature |
| `hotrestart/` | Enterprise persistence |
| `persistence/` | Enterprise HD persistence |
| `crdt/` | Niche, high complexity |
| `wan/` | Enterprise WAN replication |
| `vector/` | Experimental vector search |
| `durableexecutor/` | Distributed durable executor |
| `flakeidgen/` | Replace with `crypto.randomUUID()` |
| `dataconnection/` | Enterprise data connections |
| `hazelcast/extensions/*` (legacy) | Legacy Java extension modules (Kafka, Hadoop, Avro, CDC, gRPC, Kinesis, Python, etc.) are out of scope; Helios Phase 12 packages (`packages/s3`, `packages/mongodb`, `packages/turso`) are explicitly in scope |
| Build tooling (`hazelcast-archunit-rules/`, `hazelcast-build-utils/`, `checkstyle/`, `distribution/`) | Not relevant |

### Replace, don't port line-by-line — with explicit parity gates

**`hazelcast-tpc-engine/` (65 source files)**: Do NOT port Java internals line-by-line, but
also do not assume a tiny wrapper is automatically equivalent. The TypeScript runtime must
preserve protocol-level guarantees (frame compatibility, per-connection ordering, correlation
integrity, bounded buffering, explicit backpressure behavior) before performance tuning.

**`aws/ azure/ gcp/ kubernetes/` cloud discovery**: Replace with `HeliosDiscovery`
(typed contract + provider adapters) using `fetch()` + config wiring. Do not port Java's
`HttpURLConnection`-based discovery code. See Cloud Discovery section below.

### Defer to v2

| Module | Why deferred |
|---|---|
| `hazelcast-sql/` (706 files) | Requires porting Apache Calcite — a 500k+ line SQL planning framework. Stub `SqlService` with `throw new Error("SQL: use Helios v2")`. Integrate a native TS SQL library in v2. |
| `jet/` (520 files) | Java DAG engine — NOT ported line-by-line. **Replaced by `@helios/blitz` (Phase 10)** using NATS JetStream. See Phase 10 blocks 10.0–10.10. |
| `cp/` (66 files) | Raft-based CP subsystem for strong consistency. Complex consensus. Defer to v2. |
| `scheduledexecutor/` (66 files) | Distributed scheduled executor. Defer to v2. |

### Compatibility Stubs for Deferred Scope

Deferred features must still be startup-safe and integration-safe in v1.

- Register concrete deferred-service stubs (no `null` service lookups) with stable service names.
- Deferred service APIs throw deterministic `UnsupportedOperationError("<feature> deferred to Helios v2")`.
- Config parsing must accept deferred cloud/discovery config shapes and preserve provider properties.
- If a deferred provider is configured with `enabled=false`, startup proceeds.
- If a deferred provider is selected with `enabled=true`, fail fast at config verification with a clear remediation message.
- Enforce join exclusivity across `multicast`, `tcp-ip`, cloud aliases, and discovery SPI.

Required tests for this contract:

- Negative tests for unsupported deferred APIs and invalid multi-join configurations.
- Contract tests for XML/YAML parse round-trip on deferred discovery provider properties.
- Service lifecycle tests proving deferred stubs init/shutdown cleanly.

Exit criteria (deferred -> implemented):

- No deferred errors on public API path for that feature.
- Real service replaces the stub in default registration path.
- Full schema validation and feature integration tests are green.

---

## Spring → NestJS Mapping

| Java / Spring | TypeScript / NestJS |
|---|---|
| `@Service` / `@Component` / `@Repository` | `@Injectable()` |
| `@Autowired` / `@Inject` | Constructor injection (NestJS DI) |
| `@Bean` | Provider in `@Module({ providers: [...] })` |
| `@Configuration` | `@Module({ imports, providers, exports })` |
| `@SpringBootApplication` | `AppModule` + `NestFactory.create(AppModule)` |
| `ApplicationContext` | `ModuleRef` from `@nestjs/core` |
| `ApplicationContextAware` | `implements OnModuleInit` + inject `ModuleRef` |
| `@Transactional` | Custom `@Transactional()` decorator (wraps Helios TX API) |
| `@Primary` | `{ provide: TOKEN, useClass: Impl }` with explicit token |
| `@Qualifier("name")` | `@Inject(TOKEN)` with named injection token |
| `@Scope(PROTOTYPE)` | `{ scope: Scope.REQUEST }` or factory provider |
| `@Scope(SINGLETON)` | Default NestJS scope |
| `@ConditionalOnMissingBean` | Custom `DynamicModule.forRootAsync()` guard |
| `@EnableAutoConfiguration` | `@Global() @Module(...)` auto-imported at app root |
| `CacheManager` (Spring) | `@nestjs/cache-manager` `CacheModule` |
| `TransactionManager` | `HeliosTransactionModule` (custom NestJS module) |
| `BeanDefinitionParser` | `DynamicModule` returned by `forRoot(config)` |
| `@RestController` + `@RequestMapping` | `@Controller()` + `@Get()` / `@Post()` |
| Spring Integration Tests | `@nestjs/testing` → `Test.createTestingModule()` |
| Spring MockMvc | `supertest` + NestJS test app |

---

## Java → TypeScript Type Mapping

| Java | TypeScript | Notes |
|---|---|---|
| `long` / `int` / `short` / `byte` | `number` | |
| `long` (sequence IDs, hashes, overflow-sensitive) | `bigint` | |
| `double` / `float` | `number` | |
| `boolean` | `boolean` | |
| `String` | `string` | |
| `Object` | `unknown` | |
| `void` | `void` | |
| `null` | `null` | |
| `byte[]` | `Buffer` | Bun has Node.js-compatible Buffer |
| `ByteBuffer` | custom `ByteBuffer` wrapping `Buffer` | |
| `Iterator<T>` | `IterableIterator<T>` via `[Symbol.iterator]()` | |
| `Iterable<T>` | `Iterable<T>` | same |
| `List<T>` | `T[]` or custom list class | |
| `Map<K,V>` | `Map<K,V>` | use `.getOrInsert()` (ES2025) |
| `Set<T>` | `Set<T>` | use `.union/.intersection/.difference` (ES2025) |
| `Optional<T>` | `T \| null` | |
| `CompletableFuture<T>` | `Promise<T>` | |
| `java.time.Instant` / `Duration` | `Temporal.Instant` / `Temporal.Duration` (ES2025) | |
| `synchronized` | N/A — Bun is single-threaded | |
| `volatile` | N/A | |
| `AtomicLong` / `AtomicInteger` | plain `number` | single-threaded |
| `AtomicReference<T>` | plain field | |
| `throws XxxException` | remove — add `@throws` JSDoc | |
| `final` (local var) | `const` | |
| `final` (field) | `readonly` | |
| `static final` | `static readonly` | |
| `abstract class` | `abstract class` | same |
| Inner class | nested class or separate file | |
| Anonymous class | object literal or arrow function | |
| `Enum` | TypeScript `enum` or `const` object + `as const` | |
| `instanceof` | `instanceof` | same |
| `computeIfAbsent` | `Map.getOrInsertComputed()` (ES2025) | |

---

## Strategy: Module-Batch TDD with Parallel Agents

### Why not one test at a time?

One-test-per-loop-iteration = ~3,441 iterations. At even 30 min/test that is 1,700+ hours.
Each iteration is a tiny, context-free slice with no signal on whether the overall module
compiles. Fragmented context means regressions accumulate silently. Not viable.

### Why not all tests first, then implement?

Converting all ~3,441 tests before writing any source means zero feedback for weeks.
Conversion errors compound. You cannot know if your converter output is right until
something runs. By the time you start implementing, the converted tests have drifted.

### The right unit of work: the module block

```
Per block:
  1. Batch-convert ALL Java tests for the block using the converter (handles ~85%)
  2. Manually clean up the remaining ~15% in the same task
  3. bun test --pattern "<block>"  →  RED (all fail — expected)
  4. Implement the full module (all source files for the block)
  5. bun test --pattern "<block>"  →  GREEN (all pass)
  6. git commit -m "feat(<block>): <N> tests green"
```

Every block ends with a green commit. No partial blocks. No "I'll fix the tests later."

### GREEN gate policy (per iteration)

- Per-iteration GREEN gates include block-default/unit/integration tests needed for fast feedback.
- Slow/Stress suites are excluded from default per-iteration GREEN gates and run in a periodic/nightly suite.
- Loop gating requires minimum line coverage for the target block: **>= 80%** before commit.

### Near-cache strict gate policy (mandatory)

For near-cache critical path blocks (`3.12a`, `3.12b`, `3.13a`, `4.4`, `5.0`, `5.1`, `5.2`, `5.3`),
unit GREEN alone is insufficient.

- Each critical block must run all required gate commands for that block (not just one pattern).
- Required gate commands must execute a non-zero test set; empty pattern matches are failures.
- `bun run tsc --noEmit` must pass after required gate commands.
- Iteration output must include `GATE-CHECK: block=<id> required=<N> passed=<N> labels=<...>`.
- Commits are valid only if `passed == required`.

Recommended gate labels:

- `3.12a`: `nearcache-core`, `nearcache-stats`
- `3.12b`: `nearcache-invalidation-core`, `nearcache-repair-core`
- `3.13a`: `nearcache-server-map-cache`, `nearcache-staleness`
- `4.4`: `nearcache-migration-metadata`, `nearcache-metadata-fetch`
- `5.0`: `client-nearcache-protocol`, `client-nearcache-listener-tasks`
- `5.1`: `client-nearcache-proxy`, `client-nearcache-listener-lifecycle`
- `5.2`: `client-nearcache-anti-entropy`, `client-nearcache-stale-read-repair`
- `5.3`: `client-nearcache-e2e-production-flow`

### Agent architecture

- `claude-teamlead` orchestrates each phase, spawns `claude-worker` agents per block
- Independent blocks within a phase run **in parallel** (e.g., `internal/util`, `internal/json`,
  `version`, `aggregation`, `cardinality` in Phase 1 are all independent — spawn 5 workers)
- Blocks with dependencies run sequentially (e.g., Phase 3 must follow Phase 2)
- Each worker receives: Java source path, Java test path, TypeScript target path, this plan
- Workers must get GREEN before reporting done — no "almost green" commits

---

## Naming Conventions

All TypeScript class/file names use `Helios` where Hazelcast Java used `Hazelcast`:
- `HeliosInstance` (was `HazelcastInstance`)
- `HeliosModule`, `HeliosCacheModule`, `HeliosTransactionModule`
- `HeliosClient`, `HeliosClientImpl`, etc.
- Java source references in comments keep original names for traceability

Path alias: `@helios/*` → `./src/*` (tsconfig paths)

---

## Project Structure

```
helios/                                   # Standalone repo (this repo)
├── package.json                          # @helios/core, Bun, TS beta
├── tsconfig.json                         # ES2025, bundler, strict, decorators
├── bunfig.toml                           # test patterns, reflect-metadata preload
├── helios-server.ts                      # standalone server entrypoint
├── loop.sh                               # TDD automation loop
│
├── scripts/
│   └── convert-java-tests.ts             # Java→TS converter — run with bun
│
├── src/
│   ├── internal/
│   │   ├── util/                         # Phase 1 — pure logic
│   │   ├── json/                         # Phase 1 — pure logic
│   │   ├── serialization/                # Phase 2 — serialization
│   │   ├── nio/                          # Phase 2 — I/O primitives
│   │   ├── networking/                   # Phase 2 — packet/channel
│   │   ├── cluster/                      # Phase 4 — cluster internals
│   │   └── partition/                    # Phase 4 — partition + migration
│   ├── version/                          # Phase 1 — pure
│   ├── aggregation/                      # Phase 1 — pure
│   ├── cardinality/                      # Phase 1 — pure
│   ├── query/                            # Phase 1 — predicates, indexes
│   ├── config/                           # Phase 1 — config model + parsers
│   ├── ringbuffer/                       # Phase 1 (pure layer) + Phase 3 (full)
│   ├── spi/                              # Phase 3 — NodeEngine, Operations
│   ├── core/                             # Phase 3 — HeliosInstance lifecycle
│   ├── instance/                         # Phase 3 — HeliosInstanceImpl
│   ├── map/                              # Phase 3 — IMap + RecordStore
│   ├── collection/                       # Phase 3 — IQueue, ISet, IList
│   ├── topic/                            # Phase 3 — ITopic, ReliableTopic
│   ├── multimap/                         # Phase 3 — MultiMap
│   ├── cache/                            # Phase 3 — JCache / ICache
│   ├── transaction/                      # Phase 3 — TransactionContext
│   ├── security/                         # Phase 3 — Credentials, Permissions
│   ├── cluster/                          # Phase 4 — Member, ClusterService
│   ├── replicatedmap/                    # Phase 4 — ReplicatedMap
│   ├── client/                           # Phase 3 (client core) + Phase 5 (near-cache reconciliation)
│   │   ├── protocol/
│   │   │   ├── ClientMessage.ts
│   │   │   └── codec/
│   │   ├── proxy/
│   │   └── ClientConnectionManager.ts
│   ├── discovery/
│   │   └── HeliosDiscovery.ts            # Phase 3 — replaces aws/azure/gcp/k8s
│   ├── rest/                             # Phase 11 — built-in REST API
│   │   ├── RestEndpointGroup.ts          # HEALTH_CHECK | CLUSTER_READ | CLUSTER_WRITE | DATA
│   │   ├── HeliosRestServer.ts           # Bun.serve() lifecycle wrapper
│   │   ├── RestApiFilter.ts              # URL → group → handler; 403 if group disabled
│   │   └── handler/
│   │       ├── HealthCheckHandler.ts     # /hazelcast/health/* (K8s probes)
│   │       ├── ClusterReadHandler.ts     # /hazelcast/rest/cluster, /instance
│   │       ├── ClusterWriteHandler.ts    # log level, member shutdown
│   │       └── DataHandler.ts           # IMap CRUD + IQueue ops
│   └── nestjs/                           # Phase 6 — NestJS integration (extracted to packages/nestjs/ in Phase 9)
│       ├── HeliosModule.ts
│       ├── HeliosCacheModule.ts
│       ├── HeliosTransactionModule.ts
│       ├── autoconfiguration/
│       │   └── HeliosAutoConfigurationModule.ts
│       └── context/
│           └── NestManagedContext.ts
│
├── test/                                 # Converted bun tests — mirrors src/
│
├── test-support/                         # Lightweight test infrastructure
│   ├── TestHeliosInstance.ts             # Phase 3 — single-node in-process
│   ├── TestNodeEngine.ts                 # Phase 3 — NodeEngine stub
│   ├── TestPartitionService.ts           # Phase 3 — 271 partitions, all local
│   └── TestClusterRegistry.ts            # Phase 4 — multi-node in-memory registry
│
├── packages/
│   └── nestjs/                           # @helios/nestjs (Phase 9)
│       ├── package.json                  # @helios/nestjs, deps: @helios/core + NestJS 11
│       ├── tsconfig.json                 # ES2025, paths: @helios/core/* → ../../src/*
│       ├── bunfig.toml                   # preload: reflect-metadata
│       ├── src/
│       │   ├── index.ts                  # barrel export
│       │   ├── helios-module.definition.ts  # ConfigurableModuleBuilder (Block 9.1)
│       │   ├── HeliosModule.ts           # extends ConfigurableModuleClass
│       │   ├── HeliosCacheModule.ts
│       │   ├── HeliosTransactionModule.ts
│       │   ├── HeliosTransactionManager.ts
│       │   ├── Transactional.ts          # DI-based @Transactional (Block 9.4)
│       │   ├── TransactionExceptions.ts  # CannotCreateTransactionException (Block 9.4)
│       │   ├── decorators/               # Block 9.2 + 9.6
│       │   ├── health/                   # Block 9.5
│       │   ├── events/                   # Block 9.7
│       │   ├── autoconfiguration/
│       │   └── context/
│       └── test/                         # NestJS integration tests
│
├── app/                                  # Demo app (HTTP + near-cache + predicates)
│   ├── package.json                      # helios-demo-app (private)
│   ├── tsconfig.json                     # paths: @helios/* → ../src/*
│   ├── bunfig.toml
│   ├── demo.sh                           # curl-based demo script
│   ├── src/app.ts
│   ├── src/http-server.ts
│   └── test/distributed-nearcache.test.ts
│
├── plans/
│   └── TYPESCRIPT_PORT_PLAN.md           # This file
│
└── .opencode/plans/                      # Detailed phase plans

Java source (read-only spec, separate repo):
  ../helios-1/hazelcast/src/main/java/com/hazelcast/
  ../helios-1/hazelcast-spring/src/main/java/
```

---

## Dependency Graph

```
[Phase 1 — independent, all parallelizable]
internal/util ──────────────────────────────────► aggregation
                                                  cardinality
                                                  query (+ predicates, indexes)
                                                  config (model + parsers)
                                                  internal/partition (later)
nearcache/NearCacheStats + internal/monitor contracts ─► config + monitoring compile-time wiring
internal/json ──────────────────────────────────► config (YAML/XML parsing)
version ─────────────────────────────────────────► config, cluster
ringbuffer (pure layer) ────────────────────────► ringbuffer full (Phase 3)

[Phase 2 — sequential within phase]
internal/util + version
  └─► internal/util/time (TimeSource/Clock runtime abstraction)
        └─► internal/serialization
              └─► internal/nio
                    └─► internal/networking
                          └─► Eventloop.ts (thin Bun wrapper — NOT a tpc-engine port)

[Phase 3 — depends on Phase 1 + 2]
serialization + partition (stub)
  └─► spi/NodeEngine
        └─► map 3.2a (RecordStore/CRUD core)
              └─► map 3.2b (advanced ops + entry processors + putAll)
                    └─► map 3.2c (query integration + MapQueryEngine wiring)
                          └─► collection, topic, multimap, ringbuffer (full), cache, transaction, security
                                ├─► HeliosInstanceImpl + TestHeliosInstance
                                │     └─► client core foundations (transport/proxies/codec base, single-node)  ⭐
                                └─► nearcache 3.12a (storage/runtime core)  ⭐
                                      └─► nearcache 3.12b (shared invalidation + repair internals)  ⭐
                                            └─► nearcache 3.13a (server local integration)  ⭐

[Phase 4 — depends on Phase 3]
spi + serialization
  └─► internal/cluster (ClusterServiceImpl, MembershipManager, ClusterJoinManager, HeartbeatManager)
        ├─► HeliosDiscovery contract wiring (typed provider + JoinConfig integration)
        └─► internal/partition (PartitionServiceImpl, MigrationManager)
              ├─► replicatedmap
              └─► nearcache 4.4 (migration metadata + metadata fetch surfaces)  ⭐

[Phase 5 — depends on Phase 4 + client core]
cluster + partition + nearcache 3.12a/3.12b/3.13a/4.4 + client core foundations
  └─► 5.0 protocol transport (listener registration/removal + metadata fetch tasks/codecs)  ⭐
        └─► 5.1 NearCached client proxies + listener lifecycle + repairing-handler wiring  ⭐
              └─► 5.2 client anti-entropy integration + stale-read hardening  ⭐
                    └─► 5.3 production-flow e2e + production proof gate  ⭐

[Phase 6 — depends on everything above]
HeliosInstance + all services
  └─► nestjs/ (HeliosModule, HeliosCacheModule, HeliosTransactionModule, autoconfiguration)

[Phase 9 — depends on Phase 6 + 8]
@helios/core (repo root) + @helios/nestjs (packages/nestjs/) Bun workspace
  └─► 9.0 package extraction (move files, no behavior change)
        └─► 9.1 ConfigurableModuleBuilder (parallel with 9.2, 9.8)
        └─► 9.2 @InjectHelios/@InjectMap decorators (parallel with 9.1, 9.8)
        └─► 9.8 Symbol tokens + lifecycle hooks (parallel with 9.1, 9.2)
              └─► 9.3 registerAsync for cache/transaction modules
              └─► 9.4 DI-based @Transactional (depends on 9.1, 9.3)
              └─► 9.5 HeliosHealthIndicator (depends on 9.2)
              └─► 9.6 @Cacheable/@CacheEvict decorators (depends on 9.3)
              └─► 9.7 event bridge (depends on 9.2)
                    └─► 9.9 final polish + publish

[Phase 10 — depends on Phase 7 (HeliosInstanceImpl + IMap/ITopic) + Phase 9 (Bun workspace)]
@helios/core IMap/ITopic + nats npm package
  └─► 10.0 BlitzService (NATS connection lifecycle)
        └─► 10.1 Pipeline/DAG builder (Vertex, Edge, submit/cancel)
              ├─► 10.2 sources + sinks (parallel with 10.3)
              └─► 10.3 stream operators (parallel with 10.2)
                    └─► 10.4 windowing engine + NATS KV state
                          └─► 10.5 stateful aggregations + grouped combiner
                                └─► 10.6 stream joins (hash join + windowed join)
                    └─► 10.7 fault tolerance (AckPolicy, retry, DL, checkpoint)
                          └─► 10.8 batch processing mode
                          └─► 10.9 NestJS module (@helios/blitz)
                                └─► 10.10 e2e acceptance + feature parity gate

[Phase 11 — depends on Phase 7.1 (HeliosInstanceImpl) + Phase 8.1 (near-cache wired)]
HeliosInstanceImpl + HeliosLifecycleService
  └─► 11.1 RestApiConfig upgrade + RestEndpointGroup enum
        └─► 11.2 HeliosRestServer + RestApiFilter (Bun.serve() lifecycle)
              ├─► 11.3 HEALTH_CHECK handler (K8s probes)          [parallel]
              ├─► 11.4 CLUSTER_READ + CLUSTER_WRITE handlers       [parallel]
              └─► 11.5 DATA handler (IMap CRUD + IQueue ops)       [parallel]
                    └─► 11.6 app/ migration + e2e REST acceptance
```

---

## Phase 0 — Tooling ✅ DONE

Status: Complete. Do not revisit.

| Item | Status |
|---|---|
| Project scaffolding (package.json, tsconfig.json, bunfig.toml) | ✅ |
| `scripts/convert-java-tests.ts` — Java→TS converter | ✅ |
| Bun + NestJS deps installed | ✅ |
| `typescript@beta` (TS 6.0) pinned | ✅ |
| tsconfig pre-aligned with TS 6.0 (all deprecations avoided) | ✅ |

**Converter handles automatically (~85% of conversion)**:
- `@Test` → `it()`
- `@Test(expected = Foo.class)` → `expect(() => {}).toThrow(Foo)`
- `@Before/@After` → `beforeEach/afterEach`
- `@BeforeClass/@AfterClass` → `beforeAll/afterAll`
- `assertEquals/assertTrue/assertFalse/assertNull/assertNotNull/assertSame/assertInstanceOf`
- Local variable declarations `Type var = x` → `const var = x`
- Java primitives → TS types
- Import path conversion

**Needs manual cleanup (~15% per file)**:
- `@Test(expected)` with nested braces
- Hamcrest matchers (`assertThat(x, instanceOf(Y))`)
- Anonymous inner classes / lambdas
- Wildcard static imports
- Java generics with wildcards (`? extends T`)
- Spring test annotations → `@nestjs/testing` equivalents

---

## Phase 1 — Pure Logic (~261 tests)

Goal: implement every module that requires zero distributed infrastructure.
All blocks in Phase 1 are independent — run as parallel workers.

---

### Block 1.1 — internal/util (src: 217 files, ~63 relevant tests)

```
src/internal/util/
├── MutableInteger.ts / MutableLong.ts
├── QuickMath.ts / Preconditions.ts
├── StringPartitioningStrategy.ts
├── TimeUtil.ts                         (pure helpers; runtime clock abstraction is Block 2.0)
├── Sha256Util.ts / XmlUtil.ts
├── IterableUtil.ts / Optionals.ts / ResultSet.ts
├── StateMachine.ts
├── collection/
│   ├── Int2ObjectHashMap.ts          ← Int2ObjectHashMapTest
│   ├── Long2ObjectHashMap.ts         ← Long2ObjectHashMapTest
│   ├── Long2LongHashMap.ts           ← Long2LongHashMapTest
│   ├── Object2LongHashMap.ts         ← Object2LongHashMapTest
│   ├── LongHashSet.ts
│   ├── PartitionIdSet.ts             ← PartitionIdSetTest
│   ├── FixedCapacityArrayList.ts
│   ├── InternalListMultiMap.ts
│   └── WeightedEvictableList.ts
├── comparators/
│   ├── BinaryValueComparator.ts
│   └── ObjectValueComparator.ts
├── concurrent/
│   ├── BackoffIdleStrategy.ts
│   └── ManyToOneConcurrentArrayQueue.ts
├── counters/ → MwCounter.ts / SwCounter.ts
├── graph/ → BronKerboschCliqueFinder.ts
├── hashslot/impl/ → HashSlotArray8/12/16byteKeyImpl.ts
└── sort/ → QuickSorter.ts
```

**DONE — Block 1.1** (90 tests green):
- [x] Batch-convert ~63 test files with converter, clean up 15%
- [x] Implement all source files above
- [x] `bun test --pattern "internal/util"` → GREEN (90 tests)
- [x] `git commit -m "feat(internal/util): complete — 90 tests green"`

---

### Block 1.2 — internal/json (src: 18 files, ~14 relevant tests)

```
src/internal/json/
├── JsonValue.ts (+ JsonNull, JsonBoolean, JsonNumber, JsonString)
├── JsonArray.ts / JsonObject.ts
├── JsonParser.ts / JsonWriter.ts / WriterConfig.ts
└── ParseException.ts
```

**DONE — Block 1.2** ✅:
- [x] Convert 14 test files (13 JSON + 1 mocking stub), clean up
- [x] Implement JSON parser/writer (custom, no external deps)
- [x] `bun test --pattern "internal/json"` → 380 tests GREEN
- [x] `git commit -m "feat(internal/json): custom JSON parser — 380 tests green"`

---

### Block 1.3 — version (src: 4 files, ~2 relevant tests)

```
src/version/
├── Version.ts
└── MemberVersion.ts
```

**TODO — Block 1.3**:
- [x] Convert 3 test files (VersionTest, VersionUnknownTest, MemberVersionTest)
- [x] Implement Version + MemberVersion (comparison, parsing)
- [x] GREEN — 64 tests
- [x] `git commit -m "feat(version): version comparison — 64 tests green"`

---

### Block 1.4 — aggregation (src: 25 files, ~7 relevant tests)

```
src/aggregation/
├── Aggregator.ts (interface)
├── CountAggregator.ts / SumAggregator.ts / AvgAggregator.ts
├── MinAggregator.ts / MaxAggregator.ts
└── DistinctAggregator.ts
```

**TODO — Block 1.4**:
- [x] Convert 6 test files (CountAggregationTest, SumAggregationTest, AvgAggregationTest, MinAggregationTest, MaxAggregationTest, DistinctAggregationTest)
- [x] Implement all aggregators (Aggregator interface, AbstractAggregator, 14 concrete impls, Aggregators factory)
- [x] GREEN — 90 tests
- [x] `git commit -m "feat(aggregation): all aggregators — 90 tests green"`

---

### Block 1.5 — cardinality (src: 25 files, ~5 relevant tests)

```
src/cardinality/
├── HyperLogLog.ts
├── HyperLogLogMerge.ts
└── CardinalityEstimator.ts
```

**DONE — Block 1.5** ✅:
- [x] Convert ~5 test files (3 test files: HyperLogLogImplTest, DenseHyperLogLogEncoderTest, SparseHyperLogLogEncoderTest)
- [x] Implement HyperLogLog (dense + sparse representation)
- [x] GREEN — 19 tests
- [x] `git commit -m "feat(cardinality): HyperLogLog — 19 tests green"`

---

### Block 1.6 — query (src: 153 files, ~74 relevant tests)

```
src/query/
├── Predicate.ts (interface)
└── impl/
    ├── predicates/
    │   ├── EqualPredicate.ts / NotEqualPredicate.ts
    │   ├── GreaterLessPredicate.ts / BetweenPredicate.ts
    │   ├── LikePredicate.ts / RegexPredicate.ts
    │   ├── InPredicate.ts / InstanceOfPredicate.ts
    │   ├── AndPredicate.ts / OrPredicate.ts / NotPredicate.ts
    │   └── PagingPredicate.ts
    ├── QueryContext.ts / QueryResult.ts / QueryResultRow.ts
    ├── IndexRegistry.ts / Indexes.ts / Index.ts
    ├── QueryOptimizer.ts
    └── Extractors.ts
```

**DONE — Block 1.6** ✅:
- [x] Convert 61 test files (pure predicate logic; cluster/serialization deferred)
- [x] Implement all predicates (EqualPredicate, NotEqual, GreaterLess, Between, In, Like, ILike, Regex, And, Or, Not, True, False)
- [x] Implement Comparables, IndexUtils, VisitorUtils, FlatteningVisitor, EmptyOptimizer
- [x] `bun test --pattern "query"` → 61 tests GREEN
- [x] `git commit -m "feat(query): predicate/query engine — 61 tests green"`

---

### Block 1.7 — config (src: 227 files, ~67 relevant tests)

```
src/config/
├── Config.ts (root config object)
├── MapConfig.ts / RingbufferConfig.ts / TopicConfig.ts / QueueConfig.ts
├── CacheConfig.ts / NetworkConfig.ts / JoinConfig.ts
├── MulticastConfig.ts / TcpIpConfig.ts
├── SplitBrainProtectionConfig.ts / EvictionConfig.ts
├── SerializationConfig.ts / SecurityConfig.ts
├── InMemoryFormat.ts (enum) / MaxSizePolicy.ts (enum) / EvictionPolicy.ts (enum)
└── parser/
    ├── XmlConfigBuilder.ts
    └── YamlConfigBuilder.ts
```

**DONE — Block 1.7** ✅:
- [x] Convert config test files (MapConfig, NearCacheConfig, NearCachePreloaderConfig, NetworkConfig, EvictionConfig, TcpIpConfig)
- [x] Implement all Config classes (POJOs with validation): EvictionPolicy, InMemoryFormat, MaxSizePolicy, EvictionConfig, MapStoreConfig, NearCachePreloaderConfig, NearCacheConfig, MapConfig, NetworkConfig, TcpIpConfig, MulticastConfig, JoinConfig + discovery stubs
- [x] GREEN — 72 tests
- [x] `git commit -m "feat(config): config model — 72 tests green"`

---

### Block 1.8 — ringbuffer pure layer (src: 32 files, ~9 relevant tests)

```
src/ringbuffer/
├── StaleSequenceException.ts
├── OverflowPolicy.ts               ← OverflowPolicyTest
└── impl/
    ├── Ringbuffer.ts (interface)
    ├── ArrayRingbuffer.ts          ← ArrayRingbufferTest
    ├── ReadOnlyRingbufferIterator.ts
    └── RingbufferWaitNotifyKey.ts  ← RingbufferWaitNotifyKeyTest
```

**TODO — Block 1.8**:
- [x] Convert ~9 test files
- [x] Implement ArrayRingbuffer (the core — circular buffer with capacity, TTL-aware)
- [x] Implement OverflowPolicy + RingbufferWaitNotifyKey
- [x] GREEN
- [x] `git commit -m "feat(ringbuffer/pure): ArrayRingbuffer — 9 tests green"`

---

### Block 1.9 — near cache compile-time contracts (src: 2 files, ~0 relevant tests)

```
src/nearcache/
└── NearCacheStats.ts                  (public stats contract)

src/internal/monitor/
└── NearCacheStatsProvider.ts          (monitoring-side contract placement)
```

Purpose: make near cache stats types available to config/monitoring compile-time
dependencies before Phase 3 runtime near cache implementation.

**TODO — Block 1.9**:
- [x] Add `NearCacheStats` public interface and monitoring contract placement
- [x] Ensure config/monitoring compile against contracts without Phase 3 impl classes
- [x] GREEN
- [x] `git commit -m "feat(nearcache/contracts): early NearCacheStats compile-time contracts"`

---

**Phase 1 done gate**: ~261 tests green. Zero distributed infrastructure required.

---

## Phase 2 — Serialization & I/O (~90 tests)

Goal: binary serialization + I/O primitives + thin Bun event loop wrapper.
Blocks 2.0 → 2.1 → 2.2 → 2.3 → 2.4 must run in this order (each depends on the previous).

---

### Block 2.0 — runtime-safe time abstraction (new code)

```
src/internal/util/time/
├── TimeSource.ts                      (interface)
└── Clock.ts                           (Temporal-backed implementation + fallback)
```

This block standardizes all TTL/time reads behind `TimeSource`/`Clock` so runtime code
does not directly call `Temporal.now.*`. Use Temporal when available; fall back to
`Date.now()`-backed behavior for Bun versions where Temporal is unavailable.

**TODO — Block 2.0**: ✅ DONE (14 tests green)
- [x] Implement `TimeSource` contract and `Clock` default implementation
- [x] Define fallback behavior for runtimes without Temporal (`Date.now()` epoch millis)
- [x] Update TTL-facing call sites to use `Clock`/`TimeSource`, not direct `Temporal.now.*`
- [x] Add focused tests for Temporal-available and fallback paths
- [x] GREEN

---

### Block 2.1 — internal/serialization (src: 132 files, ~66 relevant tests)

```
src/internal/serialization/
├── Data.ts (interface) / SerializationService.ts (interface)
├── DataType.ts (enum) / DataSerializerHook.ts (interface)
└── impl/
    ├── HeapData.ts                       (Data backed by Buffer)
    ├── ByteArrayObjectDataInput.ts
    ├── ByteArrayObjectDataOutput.ts
    ├── DataSerializableSerializer.ts / DataSerializableHeader.ts
    ├── DefaultSerializationServiceBuilder.ts
    ├── AbstractSerializationService.ts / SerializationServiceImpl.ts
    ├── PortableSerializer.ts / PortableContext.ts
    └── GenericRecord.ts / AbstractGenericRecord.ts
```

Key: `byte[]` → `Buffer`. `ByteBuffer.readLong()` → `buffer.readBigInt64BE()`.
BigInt is required for 64-bit sequence numbers and hash codes.

**TODO — Block 2.1**: ✅ DONE (134 tests green)
- [x] Convert ~66 test files
- [x] Implement HeapData + ByteArrayObjectDataInput/Output (foundation)
- [x] Implement DataSerializableHeader, SerializationConstants, FactoryIdHelper, Data interface
- [x] GREEN
- [x] `git commit -m "feat(serialization): binary serialization — 134 tests green"`

---

### Block 2.2 — internal/nio (src: 28 files, ~2 relevant tests)

```
src/internal/nio/
├── Bits.ts                               (byte-level read/write helpers)
├── BufferObjectDataInput.ts
└── BufferObjectDataOutput.ts
```

**TODO — Block 2.2**: ✅ DONE (26 tests green)
- [x] Convert BitsTest (1 test file → 26 tests)
- [x] Implement Bits.ts + BufferObjectDataInput/BufferObjectDataOutput interfaces
- [x] GREEN
- [x] `git commit -m "feat(nio): byte buffer primitives — 26 tests green"`

---

### Block 2.3 — internal/networking (src: 36 files, ~19 relevant tests)

```
src/internal/networking/
├── Packet.ts / PacketIOHelper.ts
├── Channel.ts (interface) / ChannelWriter.ts / ChannelReader.ts
└── OutboundHandler.ts
```

**TODO — Block 2.3**:
- [x] Convert ~19 test files
- [x] Implement Packet framing + Channel abstractions
- [x] GREEN
- [x] `git commit -m "feat(networking): packet/channel layer — 23 tests green"`

---

### Block 2.4 — Eventloop.ts (TPC replacement surface)

Do NOT port the 65 Java TPC engine source files line-by-line. Implement a Bun-native
adapter for listen/connect/scheduling, but preserve protocol-facing behavior expected by
client/server layers.

```
src/internal/eventloop/
└── Eventloop.ts
```

The Java TPC suite contains many thread-level tests with no direct TS equivalent. Replace
those with behavior-focused tests proving bounded buffering, ordering, and connection
lifecycle semantics for the Helios transport path.

**TODO — Block 2.4**:
- [x] Implement `Eventloop.ts` wrapper for `Bun.listen()` / `Bun.connect()` / scheduling
- [x] Enforce bounded outbound buffering and explicit rejection/close behavior under pressure
- [x] Write Bun-native tests for listen/connect/data round-trip + backpressure/ordering behavior
- [x] GREEN
- [x] `git commit -m "feat(eventloop): Bun-native transport wrapper with parity gates — 9 tests green"`

### Runtime Architecture Delta (TPC -> Bun/Nest)

This is a hard contract for runtime replacement decisions.

- Preserve wire compatibility (`ClientMessage` frame layout, flags, correlation semantics).
- Preserve per-connection FIFO ordering and deterministic connection error handling.
- Keep backpressure explicit: saturated writes must reject or close; no silent drops.
- Require bounded memory in socket write paths (no unbounded queues).
- Collapse Java reactor/thread internals into Bun event loop intentionally, but document every semantic delta.

Temporal runtime guardrails:

- Runtime code must read time via `TimeSource`/`Clock` only, not direct `Temporal.now.*`.
- On startup, probe `globalThis.Temporal`; if unavailable, enable fallback path (`Date.now()` + monotonic delta).
- TTL/expiry tests must pass in both Temporal-available and fallback modes.

Benchmark and fail-fast gates:

- Protocol parity corpus (`encode/decode`) must be 100% green.
- Correlation mismatch count must be 0 under concurrent load.
- Per-connection ordering violations must be 0.
- Event-loop p99 lag under target load must stay <= 20 ms.
- If any gate fails, block progression to Phase 3/5 near-cache blocks.

---

**Phase 2 done gate**: ~90 tests green. Serialization + I/O + event loop complete.

---

## Phase 3 — Single-Node Core (~740 tests)

Goal: full in-process single-node HeliosInstance with all data structures.
No real TCP — single node, all partitions local. Start with test infrastructure.
Map sequencing rule: Blocks 3.2a → 3.2b → 3.2c are strictly sequential.

---

### Block 3.0 — Test Infrastructure (new code, no Java equivalent)

```
test-support/
├── TestNodeEngine.ts           # real serialization, stubbed cluster/partition
├── TestPartitionService.ts     # 271 partitions, all assigned locally
├── TestHeliosInstance.ts       # exposes getMap(), getQueue(), getTopic(), etc.
└── TestClusterRegistry.ts      # Phase 4 — in-memory multi-node registry
```

**TODO — Block 3.0**:
- [x] Implement TestNodeEngine (getSerializationService, getLogger minimum viable)
- [x] Implement TestPartitionService (all partitions local)
- [x] Implement TestHeliosInstance (thin facade over all services)
- [x] Verify Phase 1/2 tests still compile with stubs in place

---

### Block 3.1 — spi (src: 304 files, ~53 relevant tests)

```
src/spi/
├── NodeEngine.ts (interface — central dependency for all services)
├── impl/
│   ├── NodeEngineImpl.ts
│   ├── operationservice/
│   │   ├── Operation.ts (base class)
│   │   ├── OperationService.ts (interface)
│   │   ├── OperationServiceImpl.ts (in-process, single-node)
│   │   └── InvocationFuture.ts → Promise<T> wrapper
│   └── ManagedContext.ts
```

**TODO — Block 3.1**:
- [x] Convert ~53 test files
- [x] Implement NodeEngine interface + NodeEngineImpl
- [x] Implement Operation base class + OperationService (in-process dispatch)
- [x] Implement InvocationFuture as Promise wrapper
- [x] GREEN
- [x] `git commit -m "feat(spi): NodeEngine + Operations — 65 tests green"`

---

### Block 3.2a — map core RecordStore/CRUD (src: 555 files, ~24 relevant tests)

```
src/map/
├── IMap.ts (interface: get, put, remove, containsKey, entrySet, putIfAbsent, ...)
├── impl/
│   ├── MapService.ts / MapServiceContext.ts
│   ├── RecordStore.ts              (per-partition key→value storage)
│   ├── record/
│   │   ├── Record.ts / DataRecord.ts / ObjectRecord.ts
│   └── iterator/
│       └── MapIterator.ts
└── MapProxy.ts                     (routes operations to correct partition)
```

**TODO — Block 3.2a**:
- [x] Convert ~24 map core test files (RecordStore + CRUD behavior)
- [x] Implement RecordStore (put/get/remove/contains — the core)
- [x] Implement MapProxy + MapService core CRUD path
- [x] GREEN
- [x] `git commit -m "feat(map): core RecordStore + CRUD — 21 tests green"`

---

### Block 3.2b — map advanced operations (src: 555 files, ~27 relevant tests)

Depends on: Block 3.2a.

```
src/map/impl/operation/
├── PutIfAbsentOperation.ts / SetOperation.ts / DeleteOperation.ts
├── PutAllOperation.ts / GetAllOperation.ts
├── ExecuteOnKeyOperation.ts / EntryOperation.ts / EntryBackupOperation.ts
├── ExecuteOnEntriesOperation.ts / PartitionWideEntryOperation.ts
└── (remaining non-query map operations)
```

**TODO — Block 3.2b**:
- [x] Convert ~27 advanced map operation test files
- [x] Implement advanced ops (putIfAbsent/set/delete/putAll/getAll)
- [x] Implement entry processors + partition-wide entry operations
- [x] Verify backup/replication-safe operation contracts at single-node level
- [x] GREEN
- [x] `git commit -m "feat(map): advanced map ops + entry processors — 32 tests green"`

---

### Block 3.2c — map query integration (src: 555 files, ~15 relevant tests)

Depends on: Block 3.2b, Phase 1 Block 1.6 (query).

```
src/map/impl/query/
└── MapQueryEngine.ts       (uses Phase 1 predicates + indexes)
```

**TODO — Block 3.2c**:
- [x] Convert ~15 map query integration test files
- [x] Implement MapQueryEngine and wire it to Phase 1 predicates/indexes
- [x] Integrate query path through MapProxy/MapService
- [x] Verify predicate filtering + index-backed query execution
- [x] GREEN
- [x] `git commit -m "feat(map): query integration + MapQueryEngine wiring — 24 tests green"`

---

### Block 3.3 — Collections (topic: 24, collection: 56, multimap: 17 relevant tests)

Run as parallel sub-workers — these three are independent of each other.

```
src/topic/
├── ITopic.ts / Message.ts
├── TopicService.ts / TopicProxy.ts
└── reliable/ReliableTopicProxy.ts   (backed by Ringbuffer)

src/collection/
├── IQueue.ts / ISet.ts / IList.ts
└── impl/                            (one Service + operations per type)

src/multimap/
├── MultiMap.ts
└── impl/                            (MultiMapService + operations)
```

**TODO — Block 3.3**:
- [x] Implement ITopic + TopicService + ReliableTopic (backed by ringbuffer)
- [x] Implement IQueue + QueueService + all queue operations
- [x] Implement ISet + SetService + all set operations
- [x] Implement IList + ListService + all list operations
- [x] Implement MultiMap + MultiMapService + all multimap operations
- [x] GREEN
- [x] `git commit -m "feat(collections): IQueue/ISet/IList/ITopic/MultiMap — 149 tests green"`

---

### Block 3.4 — ringbuffer full (src: 32 files, ~23 remaining tests)

```
src/ringbuffer/impl/
├── RingbufferContainer.ts          (TTL, store, read/write ops)
├── RingbufferExpirationPolicy.ts
├── RingbufferService.ts / RingbufferProxy.ts
├── RingbufferStoreWrapper.ts
├── ReadResultSetImpl.ts
└── operations/
    ├── AddOperation.ts / AddAllOperation.ts / AddBackupOperation.ts
    ├── ReadOneOperation.ts / ReadManyOperation.ts
    └── GenericOperation.ts
```

**DONE — Block 3.4** (42 new tests green, 51 total ringbuffer tests):
- [x] Convert remaining test files
- [x] Implement RingbufferContainer (TTL + store integration)
- [x] Implement all ringbuffer operations (Add, ReadOne, ReadMany, Generic)
- [x] Implement RingbufferService with container management
- [x] All ringbuffer tests green
- [x] `git commit -m "feat(ringbuffer): full RingbufferContainer — 42 tests green"`

---

### Block 3.5 — cache / JCache (src: 164 files, ~53 relevant tests)

```
src/cache/
├── ICache.ts / CacheProxy.ts
├── impl/
│   ├── CacheService.ts / CacheRecordStore.ts
│   ├── operation/
│   │   ├── CacheGetOperation.ts / CachePutOperation.ts / CacheRemoveOperation.ts
│   │   └── (remaining cache operations)
│   └── journal/
│       └── CacheEventJournal.ts
└── CacheManager.ts
```

**DONE — Block 3.5**:
- [x] Convert test files (DeferredValue, JCacheDetector, CacheUtil, CacheRecordStore, EntryCountCacheEvictionChecker)
- [x] Implement CacheUtil, HazelcastCacheManager, DeferredValue, JCacheDetector
- [x] Implement CacheRecord, CacheDataRecord, CacheObjectRecord, CacheRecordStore
- [x] Implement EntryCountCacheEvictionChecker, InMemoryFormat
- [x] GREEN
- [x] `git commit -m "feat(cache): JCache / ICache — 51 tests green"`

---

### Block 3.6 — transaction (src: 55 files, ~20 relevant tests)

```
src/transaction/
├── TransactionContext.ts / Transaction.ts (interface)
├── impl/
│   ├── TransactionServiceImpl.ts
│   ├── TransactionalMapProxy.ts / TransactionalQueueProxy.ts
│   └── xa/ → XATransaction.ts
```

**DONE — Block 3.6**:
- [x] Convert test files (TransactionTypeTest, TransactionLogTest, TransactionImplTest, OnePhase, TwoPhase, ManagerServiceImplTest)
- [x] Implement TransactionOptions/TransactionType, Transaction interface, TransactionLogRecord, TargetAwareTransactionLogRecord
- [x] Implement TransactionLog, TransactionImpl (async ONE_PHASE + TWO_PHASE), TransactionManagerServiceImpl
- [x] Add Address, MwCounter; extend OperationService/OperationServiceImpl with invokeOnTarget
- [x] GREEN — 44 tests
- [x] `git commit -m "feat(transaction): TransactionContext — 44 tests green"`

---

### Block 3.7 — security (src: 63 files, ~9 relevant tests)

```
src/security/
├── Credentials.ts / PasswordCredentials.ts / TokenCredentials.ts
├── SecurityContext.ts
└── permission/
    └── PermissionCollection.ts
```

**DONE — Block 3.7**:
- [x] Convert test files (InstancePermissionTest, MapPermissionTest, CachePermissionTest, CardinalityEstimatorPermissionTest, ActionConstantsTest, CredentialsTest)
- [x] Implement Credentials/PasswordCredentials/TokenCredentials, UsernamePasswordCredentials, SimpleTokenCredentials
- [x] Implement ClusterPermission, InstancePermission, ClusterPermissionCollection, WildcardPermissionMatcher, ActionConstants
- [x] Implement MapPermission, CachePermission, MultiMapPermission, QueuePermission, ListPermission, SetPermission, TopicPermission, LockPermission, ExecutorServicePermission, FlakeIdGeneratorPermission, ReplicatedMapPermission, AtomicLongPermission, AtomicReferencePermission, SemaphorePermission, CountDownLatchPermission, CPMapPermission, UserCodeNamespacePermission, VectorCollectionPermission, CardinalityEstimatorPermission, ScheduledExecutorPermission
- [x] GREEN — 57 tests
- [x] `git commit -m "feat(security): credentials + permissions — 57 tests green"`

---

### Block 3.8 — HeliosDiscovery (replaces aws/azure/gcp/kubernetes)

```
src/discovery/
└── HeliosDiscovery.ts   (~100 lines)
```

This replaces the entire `aws/` (21 files), `azure/` (12), `gcp/` (12), `kubernetes/`
(16) Java packages. The Java versions used `HttpURLConnection`. We use `fetch()`.

```typescript
// HeliosDiscovery.ts — production contract + provider adapters
export interface DiscoveryProvider {
  readonly name: "aws" | "azure" | "gcp" | "k8s" | "static";
  discover(config: DiscoveryConfig, signal?: AbortSignal): Promise<readonly MemberAddress[]>;
}

export interface HeliosDiscoveryResolver {
  resolve(joinConfig: JoinConfig, providers: readonly DiscoveryProvider[]): Promise<readonly MemberAddress[]>;
}
```

Write 5–10 tests with mocked `fetch()` using `mock()` from `bun:test`.

**DONE — Block 3.8** (15 tests green):
- [x] Implement `HeliosDiscovery.ts` resolver + provider adapters (`aws`, `azure`, `gcp`, `k8s`, `static`)
- [x] Add typed discovery contracts (`DiscoveryProvider`, `HeliosDiscoveryResolver`, `DiscoveryConfig`)
- [x] Write bun tests with mocked fetch for each provider + static fallback
- [x] GREEN
- [x] `git commit -m "feat(discovery): HeliosDiscovery — replaces aws/azure/gcp/k8s"`

---

### Block 3.9 — HeliosDiscovery integration contract (~8 relevant tests)

Depends on: Block 1.7 (config), Block 3.1 (spi), Block 3.8 (provider adapters).

```
src/config/
├── JoinConfig.ts / DiscoveryConfig.ts       (typed discovery provider model)
└── parser/XmlConfigBuilder.ts + YamlConfigBuilder.ts

src/internal/cluster/
└── ClusterJoinManager.ts                     (consumes HeliosDiscoveryResolver)
```

This is the production viability gate: discovery is not complete until join flow consumes
the typed contract from config and uses discovered members during bootstrap.

**DONE — Block 3.9** ✅ (12 tests green):
- [x] Add typed discovery config surface to config model + XML/YAML parsing
- [x] Wire `ClusterJoinManager` to `HeliosDiscoveryResolver` (provider selection + fallback)
- [x] Add integration tests: config → join manager → discovered members list
- [x] GREEN
- [x] `git commit -m "feat(discovery): wire discovery contract into join/config"`

---

### Block 3.10 — instance/core lifecycle (src: 50+42 files, ~30 relevant tests)

```
src/core/
└── HeliosInstance.ts (interface — getMap, getQueue, getTopic, etc.)

src/instance/
├── HeliosInstanceImpl.ts           (implements HeliosInstance — the main entry point)
├── HeliosBootstrap.ts              (NodeEngine wiring)
└── lifecycle/
    ├── HeliosLifecycleService.ts
    └── LifecycleEvent.ts (enum)
```

**DONE — Block 3.10** (40 tests green):
- [x] Convert ~30 test files (MobyNames, OOMDispatcher, DistributedObjectUtil, BuildInfo, LifecycleEvent, HeliosLifecycleService)
- [x] Implement HeliosInstance interface
- [x] Implement lifecycle management (HeliosLifecycleService + LifecycleEvent)
- [x] Implement MobyNames, BuildInfo, BuildInfoProvider, OutOfMemoryErrorDispatcher, DefaultOutOfMemoryHandler
- [x] GREEN
- [x] `git commit -m "feat(instance): instance/core lifecycle — 40 tests green"`

---

### Block 3.11 — client core foundations (pre-cluster, ~80 relevant tests)

Depends on: Block 3.0 (TestHeliosInstance), Block 3.1 (spi), Block 3.2c (map query integration complete), Block 3.5 (cache), Block 3.10 (instance/core), Phase 2 networking.

```
src/client/
├── HeliosClient.ts
├── ClientConnectionManager.ts
├── ClientInvocationService.ts
├── ClientPartitionService.ts
├── proxy/
│   ├── ClientMapProxy.ts
│   ├── ClientQueueProxy.ts
│   ├── ClientTopicProxy.ts
│   ├── ClientRingbufferProxy.ts
│   └── (base proxies without multi-node near-cache reconciliation)
└── protocol/
    ├── ClientMessage.ts
    └── codec/                                (core operation codecs, excludes near-cache metadata/invalidation)
```

Scope gate: this block is single-node only and must be testable against `TestHeliosInstance`.
Do not gate this block on multi-node partition migration behavior.

**DONE — Block 3.11** ✅ (25 tests green):
- [x] Convert core client tests that do not require multi-node invalidation reconciliation
- [x] Implement ClientMessage frame format + core codec encode/decode pairs
- [x] Implement ClientConnectionManager + invocation/partition services for single-node transport
- [x] Implement base client proxies (map/queue/topic/ringbuffer/cache) against TestHeliosInstance
- [x] `bun test --pattern "client/(core|protocol|proxy)"` against TestHeliosInstance → GREEN
- [x] `git commit -m "feat(client-core): single-node client foundations — tests green"`

---

### Block 3.12a — internal/nearcache storage/runtime core (~22 relevant tests)

> **Primary goal of the whole project.** Near cache is the client-side read cache
> that eliminates network round-trips for hot data. Get this right.

Depends on: Phase 2 (serialization — NearCacheDataRecord wraps Data), Phase 1 config
(NearCacheConfig), Block 1.9 (near cache compile-time contracts), Block 3.2c (map query integration complete), Block 3.5 (cache).

```
src/internal/nearcache/
├── NearCache.ts                        (interface)
├── NearCacheManager.ts                 (interface)
├── NearCacheRecord.ts                  (interface)
├── NearCacheRecordStore.ts             (interface)
└── impl/
    ├── DefaultNearCache.ts             (get, put, remove, evict, TTL enforcement)
    ├── DefaultNearCacheManager.ts      (lifecycle — create/destroy per data structure)
    ├── SampleableNearCacheRecordMap.ts (eviction sampling)
    ├── invalidation/
    │   ├── BatchNearCacheInvalidation.ts
    │   └── SingleNearCacheInvalidation.ts
    ├── maxsize/
    │   └── EntryCountNearCacheEvictionChecker.ts
    ├── preloader/
    │   ├── NearCachePreloader.ts
    │   └── NearCachePreloaderLock.ts
    ├── record/
    │   ├── AbstractNearCacheRecord.ts
    │   ├── NearCacheDataRecord.ts
    │   └── NearCacheObjectRecord.ts
    └── store/
        ├── AbstractNearCacheRecordStore.ts
        ├── BaseHeapNearCacheRecordStore.ts
        ├── HeapNearCacheRecordMap.ts
        ├── NearCacheDataRecordStore.ts
        └── NearCacheObjectRecordStore.ts

src/internal/monitor/impl/
└── NearCacheStatsImpl.ts               (tracks hits/misses/evictions for observability)
```

**TODO — Block 3.12a**:
- [x] Port NearCacheConfig tests (from config block if not already done)
- [x] Convert core near-cache storage/runtime tests (`NearCacheManagerTest`, `NearCacheRecordStoreTest`, `NearCacheTest`, `NearCachePreloaderLockTest`, `AbstractNearCacheRecordStoreTest`, `NearCacheStatsImplTest`)
- [x] Implement interfaces and runtime impl classes above
- [x] TTL/max-idle enforcement must use `Clock`/`TimeSource`
- [x] Both `IN_MEMORY_FORMAT` modes must pass (`OBJECT`, `BINARY`)
- [x] GREEN — 65 tests green (1510 total)
- [x] `git commit -m "feat(nearcache): storage/runtime core (3.12a) — 65 tests green"`

---

### Block 3.12b — shared invalidation + repair primitives (~20 relevant tests)

Depends on: Block 3.12a, Block 3.1 (execution/event services), Block 3.2c, Block 3.5.

```
src/internal/nearcache/impl/invalidation/
├── Invalidation.ts
├── Invalidator.ts
├── MetaDataGenerator.ts
├── MetaDataContainer.ts
├── InvalidationMetaDataFetcher.ts
├── RepairingHandler.ts
├── RepairingTask.ts
├── StaleReadDetector.ts
├── StaleReadDetectorImpl.ts
├── BatchInvalidator.ts / NonStopInvalidator.ts
└── (supporting invalidation/repair internals)
```

This block establishes shared near-cache correctness primitives used by both member-side
and client-side near-cache reconciliation paths.

**TODO — Block 3.12b**:
- [x] Convert invalidation/repair internals tests (`RepairingHandlerTest`, `RepairingTaskTest`, `MetaDataGeneratorTest`, `StaleReadDetectorTest`, metadata container/fetcher tests)
- [x] Implement metadata sequence/UUID generation and repair-state tracking
- [x] Implement stale-read detection contracts in near-cache read path helpers
- [x] Implement tolerated-miss handling and stale-sequence advancement rules
- [x] GREEN — 43 tests ✅
- [x] `git commit -m "feat(nearcache): shared invalidation+repair primitives (3.12b) — 43 tests green"`

---

### Block 3.13a — near cache server local integration (~20 relevant tests)

Depends on: Block 3.12a, Block 3.12b, Block 3.2c (map query integration complete), Block 3.5 (cache).

```
src/map/impl/nearcache/
├── MapNearCacheManager.ts          (wraps DefaultNearCacheManager, per-map lifecycle)
└── NearCachedMapProxyImpl.ts       (server-side map proxy with near cache read-through)
```

This block wires near cache into local server-side map/cache execution semantics.
Migration metadata state holder work moves to Phase 4 Block 4.4.

**TODO — Block 3.13a**:
- [x] Convert server-side near-cache local integration tests (`MapNearCacheBasicTest`, `MapNearCacheEvictionTest`, `MapNearCacheInvalidationTest`, `MapNearCacheLocalInvalidationTest`, local staleness tests)
- [x] Implement `MapNearCacheManager` lifecycle integration with `MapService`
- [x] Implement `NearCachedMapProxyImpl` read-through + local write invalidation behavior
- [x] Verify local invalidation and read-through correctness across map/cache paths
- [x] GREEN
- [x] `git commit -m "feat(nearcache): server local integration (3.13a) — 39 tests green"`

---

**Phase 3 done gate**: ~740 tests green. Full single-node Helios with map 3.2a/3.2b/3.2c complete, client core foundations, all data structures, near-cache storage/runtime, and shared invalidation/repair primitives.

---

## Phase 4 — Cluster Layer (~142 tests)

Goal: multi-node in-process cluster. Membership + partition assignment + replication.
Start with TestClusterRegistry so multi-node tests can run in-process.

> **Multi-node resilience plan:** The full cluster runtime, partition service, operation
> routing, backup replication, anti-entropy, and map replication (including write-behind
> queue state transfer) are specified in `plans/MULTI_NODE_RESILIENCE_PLAN.md`. That plan
> covers Phases A–F building on the data model foundations delivered in Blocks 4.0–4.4 below.

---

### Block 4.0 — TestClusterRegistry (new code)

```typescript
// test-support/TestClusterRegistry.ts
// in-memory Map<memberId, TestHeliosInstance>
// partitions distributed round-robin across registered members
// no real TCP — nodes share in-process memory
```

---

### Block 4.1 — internal/cluster + cluster (src: 84+19 files, ~64 relevant tests)

```
src/cluster/
├── Member.ts (interface) / MemberImpl.ts
└── ClusterService.ts (interface)

src/internal/cluster/
├── ClusterServiceImpl.ts
├── MembershipManager.ts
├── ClusterJoinManager.ts
├── HeartbeatManager.ts
└── SplitBrainProtection.ts
```

**DONE — Block 4.1** (94 tests green):
- [x] Convert unit-testable test files (VectorClock, MemberSelectors, MemberMap, MembersView, MembersViewMetadata, MemberSelectingCollection, MemberSelectingIterator, AddressCheckerImpl, Versions)
- [x] Implement Member + MemberImpl + MemberSelector + MemberSelectors + VectorClock
- [x] Implement MemberSelectingCollection + MemberMap + MembersView + MembersViewMetadata
- [x] Implement AddressCheckerImpl + AddressUtil + Versions
- [x] GREEN — 94 tests pass
- [x] `git commit -m "feat(cluster): cluster membership — 94 tests green"`

---

### Block 4.2 — internal/partition (src: 112 files, ~63 relevant tests)

```
src/internal/partition/
├── PartitionService.ts (interface) / PartitionServiceImpl.ts
├── PartitionReplica.ts
├── MigrationManager.ts
└── PartitionReplicaManager.ts
```

**DONE — Block 4.2** (58 tests green):
- [x] Convert unit-testable test files (PartitionTableViewTest, InternalPartitionImplTest, MigrationPlannerTest, MigrationQueueTest, NameSpaceUtilTest)
- [x] Implement PartitionReplica, IPartition, InternalPartition, AbstractInternalPartition, ReadonlyInternalPartition, PartitionTableView, PartitionStampUtil
- [x] Implement InternalPartitionImpl, MigrationPlanner, MigrationQueue, MigrationRunnable, NameSpaceUtil, MigrationInfo
- [x] Implement ServiceNamespace interface (services layer)
- [x] GREEN — 58 tests pass
- [x] `git commit -m "feat(partition): partition core + migration planner — 58 tests green"`

---

### Block 4.3 — replicatedmap (src: 65 files, ~15 relevant tests)

```
src/replicatedmap/
├── ReplicatedMap.ts (interface)
└── impl/
    ├── ReplicatedMapService.ts
    └── ReplicatedMapProxy.ts
```

**DONE — Block 4.3** (46 tests green):
- [x] Convert ~15 test files (ReplicatedRecordTest, EntryViewTest, LazyCollectionTest, LazySetTest, LazyIteratorTest)
- [x] Implement ReplicatedRecord, InternalReplicatedMapStorage, ReplicatedMapEntryView, LazyCollection, LazySet, ValuesIteratorFactory, KeySetIteratorFactory, EntrySetIteratorFactory, ReplicatedRecordStore interface
- [x] GREEN — 46 tests pass
- [x] `git commit -m "feat(replicatedmap): ReplicatedMap record/lazy structures — 46 tests green"`

---

### Block 4.4 — near-cache migration metadata + metadata fetch surfaces (~12 relevant tests)

Depends on: Block 4.1, Block 4.2, Block 3.13a.

```
src/map/impl/operation/
└── MapNearCacheStateHolder.ts

src/cache/impl/operation/
└── CacheNearCacheStateHolder.ts

src/client/impl/protocol/task/map/
└── MapFetchNearCacheInvalidationMetadataTask.ts (TS equivalent)

src/client/impl/protocol/task/cache/
└── CacheFetchNearCacheInvalidationMetadataTask.ts (TS equivalent)
```

This block introduces migration-safe metadata state transfer and server surfaces used by
client near-cache metadata reconciliation.

**TODO — Block 4.4**:
- [x] Convert and port migration metadata/state-holder tests for map and cache
- [x] Implement map/cache near-cache state holders for migration-safe metadata snapshots
- [x] Implement server metadata fetch task surfaces required by client reconciliation
- [x] Verify partition UUID/sequence metadata is available and consistent during migration/restart scenarios
- [x] GREEN
- [x] `git commit -m "feat(nearcache): migration metadata + fetch surfaces (4.4) — tests green"`

---

**Phase 4 done gate**: ~142 tests green. Full in-process multi-node cluster plus near-cache migration metadata surfaces.

---

## Phase 5 — Client Near-Cache Reconciliation (~85 tests)

Goal: complete multi-node client near-cache invalidation/reconciliation on top of the
pre-cluster client core delivered in Phase 3.

Depends on: Phase 4 (cluster/partition + Block 4.4), Block 3.11 (client core foundations),
Block 3.12a (near cache storage/runtime core), Block 3.12b (shared invalidation/repair internals), Block 3.13a (server local near cache integration).

```
src/client/
├── HeliosClient.ts                              (main entry point for client users)
├── ClientConnectionManager.ts                  (Bun.connect → manages connections)
├── ClientInvocationService.ts
├── ClientPartitionService.ts
├── impl/statistics/
│   └── NearCacheMetricsProvider.ts             (exposes near cache hit/miss stats)
├── proxy/
│   ├── ClientMapProxy.ts                        (IMap via client protocol)
│   ├── ClientQueueProxy.ts
│   ├── ClientTopicProxy.ts
│   ├── ClientRingbufferProxy.ts
│   └── (one proxy per data structure)
├── map/impl/nearcache/
│   └── NearCachedClientMapProxy.ts             (wraps ClientMapProxy + near cache read-through)
├── cache/impl/nearcache/
│   └── NearCachedClientCacheProxy.ts           (wraps ClientCacheProxy + near cache read-through)
└── protocol/
    ├── ClientMessage.ts                         (binary frame: header + payload)
    ├── ClientProtocolVersion.ts
    └── codec/
        ├── MapAddNearCacheInvalidationListenerCodec.ts
        ├── MapFetchNearCacheInvalidationMetadataCodec.ts
        ├── CacheAddNearCacheInvalidationListenerCodec.ts
        ├── CacheFetchNearCacheInvalidationMetadataCodec.ts
        ├── ReplicatedMapAddNearCacheEntryListenerCodec.ts
        ├── custom/NearCacheConfigHolderCodec.ts
        ├── custom/NearCachePreloaderConfigCodec.ts
        └── (all other operation codecs)
```

Near cache invalidation flow (client side):
1. On connect, `NearCachedClientMapProxy` registers an invalidation listener via `MapAddNearCacheInvalidationListenerCodec`
2. When the cluster processes a write, it pushes `SingleNearCacheInvalidation` or `BatchNearCacheInvalidation` events to all subscribed clients
3. The client listener calls `nearCache.remove(key)` on receipt
4. On partition migration, `MapFetchNearCacheInvalidationMetadataCodec` is used to reconcile which keys need invalidation

### Near Cache Parity Contract

Phase 5 is complete only when all rules below are green for map + cache near-cache paths.

Mandatory invariants:

- Read-through reservation correctness: miss -> reserve -> fetch -> publish, with failed fetch cleanup.
- Write-path invalidation correctness for local and remote writes, including clear events.
- Metadata-bearing invalidation events (partition UUID + sequence) for reconciliation.
- Listener lifecycle correctness: register on init, remove on close/destroy/shutdown.
- Stale-read prevention via sequence/UUID checks before serving cached values.
- Anti-entropy repair loop that converges after dropped invalidations/reconnect windows.
- Config-semantic parity (`serializeKeys`, `CACHE_ON_UPDATE`, `IN_MEMORY_FORMAT`, TTL/max-idle/max-size).

Required components (must exist and be wired):

- Metadata generation + metadata fetch surfaces.
- Listener add/remove protocol handlers + client lifecycle wiring.
- Repairing handler/task + stale-read detector + metadata containers.
- Near-cache metrics wiring (`NearCacheMetricsProvider` + stats provider path).

Deferred/non-goal policy:

- Enterprise-specific near-cache behavior is deferred unless required by OSS tests.
- Alternative reconciliation algorithms are non-goal until parity model is complete.

### Block 5.0 — protocol transport for near-cache invalidation/reconciliation (~60 relevant tests)

Depends on: Block 3.11 (client core foundations), Block 4.4 (metadata surfaces), Phase 4 cluster/partition.

**TODO — Block 5.0**:
- [x] Convert protocol/task-focused near-cache suites for listener add/remove + metadata fetch (`MapAddNearCacheInvalidationListener*`, `CacheAddNearCacheInvalidationListener*`, metadata fetch task suites)
- [x] Implement near-cache invalidation listener codecs and metadata fetch codecs (map/cache/replicated map)
- [x] Implement server protocol task handlers for listener registration/removal and metadata fetch endpoints
- [x] Verify remote write events are delivered with partition UUID/sequence metadata
- [x] GREEN
- [x] `git commit -m "feat(client-nearcache): protocol transport + metadata tasks (5.0) — tests green"`

---

### Block 5.1 — near-cached client proxies + listener lifecycle wiring (~60 relevant tests) ⭐

Depends on: Block 5.0, Block 3.12a, Block 3.12b, Block 3.13a.

**TODO — Block 5.1**:
- [x] Convert proxy-focused near-cache suites (`ClientMapNearCache*`, `ClientCacheNearCache*`, `ClientReplicatedMapNearCache*`, config/isolation suites)
- [x] Implement `NearCachedClientMapProxy` + `NearCachedClientCacheProxy` read-through semantics
- [x] Wire listener registration/removal and repairing-handler lifecycle in client proxy connect/disconnect flow
- [x] Implement `NearCacheMetricsProvider` integration with `NearCacheStatsImpl`
- [x] Verify multi-client remote write invalidates peer near caches and preserves hit/miss accounting
- [x] GREEN
- [x] `git commit -m "feat(client-nearcache): near-cached proxies + listener lifecycle (5.1) — tests green"`

---

### Block 5.2 — client anti-entropy integration + fault-path hardening (10 tests green) ⭐ ✅

Depends on: Block 5.1, Block 4.2, Block 4.4, Block 3.12b.

```
src/client/map/impl/nearcache/invalidation/
├── RepairingTask.ts
├── RepairingHandler.ts
├── StaleReadDetector.ts
└── metadata fetch integration
```

**TODO — Block 5.2**:
- [x] Convert anti-entropy and stale-read suites (`RepairingHandlerTest`, `RepairingTaskTest`, `StaleReadDetectorTest`, metadata fetcher tests)
- [x] Wire client metadata fetchers to map/cache fetch metadata codecs
- [x] Enforce tolerated-miss handling and stale-sequence advancement behavior
- [x] Verify dropped invalidation + reconnect + migration scenarios converge without stale reads after repair window
- [x] GREEN
- [x] `git commit -m "feat(client-nearcache): anti-entropy integration + stale-read hardening (5.2) — 10 tests green"`

---

### Block 5.3 — end-to-end near cache production-flow acceptance (~5 new tests) ⭐

Depends on: Block 5.0, Block 5.1, Block 5.2.

**TODO — Block 5.3**:
- [x] Add dedicated e2e acceptance suite for exact production flow over real TCP (single-node server + 2 clients)
- [x] Prove canonical sequence: miss -> hit -> remote write invalidation -> re-fetch
- [x] Assert no cluster read on hit path and explicit cluster read on post-invalidation re-fetch
- [x] Include map and cache variants; include reconnect + dropped invalidation repair scenario
- [x] GREEN
- [x] `git commit -m "test(client-nearcache): e2e production-flow acceptance over TCP (5.3) — tests green"`

---

### Production Proof Gate (Near Cache)

This gate is release-blocking and runs after Block 5.3.

Required scenarios:

- E2E map flow and cache flow over real TCP with two clients, repeated >= 1000 iterations.
- Replicated map near-cache listener behavior (`localOnly` true/false).
- Failure/repair runs with dropped invalidations and listener reconnect windows.
- Soak run (24h) with membership churn and reconnect churn.
- Stress run (>= 30 min) at production target throughput.

Required thresholds:

- Stale reads: 0 after repair windows.
- Invalidation lag: p99 <= 1s (stress), max <= 5s.
- Near-cache hit ratio in hot-read profile: >= 85% after warmup.
- Listener leak delta after tests: 0.
- Near-cache memory drift in steady-state soak: <= 10%.

Release-blocking criteria:

- Any stale-read breach, listener leak, or missing near-cache metrics stream blocks release.
- Any threshold breach blocks release until fixed and re-validated.

**Phase 5 done gate**: ~85 tests green, strict near-cache gates green, and Production Proof Gate green.

---

## Phase 6 — NestJS Integration (~141 tests)

Goal: first-class NestJS integration. Port `hazelcast-spring/` (31 src, 130 tests) +
`hazelcast-spring-boot-autoconfiguration/hazelcast-spring-boot4/` (2 src, 11 tests).

SQL and CP are deferred to v2 — Blitz (stream processing) is implemented in Phase 10. See Deferred section.

Blocks 6.1–6.4 are parallelizable within this phase.

---

### Block 6.1 — HeliosModule core (hazelcast-spring main)

```
src/nestjs/
├── HeliosModule.ts                       # @Global() replaces HazelcastNamespaceHandler
│   ├── forRoot(config: Config): DynamicModule
│   └── forRootAsync(options): DynamicModule
├── HeliosInstanceDefinition.ts           # provider factory
├── HeliosObjectExtractionModule.ts
└── context/
    └── NestManagedContext.ts             # replaces SpringManagedContext, uses ModuleRef
```

Spring `@SpringAware` → NestJS: `implements OnModuleInit`, inject via `ModuleRef`.

**TODO — Block 6.1**:
- [x] Convert hazelcast-spring main test files (NestJS-style tests from scratch)
- [x] Implement HeliosModule.forRoot() + forRootAsync()
- [x] Implement NestManagedContext
- [x] GREEN — 16 tests ✅

---

### Block 6.2 — HeliosCacheModule

```
src/nestjs/
├── HeliosCacheModule.ts                  # replaces HazelcastCacheManager
└── HeliosCache.ts                        # implements NestJS CacheStore interface
```

Spring `HazelcastCacheManager` → `CacheModule.registerAsync({ useClass: HeliosCacheStore })`.

**TODO — Block 6.2**:
- [x] Implement HeliosCache (NestJS CacheStore backed by IMap)
- [x] Implement HeliosCacheModule
- [x] GREEN

---

### Block 6.3 — HeliosTransactionModule

```
src/nestjs/
├── HeliosTransactionModule.ts
├── @Transactional.ts                     # decorator — wraps method in Helios TX
└── HeliosTransactionManager.ts
```

**TODO — Block 6.3**:
- [x] Implement `@Transactional()` decorator
- [x] Implement HeliosTransactionManager
- [x] GREEN

---

### Block 6.4 — Boot Autoconfiguration (Spring Boot 4 only)

```
src/nestjs/autoconfiguration/
├── HeliosAutoConfigurationModule.ts      # @Global() dynamic module
└── HeliosBoot4ObjectExtractionModule.ts
```

Ports `hazelcast-spring-boot4/` only (2 src files, 11 tests). Spring Boot 3 and legacy
variants are excluded — they map to nothing in NestJS.

The module:
- Auto-reads `helios.config` from environment / file on startup
- Creates and provides `HeliosInstance` as a singleton provider
- Exports all Helios data structure proxies

**TODO — Block 6.4**:
- [x] Implement HeliosAutoConfigurationModule
- [x] Implement HeliosBoot4ObjectExtractionModule
- [x] Boot 4 autoconfiguration tests green (11 tests)

---

### Block 6.5 — NestJS integration tests (hazelcast-spring-tests, 124 tests)

```typescript
// Java: @RunWith(SpringRunner.class) @ContextConfiguration(classes = HeliosConfig.class)
// NestJS: const app = await Test.createTestingModule({ imports: [HeliosModule.forRoot(cfg)] }).compile()
```

**TODO — Block 6.5**:
- [x] Convert all portableable spring-tests integration tests (XML-config tests dropped — require running cluster)
- [x] Fix all remaining Jest → bun:test API differences
- [x] All 141 Phase 6 tests green
- [x] `git commit -m "feat(nestjs): full NestJS integration — 141 tests green"`

---

**Phase 6 done gate**: ~141 tests green. Helios is a drop-in NestJS module.

---

## Phase 7 — Instance Facade Wiring + Example App + Production Hardening

Goal: wire all implemented data structures into a usable HeliosInstance facade, prove it
works end-to-end with an example app, then harden for production deployment.

---

### Block 7.0 — Wire data structures into TestHeliosInstance + example app ✅

Completed. `TestHeliosInstance` now lazily creates and returns real data structure instances:
- `getMap<K,V>(name)` → `SimpleMapProxy` wrapping `DefaultRecordStore` with serialization
- `getQueue<E>(name)` → `QueueImpl`
- `getList<E>(name)` → `ListImpl`
- `getSet<E>(name)` → `SetImpl`
- `getTopic<E>(name)` → `TopicImpl`
- `getMultiMap<K,V>(name)` → `MultiMapImpl`

Same name returns same instance. Shutdown clears all structures.

Example app: `examples/helios-smoke-test.ts` — runnable with `bun run examples/helios-smoke-test.ts`
Test suite: `test/examples/HeliosSmokeTest.test.ts` — 27 tests covering all 6 data structures.

---

### Block 7.1 — Production HeliosInstanceImpl with service registry wiring

Replace `TestHeliosInstance` as the primary entry point with a production-grade
`HeliosInstanceImpl` that:
- Registers all services (`MapService`, `QueueService`, `TopicService`, etc.) in a real service registry
- Uses `NodeEngineImpl` with production `SerializationServiceImpl`
- Supports `Config`-driven initialization (map configs, near-cache configs, etc.)
- Implements the full `HeliosInstance` interface

**DONE — Block 7.1** ✅ (30 tests green):
- [x] Implement `HeliosInstanceImpl` with service registry and config wiring
- [x] Implement `MapServiceImpl` wrapping `DefaultRecordStore` per partition
- [x] Wire all data structure services into the registry
- [x] Tests: instance creation, service lookup, config-driven map/queue creation
- [x] GREEN
- [x] `git commit -m "feat(instance): production HeliosInstanceImpl with service registry"`

---

### Block 7.2 — Helios.newInstance() factory + config-driven bootstrap

Public factory API for creating Helios instances:

```typescript
const hz = await Helios.newInstance();                    // default config
const hz = await Helios.newInstance(config);              // explicit config
const hz = await Helios.newInstance('helios-config.yml'); // file-based config
```

**DONE — Block 7.2** ✅ (27 tests green):
- [x] Implement `Helios` static factory class
- [x] Implement config file loading (YAML + JSON)
- [x] Implement config validation with clear error messages for invalid configs
- [x] Wire deferred-service stubs (SQL, Blitz stub until Phase 10, CP, ScheduledExecutor)
- [x] Tests: factory creation, config file loading, deferred-service error messages
- [x] GREEN
- [x] `git commit -m "feat(factory): Helios.newInstance() factory + config bootstrap"`

---

### Block 7.3 — HeliosInstance interface expansion

Expand the minimal `HeliosInstance` interface to expose all implemented data structures:

```typescript
export interface HeliosInstance {
  getName(): string;
  getMap<K, V>(name: string): IMap<K, V>;
  getQueue<E>(name: string): IQueue<E>;
  getList<E>(name: string): IList<E>;
  getSet<E>(name: string): ISet<E>;
  getTopic<E>(name: string): ITopic<E>;
  getMultiMap<K, V>(name: string): MultiMap<K, V>;
  getReplicatedMap<K, V>(name: string): ReplicatedMap<K, V>;
  getDistributedObject(serviceName: string, name: string): DistributedObject;
  shutdown(): void;
  getLifecycleService(): LifecycleService;
  getCluster(): Cluster;
  getConfig(): Config;
}
```

**DONE — Block 7.3** ✅ (27 tests green):
- [x] Expand `HeliosInstance` interface with all accessor methods
- [x] Ensure all implementations conform
- [x] Update NestJS `HeliosModule` to use expanded interface
- [x] Tests: interface compliance, NestJS injection with expanded interface
- [x] GREEN
- [x] `git commit -m "feat(core): expand HeliosInstance interface with all data structures"`

---

### Block 7.4 — IMap interface promotion

Promote `SimpleMapProxy` to a full `IMap<K,V>` interface with:
- Event listeners (`addEntryListener`, `removeEntryListener`)
- Predicate-based queries (`values(predicate)`, `keySet(predicate)`, `entrySet(predicate)`)
- Aggregation support (`aggregate(aggregator)`, `aggregate(aggregator, predicate)`)
- Locking (`lock`, `tryLock`, `unlock`, `isLocked`)
- Async variants (`putAsync`, `getAsync`, `removeAsync`)

**TODO — Block 7.4**:
- [x] Define `IMap<K,V>` interface with full method surface
- [x] Implement `MapProxy` extending current `SimpleMapProxy` with query/aggregation/listener support
- [x] Wire `MapQueryEngine` into map proxy query methods
- [x] Tests: predicate queries, aggregation, entry listeners, async operations
- [x] GREEN
- [x] `git commit -m "feat(map): full IMap interface with queries/aggregation/listeners"`

---

### Block 7.5 — Multi-node TCP integration test

Prove two real Helios instances can communicate over TCP using `Bun.listen`/`Bun.connect`:
- Instance A starts, listens on a port
- Instance B connects to Instance A
- Instance B puts a map entry
- Instance A reads the map entry
- Near-cache invalidation flows between them

**TODO — Block 7.5**:
- [x] Implement TCP-based member join and data exchange
- [x] Write integration test with 2 real instances on localhost
- [x] Verify map put/get across nodes
- [x] Verify near-cache invalidation propagates across nodes
- [x] GREEN
- [x] `git commit -m "test(integration): multi-node TCP integration — 2 instances communicating"`

---

### Block 7.6 — Near-cache production proof soak/stress suite

Implement the Production Proof Gate scenarios defined in Phase 5:
- E2E map/cache flow repeated >= 1000 iterations
- Failure/repair runs with dropped invalidations
- Stress run at target throughput
- Metrics assertions (stale reads, invalidation lag, hit ratio, listener leaks, memory drift)

**DONE — Block 7.6** (12 tests green):
- [x] Implement soak test harness with configurable duration/throughput
- [x] Implement metrics collection and threshold assertions
- [x] Write soak scenarios for near-cache correctness under churn
- [x] All Production Proof Gate thresholds pass
- [x] GREEN
- [x] `git commit -m "test(nearcache): production proof soak/stress suite — 12 tests green"`

---

### Block 7.7 — CLI entrypoint + standalone server mode

```bash
bun run helios-server.ts                          # start with defaults
bun run helios-server.ts --config helios.yml      # start with config file
bun run helios-server.ts --port 5701              # explicit port
```

**DONE — Block 7.7** (36 tests green):
- [x] Implement CLI argument parsing
- [x] Implement standalone server bootstrap
- [x] Implement graceful shutdown on SIGINT/SIGTERM
- [x] Tests: startup/shutdown lifecycle, config loading, port binding
- [x] GREEN
- [x] `git commit -m "feat(cli): standalone Helios server entrypoint — 36 tests green"`

---

### Block 7.8 — npm package structure + build + publish pipeline

Prepare Helios for distribution:
- Barrel exports (`index.ts`) for public API
- Package.json `exports` field for ESM
- Build script producing distributable output
- README with getting-started example

**DONE — Block 7.8** (40 tests green):
- [x] Create barrel exports for all public modules
- [x] Configure package.json `exports`, `main`, `types` fields
- [x] Implement build script
- [x] Write README with installation and usage examples
- [x] Verify `bun publish --dry-run` succeeds
- [x] GREEN
- [x] `git commit -m "chore(package): npm package structure + build pipeline — 40 tests green"`

---

**Phase 7 done gate**: Production-deployable Helios v1.0 with working example app, real TCP multi-node support, production near-cache proof, CLI server mode, and publishable npm package.

---

## Phase 8 — Near-Cache ↔ TCP Invalidation Wiring

Goal: Wire the existing near-cache engine (`DefaultNearCache`, `DefaultNearCacheManager`)
into `HeliosInstanceImpl` so that `getMap()` returns a near-cache-aware proxy when
`MapConfig` has a `NearCacheConfig`, and TCP `INVALIDATE` messages automatically evict
entries from the local near-cache. Fix `HeliosServer.getBoundPort()` bug.

All pieces exist independently — this phase connects them.

---

### Block 8.1 — Wire near-cache into HeliosInstanceImpl + TCP invalidation path

Modify `src/instance/impl/HeliosInstanceImpl.ts`:
1. Add `DefaultNearCacheManager` field, initialized in constructor
2. In `getMap()`: check `this._config.getMapConfig(name)?.getNearCacheConfig()` — if present,
   create a `DefaultNearCache` via the manager and wrap the proxy with near-cache read-through
   (check near-cache on `get()`, invalidate on `put()`/`remove()`)
3. Wire `onRemoteInvalidate` callback → `nearCacheManager.getNearCache(mapName)?.invalidate(key)`
4. Expose `getNearCacheManager()` for observability

**DONE — Block 8.1** ✅ (10 new tests, 2105 total):
- [x] Add NearCacheManager to HeliosInstanceImpl
- [x] Wrap getMap() with NearCachedIMapWrapper when MapConfig has NearCacheConfig
- [x] Wire TCP onRemoteInvalidate → nearCacheManager.getNearCache(mapName)?.invalidate(key)
- [x] Expose getNearCacheManager() accessor
- [x] Created `NearCachedIMapWrapper` — full IMap implementation with near-cache read-through + write-invalidation
- [x] All 2,105 tests green (10 new + 2,095 existing, 0 regressions)
- [x] GREEN

---

### Block 8.2 — Fix HeliosServer.getBoundPort() bug

Modify `src/server/HeliosServer.ts`:
- Change `_tcp` reference to `_transport` in `getBoundPort()`

**DONE — Block 8.2** ✅:
- [x] Fix _tcp → _transport in getBoundPort()
- [x] GREEN

---

**Phase 8 done gate**: `getMap()` returns near-cache-wrapped proxy when configured, TCP
invalidation automatically evicts near-cache entries, all tests green.

---

## Phase 9 — `@helios/nestjs` Package Extraction + Modern NestJS Library Patterns

Goal: Extract NestJS integration into a separate `@helios/nestjs` package, then modernize it
to state-of-the-art NestJS 11 library patterns. The core `@helios/core` package must have
zero NestJS dependencies.

### Why — Current Gaps vs State-of-the-Art

| Gap | Current state | Modern NestJS pattern | Reference |
|---|---|---|---|
| No `ConfigurableModuleBuilder` | Hand-rolled `forRoot()`/`forRootAsync()` with manual DynamicModule | `ConfigurableModuleBuilder` with `setClassMethodName('forRoot')` + `setExtras({ isGlobal })` | `@nestjs/throttler`, `@nestjs/bull` |
| `forRootAsync` only supports `useFactory` | Missing `useClass` + `useExisting` | Builder generates all three automatically | NestJS docs |
| String injection token | `'HELIOS_INSTANCE' as const` | `Symbol()` or class-based token | Collision-safe |
| No convenience decorators | `@Inject(HELIOS_INSTANCE_TOKEN)` everywhere | `@InjectHelios()`, `@InjectMap('name')`, `@InjectQueue('name')` | `@InjectRepository()`, `@InjectQueue()` |
| No health indicator | None | `HeliosHealthIndicator extends HealthIndicatorService` for `@nestjs/terminus` | Every production library |
| `@Transactional` uses static singleton | `HeliosTransactionManager._current` global | Resolve from DI via `MODULE_OPTIONS_TOKEN` or `AsyncLocalStorage` + module-scoped provider | NestJS DI best practice |
| No `registerAsync` on cache/tx modules | `HeliosCacheModule.register()` sync only | `registerAsync({ imports, useFactory, inject })` | `@nestjs/cache-manager` |
| No lifecycle hooks | Module doesn't shut down instance | `OnModuleDestroy` / `OnApplicationShutdown` → `instance.shutdown()` | Production safety |
| No event bridge | Helios events disconnected from NestJS | `@nestjs/event-emitter` bridge for entry/lifecycle/topic events | Idiomatic NestJS |
| No `@CacheEvict` / `@Cacheable` decorators | Only raw `cache-manager` wrapper | Method-level decorators for automatic cache population/eviction | Spring Cache port |

### Workspace setup (prerequisite)

Set up Bun workspaces with root `package.json`:
```json
{ "private": true, "workspaces": [".", "packages/nestjs", "app"] }
```

Rename root package: `"name": "helios"` → `"name": "@helios/core"`.
Add wildcard subpath export: `"./*": { "import": "./dist/src/*.js", "types": "./dist/src/*.d.ts" }`.
Remove all NestJS deps from `@helios/core`.

---

### Block 9.0 — Package extraction (no behavioral changes)

Extract the 14 source files from `src/nestjs/` and 11 test files from
`test/nestjs/` into `packages/nestjs/` as `@helios/nestjs`. Copy, transform
imports, verify all 141 NestJS tests pass in the new location, then delete originals.

Note: `packages/nestjs/` already exists with the initial extraction. This block
completes the separation: removes NestJS deps from root, updates imports, verifies.

Import transformation rules:
- Intra-NestJS: `@helios/nestjs/X` → `./X` (relative within package)
- Core types: `@helios/core/HeliosInstance` → `@helios/core/core/HeliosInstance`
- Core modules: `@helios/transaction/X` → `@helios/core/transaction/X`
- Core SPI: `@helios/spi/impl/X` → `@helios/core/spi/impl/X`

```
packages/nestjs/
├── package.json            # @helios/nestjs, deps: @helios/core + NestJS
├── tsconfig.json           # paths: @helios/core/* → ../../src/*
├── bunfig.toml             # preload: reflect-metadata
├── src/                    # 14 files (copied + import-transformed)
│   ├── index.ts            # barrel export
│   └── ...
└── test/                   # 11 files (copied + import-transformed)
```

**DONE — Block 9.0** ✅ (168 tests green: 2157 core + 168 nestjs):
- [x] Create root workspace `package.json` (or convert existing)
- [x] Rename root package to `@helios/core`, remove NestJS deps, add `./*` subpath export
- [x] Finalize `packages/nestjs/` with package.json, tsconfig, bunfig
- [x] Verify + transform source files (14) and test files (11)
- [x] Create barrel `src/index.ts`
- [x] Remove NestJS re-exports from root `src/index.ts`
- [x] Update `app/` path aliases and imports
- [x] `bun install` from root, verify both packages typecheck
- [x] `bun test` in `packages/nestjs/` → 141 tests green
- [x] `bun test` at root → ~1964 tests green (no NestJS tests)
- [x] Delete `src/nestjs/` and `test/nestjs/`
- [x] `git commit -m "refactor(nestjs): extract @helios/nestjs package — 141 tests green"`

---

### Block 9.1 — `ConfigurableModuleBuilder` for HeliosModule

Replace hand-rolled `forRoot()` / `forRootAsync()` with NestJS `ConfigurableModuleBuilder`.
This is the #1 modernization: it adds `useClass`, `useExisting`, `useFactory` + `imports`
support for free, with type-safe `MODULE_OPTIONS_TOKEN`.

```typescript
// src/helios-module.definition.ts
import { ConfigurableModuleBuilder } from '@nestjs/common';

export interface HeliosModuleOptions {
    /** Pre-built HeliosInstance (sync path). */
    instance?: HeliosInstance;
    /** Config to create an instance from (async factory creates it). */
    config?: HeliosConfig;
}

export const {
    ConfigurableModuleClass: HeliosConfigurableModule,
    MODULE_OPTIONS_TOKEN: HELIOS_MODULE_OPTIONS_TOKEN,
    OPTIONS_TYPE,
    ASYNC_OPTIONS_TYPE,
} = new ConfigurableModuleBuilder<HeliosModuleOptions>()
    .setClassMethodName('forRoot')
    .setExtras({ isGlobal: true }, (definition, extras) => ({
        ...definition,
        global: extras.isGlobal,
    }))
    .build();
```

```typescript
// src/HeliosModule.ts
@Module({})
export class HeliosModule extends HeliosConfigurableModule {
    // ConfigurableModuleBuilder generates forRoot() + forRootAsync() automatically.
    // forRootAsync supports useFactory, useClass, useExisting, inject, imports.
}
```

Consumer usage after modernization:
```typescript
// Sync
HeliosModule.forRoot({ instance: myHeliosInstance })

// Async with useFactory
HeliosModule.forRootAsync({
    imports: [ConfigModule],
    useFactory: async (config: ConfigService) => ({
        config: new HeliosConfig(config.get('HELIOS_NAME')),
    }),
    inject: [ConfigService],
})

// Async with useClass
HeliosModule.forRootAsync({ useClass: HeliosConfigFactory })
```

**TODO — Block 9.1** (~8 tests): ✅ DONE — 10 tests green
- [x] Add `HeliosInstanceFactory` interface (useClass pattern)
- [x] Extend `HeliosModuleAsyncOptions` with `useClass`, `useExisting`, `imports`
- [x] Implement `forRootAsync` branches for useClass/useExisting/useFactory
- [x] Add `OnModuleDestroy` lifecycle safety (instance.shutdown())
- [x] 10 tests green (useClass x3, useExisting x2, imports x1, structural x4)
- [x] GREEN

---

### Block 9.2 — Convenience injection decorators

Add `@InjectHelios()`, `@InjectMap('name')`, `@InjectQueue('name')`, `@InjectTopic('name')`
parameter decorators. Every serious NestJS library has these.

```typescript
// src/decorators/inject-helios.decorator.ts
import { Inject } from '@nestjs/common';
import { HELIOS_INSTANCE_TOKEN } from './helios-module.definition';

export const InjectHelios = () => Inject(HELIOS_INSTANCE_TOKEN);

// src/decorators/inject-map.decorator.ts
export const getMapToken = (name: string) => `HELIOS_MAP_${name}`;
export const InjectMap = (name: string) => Inject(getMapToken(name));

// src/decorators/inject-queue.decorator.ts
export const getQueueToken = (name: string) => `HELIOS_QUEUE_${name}`;
export const InjectQueue = (name: string) => Inject(getQueueToken(name));

// ... same for InjectTopic, InjectList, InjectSet, InjectMultiMap
```

Consumer usage:
```typescript
@Injectable()
class UserService {
    constructor(
        @InjectHelios() private readonly helios: HeliosInstance,
        @InjectMap('users') private readonly users: IMap<string, User>,
        @InjectQueue('tasks') private readonly tasks: IQueue<Task>,
    ) {}
}
```

**TODO — Block 9.2** (~12 tests): ✅ DONE — 17 tests green
- [x] Implement `@InjectHelios()` decorator
- [x] Implement `@InjectMap(name)`, `@InjectQueue(name)`, `@InjectTopic(name)`,
      `@InjectList(name)`, `@InjectSet(name)`, `@InjectMultiMap(name)` decorators
- [x] Implement `getMapToken`, `getQueueToken`, etc. helper functions
- [x] Wire `HeliosObjectExtractionModule` to use generated tokens from decorator helpers
- [x] Tests: inject each data structure type via decorator in a test module
- [x] GREEN

---

### Block 9.3 — `registerAsync` for HeliosCacheModule + HeliosTransactionModule

Add `registerAsync()` to both modules as a **purely additive** change.
`register()` signatures are **unchanged** — existing callers keep working with zero edits.

> ℹ️ Cross-ref: `HELIOS_BLITZ_IMPLEMENTATION.md` → Issue 1 (explains why `register()` is not touched)

#### New types exported from `HeliosTransactionModule.ts`

```typescript
export interface HeliosTransactionModuleOptions {
    /** Factory that creates TransactionContext instances. */
    factory: TransactionContextFactory;
    /** Default transaction timeout in seconds. -1 = no timeout. Default: -1 */
    defaultTimeout?: number;
}

export interface HeliosTransactionModuleOptionsFactory {
    createHeliosTransactionOptions():
        HeliosTransactionModuleOptions | Promise<HeliosTransactionModuleOptions>;
}
```

#### New type exported from `HeliosCacheModule.ts`

```typescript
export interface HeliosCacheModuleOptionsFactory {
    createHeliosCacheOptions(): HeliosCacheModuleOptions | Promise<HeliosCacheModuleOptions>;
}
```

#### Usage examples

```typescript
// HeliosCacheModule.register() — unchanged:
HeliosCacheModule.register({ ttl: 30_000 })

// HeliosCacheModule.registerAsync() — new:
HeliosCacheModule.registerAsync({
    imports: [ConfigModule],
    useFactory: (config: ConfigService) => ({ ttl: config.get('CACHE_TTL') }),
    inject: [ConfigService],
})

// To wire a Helios IMap as the cache store, adapt it to IHeliosCacheMap:
function heliosMapAsStore(map: IMap<string, unknown>): IHeliosCacheMap {
    return {
        async get(key) { return map.get(key); },
        async set(key, value, ttl) {
            if (ttl != null && ttl > 0) await map.put(key, value, ttl, 'MILLISECONDS');
            else await map.put(key, value);
        },
        async delete(key) { await map.remove(key); return true; },
        async clear() { await map.clear(); },
        async has(key) { return map.containsKey(key); },
        async keys() { return [...(await map.keySet())]; },
    };
}
HeliosCacheModule.registerAsync({
    imports: [HeliosModule],
    useFactory: (hz: HeliosInstance) => ({
        ttl: 30_000,
        store: heliosMapAsStore(hz.getMap('cache')),
    }),
    inject: [HELIOS_INSTANCE_TOKEN],
})

// HeliosTransactionModule.register() — unchanged:
HeliosTransactionModule.register(myFactory)

// HeliosTransactionModule.registerAsync() — new:
HeliosTransactionModule.registerAsync({
    imports: [HeliosModule],
    useFactory: (hz: HeliosInstance) => ({
        factory: { create: (opts) => hz.newTransactionContext(opts) },
    }),
    inject: [HELIOS_INSTANCE_TOKEN],
})
```

**DONE — Block 9.3** ✅ (13 tests green):
- [x] Add `HeliosCacheModuleOptionsFactory` + `registerAsync` (useFactory/useClass/useExisting) to `HeliosCacheModule`
- [x] Add `HeliosTransactionModuleOptions` + `HeliosTransactionModuleOptionsFactory` + `registerAsync` to `HeliosTransactionModule`
- [x] `register()` signatures left unchanged — purely additive
- [x] Tests: `useFactory`, `inject`, `useClass`, async factory for both modules (13 tests)
- [x] GREEN
- [x] `git commit -m "feat(nestjs): registerAsync for cache + transaction modules — 13 tests green"`

---

### Block 9.4 — `@Transactional` decorator DI-based resolution

Remove the global static `HeliosTransactionManager._current` singleton. Replace with
a module-file-scoped `AsyncLocalStorage<HeliosTransactionManager>` that
`HeliosTransactionModule.onModuleInit()` populates.

> ℹ️ Cross-ref: `HELIOS_BLITZ_IMPLEMENTATION.md` → Issues 2 & 3 (why no deprecation shim; why throw-on-missing is required)

#### Mechanism

```typescript
// In HeliosTransactionModule.ts (module file scope — not exported):
const _txManagerStorage = new AsyncLocalStorage<HeliosTransactionManager>();

@Global()
@Module({})
export class HeliosTransactionModule implements OnModuleInit {
    constructor(private readonly _txMgr: HeliosTransactionManager) {}

    onModuleInit(): void {
        // Bind manager to ALS so @Transactional() can resolve it.
        // No static global. No process-level singleton.
        _txManagerStorage.enterWith(this._txMgr);
    }
}

// Export the storage reference for use by @Transactional():
export { _txManagerStorage };
```

```typescript
// src/TransactionExceptions.ts
/** Thrown when @Transactional() is called outside a HeliosTransactionModule context.
 *  Indicates a misconfiguration — the module was not imported in the app module.
 *  This is always a programmer error, never a recoverable runtime error.
 *  NOTE: Does NOT extend BlitzError — @helios/nestjs must not depend on @helios/blitz. */
export class CannotCreateTransactionException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CannotCreateTransactionException';
  }
}
```

```typescript
// In Transactional.ts:
import { _txManagerStorage } from './HeliosTransactionModule';
import { CannotCreateTransactionException } from './TransactionExceptions';

descriptor.value = async function (this: unknown, ...args: unknown[]) {
    const mgr = _txManagerStorage.getStore();
    if (!mgr) {
        // No shim. No silent no-op. Fail loud — misconfiguration must be visible.
        throw new CannotCreateTransactionException(
            '@Transactional() called outside a HeliosTransactionModule context. ' +
            'Import HeliosTransactionModule.register() or registerAsync() in your app module.'
        );
    }
    return mgr.run(() => originalMethod.apply(this, args) as Promise<unknown>, runOptions);
};
```

**DONE — Block 9.4** ✅ (7 tests green):
- [x] Create `src/TransactionExceptions.ts` — export `CannotCreateTransactionException`
- [x] Remove `static _current`, `setCurrent()`, `getCurrent()` from `HeliosTransactionManager` — no deprecation shim
- [x] Add `_txManagerStorage: AsyncLocalStorage<HeliosTransactionManager>` at module file scope in `HeliosTransactionModule.ts`
- [x] `HeliosTransactionModule.onModuleInit()` calls `_txManagerStorage.enterWith(this._txMgr)`
- [x] Update `@Transactional()`: import `_txManagerStorage`; throw `CannotCreateTransactionException` if `getStore()` returns `undefined` — no silent no-op fallback
- [x] Update `HeliosTransactionModuleAsyncTest.test.ts` + `HeliosTransactionModuleTest.test.ts`: remove `HeliosTransactionManager.setCurrent(null)` from `afterEach` (no global state to reset)
- [x] Tests: `@Transactional` works via module import alone; throws with clear message when used without module
- [x] GREEN
- [x] `git commit -m "feat(nestjs): DI-based @Transactional via ALS — no static singleton, throw on misconfiguration — tests green"`

---

### Block 9.5 — Helios health indicator (`@nestjs/terminus`)

Implement `HeliosHealthIndicator` for production health checks.

```typescript
// src/health/helios.health.ts
import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';

@Injectable()
export class HeliosHealthIndicator {
    constructor(
        private readonly healthIndicatorService: HealthIndicatorService,
        @InjectHelios() private readonly helios: HeliosInstance,
    ) {}

    async isHealthy(key = 'helios') {
        const indicator = this.healthIndicatorService.check(key);
        const running = this.helios.isRunning();
        if (!running) {
            return indicator.down({ status: 'not running' });
        }
        return indicator.up({
            status: 'running',
            name: this.helios.getName(),
            members: this.helios.getCluster()?.getMembers()?.length ?? 0,
        });
    }
}

// src/health/helios-health.module.ts
@Module({
    imports: [TerminusModule],
    providers: [HeliosHealthIndicator],
    exports: [HeliosHealthIndicator],
})
export class HeliosHealthModule {}
```

Consumer usage:
```typescript
@Controller('health')
export class HealthController {
    constructor(
        private health: HealthCheckService,
        private heliosHealth: HeliosHealthIndicator,
    ) {}

    @Get()
    @HealthCheck()
    check() {
        return this.health.check([
            () => this.heliosHealth.isHealthy('helios'),
        ]);
    }
}
```

`@nestjs/terminus` is an **optional peer dependency** — the health module only loads
when terminus is installed.

**DONE — Block 9.5** ✅ (8 tests green):
- [x] Implement `HeliosHealthIndicator` using `HealthIndicatorService` (NestJS 11 API)
- [x] Implement `HeliosHealthModule` that provides the indicator
- [x] Add `@nestjs/terminus` as optional peer dependency
- [x] Add near-cache health details (hit ratio, eviction count) when near-cache is active
- [x] Tests: healthy instance, unhealthy (shutdown) instance, near-cache stats in health
- [x] GREEN
- [x] `git commit -m "feat(nestjs): HeliosHealthIndicator for @nestjs/terminus — tests green"`

---

### Block 9.6 — `@Cacheable` / `@CacheEvict` method decorators

NestJS cache-manager provides `@CacheKey` / `@CacheTTL` but no proper `@Cacheable` /
`@CacheEvict` decorators. Helios adds them — these are the #1 feature NestJS developers
expect from a cache library.

```typescript
// src/decorators/cacheable.decorator.ts
export function Cacheable(options?: {
    mapName?: string;
    ttl?: number;
    key?: string | ((...args: unknown[]) => string);
}): MethodDecorator { ... }

// src/decorators/cache-evict.decorator.ts
export function CacheEvict(options?: {
    mapName?: string;
    key?: string | ((...args: unknown[]) => string);
    allEntries?: boolean;
}): MethodDecorator { ... }

// src/decorators/cache-put.decorator.ts
export function CachePut(options?: {
    mapName?: string;
    ttl?: number;
    key?: string | ((...args: unknown[]) => string);
}): MethodDecorator { ... }
```

Consumer usage:
```typescript
@Injectable()
class UserService {
    @Cacheable({ mapName: 'users', key: (id: string) => `user:${id}` })
    async getUser(id: string): Promise<User> {
        return this.db.findUser(id); // only called on cache miss
    }

    @CacheEvict({ mapName: 'users', key: (id: string) => `user:${id}` })
    async deleteUser(id: string): Promise<void> {
        await this.db.deleteUser(id);
    }

    @CachePut({ mapName: 'users', key: (id: string) => `user:${id}` })
    async updateUser(id: string, data: Partial<User>): Promise<User> {
        return this.db.updateUser(id, data); // always executes, updates cache
    }
}
```

#### DI resolution mechanism

> ℹ️ Cross-ref: `HELIOS_BLITZ_IMPLEMENTATION.md` → Issue 4 (why the interceptor pattern; no global registry)

The decorators themselves store **only metadata** (`Reflect.defineMetadata`) — zero execution
logic at decoration time. All cache logic lives in `HeliosCacheInterceptor`:

```
- @Cacheable / @CacheEvict / @CachePut: store metadata via Reflect.defineMetadata.
- HeliosCacheInterceptor extends CacheInterceptor (@nestjs/cache-manager):
    - Injected with CACHE_MANAGER via constructor DI.
    - On intercept: reads @Cacheable/@CacheEvict/@CachePut metadata from the handler.
    - Executes cache read / write / evict logic around the method call.
- HeliosCacheModule registers HeliosCacheInterceptor as APP_INTERCEPTOR within its scope.
- Result: pure NestJS DI — no module-level global, no process-level singleton.
```

```typescript
// src/decorators/helios-cache.interceptor.ts
@Injectable()
export class HeliosCacheInterceptor extends CacheInterceptor implements NestInterceptor {
    constructor(@Inject(CACHE_MANAGER) cacheManager: Cache) {
        super(cacheManager, /* reflector */ null!);
    }

    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
        const handler = context.getHandler();
        const cacheable = Reflect.getMetadata(CACHEABLE_KEY, handler) as CacheableOptions | undefined;
        const cacheEvict = Reflect.getMetadata(CACHE_EVICT_KEY, handler) as CacheEvictOptions | undefined;
        const cachePut  = Reflect.getMetadata(CACHE_PUT_KEY,   handler) as CachePutOptions   | undefined;
        // ... apply cache logic based on which decorator is present
    }
}

// In HeliosCacheModule.register() / registerAsync() — add to providers:
{ provide: APP_INTERCEPTOR, useClass: HeliosCacheInterceptor }
```

**DONE — Block 9.6** (15 tests green ✅):
- [x] Implement `@Cacheable()` method decorator — DI-first store resolution; key: string or `((...args) => string)`; optional TTL
- [x] Implement `@CacheEvict()` method decorator — single key or `allEntries: true`; `beforeInvocation` option
- [x] Implement `@CachePut()` method decorator — always executes method, then updates cache; TTL support
- [x] Implement `CacheableRegistry` static singleton (same DI-first + static-fallback pattern as `@Transactional`)
- [x] Tests: cache hit skips method; cache miss calls method + stores; evict removes key; allEntries clears; CachePut always executes + updates; TTL respected; function key generators; DI precedence; NestJS CACHE_MANAGER integration
- [x] GREEN
- [x] `git commit -m "feat(nestjs): @Cacheable/@CacheEvict/@CachePut via HeliosCacheInterceptor — 15 tests green"`

---

### Block 9.7 — NestJS event bridge for Helios events

Bridge Helios entry listeners, lifecycle events, and topic messages to
`@nestjs/event-emitter` so NestJS developers can use `@OnEvent()` decorators.

```typescript
// src/events/helios-event-bridge.module.ts
@Module({
    imports: [EventEmitterModule.forRoot()],
    providers: [HeliosEventBridge],
    exports: [HeliosEventBridge],
})
export class HeliosEventBridgeModule {}

// src/events/helios-event-bridge.ts
@Injectable()
export class HeliosEventBridge implements OnModuleInit {
    constructor(
        @InjectHelios() private readonly helios: HeliosInstance,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    /** Register entry listener on a map, bridging to NestJS events. */
    bridgeMap(mapName: string): void {
        const map = this.helios.getMap(mapName);
        map.addEntryListener({
            entryAdded: (e) => this.eventEmitter.emit(`helios.map.${mapName}.added`, e),
            entryRemoved: (e) => this.eventEmitter.emit(`helios.map.${mapName}.removed`, e),
            entryUpdated: (e) => this.eventEmitter.emit(`helios.map.${mapName}.updated`, e),
            entryEvicted: (e) => this.eventEmitter.emit(`helios.map.${mapName}.evicted`, e),
        });
    }

    /** Bridge topic messages to NestJS events. */
    bridgeTopic(topicName: string): void {
        const topic = this.helios.getTopic(topicName);
        topic.addMessageListener((msg) =>
            this.eventEmitter.emit(`helios.topic.${topicName}`, msg),
        );
    }
}
```

Consumer usage:
```typescript
@Injectable()
class AuditService {
    @OnEvent('helios.map.users.updated')
    handleUserUpdate(event: EntryEvent<string, User>) {
        console.log(`User ${event.key} updated`);
    }

    @OnEvent('helios.topic.notifications')
    handleNotification(msg: Message<Notification>) {
        console.log(`Notification: ${msg.messageObject.text}`);
    }
}
```

`@nestjs/event-emitter` is an **optional peer dependency**.

**DONE — Block 9.7** (11 tests green ✅):
- [x] Implement `HeliosEventBridge` service with `bridgeMap()` / `bridgeTopic()` / `bridgeLifecycle()` methods
- [x] Implement `HeliosEventBridgeModule`
- [x] Add `@nestjs/event-emitter` as optional peer dependency
- [x] Bridge lifecycle events (`LifecycleEvent` → `helios.lifecycle.*`)
- [x] Tests: map entry events, topic messages, lifecycle events via EventEmitter2; NestJS DI integration
- [x] GREEN
- [x] `git commit -m "feat(nestjs): event bridge for @nestjs/event-emitter — 11 tests green"`

---

### Block 9.8 — Symbol-based injection tokens + module lifecycle

Replace string-based injection tokens with `Symbol()` for collision safety.
Add proper `OnModuleDestroy` / `OnApplicationShutdown` hooks.

```typescript
// Before:
export const HELIOS_INSTANCE_TOKEN = 'HELIOS_INSTANCE' as const;

// After:
export const HELIOS_INSTANCE_TOKEN = Symbol('HELIOS_INSTANCE');
```

Lifecycle hooks:
```typescript
@Module({})
export class HeliosModule extends HeliosConfigurableModule
    implements OnModuleDestroy, OnApplicationShutdown {

    constructor(@Inject(HELIOS_INSTANCE_TOKEN) private readonly hz: HeliosInstance) {
        super();
    }

    async onModuleDestroy() {
        this.hz?.shutdown();
    }

    async onApplicationShutdown(signal?: string) {
        this.hz?.shutdown();
    }
}
```

> ℹ️ Cross-ref: `HELIOS_BLITZ_IMPLEMENTATION.md` → Issue 5 (why no backward compat transition — all importers receive the Symbol automatically)

**DONE — Block 9.8** ✅ (9 tests green):
- [x] Change `HELIOS_INSTANCE_TOKEN` to `Symbol('HELIOS_INSTANCE')` — one commit, no transition period; all importers receive the new value automatically since they use the constant not the literal string
- [x] Implement `OnModuleDestroy` on `HeliosModule` → calls `instance.shutdown()`
- [x] Implement `OnApplicationShutdown` on `HeliosModule`
- [x] Tests: verify shutdown called on module destroy; verify symbol token injection works; verify no test hardcodes the string `'HELIOS_INSTANCE'`
- [x] GREEN
- [x] `git commit -m "feat(nestjs): Symbol injection tokens + OnModuleDestroy lifecycle — tests green"`

---

### Block 9.9 — Documentation + subpath exports + final polish

Finalize the `@helios/nestjs` package for publication.

Subpath exports in `packages/nestjs/package.json`:
```json
{
    "exports": {
        ".": { "import": "./dist/src/index.js", "types": "./dist/src/index.d.ts" },
        "./cache": { ... },
        "./transaction": { ... },
        "./health": { ... },
        "./events": { ... },
        "./decorators": { ... },
        "./autoconfiguration": { ... },
        "./context": { ... }
    }
}
```

**DONE — Block 9.9** ✅ (57 tests green):
- [x] Finalize all subpath exports
- [x] Add package structure tests (verify all public exports resolve)
- [x] Update barrel `src/index.ts` with all new exports (decorators, health, events)
- [x] Ensure `bun run build` produces clean output for both packages
- [x] Verify `bun publish --dry-run` for both `@helios/core` and `@helios/nestjs`
- [x] GREEN
- [x] `git commit -m "feat(nestjs): @helios/nestjs v1.0 — all tests green"`

---

> **Note:** `HeliosCacheModule` and `HeliosTransactionModule` use hand-rolled `register()`/
> `registerAsync()`. Future migration to `ConfigurableModuleBuilder` is tracked separately —
> not in Phase 9 scope. New `@helios/*` modules should use `ConfigurableModuleBuilder`.

**Phase 9 done gate**: `@helios/nestjs` is a standalone, publishable NestJS library with:
- `ConfigurableModuleBuilder`-based module registration (`forRoot` + `forRootAsync`)
- `@InjectHelios()`, `@InjectMap()`, `@InjectQueue()`, `@InjectTopic()` convenience decorators
- `@Cacheable`, `@CacheEvict`, `@CachePut` method-level caching decorators
- `HeliosHealthIndicator` for `@nestjs/terminus` integration
- `HeliosEventBridge` for `@nestjs/event-emitter` integration
- `@Transactional()` with proper DI-based resolution (no static singleton)
- `registerAsync` on all modules (cache, transaction, core)
- Symbol-based injection tokens
- Automatic lifecycle management (`OnModuleDestroy` → `instance.shutdown()`)
- Optional peer dependencies for terminus / event-emitter (tree-shakeable)

---

## Phase 10 — Helios Blitz: NATS-Backed Stream & Batch Processing Engine (~295 tests)

Goal: deliver a `@helios/blitz` package that provides ~80%+ feature parity with Hazelcast
Jet (`jet/` — 520 Java source files) using **NATS JetStream** as the durable streaming
backbone. We do not port the Java DAG engine line-by-line. We build a TypeScript-idiomatic
pipeline API on top of NATS primitives that preserves the same programming model and
behavioural contracts.

### Why NATS JetStream

Hazelcast Jet is a distributed stream processing engine. Its core primitives are:
DAG-based pipelines, durable sources/sinks, windowing, stateful aggregations, and
fault-tolerant at-least-once delivery. NATS JetStream covers the infrastructure layer
for all of these:

| Hazelcast Jet concept | NATS JetStream equivalent |
|---|---|
| Durable stream source | JetStream stream + consumer (replay from any offset) |
| At-least-once delivery | JetStream explicit `ack()` / `nak()` |
| Distributed parallel workers | Subject-partitioned NATS consumers (`withParallelism(N)` → hash(key) % N routing) |
| Window / aggregation state | NATS KV Store (key-value, TTL-aware) |
| Stream-table join (side input) | Helios `IMap` lookup + NATS KV |
| Batch processing | JetStream bounded replay (deliver-all + `EndOfStream` detection) |
| Back-pressure | NATS pull consumer + `maxAckPending` |
| Dead-letter / retry | JetStream `maxDeliverCount` + `deliverSubject` |

The `nats` npm package (`nats.js` monorepo) has **native Bun support** and full
TypeScript declarations — no shims required.

### What is NOT in scope (deferred to v2)

- **Exactly-once semantics**: NATS JetStream is at-least-once. Idempotent sinks
  (dedup key in Helios IMap) are the recommended pattern. True exactly-once requires
  a two-phase commit protocol and is deferred.
- **SQL over streams**: depends on the SQL engine (deferred to v2 with `hazelcast-sql/`).
- **Co-located compute**: NATS is a separate process from Helios nodes. Native in-IMDG
  computation (Jet's IMap journal source running inside the data node) is deferred.
- **Jet Management Center / metrics UI**: out of scope for v1.

### What IS guaranteed (at-least-once)

**Every message that enters the pipeline is processed at least once. No message is silently
dropped.** Operators must handle duplicate delivery — see `Stage.ts` JSDoc and
`StageContext.deliveryCount` for dedup patterns.

`process()` may be called more than once for the same message in these scenarios:
- Pipeline process crashed before ack'ing the message.
- A `nak()` was issued (operator error, sink error, explicit retry).
- The NATS server redelivered the message after a missed heartbeat.

Recommended idempotency patterns (see `Stage.ts` JSDoc for full spec):
- `HeliosMapSink.put()` overwrites → safe to retry.
- Dedup key in Helios IMap (`context.messageId` as key).
- Window accumulator re-accumulates replayed events into same KV key → correct final count.

### Test infrastructure for Phase 10

> ℹ️ Cross-ref: `HELIOS_BLITZ_IMPLEMENTATION.md` → Issue 7

**Unit tests** (Blocks 10.1, 10.3 — operators in isolation): mock the `NatsConnection`
interface. No external process needed.

**Integration tests** (Blocks 10.0, 10.2, 10.4, 10.5, 10.7, 10.8, 10.10): require a real
NATS server with JetStream enabled.

All integration test files wrap their tests in `describe.skipIf(!NATS_AVAILABLE)` where
`NATS_AVAILABLE = !!process.env.NATS_URL || !!process.env.CI`. This shows as SKIP in
`bun test` output and is visible in the done gate count — skipped tests are never invisible.

> ℹ️ Cross-ref: `HELIOS_BLITZ_IMPLEMENTATION.md` → Issue 17 (process.exit(0) skip guard silently drops tests from bun test output)

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

const NATS_AVAILABLE = !!process.env.NATS_URL || !!process.env.CI;

describe.skipIf(!NATS_AVAILABLE)('BlitzService — NATS integration', () => {
  let natsServer: ReturnType<typeof Bun.spawn>;

  beforeAll(async () => {
    natsServer = Bun.spawn(
      [require.resolve('nats-server/bin/nats-server'), '-js', '-p', '4222'],
      { stdout: 'ignore', stderr: 'ignore' },
    );
    // Health poll — wait until NATS accepts connections (up to 3s)
    const { connect } = await import('@nats-io/transport-node');
    for (let i = 0; i < 30; i++) {
      try { const nc = await connect({ servers: 'nats://localhost:4222' }); await nc.close(); break; }
      catch { await Bun.sleep(100); }
    }
  });

  afterAll(() => { natsServer.kill(); });

  // tests go here
});
```

`describe.skipIf(condition)` and `it.skipIf(condition)` are built into `bun:test`. They show
as SKIP in output, are counted in test results, and the done gate can verify skip count vs
expected. This ensures `bun test` at the workspace root never silently drops integration tests.
CI sets `NATS_URL=nats://localhost:4222` or `CI=true`.

The `nats-server` binary (~20 MB, single static binary) is added to `packages/blitz/`
`devDependencies` via the [`nats-server` npm package](https://www.npmjs.com/package/nats-server)
which wraps the binary. Document setup in `CONTRIBUTING.md`.

> **CONTRIBUTING.md note (binary PATH):** The `nats-server` npm package installs the binary
> to `node_modules/nats-server/bin/nats-server`. Tests reference it via
> `require.resolve('nats-server/bin/nats-server')`. Do not rely on `nats-server` being in
> `PATH` — the resolved path from `node_modules` is the only reliable reference.

### Package layout

```
packages/blitz/                              # @helios/blitz
├── package.json                           # deps: @nats-io/transport-node, @nats-io/jetstream, @nats-io/kv, @helios/core
│                                          # peerDeps (optional): @nestjs/common@^11, @nestjs/core@^11
│                                          # devDeps: nats-server (binary), bun-types, typescript
├── tsconfig.json                          # paths: @helios/core/* → ../../src/*
├── bunfig.toml
├── src/
│   ├── index.ts                           # barrel export (does NOT re-export src/nestjs/)
│   ├── Pipeline.ts                        # fluent DAG builder (Block 10.1); includes withParallelism(n)
│   ├── Vertex.ts / Edge.ts               # DAG node + edge (Block 10.1)
│   ├── Stage.ts                           # processing stage base (Block 10.1) — at-least-once delivery contract; see JSDoc
│   ├── StageContext.ts                    # messageId + deliveryCount + nak() per-delivery context (Block 10.1)
│   ├── BlitzService.ts                      # top-level entry point (Block 10.0)
│       ├── BlitzConfig.ts                       # NATS connection + pipeline config (Block 10.0); includes checkpointIntervalAcks (default 100) + checkpointIntervalMs (default 5000); includes maxReconnectAttempts, reconnectTimeWaitMs, connectTimeoutMs, natsPendingLimit
│   ├── BlitzEvent.ts                      # enum: NATS_RECONNECTING, NATS_RECONNECTED, PIPELINE_ERROR, PIPELINE_CANCELLED (Block 10.0)
│   ├── errors/                            # error hierarchy (Block 10.0)
│   │   ├── BlitzError.ts                  # base class for all @helios/blitz errors
│   │   ├── NakError.ts                    # operator returned an error — message will be nak'd
│   │   ├── DeadLetterError.ts             # retries exhausted — message routed to DL stream
│   │   └── PipelineError.ts              # pipeline-level structural error (cycle, no source, etc.)
│   ├── codec/                             # Block 10.2
│   │   └── BlitzCodec.ts                  # BlitzCodec<T> interface + JsonCodec/StringCodec/BytesCodec built-ins
│   ├── source/                            # Block 10.2
│   │   ├── Source.ts                      # interface (requires codec: BlitzCodec<T>)
│   │   ├── NatsSource.ts                  # read from NATS subject / JetStream stream
│   │   ├── HeliosMapSource.ts             # Helios IMap snapshot → bounded stream
│   │   ├── HeliosTopicSource.ts           # Helios ITopic → unbounded stream
│   │   ├── FileSource.ts                  # line-by-line file reader (batch)
│   │   └── HttpWebhookSource.ts           # Bun.serve() based inbound HTTP events
│   ├── sink/                              # Block 10.2
│   │   ├── Sink.ts                        # interface
│   │   ├── NatsSink.ts                    # publish to NATS subject / JetStream
│   │   ├── HeliosMapSink.ts               # write to Helios IMap
│   │   ├── HeliosTopicSink.ts             # publish to Helios ITopic
│   │   └── FileSink.ts                    # write lines to file (batch)
│   ├── operator/                          # Block 10.3
│   │   ├── MapOperator.ts                 # transform T → R
│   │   ├── FilterOperator.ts              # predicate filter
│   │   ├── FlatMapOperator.ts             # T → R[]
│   │   ├── MergeOperator.ts               # fan-in multiple stages
│   │   ├── BranchOperator.ts              # fan-out by predicate
│   │   └── PeekOperator.ts                # side-effect observe (debug)
│   ├── window/                            # Block 10.4
│   │   ├── WindowPolicy.ts                # interface
│   │   ├── TumblingWindowPolicy.ts        # fixed non-overlapping windows
│   │   ├── SlidingWindowPolicy.ts         # overlapping windows (size + slide)
│   │   ├── SessionWindowPolicy.ts         # inactivity-gap based windows
│   │   ├── WindowState.ts                 # NATS KV-backed window accumulator
│   │   └── WindowOperator.ts              # applies policy + emits completed windows
│   ├── aggregate/                         # Block 10.5
│   │   ├── Aggregator.ts                  # extends core batch contract with combine() for parallel partial aggregation
│   │   ├── CountAggregator.ts
│   │   ├── SumAggregator.ts
│   │   ├── MinAggregator.ts
│   │   ├── MaxAggregator.ts
│   │   ├── AvgAggregator.ts
│   │   ├── DistinctAggregator.ts
│   │   └── AggregatingOperator.ts         # wires WindowOperator + Aggregator
│   ├── join/                              # Block 10.6
│   │   ├── HashJoinOperator.ts            # stream-table join (Helios IMap side input)
│   │   └── WindowedJoinOperator.ts        # stream-stream join within window
│   ├── fault/                             # Block 10.7
│   │   ├── AckPolicy.ts                   # explicit / none
│   │   ├── RetryPolicy.ts                 # maxRetries + backoff
│   │   ├── DeadLetterSink.ts              # route failed messages to DL stream
│   │   └── CheckpointManager.ts           # NATS KV-backed consumer sequence checkpoints
│   ├── batch/                             # Block 10.8
│   │   ├── BatchPipeline.ts               # bounded variant of Pipeline
│   │   └── EndOfStreamDetector.ts         # detects JetStream stream end for batch mode
│   └── nestjs/                            # Block 10.9 — exported via @helios/blitz/nestjs subpath
│       ├── index.ts                         # barrel export for nestjs submodule
│       ├── HeliosBlitzModule.ts             # @Module() forRoot() / forRootAsync()
│       ├── HeliosBlitzService.ts            # @Injectable() wrapping BlitzService
│       └── InjectBlitz.decorator.ts         # @InjectBlitz()
└── test/
```

`package.json` exports field includes a `@helios/blitz/nestjs` subpath:

```json
{
  "exports": {
    ".": {
      "import": "./dist/src/index.js",
      "types": "./dist/src/index.d.ts"
    },
    "@helios/blitz/nestjs": {
      "import": "./dist/src/nestjs/index.js",
      "types": "./dist/src/nestjs/index.d.ts"
    }
  }
}
```

The `src/nestjs/` submodule is **NOT** re-exported from `src/index.ts`. Applications that
use `@helios/blitz` for pure stream processing without NestJS do not need `@nestjs/common`
or `@nestjs/core`. Those packages are declared as **optional peer dependencies** only.

> ℹ️ Cross-ref: `HELIOS_BLITZ_IMPLEMENTATION.md` → Issue 16 (NestJS packages absent from package.json; NestJS submodule leaking through main barrel)

### Dependency graph (within Phase 10)

```
Block 10.0 (BlitzService / BlitzConfig / NATS connection)
  └─► Block 10.1 (Pipeline / Vertex / Edge / Stage builder)
        ├─► Block 10.2 (sources + sinks — parallel)
        └─► Block 10.3 (stream operators — parallel with 10.2)
              ├─► Block 10.4 (windowing — needs operators + NATS KV)
              │     └─► Block 10.5 (aggregations — needs windows)
              │           └─► Block 10.6 (joins — needs aggregations + IMap)
              └─► Block 10.7 (fault tolerance — wraps operators/sources/sinks)
                    ├─► Block 10.8 (batch mode — needs fault + sources)
                    └─► Block 10.9 (NestJS module — depends on all above)
```

---

### Error types (`src/errors/`)

All `@helios/blitz` errors extend `BlitzError`. Operators signal recoverable failures via
`NakError`; the fault policy (retry / dead-letter) consults this type at runtime.

```typescript
// src/errors/BlitzError.ts
export class BlitzError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
  }
}

// src/errors/NakError.ts
/** Thrown by an operator `fn` to signal that the current message should be nak'd.
 *  The retry policy determines whether it is redelivered or sent to the dead-letter stream. */
export class NakError extends BlitzError {
  constructor(
    message: string,
    /** Delay in ms before redelivery (0 = immediate). Overrides RetryPolicy.delayMs for this message. */
    public readonly nakDelayMs?: number,
    cause?: unknown,
  ) {
    super(message, cause);
  }
}

// src/errors/DeadLetterError.ts
/** Thrown when retry policy is exhausted. BlitzService routes to DeadLetterSink. */
export class DeadLetterError extends BlitzError {
  constructor(
    message: string,
    public readonly originalError: unknown,
    public readonly deliveryCount: number,
  ) {
    super(message, originalError);
  }
}

// src/errors/PipelineError.ts
/** Structural pipeline error (cycle detected, no source, disconnected graph). */
export class PipelineError extends BlitzError {}
```

> ℹ️ Cross-ref: `HELIOS_BLITZ_IMPLEMENTATION.md` → Issue 14 (NakError was referenced but never defined)

---

### Block 10.0 — Package scaffold + NATS connection management (~10 tests)

```
packages/blitz/
├── package.json            # @helios/blitz
│                           # deps: @nats-io/transport-node, @nats-io/jetstream, @nats-io/kv, @helios/core
│                           # peerDeps (optional): @nestjs/common@^11, @nestjs/core@^11
│                           # devDeps: nats-server (binary), bun-types, typescript
├── tsconfig.json           # paths: @helios/core/* → ../../src/*
├── bunfig.toml             # no reflect-metadata needed (NestJS submodule exported separately)
└── src/
    ├── BlitzConfig.ts        # NATS server URL(s), stream/consumer defaults, KV bucket names
    └── BlitzService.ts       # connect() via @nats-io/transport-node; js/jsm via @nats-io/jetstream; kvm via @nats-io/kv
```

`BlitzService` owns the NATS connection lifecycle. It is the single entry point:
```typescript
const blitz = await BlitzService.connect({ servers: 'nats://localhost:4222' });
const pipeline = blitz.pipeline('order-processing');
await blitz.shutdown();
```

Internally `BlitzService.connect()` uses the v3 scoped packages:
```typescript
import { connect } from '@nats-io/transport-node';
import { jetstream, jetstreamManager } from '@nats-io/jetstream';
import { Kvm } from '@nats-io/kv';

// In BlitzService.connect():
const nc = await connect({ servers: config.servers });
const js = jetstream(nc);
const jsm = jetstreamManager(nc);
const kvm = new Kvm(nc);
```

> ℹ️ Cross-ref: `HELIOS_BLITZ_IMPLEMENTATION.md` → Issues 6 & 7 (workspace already configured; NATS test infrastructure)

#### NATS reconnect behavior

`BlitzService` configures the NATS connection with explicit reconnect settings:

```typescript
const nc = await connect({
  servers: config.servers,
  maxReconnectAttempts: config.maxReconnectAttempts ?? -1,  // -1 = infinite
  reconnectTimeWait: config.reconnectTimeWaitMs ?? 2_000,   // 2s between attempts
  timeout: config.connectTimeoutMs ?? 10_000,               // 10s initial connect
});
```

During a NATS reconnect window:
1. **JetStream consumers**: NATS client buffers incoming messages internally and delivers
   them after reconnect. No pipeline messages are lost. Consumer message delivery pauses
   and resumes automatically.
2. **JetStream publishes** (NatsSink.toStream): publish calls during reconnect throw a
   `NatsError`. `BlitzService` catches this and wraps it as a `NakError`, triggering the
   standard retry/DL policy for the upstream message.
3. **Core NATS publishes** (NatsSink.toSubject): the NATS client buffers outbound messages
   during reconnect (up to `pendingLimit`). Configure `pendingLimit` explicitly via
   `BlitzConfig.natsPendingLimit` (default: 512 MB) to bound memory usage.
4. **KV operations** (CheckpointManager, WindowState): KV operations during reconnect throw.
   `WindowState.put()` failures are retried 3 times with 500ms backoff before propagating
   as a `NakError`. `CheckpointManager.write()` failures are swallowed and logged — a missed
   checkpoint means slightly more replay on next restart, not data loss.
5. **Status monitoring**: `BlitzService` subscribes to `nc.status()` and emits a
   `BlitzEvent.NATS_RECONNECTING` / `BlitzEvent.NATS_RECONNECTED` event so application code
   can react (e.g., log, alert, pause submission of new pipelines).

Add `maxReconnectAttempts`, `reconnectTimeWaitMs`, `connectTimeoutMs`, `natsPendingLimit` to `BlitzConfig.ts` spec.

> ℹ️ Cross-ref: `HELIOS_BLITZ_IMPLEMENTATION.md` → Issue 18 (NATS reconnect behavior gaps)

**TODO — Block 10.0**: ✅ COMPLETE
- [x] Create `packages/blitz/` directory with `package.json` (`@helios/blitz`, deps: `@nats-io/transport-node`, `@nats-io/jetstream`, `@nats-io/kv`, `@helios/core`; peerDeps optional: `@nestjs/common@^11`, `@nestjs/core@^11`; exports: `"."` + `"@helios/blitz/nestjs"`), `tsconfig.json`, `bunfig.toml`, `src/index.ts` — root `package.json` workspace entry already configured
- [x] Implement `src/errors/` — `BlitzError`, `NakError`, `DeadLetterError`, `PipelineError`
- [x] Add `nats-server` to `packages/blitz/` devDependencies (binary for integration tests — see Phase 10 test infrastructure section above)
- [x] Implement `BlitzConfig` (NATS URL, KV bucket prefix, stream retention defaults, natsPendingLimit, checkpointIntervalAcks, checkpointIntervalMs)
- [x] Implement `BlitzService.connect()` — opens NATS connection via `connect()` from `@nats-io/transport-node`; creates `js` + `jsm` via `@nats-io/jetstream`; creates `kvm` via `new Kvm(nc)` from `@nats-io/kv`
- [x] Configure NATS connection with explicit reconnect settings (`maxReconnectAttempts`, `reconnectTimeWaitMs`, `connectTimeoutMs`)
- [x] Implement `BlitzEvent` enum: `NATS_RECONNECTING`, `NATS_RECONNECTED`, `PIPELINE_ERROR`, `PIPELINE_CANCELLED`
- [x] Subscribe to `nc.status()` in `BlitzService`; emit `BlitzEvent`s on reconnect/error
- [x] Implement `BlitzService.shutdown()` — graceful drain + close
- [x] Verify `nats-server` npm package binary path via `require.resolve('nats-server/bin/nats-server')` in test setup — document in `packages/blitz/README.md`
- [x] Tests: connect/disconnect, config defaults, error on bad server (integration — requires NATS_URL)
- [x] Test: BlitzEvent unit tests — all 4 enum values distinct
- [x] Test: Error hierarchy unit tests — BlitzError/NakError/DeadLetterError/PipelineError
- [x] GREEN — 31 tests pass (11 integration skipped without NATS_URL)
- [x] `git commit -m "feat(blitz): Block 10.0 — package scaffold + BlitzService NATS connection — 31 tests green"`

---

### Block 10.1 — Pipeline / DAG builder API (~20 tests)

```
src/
├── Pipeline.ts     # fluent builder: source → operator chain → sink
├── Vertex.ts       # DAG node (wraps source / operator / sink)
├── Edge.ts         # directed edge between vertices (NATS subject as the wire)
├── Stage.ts        # abstract: process(msg, context) → void | msg | msg[]
└── StageContext.ts # per-delivery context: messageId, deliveryCount, nak()
```

#### At-least-once delivery contract (Stage.ts)

```typescript
// src/Stage.ts
/**
 * A processing stage in a Blitz pipeline.
 *
 * **At-least-once delivery contract:**
 * `process()` may be called more than once for the same message in the following scenarios:
 * - The pipeline process crashed before ack'ing the message.
 * - A nak() was issued (operator error, sink error, explicit retry).
 * - The NATS server redelivered the message after a missed heartbeat.
 *
 * Operators MUST be designed for at-least-once delivery. The recommended patterns are:
 * - **Idempotent by design**: `HeliosMapSink.put()` overwrites → safe to retry.
 * - **Dedup key**: store a processed message ID in Helios IMap before processing;
 *   skip if already present.
 * - **Natural idempotency**: counting events in a window accumulator — replayed events
 *   re-accumulate into the same KV key, producing the same final count.
 *
 * Non-idempotent operations (file appends, external API calls with side effects)
 * must implement their own dedup logic.
 */
export abstract class Stage<T, R = T> {
  abstract process(value: T, context: StageContext): Promise<R | R[] | void>;
}
```

#### StageContext interface (StageContext.ts)

```typescript
// src/StageContext.ts
export interface StageContext {
  /** Unique message ID for this delivery. Same ID = same message, possibly redelivered. */
  readonly messageId: string;
  /** How many times this message has been delivered (1 = first delivery). */
  readonly deliveryCount: number;
  /** Explicitly nak this message with optional delay (ms). Throws if already ack'd. */
  nak(delayMs?: number): void;
}
```

#### At-least-once: positive statement

> **What IS guaranteed (at-least-once):** Every message that enters the pipeline is processed
> at least once. No message is silently dropped. Operators must handle duplicate delivery — see
> `Stage.ts` JSDoc and `StageContext.deliveryCount` for dedup patterns.

The Pipeline API mirrors Hazelcast Jet's `Pipeline` / `GeneralStage` model:

```typescript
const p = blitz.pipeline('orders');

p.readFrom(NatsSource.fromSubject<Order>('orders.raw', JsonCodec<Order>()))
 .map(order => ({ ...order, total: order.qty * order.price }))
 .filter(order => order.total > 100)
 .writeTo(NatsSink.toSubject('orders.enriched', JsonCodec<EnrichedOrder>()));

await blitz.submit(p);
```

`JsonCodec<T>()` is from `@helios/blitz/codec` — it decodes the raw `Uint8Array` NATS payload
into `T` on receive and encodes `T` back to `Uint8Array` on send (see Block 10.2 codec spec).

Internally, each `.map()` / `.filter()` / `.writeTo()` call appends a `Vertex` and
wires an `Edge` (backed by an intermediate NATS subject) between consecutive vertices.
`blitz.submit(p)` validates the DAG (no cycles, exactly one source, at least one sink) and
starts the consumer loop for each vertex.

**TODO — Block 10.1**: ✅ COMPLETE
- [x] Implement `Stage<T, R>` abstract class with `process(value: T, context: StageContext): Promise<R | R[] | void>` — include full at-least-once JSDoc (see spec above)
- [x] Implement `StageContext` interface (`messageId`, `deliveryCount`, `nak(delayMs?)`) in `src/StageContext.ts`
- [x] Implement `Vertex` (name, fn, type)
- [x] Implement `Edge` (from, to, subject derived from vertex names)
- [x] Implement `Pipeline` fluent builder (readFrom → operator chain → writeTo)
- [x] Implement `Pipeline.withParallelism(n: number): this`
- [x] Implement DAG validation — throws `PipelineError` on: cycle detected, no source vertex, no sink vertex, disconnected subgraph
- [x] Implement `blitz.submit(pipeline)` — validates DAG + registers pipeline
- [x] Implement `blitz.cancel(pipelineName)` — removes pipeline + emits PIPELINE_CANCELLED
- [x] Implement `blitz.isRunning(name)` — query running state
- [x] Tests: linear pipeline, map/filter chain, cycle detection, no-source, no-sink, disconnected, Stage/StageContext types, submit/cancel lifecycle (NATS-gated)
- [x] GREEN — 22 pass, 7 skip (NATS integration)
- [x] `git commit -m "feat(blitz): Pipeline/DAG builder + submit/cancel — 22 tests green"`

---

### Block 10.2 — Sources + sinks (~30 tests)

#### Codec contract

In NATS v3, `JSONCodec`/`StringCodec` are removed. All payloads are raw `Uint8Array`.
`@helios/blitz` introduces a `BlitzCodec<T>` interface so every source/sink has an explicit
wire format:

```typescript
// src/codec/BlitzCodec.ts
export interface BlitzCodec<T> {
  /** Deserialize raw NATS payload bytes into a typed value. */
  decode(payload: Uint8Array): T;
  /** Serialize a typed value to NATS payload bytes. */
  encode(value: T): Uint8Array;
}

/** Built-in: JSON codec. encode = JSON.stringify → TextEncoder; decode = TextDecoder → JSON.parse */
export const JsonCodec = <T>(): BlitzCodec<T> => ({
  decode: (b) => JSON.parse(new TextDecoder().decode(b)) as T,
  encode: (v) => new TextEncoder().encode(JSON.stringify(v)),
});

/** Built-in: raw string codec */
export const StringCodec = (): BlitzCodec<string> => ({
  decode: (b) => new TextDecoder().decode(b),
  encode: (s) => new TextEncoder().encode(s),
});

/** Built-in: passthrough — payload is already Uint8Array */
export const BytesCodec = (): BlitzCodec<Uint8Array> => ({
  decode: (b) => b,
  encode: (b) => b,
});
```

The `Source<T>` interface requires a codec; messages are emitted already decoded:

```typescript
// src/source/Source.ts
export interface Source<T> {
  readonly codec: BlitzCodec<T>;
  messages(): AsyncIterable<{ value: T; ack(): void; nak(delay?: number): void }>;
}
```

Factory signatures include a codec parameter:

```typescript
NatsSource.fromSubject<Order>('orders.raw', JsonCodec<Order>())
NatsSource.fromStream<Order>('order-stream', 'order-consumer', JsonCodec<Order>())
```

Sinks also accept a codec and encode on send:

```typescript
NatsSink.toSubject('orders.enriched', JsonCodec<EnrichedOrder>())
NatsSink.toStream('order-stream', JsonCodec<EnrichedOrder>())
```

#### Sources

| Source | Backed by | Mode |
|---|---|---|
| `NatsSource.fromSubject(subj, codec)` | Core NATS push subscription | Streaming (unbounded) |
| `NatsSource.fromStream(stream, consumer, codec)` | JetStream durable consumer | Streaming + replayable |
| `HeliosMapSource.snapshot(map)` | Helios `IMap.entrySet()` | Batch (bounded) |
| `HeliosTopicSource.fromTopic(topic)` | Helios `ITopic.addMessageListener` | Streaming (unbounded) |
| `FileSource.lines(path)` | `Bun.file(path)` line iterator | Batch (bounded) |
| `HttpWebhookSource.listen(port, path)` | `Bun.serve()` | Streaming (unbounded) |

#### Sinks

| Sink | Backed by | Notes |
|---|---|---|
| `NatsSink.toSubject(subj, codec)` | `nc.publish()` (encodes via codec) | at-most-once publish; retry on failure wraps as NakError |
| `NatsSink.toStream(stream, codec)` | `js.publish()` from `@nats-io/jetstream` (encodes via codec) | durable; ack-based; retry on publish timeout |
| `HeliosMapSink.put(map)` | `IMap.put()` | idempotent: IMap.put() overwrites; safe to retry |
| `HeliosTopicSink.publish(topic)` | `ITopic.publish()` | at-most-once broadcast; retry on failure wraps as NakError |
| `FileSink.appendLines(path)` | `Bun.write()` append | NOT idempotent: retry will append duplicate lines. Use only in batch mode with exactly-once semantics or implement dedup. |
| `LogSink.console()` | `console.log` | Debug / testing |

**DONE — Block 10.2** (32 tests green, 3 skipped/NATS-integration):
- [x] Implement `BlitzCodec<T>` interface with `JsonCodec`, `StringCodec`, `BytesCodec` built-ins (`src/codec/BlitzCodec.ts`)
- [x] Implement all sources above; `Source<T>` interface: `readonly codec: BlitzCodec<T>` + `messages(): AsyncIterable<{ value: T; ack(); nak() }>`
- [x] All NATS sources accept a `codec: BlitzCodec<T>` parameter — decode raw `Uint8Array` payload on receive
- [x] Implement all sinks above with typed `write(value: T): Promise<void>` interface
- [x] All NATS sinks accept a `codec: BlitzCodec<T>` parameter — encode `T` to `Uint8Array` on send
- [x] Helios sources/sinks: wire to `@helios/core` IMap / ITopic interfaces
- [x] FileSource: line-by-line read via `Bun.file().text()` + split
- [x] HttpWebhookSource: `Bun.serve()` with configurable path + codec parsing
- [x] Tests: each source produces expected messages (decoded); each sink receives + records messages (encoded)
- [x] GREEN
- [x] `git commit -m "feat(blitz): Block 10.2 — codec contract + sources + sinks — 32 tests green"`

---

### Block 10.3 — Stream operators (~25 tests)

```
src/operator/
├── MapOperator.ts       # map<T, R>(fn: (t: T) => R | Promise<R>)
├── FilterOperator.ts    # filter<T>(pred: (t: T) => boolean | Promise<boolean>)
├── FlatMapOperator.ts   # flatMap<T, R>(fn: (t: T) => R[] | AsyncIterable<R>)
├── MergeOperator.ts     # merge(...stages) — fan-in, round-robin or first-come
├── BranchOperator.ts    # branch(pred) → [trueBranch, falseBranch]
└── PeekOperator.ts      # peek(fn) — observe without transforming (for debug/metrics)
```

All operators are async-first: `fn` may return a `Promise`. Errors in `fn` that extend
`NakError` trigger the fault policy (retry / dead-letter) — see `src/errors/NakError.ts`.
Other errors are wrapped in a `NakError` automatically. Operators should
`throw new NakError(...)` for recoverable errors.

**DONE — Block 10.3** (28 tests green):
- [x] Implement each operator as a `Stage` subclass with `process()` method
- [x] `MapOperator`: sync + async fn, error propagation
- [x] `FilterOperator`: sync + async predicate, pass-through on `true`
- [x] `FlatMapOperator`: sync array + async generator output, one-to-many expansion
- [x] `MergeOperator`: fan-in pass-through (pipeline runtime wires multiple upstream subjects)
- [x] `BranchOperator`: evaluate predicate, route to one of two FilterOperator branches
- [x] `PeekOperator`: call side-effect fn, re-emit message unchanged
- [x] Tests: each operator in isolation; chain of operators; async fn; error in fn triggers nak
- [x] GREEN
- [x] `git commit -m "feat(blitz): Block 10.3 — stream operators (map/filter/flatMap/merge/branch/peek) — 28 tests green"`

---

### Block 10.4 — Windowing engine (~35 tests)

```
src/window/
├── WindowPolicy.ts           # interface: assignWindows(eventTime) → WindowKey[]
├── TumblingWindowPolicy.ts   # size = duration; windows never overlap
├── SlidingWindowPolicy.ts    # size = duration, slide = duration; windows overlap
├── SessionWindowPolicy.ts    # gap = duration; new window after inactivity
├── WindowState.ts            # NATS KV bucket per pipeline (`blitz.{pipelineName}.windows`): typed put/get/delete/list; TTL = safety backstop only; explicit delete() after window close
└── WindowOperator.ts         # buffers events per window key; emits on close trigger
```

Window state is stored in the **NATS KV Store** — this makes window state durable across
process restarts (fault tolerance for free).

> ℹ️ Cross-ref: `HELIOS_BLITZ_IMPLEMENTATION.md` → Issue 12 (NATS KV TTL is per-bucket, not per-key)

**`WindowState` design — explicit deletion + bucket TTL backstop:**

`WindowState` uses one NATS KV bucket per pipeline (name: `blitz.{pipelineName}.windows`).

TTL is set at bucket level to `maxWindowDuration * 3` as a safety backstop only —
primary cleanup is explicit deletion after window close:

```
Lifecycle contract (enforced by WindowOperator):
  1. On event:        kv.put(windowKey, serialize(accumulator))
  2. On window CLOSE: kv.delete(windowKey) AFTER emitting the result.
                      If emit fails (downstream error), kv.delete is NOT called —
                      window remains for retry.
  3. Bucket TTL (safety backstop): windowPolicy.maxDurationMs * 3.
                      Default: TumblingWindow → size*3, SlidingWindow → size*3,
                               SessionWindow → gapMs*6.
                      Catches leaked state from crashes between emit and delete.
  4. WindowState interface: put(key, acc), get(key), delete(key), list() — all typed.
```

`WindowState` interface:
```typescript
interface WindowState<A> {
    put(key: WindowKey, accumulator: A): Promise<void>;
    get(key: WindowKey): Promise<A | null>;
    delete(key: WindowKey): Promise<void>;   // called explicitly after every successful window emit
    list(): Promise<WindowKey[]>;
}
```

`WindowOperator` after emitting a closed window's result calls `windowState.delete(windowKey)`.
Deletion failure is logged but does not block pipeline progress — the bucket TTL backstop
will clean it up.

Window close trigger strategies:
- **Event-time watermark**: downstream message with `ts >= windowEnd + allowedLateness`
- **Processing-time timer**: `setTimeout` fires at `now + (windowEnd - eventTime)` ±jitter
- **Count trigger**: window closes when it accumulates N events (tumbling only)

```typescript
p.readFrom(NatsSource.fromStream('clickstream'))
 .window(TumblingWindowPolicy.of({ size: 60_000 }))   // 1-minute tumbling windows
 .aggregate(CountAggregator.byKey(click => click.userId))
 .writeTo(NatsSink.toSubject('click-counts-per-minute'));
```

**DONE — Block 10.4** (32 tests green, 5 skipped/NATS-integration):
- [x] Implement `WindowPolicy` interface (`assignWindows(eventTime: number): WindowKey[]`)
- [x] Implement `TumblingWindowPolicy` (non-overlapping, fixed-duration)
- [x] Implement `SlidingWindowPolicy` (overlapping, size + slide; non-negative window start guard)
- [x] Implement `SessionWindowPolicy` (gap-based; `resolveKey()` for stateful session tracking)
- [x] Implement `WindowState<A>` backed by NATS KV: `put(key, acc)`, `get(key)`, `delete(key)`, `list()` — all typed; bucket name `blitz-{pipelineName}-windows`
- [x] `WindowState.delete(key)` called explicitly after every successful window emit
- [x] Bucket TTL set to `windowPolicy.maxDurationMs * 3` at bucket creation (safety backstop only)
- [x] Implement `WindowOperator`: routes events to window key(s); count trigger + processing-time timer; `delete(key)` after emit; session close timer resets on each event
- [x] Tests: tumbling window groups and emits; sliding window emits overlapping results; session window extends on activity; KV state survives restart (NATS skipped)
- [x] Test: closed windows are deleted from KV after emit
- [x] GREEN
- [x] `git commit -m "feat(blitz): Block 10.4 — windowing engine (tumbling/sliding/session) + NATS KV state — 32 tests green"`

---

### Block 10.5 — Stateful aggregations (~30 tests)

```
src/aggregate/
├── Aggregator.ts             # interface: create() → A; accumulate(acc, item) → A; combine(a, b) → A; export(acc) → R
├── CountAggregator.ts        # count events [optionally grouped by key]
├── SumAggregator.ts          # sum numeric field
├── MinAggregator.ts          # minimum value
├── MaxAggregator.ts          # maximum value
├── AvgAggregator.ts          # running average (sum + count accumulators)
├── DistinctAggregator.ts     # distinct values (Set accumulator)
└── AggregatingOperator.ts    # consumes WindowOperator output; applies Aggregator; emits result
```

The blitz `Aggregator<T, A, R>` interface extends the core batch aggregator contract with one
additional method — `combine()` — required for subject-partitioned parallel workers:

```typescript
// packages/blitz/src/aggregate/Aggregator.ts
export interface Aggregator<T, A, R> {
  /** Create a new empty accumulator. */
  create(): A;
  /** Fold one item into the accumulator. Must be pure (no side effects). */
  accumulate(acc: A, item: T): A;
  /**
   * Combine two partial accumulators into one.
   * Required for subject-partitioned parallel workers (withParallelism > 1).
   * For single-worker pipelines this method is never called.
   */
  combine(a: A, b: A): A;
  /** Extract the final result from the accumulator. */
  export(acc: A): R;
}
```

The six concrete aggregators in `packages/blitz/src/aggregate/` are thin wrappers that
delegate to the corresponding `@helios/core` implementations and add `combine()`:

- `CountAggregator` wraps `@helios/core/aggregation/CountAggregator` — `combine(a, b) = a + b`
- `SumAggregator` wraps `@helios/core/aggregation/SumAggregator` — `combine(a, b) = a + b`
- `MinAggregator` — `combine(a, b) = Math.min(a, b)`
- `MaxAggregator` — `combine(a, b) = Math.max(a, b)`
- `AvgAggregator` — accumulator is `{ sum: number; count: number }`, `combine(a, b) = { sum: a.sum + b.sum, count: a.count + b.count }`
- `DistinctAggregator` — accumulator is `Set<T>`, `combine(a, b) = new Set([...a, ...b])`

No duplicate business logic. `@helios/core` remains the authoritative implementation.
The blitz wrappers add exactly one method each.

Grouped aggregations (equivalent to Jet's `groupingKey`):

```typescript
.aggregate(CountAggregator.byKey(event => event.region))
// emits: Map<region, count> per window
```

> ℹ️ Cross-ref: `HELIOS_BLITZ_IMPLEMENTATION.md` → Issue 13 (NATS queue groups have no key-affinity routing)

**Grouped aggregation correctness — parallelism modes:**

Grouped aggregations (`byKey`) are correct by construction in two modes only:

- **Mode 1 — Single worker (default, always correct):** A pipeline with `.aggregate(agg.byKey(fn))` runs as a single consumer (not a queue group). Ordering and key-affinity are guaranteed. Throughput is limited to one node.

- **Mode 2 — Parallel workers with key-partitioned subjects:** When `.withParallelism(N)` is set, the pipeline publishes each event to a deterministic subject based on the key hash:
  ```
  subject = `blitz.{pipelineName}.keyed.${Math.abs(hash(keyFn(event))) % N}`
  ```
  Worker `i` subscribes only to `blitz.{pipelineName}.keyed.i`. All events for the same key always go to the same worker. No combiner needed.

**Warning:** Grouped aggregations (`byKey`) MUST NOT be used with plain NATS queue groups, as queue groups distribute messages round-robin with no key-affinity. Each worker would hold only a partial count for any given key, producing silently wrong results.

**DONE — Block 10.5** ✅ (34 tests green):
- [x] Implement blitz aggregate wrappers that delegate to `@helios/core` aggregators and add `combine()` — no business logic duplication
- [x] Implement `Aggregator<T, A, R>` interface (extends core batch contract with `combine(a: A, b: A): A` for parallel partial aggregation — see interface spec above)
- [x] Implement all 6 concrete aggregators as thin wrappers over `@helios/core/aggregation/` implementations (reuse core logic; add only `combine()`)
- [x] Implement `AggregatingOperator`: consume closed window from `WindowOperator`, run accumulation loop, emit result
- [x] Implement `byKey(keyFn)` grouping variant on each aggregator
- [x] Tests: each aggregator produces correct result; grouped aggregation; streaming aggregation without windowing (whole-stream running total)
- [x] Test (a): single-worker grouped aggregation correctness (`byKey` with one consumer produces exact per-key counts)
- [x] Test (b): `withParallelism(N)` routes same-key events to the same shard across N workers — no cross-shard key splits
- [x] GREEN
- [x] `git commit -m "feat(blitz): stateful aggregations (count/sum/min/max/avg/distinct) — 34 tests green"`

---

### Block 10.6 — Stream joins (~25 tests)

```
src/join/
├── HashJoinOperator.ts      # stream-table join: enrich stream events from Helios IMap side input
└── WindowedJoinOperator.ts  # stream-stream join: match events from two streams within same window
```

#### Stream-table join (hash join)

The enrichment pattern: for every event in stream A, look up a matching record from
Helios `IMap` (the "table" side). This is the most common join in practice.

```typescript
const enriched = p.readFrom(NatsSource.fromSubject('orders'))
  .hashJoin(
    HeliosMapSource.asLookup(orderDetailsMap, order => order.productId),
    (order, details) => ({ ...order, category: details?.category ?? 'unknown' })
  );
```

#### Stream-stream join (windowed join)

Match events from two NATS streams that fall within the same window:

```typescript
const joined = p.readFrom(NatsSource.fromStream('clicks'))
  .windowedJoin(
    NatsSource.fromStream('purchases'),
    TumblingWindowPolicy.of({ size: 60_000 }),
    (click, purchase) => click.userId === purchase.userId,
    (click, purchase) => ({ click, purchase })
  );
```

Window state for both sides is stored in NATS KV.

**TODO — Block 10.6**:
- [x] Implement `HashJoinOperator`: for each incoming event, perform `IMap.get(keyFn(event))`; apply merge fn; emit enriched event
- [x] Implement `WindowedJoinOperator`: buffer left + right events per window key in NATS KV; on window close, cross-join with predicate; emit matched pairs
- [x] Handle null / missing table entries gracefully (left-outer join behavior by default)
- [x] Tests: hash join enriches events; hash join handles missing key (null side); windowed join matches within window; windowed join does not match across windows; late arrivals respected
- [x] GREEN
- [x] `git commit -m "feat(blitz): stream joins (hash join + windowed stream-stream join) — 25 tests green"`

---

### Block 10.7 — Fault tolerance + retry + dead-letter (~20 tests)

```
src/fault/
├── AckPolicy.ts           # EXPLICIT (ack on success, nak on error) | NONE (fire-and-forget)
├── RetryPolicy.ts         # maxRetries + backoff strategy (fixed / exponential)
├── DeadLetterSink.ts      # route exhausted messages to a DL NATS subject/stream
└── CheckpointManager.ts   # NATS KV-backed: persist last-processed sequence per consumer
```

All JetStream-backed stages use `AckPolicy.EXPLICIT` by default. On operator error:
1. `nak()` the NATS message (returns it to the server for redelivery)
2. After `RetryPolicy.maxRetries` exhausted, `nak()` with `delay = 0` to trigger `maxDeliverCount`
3. JetStream moves exhausted messages to the configured dead-letter stream
4. `DeadLetterSink` records failed messages with error metadata for inspection

`CheckpointManager` periodically persists the highest consecutive ack'd sequence number
per pipeline/consumer to NATS KV. On restart, the consumer seeks to the checkpoint
sequence instead of replaying from the beginning.

#### CheckpointManager specification

Checkpoint granularity: **per JetStream consumer** (one checkpoint key per pipeline/consumer pair).

Default checkpoint triggers (both apply simultaneously — whichever fires first):
- **Every 100 consecutive ack'd messages** (N = 100)
- **Every 5 seconds** (T = 5 000 ms)

Both defaults are configurable via `BlitzConfig.checkpointIntervalAcks` and
`BlitzConfig.checkpointIntervalMs`.

KV key format: `checkpoint.{pipelineName}.{consumerName}`
KV value format: `{ sequence: number; ts: number; windowKeys: string[] }`

`windowKeys` stores the set of open window keys at checkpoint time. On restart:
1. Read checkpoint from KV → get `sequence` and `windowKeys`.
2. Seek JetStream consumer to `sequence + 1`.
3. For each `windowKey` in `windowKeys`: the NATS KV window state bucket already contains
   the partial accumulator — WindowOperator resumes accumulating from it.
4. Messages between `checkpoint.sequence + 1` and the next window-close event are 
   replayed — they are re-accumulated into the existing partial accumulator.
   This is safe because accumulators are additive (count += 1, sum += x).
   For non-additive aggregations, the window accumulator stores raw events (not 
   derived state) so replay is exact.

Mid-window crash replay scope: At most `N` messages (default 100) are replayed per
consumer. This is the checkpoint granularity. A window that closes every 500 events
and a checkpoint every 100 events means at most 100 events are re-processed on restart.

IMPORTANT: The replay produces at-most-once window emissions (the window emit + delete
did not happen for the replayed messages, so the window remains open and accumulates
correctly). At-least-once delivery is guaranteed — no data loss.

#### Sink error propagation contract

Sinks are terminal stages. When a sink's `write()` method throws:

1. The upstream JetStream message that triggered this pipeline execution is **nak'd**
   with the same retry/DL policy as operator errors. The message returns to the server
   for redelivery.
2. The `RetryPolicy` applies to the entire stage chain (source → operators → sink)
   as a unit. A sink failure is indistinguishable from an operator failure from the
   fault policy's perspective.
3. On retry, the full pipeline chain re-executes for that message: operators run again,
   sink is called again. Operators MUST be idempotent or the retry produces duplicates
   in intermediate state (NATS KV, IMap, etc.).
4. After `RetryPolicy.maxRetries` exhausted: the message is routed to `DeadLetterSink`
   with error metadata including `sinkName`, `errorMessage`, `deliveryCount`.
5. `NatsSink.toSubject()` (fire-and-forget): publish failures are wrapped as `NakError`
   and follow the standard retry/DL path.
6. `NatsSink.toStream()` (durable, ack-able): if the JetStream publish ack times out or
   fails, it is treated as a `NakError` — the upstream message is nak'd and retried.

This contract means: a pipeline with N stages either succeeds atomically (all stages
complete, upstream ack'd) or fails and retries as a unit. There is no partial success.

For idempotent sinks (e.g., `HeliosMapSink.put()` which is naturally idempotent via
IMap's put-overwrites semantics), retries are safe. For non-idempotent sinks (append
operations), callers must implement their own dedup logic (e.g., dedup key in IMap).

**DONE — Block 10.7** (44 tests green):
- [x] Implement `AckPolicy` enum (EXPLICIT / NONE)
- [x] Implement `RetryPolicy` (fixed delay + exponential backoff with jitter + maxBackoffMs cap)
- [x] Implement `DeadLetterSink` (injectable `DLPublisher`; publish with error headers)
- [x] Implement `CheckpointManager` with N=100 acks and T=5000ms defaults; both configurable; NATS KV via `CheckpointStore` interface
- [x] Checkpoint KV value includes `windowKeys: string[]` and `ts`
- [x] On restart: reads checkpoint sequence + windowKeys from store
- [x] Implement `FaultHandler` orchestrating ack/retry/DL per message
- [x] Missed checkpoint (store throws) logged, does not propagate
- [x] GREEN
- [x] `git commit -m "feat(blitz): Block 10.7 — fault tolerance (ack/retry/dead-letter/checkpoint) — 44 tests green"`

---

### Block 10.8 — Batch processing mode (~20 tests)

```
src/batch/
├── BatchPipeline.ts          # bounded variant: auto-detects end of stream, then shuts down
└── EndOfStreamDetector.ts    # monitors JetStream consumer; fires when last message ack'd + no new msgs for T ms
```

Batch mode wraps the same Pipeline API but the source is bounded:
- `HeliosMapSource.snapshot(map)` — reads all entries, signals end-of-stream
- `FileSource.lines(path)` — reads to EOF, signals end-of-stream
- `NatsSource.fromStream(stream, { deliverAll: true })` — replay all historical messages, signals EOS

On end-of-stream, `BatchPipeline.run()` returns a `Promise<BatchResult>` with record counts,
error counts, and duration. All pipeline resources are automatically cleaned up.

```typescript
const result = await blitz.batch('etl-job')
  .readFrom(FileSource.lines('/data/input.ndjson'))
  .map(line => JSON.parse(line))
  .filter(record => record.status === 'active')
  .writeTo(HeliosMapSink.put(activeUsersMap, r => r.id));

console.log(`Processed ${result.recordsOut} records in ${result.durationMs}ms`);
```

**DONE — Block 10.8** ✅:
- [x] Implement `EndOfStreamDetector` (count expected vs ack'd; idle timeout fallback)
- [x] Implement `BatchGeneralStage.writeTo()` → `Promise<BatchResult>` with auto-shutdown
- [x] Implement `BatchResult` (recordsIn, recordsOut, errorCount, durationMs, errors[])
- [x] Wire `HeliosMapSource.snapshot()` and `FileSource.lines()` end-of-stream signals (natural iterator exhaustion)
- [x] Wire JetStream `deliverAll` consumer to EOS detector (EndOfStreamDetector idle-timeout mode)
- [x] Tests: batch runs to completion; BatchResult counts match; error in map captured in result; partial failure with retry; clean shutdown after completion
- [x] GREEN — 20 tests
- [x] `git commit -m "feat(blitz): Block 10.8 — batch processing mode (bounded pipelines) — 20 tests green"`

---

### Block 10.9 — NestJS integration (`@helios/blitz` module) (~25 tests)

```
src/nestjs/
├── HeliosBlitzModule.ts       # @Global() DynamicModule with forRoot() / forRootAsync()
├── HeliosBlitzService.ts      # @Injectable() wrapper around BlitzService
└── InjectBlitz.decorator.ts   # @InjectBlitz() parameter decorator
```

> **Pattern rationale:** `HeliosBlitzModule` uses NestJS `ConfigurableModuleBuilder`
> (the same pattern as `HeliosModule` in Block 9.1), NOT the hand-rolled `register()`/
> `registerAsync()` pattern used by `HeliosCacheModule` and `HeliosTransactionModule`.
>
> **Why the difference:**
> - `HeliosCacheModule` and `HeliosTransactionModule` were implemented before
>   `ConfigurableModuleBuilder` was standardized in the `@helios/*` ecosystem. They
>   use a hand-rolled pattern that is correct but verbose.
> - New modules (`HeliosModule` Block 9.1, `HeliosBlitzModule` Block 10.9) use
>   `ConfigurableModuleBuilder` — it generates `forRoot()` + `forRootAsync()` with
>   `useFactory`/`useClass`/`useExisting` support from a single builder call.
> - **When adding new `@helios/*` modules in the future: use `ConfigurableModuleBuilder`.**
>   The cache and transaction modules will be migrated to this pattern in a future cleanup
>   (tracked as a separate task — not in Phase 10 scope).

```typescript
// App module
@Module({
  imports: [
    HeliosModule.forRoot({ config }),
    HeliosBlitzModule.forRoot({ servers: 'nats://localhost:4222' }),
  ],
})
export class AppModule {}

// Consumer
@Injectable()
class OrderProcessor implements OnModuleInit {
  constructor(@InjectBlitz() private readonly blitz: BlitzService) {}

  async onModuleInit() {
    const p = this.blitz.pipeline('order-pipeline');
    p.readFrom(NatsSource.fromSubject('orders'))
     .map(this.enrich.bind(this))
     .writeTo(HeliosMapSink.put(this.ordersMap, o => o.id));
    await this.blitz.submit(p);
  }
}
```

`HeliosBlitzModule.forRootAsync()` supports `useFactory`, `useClass`, `useExisting` via
`ConfigurableModuleBuilder` (same pattern as Phase 9 Block 9.1).

**NestJS peer dependencies:**

> ℹ️ Cross-ref: `HELIOS_BLITZ_IMPLEMENTATION.md` → Issue 16

- `@nestjs/common@^11` and `@nestjs/core@^11` are declared as **optional peer dependencies**
  in `packages/blitz/package.json`. They are only required when using the `src/nestjs/`
  submodule. Applications that use `@helios/blitz` for pure stream processing without NestJS
  do not need them.
- `@helios/blitz` must **NOT** import from `src/nestjs/` in its main barrel `src/index.ts`.
  The NestJS submodule is exported via a separate subpath: `@helios/blitz/nestjs`.
- Consumers import NestJS integration as: `import { HeliosBlitzModule } from '@helios/blitz/nestjs'`

**TODO — Block 10.9**:
- [x] Add `@nestjs/common@^11` and `@nestjs/core@^11` as optional peer dependencies in `packages/blitz/package.json`
- [x] Export `src/nestjs/` via `@helios/blitz/nestjs` subpath export in `packages/blitz/package.json` — NOT from main barrel `src/index.ts`
- [x] Set up `ConfigurableModuleBuilder` for `HeliosBlitzModule`
- [x] Implement `HeliosBlitzService` as an `@Injectable()` wrapping `BlitzService`
- [x] Implement `OnModuleDestroy` → `blitz.shutdown()` for lifecycle safety
- [x] Implement `@InjectBlitz()` convenience decorator
- [x] Tests: `forRoot()` sync registration; `forRootAsync()` with `useFactory`; `@InjectBlitz()` resolves service; module destroy calls shutdown; pipeline survives module restart
- [x] Verify `src/index.ts` does NOT import or re-export anything from `src/nestjs/`
- [x] GREEN
- [x] `git commit -m "feat(blitz): @helios/blitz NestJS module integration — 25 tests green"`
- ⚠️ **Known infrastructure issue**: `packages/blitz/bunfig.toml` preloads `reflect-metadata` but it is missing from `devDependencies` — `bun test` inside `packages/blitz/` fails with `preload not found`. Fixed in **Block 13.1**.

---

### Block 10.10 — End-to-end acceptance + feature parity gate (~20 tests)

This block validates that the assembled `@helios/blitz` package meets the 80%+ parity
contract with Hazelcast Jet. Each test scenario maps to a Hazelcast Jet integration test.

Required scenarios:

| Hazelcast Jet test class | Helios Blitz equivalent scenario |
|---|---|
| `PipelineTest` | Multi-stage pipeline with source → map → filter → sink |
| `WindowAggregationTest` | Tumbling window + count aggregation over NATS stream |
| `SlidingWindowTest` | Sliding window producing overlapping results |
| `SessionWindowTest` | Session window closes on inactivity gap |
| `HashJoinTest` | Enrich stream events from Helios IMap lookup |
| `StreamStreamJoinTest` | Match events from two NATS streams within window |
| `FaultToleranceTest` | Operator crash → retry → recovery without data loss |
| `BatchJobTest` | FileSource → transform → HeliosMapSink completes with correct count |
| `DeadLetterTest` | Exhausted retries route to DL stream |
| `CheckpointRestartTest` | Pipeline restart resumes from checkpoint, not from beginning |
| `AtLeastOnceTest` | Simulate crash mid-pipeline → restart → verify no data loss AND dedup key prevents double-counting |

**Feature parity gate** (blocks release of `@helios/blitz` v1.0):

| Feature | Required |
|---|---|
| Linear pipeline (source → ops → sink) | ✅ |
| Tumbling + sliding + session windows | ✅ |
| All 6 built-in aggregators | ✅ |
| Hash join (stream-table) | ✅ |
| Windowed join (stream-stream) | ✅ |
| Fault tolerance (at-least-once, retry, DL) | ✅ |
| Batch mode (bounded pipeline) | ✅ |
| Checkpoint/restart | ✅ |
| NestJS module integration | ✅ |
| Bun-native (zero Node.js shims) | ✅ |

**DONE — Block 10.10**:
- [x] Write all 10 acceptance scenarios above (33 tests total)
- [x] Run feature parity gate — all scenarios pass
- [x] Verify `bun publish --dry-run` succeeds for `packages/blitz/` (187 files, 0.28MB)
- [x] GREEN — 33 tests green
- [x] `git commit -m "test(blitz): Block 10.10 — e2e acceptance + feature parity gate — @helios/blitz v1.0 — 33 tests green"`

---

**Phase 10 done gate**: `@helios/blitz` v1.0 is a standalone, publishable Bun/TypeScript
stream and batch processing library with:
- Fluent DAG pipeline builder API (Hazelcast Jet `Pipeline` model)
- NATS JetStream as durable transport backbone
- Tumbling, sliding, and session windowing with NATS KV state
- 6 built-in aggregators (count, sum, min, max, avg, distinct) + custom aggregator interface
- Stream-table join (hash join via Helios IMap) + stream-stream join (windowed)
- At-least-once fault tolerance with configurable retry + dead-letter routing
- Checkpoint/restart via NATS KV sequence tracking
- Batch processing mode (bounded pipelines with `BatchResult`)
- 6 built-in sources (NATS, JetStream, HeliosMap, HeliosTopic, File, HttpWebhook)
- 5 built-in sinks (NATS, JetStream, HeliosMap, HeliosTopic, File)
- `@helios/blitz` NestJS module with `forRoot`/`forRootAsync` + `@InjectBlitz()` decorator
- ~80% feature parity with Hazelcast Jet, zero JVM dependency

---

## Phase 11 — Built-in REST API (Bun.serve())

Goal: promote the REST API from a demo-app concern into `@helios/core` as a proper
production feature. The REST API is the only way to operate a Helios node without a
Hazelcast binary-protocol client — it is required for Kubernetes health probes, Docker
health checks, CI/CD pipelines, and shell-based cluster management.

Depends on: Phase 7.1 (production `HeliosInstanceImpl`), Phase 8.1 (near-cache wired
into instance).

### Why it belongs in core, not the demo app

The `app/src/http-server.ts` built during Phase 7 proved the pattern works. Phase 11
graduates it: the REST server becomes a lifecycle-managed component of `HeliosInstanceImpl`
itself — started when `restApiConfig.isEnabled()`, stopped on `instance.shutdown()`.
No user wiring required.

### Design decisions vs Hazelcast Java

| Concern | Java old (`RestApiConfig`, removed 6.0) | Java new (`RestConfig`, 5.4+) | Helios |
|---|---|---|---|
| Transport | HTTP multiplexed on cluster TCP port 5701 via NIO text-parser | Separate HTTP server (default port 8443) | Separate HTTP server, **`Bun.serve()`**, default port **8080** |
| Dependency | None (reused NIO stack) | Embedded HTTP server | None — `Bun.serve()` is built in |
| TLS | No | Full TLS (JKS, PEM) | Deferred to v2 via `Bun.serve({ tls })` |
| Auth | None | JWT tokens, lockout, security realm | Deferred to v2 |
| Endpoint groups | `RestEndpointGroup` enum | Same groups (deprecated name) | Same model, 4 groups relevant to v1 |

The Java NIO-multiplexing hack existed because adding Jetty to a JVM cluster node was
heavy. In Bun, `Bun.serve()` is built into the runtime — zero additional dependency,
zero cold-start cost. We skip straight to the correct model: a dedicated HTTP listener.

### Endpoint groups (v1 scope)

| Group | Default | Endpoints |
|---|---|---|
| `HEALTH_CHECK` | **enabled** | `/hazelcast/health`, `/hazelcast/health/ready`, `/hazelcast/health/node-state`, `/hazelcast/health/cluster-state`, `/hazelcast/health/cluster-safe`, `/hazelcast/health/cluster-size` |
| `CLUSTER_READ` | **enabled** | `/hazelcast/rest/cluster`, `/hazelcast/rest/instance` |
| `CLUSTER_WRITE` | disabled | `GET/POST /hazelcast/rest/log-level`, `POST /hazelcast/rest/log-level/reset`, `POST /hazelcast/rest/management/cluster/memberShutdown` |
| `DATA` | disabled | `GET/POST/DELETE /hazelcast/rest/maps/{name}/{key}`, `GET /hazelcast/rest/queues/{name}/size`, `POST /hazelcast/rest/queues/{name}`, `GET /hazelcast/rest/queues/{name}/{timeout}` |

Groups `PERSISTENCE`, `WAN`, and `CP` are not implemented — they map to deferred/dropped
features and return 501 Not Implemented if requested.

### File structure

```
src/config/RestApiConfig.ts               (upgraded — add port, groups, timeout)

src/rest/
├── RestEndpointGroup.ts                  (enum: HEALTH_CHECK | CLUSTER_READ | CLUSTER_WRITE | DATA)
├── HeliosRestServer.ts                   (Bun.serve() lifecycle — start(), stop(), getBoundPort())
├── RestApiFilter.ts                      (URL → group → handler; 403 if group disabled)
├── handler/
│   ├── HealthCheckHandler.ts             (HEALTH_CHECK group — K8s probes)
│   ├── ClusterReadHandler.ts             (CLUSTER_READ group — cluster info)
│   ├── ClusterWriteHandler.ts            (CLUSTER_WRITE group — log level, shutdown)
│   └── DataHandler.ts                    (DATA group — IMap CRUD + IQueue ops)
└── index.ts                              (barrel export)
```

### Config model (upgraded RestApiConfig)

```typescript
// src/config/RestApiConfig.ts (upgraded from boolean stub)
import { RestEndpointGroup } from '@helios/rest/RestEndpointGroup';

export class RestApiConfig {
    static readonly DEFAULT_PORT = 8080;
    static readonly DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

    private _enabled: boolean = false;
    private _port: number = RestApiConfig.DEFAULT_PORT;
    private _requestTimeoutMs: number = RestApiConfig.DEFAULT_REQUEST_TIMEOUT_MS;
    private _enabledGroups: Set<RestEndpointGroup> = new Set([
        RestEndpointGroup.HEALTH_CHECK,
        RestEndpointGroup.CLUSTER_READ,
    ]);

    isEnabled(): boolean { return this._enabled; }
    setEnabled(enabled: boolean): this { this._enabled = enabled; return this; }

    getPort(): number { return this._port; }
    setPort(port: number): this { this._port = port; return this; }

    getRequestTimeoutMs(): number { return this._requestTimeoutMs; }
    setRequestTimeoutMs(ms: number): this { this._requestTimeoutMs = ms; return this; }

    enableGroups(...groups: RestEndpointGroup[]): this {
        for (const g of groups) this._enabledGroups.add(g);
        return this;
    }
    disableGroups(...groups: RestEndpointGroup[]): this {
        for (const g of groups) this._enabledGroups.delete(g);
        return this;
    }
    enableAllGroups(): this {
        for (const g of Object.values(RestEndpointGroup)) this._enabledGroups.add(g);
        return this;
    }
    disableAllGroups(): this { this._enabledGroups.clear(); return this; }

    isGroupEnabled(group: RestEndpointGroup): boolean { return this._enabledGroups.has(group); }
    getEnabledGroups(): ReadonlySet<RestEndpointGroup> { return this._enabledGroups; }
    isEnabledAndNotEmpty(): boolean { return this._enabled && this._enabledGroups.size > 0; }
}
```

### HeliosRestServer skeleton

```typescript
// src/rest/HeliosRestServer.ts
export class HeliosRestServer {
    private _server: ReturnType<typeof Bun.serve> | null = null;

    constructor(
        private readonly instance: HeliosInstance,
        private readonly config: RestApiConfig,
    ) {}

    start(): void {
        const filter = new RestApiFilter(this.config, this.instance);
        this._server = Bun.serve({
            port: this.config.getPort(),
            fetch: (req) => filter.dispatch(req),
        });
    }

    stop(): void {
        this._server?.stop(true);
        this._server = null;
    }

    getBoundPort(): number {
        return this._server?.port ?? -1;
    }
}
```

### Integration with HeliosInstanceImpl

```typescript
// In HeliosInstanceImpl.start() — add after all services are started:
if (this._config.getNetworkConfig().getRestApiConfig().isEnabledAndNotEmpty()) {
    this._restServer = new HeliosRestServer(
        this,
        this._config.getNetworkConfig().getRestApiConfig(),
    );
    this._restServer.start();
}

// In HeliosInstanceImpl.shutdown():
this._restServer?.stop();
```

### Integration with standalone CLI (HeliosServer — Block 7.7)

No extra wiring needed — REST is driven entirely by config and instance lifecycle.
Add CLI ergonomics to `helios-server.ts`:

```bash
bun run helios-server.ts --rest-port 8080
bun run helios-server.ts --rest-port 8080 --rest-groups HEALTH_CHECK,CLUSTER_READ,DATA
```

### What happens to app/src/http-server.ts

`app/src/http-server.ts` is **deleted** in Block 11.6. `HeliosRestServer` starts
automatically inside `HeliosInstanceImpl` when `restApiConfig.isEnabledAndNotEmpty()` —
the demo app simply configures the instance with the desired groups. No delegation,
no proxy, no two HTTP listeners. See Block 11.6 for the full migration spec.

---

### Block 11.1 — RestApiConfig upgrade + RestEndpointGroup (~12 tests)

Upgrade the existing `RestApiConfig` stub and introduce `RestEndpointGroup`.

```
src/config/RestApiConfig.ts     (upgrade — port, groups, timeout, full fluent API)
src/rest/RestEndpointGroup.ts   (new — HEALTH_CHECK | CLUSTER_READ | CLUSTER_WRITE | DATA)
```

Config YAML/JSON parsers (Block 1.7) must be updated to parse the `rest-api` config block.

**DONE — Block 11.1** ✅ (23 tests green):
- [x] Implement `RestEndpointGroup` enum (4 groups; default enabled: HEALTH_CHECK + CLUSTER_READ)
- [x] Upgrade `RestApiConfig` with port, groups, timeout, fluent API, `isEnabledAndNotEmpty()`
- [x] Update YAML/JSON config parsers to parse `rest-api.port` and `rest-api.enabled-groups`
- [x] Tests: default groups correct; enable/disable fluent API; YAML + JSON parse round-trip; port validation; `isEnabledAndNotEmpty()` logic
- [x] GREEN
- [x] `git commit -m "feat(rest): RestApiConfig upgrade + RestEndpointGroup — 23 tests green"`

---

### Block 11.2 — HeliosRestServer + RestApiFilter + lifecycle (~8 tests)

```
src/rest/HeliosRestServer.ts    (Bun.serve() lifecycle: start, stop, getBoundPort)
src/rest/RestApiFilter.ts       (URL prefix → group; 403 with JSON body if group disabled)
```

Disabled-group response:
```json
{ "status": 403, "message": "This REST endpoint group is disabled. Enable it via RestApiConfig." }
```

Unknown paths return 404:
```json
{ "status": 404, "message": "Unknown REST endpoint." }
```

**DONE — Block 11.2** (18 tests green):
- [x] Implement `HeliosRestServer` (`start`/`stop`/`getBoundPort`, port from config)
- [x] Implement `RestApiFilter` (URL prefix → group mapping, 403 on disabled group, 404 on unknown)
- [x] Wire `HeliosRestServer` into `HeliosInstanceImpl` startup/shutdown sequence
- [x] Tests: server starts on correct port; does not start when `isEnabled()=false`; stops cleanly; 403 for disabled group; 404 for unknown path; port accessible after start
- [x] GREEN — 18 tests

---

### Block 11.3 — HEALTH_CHECK handler (~8 tests)

The primary production driver. Kubernetes liveness/readiness probes and load balancer
health checks hit these endpoints — they must be synchronous, fast, and return
well-formed JSON even if the cluster is degraded.

```
src/rest/handler/HealthCheckHandler.ts
```

Endpoints:
```
GET /hazelcast/health              → full health JSON
GET /hazelcast/health/ready        → 200 {"status":"UP"} if ACTIVE; 503 {"status":"DOWN"} otherwise
GET /hazelcast/health/node-state   → {"nodeState":"ACTIVE"}
GET /hazelcast/health/cluster-state → {"clusterState":"ACTIVE"}
GET /hazelcast/health/cluster-safe → {"clusterSafe":true}
GET /hazelcast/health/cluster-size → {"clusterSize":1}
```

Full health response body:
```json
{
  "nodeState": "ACTIVE",
  "clusterState": "ACTIVE",
  "clusterSafe": true,
  "clusterSize": 1,
  "memberVersion": "1.0.0",
  "instanceName": "helios-node-1"
}
```

Node state is sourced from `HeliosLifecycleService.getState()`:
`STARTING | ACTIVE | PASSIVE | SHUTTING_DOWN | TERMINATED`

**DONE — Block 11.3** (9 tests green):
- [x] Implement `HealthCheckHandler` with all 6 endpoints
- [x] `/hazelcast/health/ready` returns 503 when node state is not `ACTIVE`
- [x] All responses: `Content-Type: application/json`
- [x] Tests: each endpoint returns correct JSON structure; 503 when not ACTIVE; ACTIVE node returns 200; correct Content-Type header on all responses
- [x] GREEN
- [x] `git commit -m "feat(rest): Block 11.3 — HealthCheckHandler (K8s probes) — 9 tests green"`

---

### Block 11.4 — CLUSTER_READ + CLUSTER_WRITE handlers (~10 tests)

```
src/rest/handler/ClusterReadHandler.ts
src/rest/handler/ClusterWriteHandler.ts
```

CLUSTER_READ endpoints (enabled by default):
```
GET /hazelcast/rest/cluster    → {"name":"dev","state":"ACTIVE","memberCount":1}
GET /hazelcast/rest/instance   → {"instanceName":"helios-node-1"}
```

CLUSTER_WRITE endpoints (disabled by default):
```
GET  /hazelcast/rest/log-level                              → {"logLevel":"INFO"}
POST /hazelcast/rest/log-level   body: {"logLevel":"DEBUG"} → 200 OK
POST /hazelcast/rest/log-level/reset                        → 200 OK
POST /hazelcast/rest/management/cluster/memberShutdown      → 200 OK (async shutdown)
```

Member shutdown: send `200 OK` response **before** calling `instance.shutdown()` —
`Promise.resolve().then(() => instance.shutdown())` so the response flushes first.

**DONE — Block 11.4** ✅ (10 tests green):
- [x] Implement `ClusterReadHandler` (cluster info + instance name)
- [x] Implement `ClusterWriteHandler` (log level get/set/reset + member shutdown)
- [x] Log-level change must update the Helios logger at runtime
- [x] Member shutdown: send 200, then schedule `instance.shutdown()` via microtask
- [x] Tests: CLUSTER_READ returns correct JSON; CLUSTER_WRITE returns 403 when group disabled; log-level round-trip (set DEBUG → get → reset → get INFO); shutdown triggers lifecycle event
- [x] GREEN
- [x] `git commit -m "feat(rest): CLUSTER_READ + CLUSTER_WRITE handlers — 10 tests green"`

---

### Block 11.5 — DATA handler (~10 tests)

```
src/rest/handler/DataHandler.ts
```

Endpoints (disabled by default):
```
GET    /hazelcast/rest/maps/{name}/{key}       → 200 + JSON value | 204 No Content if key absent
POST   /hazelcast/rest/maps/{name}/{key}       → body: JSON value → 200 OK
DELETE /hazelcast/rest/maps/{name}/{key}       → 200 OK
GET    /hazelcast/rest/queues/{name}/size      → {"size": 0}
POST   /hazelcast/rest/queues/{name}           → body: JSON value → 200 OK | 503 if queue full
GET    /hazelcast/rest/queues/{name}/{timeout} → poll (timeout in seconds) → 200 + value | 204 on timeout
```

All values are JSON-serialized (`JSON.stringify`/`JSON.parse`). Keys are always strings
(the URL path segment). Map names and queue names are looked up via `instance.getMap(name)` /
`instance.getQueue(name)`.

**DONE — Block 11.5**:
- [x] Implement `DataHandler` with all map + queue endpoints above
- [x] Map GET: returns 204 (no body) when key is absent
- [x] Queue offer: returns 503 when `offer()` returns false (bounded queue full)
- [x] Queue poll: pass `timeout * 1000` ms to `queue.poll()`; returns 204 on timeout
- [x] Tests: map CRUD round-trip; 204 on absent key; 403 when DATA group disabled; queue offer/poll/size; queue poll timeout returns 204; 503 on full bounded queue
- [x] GREEN
- [x] `git commit -m "feat(rest): DATA handler (IMap CRUD + IQueue ops) — 10 tests green"`

---

### Block 11.6 — app/ migration + e2e REST acceptance (~8 tests)

> ℹ️ Cross-ref: `HELIOS_BLITZ_IMPLEMENTATION.md` → Issue 9 (why delegation is wrong; clean delete + configure approach)

**Delete `app/src/http-server.ts`** entirely. `HeliosRestServer` — which starts automatically
inside `HeliosInstanceImpl` when `restApiConfig.isEnabledAndNotEmpty()` — replaces it for
all `/hazelcast/*` paths. No proxy. No delegation. No two HTTP listeners.

**`app/src/app.ts` changes:**
- Remove the `Bun.serve()` block (previously handled `/hazelcast/*` and `/map/*`)
- Configure `RestApiConfig` on the instance: `setEnabled(true)`, `enableGroups(HEALTH_CHECK, CLUSTER_READ, DATA)`
- Add `--rest-port` CLI flag → `restApiConfig.setPort(port)` (default 8080)
- Add `--rest-groups` CLI flag (comma-separated group names) → `restApiConfig.enableGroups(...)`
- REST server starts automatically with the instance — no manual wiring

**Demo-specific routes removed:**
- `/map/:name/query` (predicate DSL) — demo-only, removed; predicate query is covered by unit tests
- `/near-cache/:name/stats` — removed; `/hazelcast/health` provides instance health

**`app/demo.sh` updated:**
- `curl .../hazelcast/health/ready` (health check)
- `curl .../hazelcast/rest/maps/{name}/{key}` (data ops)
- `curl .../hazelcast/rest/cluster` (cluster info)

**DONE — Block 11.6** ✅ (8 tests green):
- [x] Delete `app/src/http-server.ts`
- [x] Update `app/src/app.ts`: remove `Bun.serve()` block; add `--rest-port` + `--rest-groups` CLI flags; configure `RestApiConfig` on the instance
- [x] Update `app/demo.sh` to use `/hazelcast/rest/` and `/hazelcast/health/` paths
- [x] Update `app/test/distributed-nearcache.test.ts` to use `/hazelcast/` endpoints where applicable
- [x] Add e2e acceptance test: `Helios.newInstance()` with `restApiConfig.setEnabled(true).enableAllGroups()` → `fetch` each group endpoint → assert correct JSON responses → `instance.shutdown()` → assert bound port closed
- [x] `bun test` in `app/` → all tests green
- [x] `git commit -m "feat(rest): e2e REST acceptance + app/ migration — delete http-server.ts, all tests green"`

---

**Phase 11 done gate**: Built-in REST API is a first-class feature of `@helios/core`:
- `HeliosRestServer` (`Bun.serve()`) starts and stops with the `HeliosInstance` lifecycle
- All 4 endpoint groups implemented and access-gated by `RestApiConfig`
- Kubernetes health probes work out of the box via `/hazelcast/health/ready`
- `DATA` group provides curl-level access to IMap and IQueue
- `CLUSTER_WRITE` enables log-level tuning and graceful member shutdown without a client
- `app/src/http-server.ts` deleted — demo uses `HeliosRestServer` exclusively for `/hazelcast/*`
- TLS and auth-token support deferred to v2 (via `Bun.serve({ tls })`)
- ~56 new tests green

---

## Phase 12 — MapStore SPI + Extension Packages (S3, MongoDB, Turso)

Goal: Add MapStore/MapLoader runtime support to Helios core, then build three backend
extension packages (`packages/s3/`, `packages/mongodb/`, `packages/turso/`). This enables
IMap to persist data to external stores (write-through or write-behind) and load-on-miss.

**Full plan:** See `plans/MAPSTORE_EXTENSION_PLAN.md` for complete implementation details.

Depends on: Phase 8 (near-cache wiring complete), Phase 7.4 (full IMap interface).

### Block Overview

| Block | What | New Tests |
|-------|------|-----------|
| **Block 12.A1** | `MapStoreConfig` (with `_factoryImplementation` + `_implementation`, mutually exclusive), `MapStoreFactory`, `MapLoader`, `MapStore`, `MapLoaderLifecycleSupport`, `MapDataStore`, `EmptyMapDataStore`, `MapStoreWrapper`, `LoadOnlyMapDataStore`, `DelayedEntry` | ~22 |
| **Block 12.A2** | `WriteThroughStore`, `CoalescedWriteBehindQueue`, `ArrayWriteBehindQueue`, `WriteBehindProcessor` (batch + retry), `StoreWorker` (background timer), `WriteBehindStore`, `MapStoreContext` (factory-first resolution: factory > impl) | ~37 |
| **Block 12.A3** | IMap async migration (11 methods → `Promise`), migration script, `MapProxy` wiring, `NearCachedIMapWrapper` + `NetworkedMapProxy` update, `MapContainerService` store lifecycle, integration tests | ~12 new + all existing green |
| **Block 12.B** | `packages/s3/` — `S3MapStore` + `S3MapStore.factory()` using `@aws-sdk/client-s3` | ~14 |
| **Block 12.C** | `packages/mongodb/` — `MongoMapStore` + `MongoMapStore.factory()` using `mongodb` driver | ~14 |
| **Block 12.D** | `packages/turso/` — `TursoMapStore` + `TursoMapStore.factory()` using `@libsql/client` (in-memory SQLite tests) | ~18 |

Blocks A1 → A2 → A3 are strictly sequential. Blocks B/C/D are independent of each other (all require only A3 complete).

### Key Design Decisions

- **IMap methods become async** (`put()` → `Promise<V | null>`): Required for write-through persistence. RecordStore stays sync.
- **MapDataStore operates on deserialized K,V**: No Data-object layer for store calls.
- **`MapStoreFactory` — the canonical multi-map integration path** (mirrors Java's `MapStoreFactory<K,V>`): A factory produces a distinct, per-map-name store instance from shared connection config (e.g. one S3 prefix per map, one Mongo collection per map, one SQLite table per map). Set via `MapStoreConfig.setFactoryImplementation(factory)`. Takes priority over `setImplementation()` in `MapStoreContext.create()`. The two fields (`_factoryImplementation` / `_implementation`) are mutually exclusive: setting one clears the other. Every extension package exposes `XxxMapStore.factory(baseConfig)` as its primary wiring API.
- **Two integration paths per extension package**: `setImplementation(new S3MapStore(config))` for single-map wiring with full manual control; `setFactoryImplementation(S3MapStore.factory(baseConfig))` for multi-map wiring where the factory scopes each store instance by map name.
- **Write-behind uses `setInterval(1000)`**: StoreWorker drains queue every 1 second.
- **Coalescing queue**: `Map<string, DelayedEntry>` — latest write per key wins.
- **Retry policy**: 3 retries with 1s delay, then fall back to single-entry stores.
- **Extension packages depend only on public interfaces**, not internal classes.

---

## Phase 13 — Infrastructure Fixes & Test Hygiene

> **Cross-ref:** No external plan file — these are purely infrastructure fixes identified during Phase 10-12 completion.
> **Goal:** Fix two remaining infrastructure issues blocking clean `bun test` runs.

### Block 13.1 — Fix `packages/blitz` missing `reflect-metadata` devDependency

**Goal:** Add `reflect-metadata` to `packages/blitz/package.json` devDependencies so `bun test` inside the package works without `preload not found` error.

**Steps:**
1. Add `"reflect-metadata": "^0.2.0"` to `devDependencies` in `packages/blitz/package.json`
2. Run `bun install` from root
3. Run `cd packages/blitz && bun test` — verify 0 errors

**Gate:**
```bash
cd /Users/zenystx/IdeaProjects/helios/packages/blitz && bun test
```

**GATE-CHECK:** `block=13.1 required=0 passed=0 labels=infrastructure-fix`

### Block 13.2 — Fix `PacketDispatcherTest` spurious error in workspace root

**Goal:** Suppress `CheckpointManager` log leak from blitz fault-tolerance tests that causes spurious `1 fail / 1 error` in root `bun test` output.

**Steps:**
1. Identify the source of log leak in `packages/blitz/test/fault/FaultToleranceTest.test.ts` or related fault tests
2. Mock or suppress `CheckpointManager` console output during tests
3. Run `bun test` at root — verify `0 fail 0 error`

**Gate:**
```bash
cd /Users/zenystx/IdeaProjects/helios && bun test
```

**GATE-CHECK:** `block=13.2 required=0 passed=0 labels=test-hygiene`

---

## Phase 14 — Blitz Embedded NATS Server

> **Cross-ref:** `plans/BLITZ_EMBEDDED_NATS_PLAN.md` — read it before executing any Block 14.X.
> **Goal:** Embed a NATS JetStream server natively inside `@helios/blitz` so that users never need to provision or manage an external NATS process. `BlitzService.start()` owns the full server lifecycle — binary resolution, spawn, health-poll, cluster formation, and shutdown — with zero user configuration required for single-node use and a concise options object for production cluster use.

### Block 14.1 — `package.json` + `NatsServerBinaryResolver`

**Goal:** Promote `nats-server` from devDependency to dependency and implement binary resolution chain.

**Steps:**
1. Move `nats-server` from `devDependencies` → `dependencies` in `packages/blitz/package.json`
2. Create `src/server/NatsServerBinaryResolver.ts` with resolution chain: explicit override → npm package → system PATH → error
3. Create `NatsServerNotFoundError` with actionable install instructions
4. Create `test/server/NatsServerManagerTest.test.ts` — binary resolver tests

**Gate:**
```bash
cd /Users/zenystx/IdeaProjects/helios/packages/blitz && bun test --pattern 'NatsServerBinaryResolver|NatsServerManagerTest'
```

**GATE-CHECK:** `block=14.1 required=10 passed=10 labels=nats-binary-resolver,nats-server-embedding`

### Block 14.2 — `NatsServerConfig` + `NatsServerManager`

**Goal:** Implement internal config and server lifecycle manager.

**Steps:**
1. Create `src/server/NatsServerConfig.ts` with `NatsServerNodeConfig` interface
2. Create `src/server/NatsServerManager.ts` with `spawn()`, `shutdown()`, `_buildArgs()`, `_waitUntilReady()`
3. Add tests: spawn single node, spawn cluster, shutdown kills processes, health-poll timeout

**Gate:**
```bash
cd /Users/zenystx/IdeaProjects/helios/packages/blitz && bun test --pattern 'NatsServerManager|NatsServerConfig'
```

**GATE-CHECK:** `block=14.2 required=20 passed=20 labels=nats-server-manager,nats-server-config`

### Block 14.3 — `BlitzConfig` Extensions

**Goal:** Add typed config interfaces for embedded NATS mode.

**Steps:**
1. Add `EmbeddedNatsConfig` interface to `src/BlitzConfig.ts` (port, dataDir, binaryPath, startTimeoutMs, extraArgs)
2. Add `NatsClusterConfig` interface (nodes, name, basePort, baseClusterPort, dataDir, binaryPath, startTimeoutMs)
3. Update `BlitzConfig` with `embedded` and `cluster` optional fields (mutually exclusive with `servers`)
4. Add mutual-exclusivity validation in `resolveBlitzConfig()`
5. Add tests: config validation, mutual exclusivity, defaults

**Gate:**
```bash
cd /Users/zenystx/IdeaProjects/helios/packages/blitz && bun test --pattern 'BlitzConfig|EmbeddedNatsConfig|NatsClusterConfig'
```

**GATE-CHECK:** `block=14.3 required=15 passed=15 labels=blitz-config,embedded-nats-config`

### Block 14.4 — `BlitzService.start()` + `shutdown()` extension

**Goal:** Implement static factory method and extend shutdown to kill embedded processes.

**Steps:**
1. Add `private _manager: NatsServerManager | null = null` field to `BlitzService`
2. Implement `static async start(config?: BlitzConfig): Promise<BlitzService>` factory method
3. Extend `shutdown()` to call `this._manager?.shutdown()` after `nc.drain()`
4. Implement internal `buildNodeConfigs()` helper to translate config to node configs
5. Add tests: start no-config, start embedded custom port, start cluster, shutdown kills process

**Gate:**
```bash
cd /Users/zenystx/IdeaProjects/helios/packages/blitz && bun test --pattern 'BlitzService.start|BlitzService.start'
```

**GATE-CHECK:** `block=14.4 required=15 passed=15 labels=blitz-service-start,embedded-server-lifecycle`

### Block 14.5 — Remove `skipIf` Guards from Integration Test Files

**Goal:** Update all 4 blitz integration test files to use embedded NATS server, removing `describe.skipIf(!NATS_AVAILABLE)` guards.

**Steps:**
1. Update `test/BlitzServiceTest.test.ts` — use `BlitzService.start()` in `beforeAll`, remove `skipIf`
2. Update `test/PipelineTest.test.ts` — same pattern
3. Update `test/SourceSinkTest.test.ts` — same pattern
4. Update `test/WindowingTest.test.ts` — same pattern
5. Verify `bun test packages/blitz/test/` — **0 skip, 0 fail**

**Gate:**
```bash
cd /Users/zenystx/IdeaProjects/helios/packages/blitz && bun test
```

**GATE-CHECK:** `block=14.5 required=0 passed=0 labels=test-hygiene,skipif-removal`

---

## Phase 15 — Production SerializationServiceImpl

> Cross-ref: `plans/SERIALIZATION_SERVICE_IMPL_PLAN.md` (reviewed in `plans/SERIALIZATION_SERVICE_IMPL_PLAN_REVIEW.md`)
> **Status of HeliosInstanceImpl:** `src/instance/impl/HeliosInstanceImpl.ts` lines 111 + 119 still use `new TestSerializationService()` with a TODO comment ("Block 7.2+"). `SerializationServiceImpl.ts` does not exist in the codebase. All 14 review issues (B1–B4, K1–K8, W2–W5) have been resolved in the final plan spec; the implementation plan already incorporates all fixes.

### Block 15.1 — Core infrastructure: error type + interfaces + config + buffer pool

**Goal:** Lay the foundation types that all serializers depend on.

**Steps:**
1. Create `src/internal/serialization/impl/HazelcastSerializationError.ts` — custom error class with `name` + optional `cause`
2. Create `src/internal/serialization/impl/SerializerAdapter.ts` — `interface SerializerAdapter { getTypeId(): number; write(out, obj): void; read(inp): unknown; }`
3. Create `src/internal/serialization/impl/DataSerializerHook.ts` — `interface DataSerializerHook { getFactoryId(): number; createFactory(): DataSerializableFactory; }`
4. Create `src/internal/serialization/impl/SerializationConfig.ts` — `class SerializationConfig { byteOrder: ByteOrder = BIG_ENDIAN; dataSerializableFactories: Map<number, DataSerializableFactory> = new Map(); dataSerializerHooks: DataSerializerHook[] = []; }`
5. Create `src/internal/serialization/impl/bufferpool/BufferPool.ts` — simple free-list (max 3 items), `takeOutputBuffer()` / `returnOutputBuffer()` / `takeInputBuffer(data)` / `returnInputBuffer(inp)`
6. Write tests: `test/internal/serialization/impl/BufferPoolTest.test.ts` — pool reuse, max-3 limit, clear-on-return

**Gate:**
```bash
cd /Users/zenystx/IdeaProjects/helios && bun test test/internal/serialization/impl/BufferPoolTest.test.ts
```

**GATE-CHECK:** `block=15.1 required=6 passed=6 labels=BufferPoolTest`

---

### Block 15.2 — Primitive + array serializers (all 21 built-in types)

**Goal:** Implement all constant-type serializers. Each is a `const` object literal (no class, no instance state).

**Steps:**
1. Create `src/internal/serialization/impl/serializers/NullSerializer.ts` — typeId 0, write nothing, read returns null
2. Create `src/internal/serialization/impl/serializers/BooleanSerializer.ts` — typeId -4
3. Create `src/internal/serialization/impl/serializers/ByteSerializer.ts` — typeId -3
4. Create `src/internal/serialization/impl/serializers/CharSerializer.ts` — typeId -5, `number` (UTF-16 code unit)
5. Create `src/internal/serialization/impl/serializers/ShortSerializer.ts` — typeId -6
6. Create `src/internal/serialization/impl/serializers/IntegerSerializer.ts` — typeId -7
7. Create `src/internal/serialization/impl/serializers/LongSerializer.ts` — typeId -8, `write()` coerces `number` to `bigint` via `BigInt(obj)`
8. Create `src/internal/serialization/impl/serializers/FloatSerializer.ts` — typeId -9
9. Create `src/internal/serialization/impl/serializers/DoubleSerializer.ts` — typeId -10
10. Create `src/internal/serialization/impl/serializers/StringSerializer.ts` — typeId -11
11. Create `src/internal/serialization/impl/serializers/ByteArraySerializer.ts` — typeId -12
12. Create `src/internal/serialization/impl/serializers/BooleanArraySerializer.ts` — typeId -13
13. Create `src/internal/serialization/impl/serializers/CharArraySerializer.ts` — typeId -14, `number[]`
14. Create `src/internal/serialization/impl/serializers/ShortArraySerializer.ts` — typeId -15
15. Create `src/internal/serialization/impl/serializers/IntegerArraySerializer.ts` — typeId -16
16. Create `src/internal/serialization/impl/serializers/LongArraySerializer.ts` — typeId -17
17. Create `src/internal/serialization/impl/serializers/FloatArraySerializer.ts` — typeId -18
18. Create `src/internal/serialization/impl/serializers/DoubleArraySerializer.ts` — typeId -19
19. Create `src/internal/serialization/impl/serializers/StringArraySerializer.ts` — typeId -20
20. Create `src/internal/serialization/impl/serializers/UuidSerializer.ts` — typeId -21, uses stream byte order (no hardcoded BIG_ENDIAN)
21. Create `src/internal/serialization/impl/serializers/JavaScriptJsonSerializer.ts` — typeId -130, always writes `[4-byte length][UTF-8 JSON]` (self-framing; migration from TestSerializationService is a documented breaking change)
22. Write tests: `test/internal/serialization/impl/SerializerPrimitivesTest.test.ts` — round-trip for every serializer via `ByteArrayObjectDataOutput` / `ByteArrayObjectDataInput`

**Gate:**
```bash
cd /Users/zenystx/IdeaProjects/helios && bun test test/internal/serialization/impl/SerializerPrimitivesTest.test.ts
```

**GATE-CHECK:** `block=15.2 required=21 passed=21 labels=SerializerPrimitivesTest`

---

### Block 15.3 — DataSerializableSerializer (IdentifiedDataSerializable dispatch)

**Goal:** Implement `DataSerializableSerializer` (typeId -2) with full read/write wire format including EE version byte skipping.

**Steps:**
1. Create `src/internal/serialization/impl/serializers/DataSerializableSerializer.ts`:
   - Write: `writeByte(DataSerializableHeader.createHeader(true, false))` then `writeInt(factoryId)`, `writeInt(classId)`, `obj.writeData(out)`
   - Read: read 1-byte header → check `isIdentifiedDataSerializable()`; if not, throw `HazelcastSerializationError`; check `isVersioned(header)` → if true, skip 2 bytes (`inp.readByte(); inp.readByte()`); look up factory by factoryId, create instance by classId, call `obj.readData(inp)`
   - Internal `registerFactory(factoryId, factory)` method
2. Write tests: `test/internal/serialization/impl/DataSerializableSerializerTest.test.ts` — round-trip via mock factory, non-IDS header throws, unknown factoryId throws, unknown classId throws, EE version bytes (bit1=1) are skipped correctly

**Gate:**
```bash
cd /Users/zenystx/IdeaProjects/helios && bun test test/internal/serialization/impl/DataSerializableSerializerTest.test.ts
```

**GATE-CHECK:** `block=15.3 required=6 passed=6 labels=DataSerializableSerializerTest`

---

### Block 15.4 — SerializationServiceImpl + dispatch logic + error handling

**Goal:** Implement the main `SerializationServiceImpl` class satisfying `InternalSerializationService`, wiring all serializers via `constantSerializers[]` + `specialSerializers` Map.

**Steps:**
1. Create `src/internal/serialization/impl/SerializationServiceImpl.ts`:
   - Constructor: build `constantSerializers` array (size 57, indexed by `-typeId`), populate `specialSerializers` Map (typeId -130), register factories from `config.dataSerializableFactories` and `config.dataSerializerHooks`
   - `serializerFor(obj)` dispatch chain (order matters — matches Java priority):
     1. `null`/`undefined` → NullSerializer
     2. `obj instanceof HeapData` → throw
     3. `typeof obj === 'number'`: `Object.is(obj, -0)` → DoubleSerializer; `Number.isInteger(obj)` + fits int32 → IntegerSerializer; else → LongSerializer (bigint coercion in write); else → DoubleSerializer
     4. `typeof obj === 'bigint'` → LongSerializer
     5. `typeof obj === 'boolean'` → BooleanSerializer
     6. `typeof obj === 'string'` → StringSerializer
      7. `Buffer.isBuffer(obj)` → ByteArraySerializer
         (**N8 FIX — CRITICAL:** use `Buffer.isBuffer()`, NOT `instanceof Uint8Array`.
          `ByteArraySerializer.write()` calls `writeByteArray()` which calls `Buffer.copy()`.
          `Buffer.copy()` does NOT exist on plain `Uint8Array` — only on Node.js/Bun Buffer.
          A plain Uint8Array passes `instanceof Uint8Array` but crashes with
          `TypeError: src.copy is not a function` at runtime. `Buffer.isBuffer()` correctly
          returns false for plain Uint8Array, routing it to JavaScriptJsonSerializer instead.
          This mirrors the N8 fix already specified in SERIALIZATION_SERVICE_IMPL_PLAN.md.)
      8. duck-type `getFactoryId()/getClassId()` → DataSerializableSerializer (**before** Array check)
     9. `Array.isArray(obj)`: empty/null-element → JsonSerializer; all boolean → BooleanArraySerializer; all bigint → LongArraySerializer; all int32 → IntegerArraySerializer; all float → DoubleArraySerializer; all string → StringArraySerializer; else → JsonSerializer
     10. Fallback → JavaScriptJsonSerializer
   - `serializerForTypeId(typeId)`: array lookup + specialSerializers + customSerializers, throw `HazelcastSerializationError` with typeId if not found
   - `toData(obj)`: use BufferPool, write partitionHash=0, typeId, payload → new HeapData
   - `toObject(data)`: use BufferPool, dispatch via typeId, return deserialized value
   - `writeObject(out, obj)`: write typeId then payload (no partitionHash — embedded object)
   - `readObject(inp)`: read typeId, dispatch, return value
   - `getClassLoader()`: return null
2. Write tests: `test/internal/serialization/impl/SerializationServiceImplTest.test.ts` — `toData`/`toObject` round-trips for all primitive types + arrays + UUID + null + HeapData pass-through + error cases (unknown typeId, `writeObject(HeapData)`)
3. Write tests: `test/internal/serialization/impl/WriteReadObjectTest.test.ts` — `writeObject`/`readObject` round-trips for all serializable types embedded in a stream

**Gate:**
```bash
cd /Users/zenystx/IdeaProjects/helios && bun test test/internal/serialization/impl/
```

**GATE-CHECK:** `block=15.4 required=20 passed=20 labels=SerializationServiceImplTest,WriteReadObjectTest`

---

### Block 15.5 — Wire SerializationServiceImpl into HeliosInstanceImpl + full regression

**Goal:** Replace `TestSerializationService` in `HeliosInstanceImpl` with a shared `SerializationServiceImpl` instance. Verify all existing tests still pass.

**Steps:**
1. Update `src/instance/impl/HeliosInstanceImpl.ts`:
   - Import `SerializationServiceImpl`, `SerializationConfig` (remove `TestSerializationService` import)
   - In constructor: `const serializationConfig = new SerializationConfig(); const ss = new SerializationServiceImpl(serializationConfig);`
   - Replace `new NodeEngineImpl(new TestSerializationService())` → `new NodeEngineImpl(ss)`
   - Replace `new DefaultNearCacheManager(new TestSerializationService())` → `new DefaultNearCacheManager(ss)`
   - **Critical:** single shared instance for both (same factory registry)
   - **N19 FIX:** In `HeliosInstanceImpl.shutdown()`, add `ss.destroy()` call **after** `this._nodeEngine.shutdown()` and `this._nearCacheManager` cleanup. Without this call, the `BufferPool` inside `SerializationServiceImpl` is never drained — pooled `ByteArrayObjectDataOutput` buffers hold their internal `Buffer` allocations indefinitely even after the instance is shut down. Over many test runs or repeated instance creation/destruction cycles, this accumulates ~12 KB of orphaned pool buffers per dead instance. The `SerializationServiceImpl` instance (`ss`) must be stored as a field (e.g., `private readonly _ss: SerializationServiceImpl`) so `shutdown()` can call `this._ss.destroy()`.
2. Remove the TODO comment on lines 109–110 in `HeliosInstanceImpl.ts`
3. Run full test suite and confirm 0 fail, 0 error

**Gate:**
```bash
cd /Users/zenystx/IdeaProjects/helios && bun test
```

**GATE-CHECK:** `block=15.5 labels=full-regression criterion="exit-code=0, 0 fail, 0 error"`

> **N12 FIX:** The previous gate hardcoded `required=2845` which was incorrect — Phase 14
> adds ~60 tests and Phase 15 adds ~53 tests, making the expected total ~2958 by this block.
> Hardcoding a test count in a full-regression gate creates a false-green scenario: if new
> tests are added but some fail, the count still matches and the gate looks green. The gate
> criterion is `bun test` exits with code 0 (zero failures, zero errors). The worker agent
> must NOT hardcode a count — they must verify the exit code is 0.

---

## Cloud Discovery Replacement

The Java aws/azure/gcp/kubernetes packages (~61 source files total) use `HttpURLConnection`
for cloud metadata queries. We replace all of them with a typed `HeliosDiscovery` contract
plus provider adapters (`HeliosDiscovery.ts` + `DiscoveryProvider` implementations).

Implementation is split across Block 3.8 (provider adapters) and Block 3.9 (integration
contract): config model/parsers, typed resolver, and `ClusterJoinManager` wiring.
Bun's built-in `fetch()` still replaces all HTTP calls; no third-party discovery libs.

---

## Deferred to v2

### SQL (`hazelcast-sql/` — 706 source files)

The Hazelcast SQL engine is built on Apache Calcite — a 500,000+ line Java SQL planning
framework that includes: AST, type system, rule-based optimizer, cost-based optimizer,
and a distributed execution engine. Porting hazelcast-sql requires porting a significant
subset of Calcite first. This is a project in itself, not a block in this plan.

**v1 stub**:
```typescript
// src/sql/SqlService.ts
export class SqlService {
  execute(_sql: string): never {
    throw new Error("SQL not supported in Helios v1 — use Helios v2");
  }
}
```

**v2 plan**: Integrate a native TypeScript SQL library (e.g., a TS port of DuckDB's
query planner, or a purpose-built TS SQL engine). Do not port Calcite.

### Jet (`jet/` — 520 source files)

> **No longer deferred** — implemented in **Phase 10** as `@helios/blitz`, a NATS JetStream-backed
> stream and batch processing engine with ~80% Hazelcast Jet feature parity. We do not port
> the Java DAG engine line-by-line; instead we build a TypeScript-idiomatic pipeline API on
> top of NATS JetStream + KV Store. See Phase 10 for the full plan.
>
> The one Blitz sub-feature that remains deferred is **SQL-over-streams**, which depends on
> the SQL engine (`hazelcast-sql/`) and is still deferred to v2 with it.

### CP Subsystem (`cp/` — 66 source files)

Raft-based CP subsystem providing strong consistency guarantees (linearizable IAtomicLong,
IAtomicReference, FencedLock, ISemaphore, ICountDownLatch). Correct Raft implementation
is non-trivial. Defer to v2.

### Scheduled Executor (`scheduledexecutor/` — 66 source files)

Distributed scheduled executor with durable scheduling (survives node failures). Defer to v2.

---

## Master Todo List

### Phase 0 — Tooling ✅
- [x] Project scaffolding (package.json, tsconfig.json, bunfig.toml)
- [x] `scripts/convert-java-tests.ts` converter
- [x] Bun + NestJS deps installed
- [x] `typescript@beta` (TS 6.0) pinned
- [x] tsconfig pre-aligned with TS 6.0

### Phase 1 — Pure Logic (~261 tests, all parallelizable)
- [x] **Block 1.1** — internal/util — 90 tests ✅
- [x] **Block 1.2** — internal/json — 380 tests ✅
- [x] **Block 1.3** — version — 64 tests ✅
- [x] **Block 1.4** — aggregation — 90 tests ✅
- [x] **Block 1.5** — cardinality — 19 tests ✅
- [x] **Block 1.6** — query — 61 tests ✅
- [x] **Block 1.7** — config — 72 tests ✅
- [x] **Block 1.8** — ringbuffer pure — ~9 tests
- [x] **Block 1.9** — near cache compile-time contracts (`nearcache/NearCacheStats` + monitoring contracts) — ~0 tests
- [x] **Phase 1 checkpoint**: ~776 tests green ✅

### Phase 2 — Serialization & I/O (~90 tests, sequential)
- [x] **Block 2.0** — runtime-safe `TimeSource`/`Clock` abstraction (Temporal + fallback) — 14 tests ✅
- [x] **Block 2.1** — internal/serialization — 134 tests ✅
- [x] **Block 2.2** — internal/nio — 26 tests ✅
- [x] **Block 2.3** — internal/networking — 23 tests ✅
- [x] **Block 2.4** — Eventloop.ts (Bun wrapper) — 9 tests ✅
- [x] **Phase 2 checkpoint**: ~206 tests green ✅

### Phase 3 — Single-Node Core (~740 tests)
- [x] **Block 3.0** — test-support stubs (TestNodeEngine, TestPartitionService, TestHeliosInstance) ✅
- [x] **Block 3.1** — spi — 65 tests ✅
- [x] **Block 3.2a** — map core RecordStore/CRUD — 21 tests ✅
- [x] **Block 3.2b** — map advanced ops + entry processors + putAll/getAll — 32 tests ✅
- [x] **Block 3.2c** — map query integration + MapQueryEngine wiring — 24 tests ✅
- [x] **Block 3.3** — collections (topic + collection + multimap) — 149 tests ✅
- [x] **Block 3.4** — ringbuffer full — 42 tests ✅
- [x] **Block 3.5** — cache — 51 tests ✅
- [x] **Block 3.6** — transaction — 44 tests ✅
- [x] **Block 3.7** — security — 57 tests ✅
- [x] **Block 3.8** — HeliosDiscovery — 15 tests green
- [x] **Block 3.9** — HeliosDiscovery integration contract (typed interface + join/config wiring) — 12 tests ✅
- [x] **Block 3.10** — instance/core lifecycle — 40 tests ✅
- [x] **Block 3.11** — client core foundations (pre-cluster, TestHeliosInstance) — 25 tests ✅
- [x] **Block 3.12a** — internal/nearcache storage/runtime core — 65 tests ✅
- [x] **Block 3.12b** — shared near-cache invalidation+repair primitives — 43 tests ✅
- [x] **Block 3.13a** — near-cache server local integration — 39 tests ✅
- [x] **Phase 3 checkpoint**: ~740 tests green (all blocks complete) ✅

### Phase 4 — Cluster Layer (~142 tests)
- [x] **Block 4.0** — TestClusterRegistry — 21 tests ✅
- [x] **Block 4.1** — internal/cluster + cluster — 94 tests ✅
- [x] **Block 4.2** — internal/partition — 58 tests ✅
- [x] **Block 4.3** — replicatedmap — 46 tests ✅
- [x] **Block 4.4** — near-cache migration metadata + metadata fetch surfaces — ~13 tests ⭐ primary goal ✅
- [x] **Phase 4 checkpoint**: ~232 tests green ✅

### Phase 5 — Client Near-Cache Reconciliation (~85 tests)
- [x] **Block 5.0** — protocol transport for near-cache invalidation/reconciliation + metadata tasks — 52 tests ✅
- [x] **Block 5.1** — near-cached client proxies + listener lifecycle + metrics wiring — 34 tests ✅
- [x] **Block 5.2** — client anti-entropy integration + stale-read repair hardening — 10 tests ✅
- [x] **Block 5.3** — end-to-end near-cache production flow acceptance (miss→hit→remote write invalidation→re-fetch) — 9 tests ⭐ primary goal ✅
- [x] **Phase 5 checkpoint**: ~105 tests green + Production Proof Gate green ✅

### Phase 6 — NestJS Integration (~141 tests)
- [x] **Block 6.1** — HeliosModule core — 16 tests ✅
- [x] **Block 6.2** — HeliosCacheModule — 17 tests ✅
- [x] **Block 6.3** — HeliosTransactionModule — 17 tests ✅
- [x] **Block 6.4** — Boot 4 autoconfiguration — 11 tests ✅
- [x] **Block 6.5** — NestJS integration tests — 80 tests ✅
- [x] **Phase 6 checkpoint**: 141 tests green ✅

### Phase 7 — Instance Facade Wiring + Example App + Production Hardening
- [x] **Block 7.0** — Wire data structures into TestHeliosInstance facade + example app — 27 tests ✅
- [x] **Block 7.1** — Production HeliosInstanceImpl with service registry wiring — 30 tests ✅
- [x] **Block 7.2** — Helios.newInstance() factory + config-driven bootstrap — 27 tests ✅
- [x] **Block 7.3** — HeliosInstance interface expansion (getMap, getQueue, getTopic, getList, getSet, getMultiMap, getReplicatedMap) — 27 tests ✅
- [x] **Block 7.4** — SimpleMapProxy → IMap interface promotion (typed distributed map with full IMap contract) — 47 tests ✅
- [x] **Block 7.5** — Multi-node TCP integration test (2+ real instances, real Bun.listen/connect) — 6 tests ✅
- [x] **Block 7.6** — Near-cache production proof soak/stress suite (per Production Proof Gate thresholds) — 12 tests ✅
- [x] **Block 7.7** — CLI entrypoint + standalone server mode (bun run helios-server.ts) — 36 tests ✅
- [x] **Block 7.8** — npm package structure + build + publish pipeline — 40 tests ✅
- [x] **Phase 7 checkpoint**: production-deployable Helios v1.0

### Phase 8 — Near-Cache ↔ TCP Invalidation Wiring
- [x] **Block 8.1** — Wire near-cache into HeliosInstanceImpl.getMap() + TCP invalidation path — 10 tests ✅
- [x] **Block 8.2** — Fix HeliosServer.getBoundPort() bug (_tcp → _transport) ✅
- [x] **Phase 8 checkpoint**: 2,105 tests green, getMap() returns near-cache-wrapped proxy when configured, TCP invalidation evicts near-cache entries ✅

### app/ — Distributed Demo Application
- [x] **Scaffolding** — package.json, tsconfig.json (path alias @helios/*), bunfig.toml ✅
- [x] **HTTP REST server** (`app/src/http-server.ts`) — Bun.serve() with map CRUD, near-cache stats, health, cluster info endpoints ✅
- [x] **Predicate query endpoints** — POST /map/:name/query (JSON DSL), GET /map/:name/values?..., GET /map/:name/keys?... ✅
- [x] **Main app entry** (`app/src/app.ts`) — CLI with --name, --tcp-port, --http-port, --peer flags ✅
- [x] **MapProxy._makeEntry() enhancement** — nested object property access for predicates (e.g., "age", "address.city") ✅
- [x] **Route matching order fix** — predicate routes (query/values/keys) checked before generic /map/:name/:key ✅
- [x] **Integration test suite** — 25 tests (13 near-cache + 12 predicate queries) ✅
- [x] **Demo script** (`app/demo.sh`) — curl-based demo with near-cache + predicate query examples ✅
- [x] **app checkpoint**: 25 tests green, 2,105 core tests still green ✅

### Phase 9 — `@helios/nestjs` Package Extraction + Modern NestJS Library Patterns
- [x] **Block 9.0** — Package extraction: Bun workspace, @helios/core rename, @helios/nestjs extraction — 168 tests ✅ (2157 core + 168 nestjs)
- [x] **Block 9.1** — `ConfigurableModuleBuilder` for HeliosModule (`forRoot` + `forRootAsync` with `useClass`/`useExisting`/`useFactory`) — 10 tests ✅
- [x] **Block 9.2** — `@InjectHelios()`, `@InjectMap()`, `@InjectQueue()`, `@InjectTopic()` convenience decorators — 17 tests ✅
- [x] **Block 9.3** — `registerAsync` for HeliosCacheModule + HeliosTransactionModule — 13 tests ✅
- [x] **Block 9.4** — DI-based `@Transactional` resolution (remove static singleton) — 7 tests ✅
- [x] **Block 9.5** — `HeliosHealthIndicator` for `@nestjs/terminus` — 8 tests ✅
- [x] **Block 9.6** — `@Cacheable` / `@CacheEvict` / `@CachePut` method decorators — 15 tests ✅
- [x] **Block 9.7** — Event bridge for `@nestjs/event-emitter` (map/topic/lifecycle) — 11 tests ✅
- [x] **Block 9.8** — Symbol-based injection tokens + `OnModuleDestroy` lifecycle hooks — 9 tests ✅
- [x] **Block 9.9** — Subpath exports, package structure tests, build + publish verification — 57 tests ✅
- [x] **Phase 9 checkpoint**: `@helios/nestjs` v1.0 — state-of-the-art NestJS library (~80 new tests) ✅

### Phase 10 — Helios Blitz: NATS-Backed Stream & Batch Processing Engine (~295 tests)
- [x] **Block 10.0** — Package scaffold (`packages/blitz/`) + BlitzService NATS connection lifecycle — 31 tests green (11 skipped/integration) ✅
- [x] **Block 10.1** — Pipeline / DAG builder API (Vertex, Edge, submit, cancel, DAG validation) — 22 tests green (7 skipped/integration) ✅
- [x] **Block 10.2** — Sources + sinks (NatsSource, NatsSink, HeliosMapSource/Sink, HeliosTopicSource/Sink, FileSource/Sink, HttpWebhookSource, LogSink) — 32 tests green (3 skipped/integration) ✅
- [x] **Block 10.3** — Stream operators (map, filter, flatMap, merge, branch, peek) — 28 tests green ✅
- [x] **Block 10.4** — Windowing engine (tumbling, sliding, session) + NATS KV state — 32 tests green (5 skipped/NATS-integration) ✅
- [x] **Block 10.5** — Stateful aggregations (count, sum, min, max, avg, distinct) + grouped aggregation + combiner — 34 tests green ✅
- [x] **Block 10.6** — Stream joins (hash join stream-table, windowed stream-stream join) — 25 tests green ✅
- [x] **Block 10.7** — Fault tolerance (AckPolicy, RetryPolicy, DeadLetterSink, CheckpointManager, FaultHandler) — 44 tests green ✅
- [x] **Block 10.8** — Batch processing mode (BatchPipeline, EndOfStreamDetector, BatchResult) — 20 tests green ✅
- [x] **Block 10.9** — NestJS module (`HeliosBlitzModule`, `HeliosBlitzService`, `@InjectBlitz()`) — 27 tests green ✅
- [x] **Block 10.10** — E2E acceptance + feature parity gate (10 scenarios, publish dry-run) — 33 tests green ✅
- [x] **Phase 10 checkpoint**: `@helios/blitz` v1.0 — NATS-backed stream & batch engine, ~80% Hazelcast Jet parity, 328 tests green ✅

### Phase 11 — Built-in REST API (~56 tests)
- [x] **Block 11.1** — `RestApiConfig` upgrade (port, groups, timeout, fluent API) + `RestEndpointGroup` enum — 23 tests ✅
- [x] **Block 11.2** — `HeliosRestServer` (`Bun.serve()` lifecycle) + `RestApiFilter` (group gating) — 18 tests ✅
- [x] **Block 11.3** — `HealthCheckHandler` — `/hazelcast/health/*` endpoints (K8s probes, 503 on non-ACTIVE) — 9 tests ✅
- [x] **Block 11.4** — `ClusterReadHandler` + `ClusterWriteHandler` — cluster info, log level, member shutdown — 10 tests ✅
- [x] **Block 11.5** — `DataHandler` — IMap CRUD + IQueue ops over REST — 10 tests ✅
- [x] **Block 11.6** — `app/` migration + e2e REST acceptance (all 4 groups, real instance, fetch) — 8 tests ✅
- [x] **Phase 11 checkpoint**: REST API is a first-class `@helios/core` feature — K8s probes, data access, cluster ops via `curl` — ~56 tests green ✅

### Phase 12 — MapStore SPI + Extension Packages (~117 tests) ✅

> Implementation spec: `plans/MAPSTORE_EXTENSION_PLAN.md` — read it before executing any Block 12.X.

- [x] **Block 12.A1** — `MapStoreConfig` (add `_factoryImplementation` field + `setFactoryImplementation()`/`getFactoryImplementation()`; setting one clears the other — mutually exclusive with `_implementation`), `MapStoreFactory` interface (`newMapStore(mapName, properties)` — factory-first resolution, mirrors Java `MapStoreFactory`), `MapLoader`, `MapStore`, `MapLoaderLifecycleSupport`, `MapDataStore`, `EmptyMapDataStore`, `MapStoreWrapper`, `LoadOnlyMapDataStore`, `DelayedEntry` — 24 tests ✅
- [x] **Block 12.A2** — `WriteThroughStore`, `CoalescedWriteBehindQueue`, `ArrayWriteBehindQueue`, `WriteBehindProcessor` (batch + 3x retry + single-entry fallback), `StoreWorker` (setInterval, flush-on-shutdown), `WriteBehindStore`, `MapStoreContext` (factory-first impl resolution: `getFactoryImplementation().newMapStore()` > `getImplementation()`; lifecycle + EAGER initial load) — 46 tests ✅
- [x] **Block 12.A3** — IMap async migration: run `scripts/async-imap-codemod.ts --write`, update `IMap.ts` (11 methods → `Promise`), async `MapProxy`, lazy `MapDataStore` wiring, `NearCachedIMapWrapper` + `NetworkedMapProxy` signature update, `MapContainerService` store lifecycle, integration tests — all existing + 18 new green (2559 total)
- [x] **Block 12.B** — `packages/s3/` (`@helios/s3`): `S3MapStore` + `S3Config` + `S3MapStore.factory(baseConfig)` (factory scopes prefix by map name), mock-S3-client tests, factory tests (2), workspace wiring — 14 tests ✅
- [x] **Block 12.C** — `packages/mongodb/` (`@helios/mongodb`): `MongoMapStore` + `MongoConfig` + `MongoMapStore.factory(baseConfig)` (factory scopes collection by map name), mock-collection tests, factory tests (2), workspace wiring — 15 tests ✅
- [x] **Block 12.D** — `packages/turso/` (`@helios/turso`): `TursoMapStore` + `TursoConfig` + `TursoMapStore.factory(baseConfig)` (factory scopes tableName by map name), real in-memory SQLite tests (`:memory:`), factory tests (2), workspace wiring — 18 tests ✅
- [x] **Phase 12 checkpoint**: MapStore SPI in core + 3 extension packages — ~117 new tests green, all existing tests still green ✅

### Phase 13 — Infrastructure Fixes & Test Hygiene ✅

> **Why loop.sh skipped everything after Phase 12**: The Master Todo had zero `- [ ] **Block`
> entries remaining. The loop prompt (Step 1) scans only for `- [ ] **Block` lines in the
> Master Todo — it found none and had nothing to pick. All per-block detailed sub-checklists
> were left open (not ticked) but the loop never reads those, only the Master Todo entries.
> The per-block items are now ticked ✅ where the implementation provably exists. The two
> remaining real gaps below are the only genuinely incomplete work.

- [x] **Block 13.1** — Fix `packages/blitz` missing `reflect-metadata` devDependency (`bun test` inside package fails with `preload not found`) — 0 new tests (infrastructure fix)
- [x] **Block 13.2** — Fix `PacketDispatcherTest` spurious `1 fail / 1 error` in workspace root run caused by `CheckpointManager` log leak from blitz fault-tolerance tests — 0 new tests (test hygiene)
- [x] **Phase 13 checkpoint**: `bun test` at root shows `0 fail 0 error`; `bun test` inside `packages/blitz/` shows 27 NestJS tests green

### Phase 14 — Blitz Embedded NATS Server ← **CURRENT**

> Cross-ref: `plans/BLITZ_EMBEDDED_NATS_PLAN.md`
> Goal: Embed a NATS JetStream server natively inside `@helios/blitz` so that users never need
> to provision or manage an external NATS process. `BlitzService.start()` owns the full server
> lifecycle — binary resolution, spawn, health-poll, cluster formation, and shutdown.

- [x] **Block 14.1** — `package.json` change (`nats-server` dep → dependency) + `NatsServerBinaryResolver` (npm package → PATH → explicit override → error chain; N16 FIX: use `createRequire(import.meta.url)` not `require.resolve`; N6 FIX: `existsSync()` check after resolve) — 8 tests
- [ ] **Block 14.2** — `NatsServerConfig` (internal typed config) + `NatsServerManager` (spawn + health-poll + shutdown; N13 FIX: close probe connections in `_waitUntilReady` finally block; N14 FIX: poll `jsm.info()` for cluster JetStream readiness; N15 FIX: `shutdown()` is async, `await proc.exited`) — ~20 tests
- [ ] **Block 14.3** — `BlitzConfig` extensions (`EmbeddedNatsConfig`, `NatsClusterConfig` interfaces) + mutual-exclusivity validation + N7 FIX: port-overlap validation for cluster configs — ~15 tests
- [ ] **Block 14.4** — `BlitzService.start()` static factory + `shutdown()` extension (N15 FIX: `await this._manager?.shutdown()` — must await, not fire-and-forget) — ~15 tests
- [ ] **Block 14.5** — Remove `skipIf` guards from all 4 blitz integration test files (`BlitzServiceTest`, `PipelineTest`, `SourceSinkTest`, `WindowingTest`) — 0 new tests (test hygiene)
- [ ] **Phase 14 checkpoint**: `bun test packages/blitz/` — **0 skip, 0 fail** (currently: 26 skip)

### Phase 15 — Production SerializationServiceImpl

> Cross-ref: `plans/SERIALIZATION_SERVICE_IMPL_PLAN.md` (reviewed in `plans/SERIALIZATION_SERVICE_IMPL_PLAN_REVIEW.md`)
> Goal: Replace `TestSerializationService` (JSON-only placeholder that throws on `writeObject`/`readObject`) with a full production `SerializationServiceImpl`. All 14 review issues (B1–B4, K1–K8, W2–W5) plus Round 2 issues (N2, N3, N5, N10, N11, N17, N18, N19) are incorporated into the implementation spec. The two broken production paths (`ByteArrayObjectDataOutput.writeObject` and `ByteArrayObjectDataInput.readObject`) will become functional.

- [ ] **Block 15.1** — Core infrastructure: `HazelcastSerializationError` + `SerializerAdapter` interface + `DataSerializerHook` interface + `SerializationConfig` + `BufferPool` (free-list, max 3 items) — ~6 tests
- [ ] **Block 15.2** — All 21 built-in serializers: 19 primitive/array types + `UuidSerializer` + `JavaScriptJsonSerializer` (self-framing with 4-byte length prefix; breaking migration from `TestSerializationService` is documented and safe) — ~21 tests
- [ ] **Block 15.3** — `DataSerializableSerializer` (typeId -2): IDS write/read with EE version byte skipping, factory registry, `registerFactory()`, error on non-IDS header — ~6 tests
- [ ] **Block 15.4** — `SerializationServiceImpl`: dispatch chain (`serializerFor` + `serializerForTypeId`), `toData`/`toObject`/`writeObject`/`readObject`, `BufferPool` wiring, factory hook registration — ~20 tests
- [ ] **Block 15.5** — Wire `SerializationServiceImpl` into `HeliosInstanceImpl` (single shared instance for `NodeEngineImpl` + `DefaultNearCacheManager`); full regression — all tests green (N12 FIX: do NOT hardcode a test count here — Phase 14 adds ~60 tests and Phase 15 itself adds ~53; the gate command is authoritative)
- [ ] **Phase 15 checkpoint**: `bun test` at root — 0 fail, 0 error (all tests green including Phase 14 + 15 additions), `writeObject`/`readObject` no longer throw in production paths

---

## Commit Convention

```
feat(<module>): <description> — <N> tests green
fix(<module>): <what was fixed>
refactor(<module>): <what changed>
```

Examples:
```
feat(internal/util): complete — 63 tests green
feat(map): full IMap — all map tests green
feat(client): binary client protocol — all tests green
feat(nestjs): NestJS integration — 141 tests green
fix(serialization): BigInt overflow in readLong on 32-bit values
refactor(ringbuffer): extract TTL logic into RingbufferExpirationPolicy
```

---

## Converter Quick Reference

```bash
# Convert a module's Java tests to TypeScript stubs
# (Java source is in the helios-1 repo — read-only spec)
bun run scripts/convert-java-tests.ts \
  --src ../helios-1/hazelcast/src/test/java/com/hazelcast/<module> \
  --out ./test/<module>

# For spring modules
bun run scripts/convert-java-tests.ts \
  --src ../helios-1/hazelcast-spring/src/test/java \
  --out ./test/nestjs

# Run one test file or class
bun test --pattern "<ClassName>"

# Run a whole module
bun test --pattern "internal/util"

# Run all tests
bun test

# Watch mode
bun test --watch --pattern "<ClassName>"

# Type check only (no emit)
bun run tsc --noEmit

# Build
bun run build
```

---

*Plan v13.0 — updated 2026-03-04 | Runtime: Bun 1.x | TypeScript: 6.0 beta | NestJS: 11.1.14 | Phases 1–13 complete — 2845 tests green (2845 pass, 0 fail, 0 error) | Phase 14 CURRENT: Blocks 14.1-14.5 (Blitz Embedded NATS Server) — ~60 new tests planned | Phase 15 QUEUED: Blocks 15.1-15.5 (Production SerializationServiceImpl) — ~53 new tests planned | Added Phase 15 detailed block sections + Master Todo entries | Cross-ref: `plans/BLITZ_EMBEDDED_NATS_PLAN.md` (Phase 14), `plans/SERIALIZATION_SERVICE_IMPL_PLAN.md` (Phase 15)*
