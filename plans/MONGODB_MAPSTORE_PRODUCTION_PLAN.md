# MongoDB MapStore Production Plan

## Goal

Deliver a production-ready MongoDB-backed MapStore for Helios with test-backed Hazelcast feature
parity for the Mongo/GenericMapStore path, using TypeScript/Bun-native replacements only where
Java-specific mechanics do not exist.

Phase ownership is split explicitly across the master plan:

- Phase 19 closes single-member MongoDB MapStore production readiness only.
- Phase 21 closes clustered multi-member MongoDB MapStore readiness on top of the owner-authoritative clustered MapStore core.

Until Phase 21.4 is green, this document may define clustered implementation requirements, but it must not be used to claim clustered Mongo production readiness, ship clustered Mongo docs/examples, or treat clustered Mongo proof as a Phase 19 release gate.

This plan covers:

- core MapStore runtime behavior already present in Helios and the remaining parity gaps
- the `packages/mongodb/` adapter
- config/property wiring
- end-to-end tests against a real MongoDB instance
- operational hardening, release readiness, and only those docs/examples the repo can actually run

## Reference Sources

Hazelcast parity target is taken from these Java references in `../helios-1/`:

- `extensions/mapstore/src/main/java/com/hazelcast/mapstore/GenericMapStore.java`
- `extensions/mapstore/src/main/java/com/hazelcast/mapstore/GenericMapStoreProperties.java`
- `extensions/mapstore/src/test/java/com/hazelcast/mapstore/GenericMapLoaderTest.java`
- `extensions/mapstore/src/test/java/com/hazelcast/mapstore/GenericMapStoreBasicIT.java`
- `extensions/mapstore/src/test/java/com/hazelcast/mapstore/mongodb/MongoGenericMapStoreBasicIT.java`
- `hazelcast/src/test/java/com/hazelcast/map/impl/mapstore/*.java`
- `hazelcast/src/test/java/com/hazelcast/map/impl/mapstore/writebehind/*.java`
- `hazelcast/src/test/java/com/hazelcast/map/impl/mapstore/offload/*.java`

## Current Helios Snapshot

Helios already has the core MapStore SPI and runtime foundation:

- `src/config/MapStoreConfig.ts`
- `src/map/impl/mapstore/MapStoreContext.ts`
- `src/map/impl/mapstore/MapStoreWrapper.ts`
- `src/map/impl/mapstore/writethrough/WriteThroughStore.ts`
- `src/map/impl/mapstore/writebehind/*`

Helios also already has a minimal MongoDB package:

- `packages/mongodb/src/MongoMapStore.ts`
- `packages/mongodb/src/MongoConfig.ts`
- `packages/mongodb/test/*.test.ts`

But the current MongoDB adapter is still below the desired production contract:

- fixed `{ _id, value }` storage shape only
- no property-driven runtime config beyond constructor inputs and trivial factory defaults
- no schema/field validation on init
- no real end-to-end tests against MongoDB through `HeliosInstanceImpl`
- no adapter-level failure classification or policy beyond generic write-behind retries already in core
- no finalized document-mode production contract with Hazelcast parity gates

## Implementable Target

The Helios MongoDB implementation is considered complete only for the following behavior set:

1. direct `implementation`, `factoryImplementation`, registry-backed config wiring, and raw `className` / `factoryClassName` dynamic loading all work.
2. `init()` / `destroy()` lifecycle works deterministically.
3. `load`, `loadAll`, `loadAllKeys`, `store`, `storeAll`, `delete`, `deleteAll` are parity-safe.
4. custom key field support exists (`id-column` parity; Mongo default remains `_id`).
5. configurable collection resolution exists (`external-name` parity).
6. selective field projection exists (`columns` parity).
7. `load-all-keys=true|false` both work with explicit runtime semantics; `load-all-keys=false + EAGER` fails fast as an invalid configuration.
8. single-field value mapping is supported (`single-column-as-value` parity).
9. document/object mapping is supported as the canonical persistence model.
10. write-through and write-behind both work with the Helios core MapStore runtime in single-node and clustered modes.
11. shutdown and restart semantics are durability-safe for write-behind in single-node and clustered modes.
12. EAGER and LAZY load timing is explicitly wired and tested, with EAGER finishing before the
    first map read/write operation resolves.
13. `IMap.getAll()` must use real bulk `loadAll()` for misses; `IMap.putAll()` must be upgraded to use `storeAll()` end-to-end before bulk-write parity is claimed.
14. offload semantics match the supported Hazelcast MapStore contract for Mongo-backed operations.
15. clustered multi-member Mongo persistence semantics preserve owner-only external writes, migration-safe write-behind ownership, and no duplicate external writes from backup/replay paths.
16. `loadAllKeys()` supports streaming/unbounded datasets through a non-array enumeration path in the core SPI/runtime.
17. query/index state remains correct after eager/lazy loads for Helios maps using configured predicates and indexes.
18. real MongoDB integration tests prove startup, CRUD, restart survival, eager/lazy load, shutdown flush, offload, cluster behavior, and failure handling.

Release-gate note: items 10, 11, 15, and the clustered portion of item 18 are Phase 21 closure criteria. Phase 19 may be called production-ready only for the single-member subset of this target; clustered Mongo claims, clustered docs/examples, and clustered proof stay gated behind Phase 21.4.

This target still intentionally avoids porting Hazelcast SQL/DataConnection internals line-by-line.

## Product Decisions

### 1. Single persistence mode

The MongoDB adapter uses one persistence mode:

- `document` mode: Mongo documents are the canonical persisted form and map/object fields are
  stored as Mongo fields with `_id` or configured `id-column` key mapping

Frozen mode rules:

- default `mode` is `document`
- `mode=blob` is removed from scope and must not be implemented
- `columns`, `single-column-as-value`, `replace-strategy`, and `allow-partial-document-updates`
  apply only within `document` mode semantics

### 2. Mongo-native adaptation of GenericMapStore parity

Hazelcast GenericMapStore is SQL/mapping based. Helios must preserve the user-visible behavior,
not the SQL implementation details. For MongoDB that means:

- replace SQL mapping creation with Mongo collection/field capability validation
- replace SQL column metadata with Mongo field metadata/config validation
- preserve config/property semantics where they make sense
- fail fast with clear Mongo-specific diagnostics when parity assumptions are invalid

### 3. No silent schema guessing

If Helios cannot derive a valid document mapping contract from the
value shape plus config, startup fails. Production mode must not guess field layouts.

### 4. Real config wiring via registry/provider and dynamic loading

This feature is considered complete only if the repo supports the end-to-end production
configuration paths it actually wires and tests.

- supported in v1: programmatic wiring via `setImplementation()` / `setFactoryImplementation()`
- supported in v1: config-driven wiring through an explicit registry/provider mechanism
- supported in v1: raw `className` / `factoryClassName` dynamic loading through a TypeScript-native `module-specifier#exportName` contract

`className` and `factoryClassName` are present in `src/config/MapStoreConfig.ts` today, but the
current repo does not resolve them anywhere. This plan therefore adds both an explicit
registry/provider path and a real dynamic-loading path for Mongo MapStore v1.

Docs/examples must only claim the paths that are actually implemented.

### 5. Explicit offload and cluster guarantees

Mongo MapStore v1 includes clustered and offloaded runtime behavior.

- clustered external-write semantics are implemented and proven against multi-member tests
- offload semantics are implemented and proven in core/runtime tests

No parity claim may remain in the document without a matching implementation block and proof gate.

Current repo reality that this plan must account for:

- `offload` exists in `src/config/MapStoreConfig.ts` but is not enforced anywhere in runtime.
- `NetworkedMapProxy` replays remote mutations through normal mutating paths, which would duplicate
  external Mongo writes/deletes if MapStore were enabled on more than one member.
- EAGER population currently happens only when the proxy first touches MapStore wiring, not at
  `getMap()` time or instance startup.
- `HeliosInstanceImpl.shutdownAsync()` does not await `MapContainerService.flushAll()` today.
- `MapProxy.putAll()` currently loops over `put()` and therefore does not reach `storeAll()`.
- EAGER-loaded entries are inserted directly into `RecordStore`, so configured indexes are not kept
  in sync unless core index rebuild wiring is added.

## Critical Wiring Decisions

These decisions close gaps in the current Helios runtime and are mandatory for this plan.

### Shutdown contract

- `HeliosInstanceImpl.shutdownAsync()` must await MapStore flush completion.
- write-behind queues must be drained or fail deterministically before shutdown resolves.
- fire-and-forget flush behavior is not acceptable for production readiness.
- `shutdown()` may remain a convenience wrapper, but the production proof gate in this plan uses
  `shutdownAsync()` and that method must await `MapContainerService.flushAll()`.

### EAGER initialization timing

- EAGER preload must complete before the first map read/write operation resolves.
- v1 does not require preload at synchronous `getMap()` time or instance construction time.
- the implementation point must be explicit and tested in runtime code before the first user
  operation completes.
- Current tests in `test/map/mapstore/InitialLoad.test.ts` only prove EAGER on first map access;
  this plan requires explicit preload gating before the first map operation resolves.

### Config resolution scope

- config-driven Mongo wiring must resolve through an explicit registry/provider mechanism exposed on
  `HeliosConfig` via public `registerMapStoreProvider(name, provider)` and
  `getMapStoreProviderRegistry()` APIs.
- registry-backed JSON/YAML config is bootstrap-dependent: application code must call
  `HeliosConfig.registerMapStoreProvider(...)` before instance creation; file config alone never
  instantiates a registry provider.
- `className` / `factoryClassName` dynamic loading must work through a TypeScript-native
  `module-specifier#exportName` contract with Bun `import()`.
- selector contract is explicit and tested: `factoryClassName` / `className` first attempt registry
  lookup by exact string key; if no registry match exists, the same value is treated as a
  `module-specifier#exportName` dynamic-loading target.
- resolution precedence is explicit and tested: `factoryImplementation` -> registry/dynamic resolve
  of `factoryClassName` -> `implementation` -> registry/dynamic resolve of `className`.
- bare/package specifiers resolve with Bun's normal ESM rules; relative specifiers in file-based
  config resolve relative to the config file directory; relative specifiers in programmatic config
  resolve relative to `process.cwd()`.
- `ConfigLoader` / file-based config paths must carry config-origin metadata into `HeliosConfig` so
  relative dynamic-loading specifiers never fall back silently to `process.cwd()`.
- examples may use programmatic wiring, registry-backed config wiring, or dynamic-loading config wiring.
- JSON/YAML examples are allowed only after the runtime can instantiate both registry and
  dynamic-loading paths for Mongo MapStore.

### Cluster safety scope

- Mongo MapStore v1 must work on clustered `NetworkedMapProxy` members with feature parity for the
  supported Hazelcast MapStore semantics.
- only the partition owner / authoritative mutation path may invoke external Mongo persistence.
- backup application, replication replay, migration replay, and state transfer paths must not
  duplicate external writes or deletes.
- clustered Mongo proof must capture per-call provenance (`memberId`, `partitionId`, `replicaRole`, `partitionEpoch`, `operationKind`) for every physical external Mongo call and must assert against duplicate physical calls directly rather than trusting final document state.
- write-behind ownership and queued entries must migrate with partition ownership using explicit
  tests for migration, restart, and rebalancing scenarios.
- authoritative migration handoff is fixed: the source owner serializes pending write-behind state
  into the migration payload, the target owner installs that state before serving partition writes,
  and the source owner stops external flush work as soon as handoff is acknowledged.
- clustered EAGER Mongo preload must inherit the core one-epoch rule: if a member joins while preload is running, the joiner waits on the active epoch and must not start a second collection-wide `loadAllKeys()` scan.
- ownership changes during that epoch may only move not-yet-finished work by explicit batch/progress handoff; they must not duplicate Mongo reads or introduce any duplicate Mongo write/delete side effects.
- owner change is staged and fenced: `beforePromotion`/handoff freezes the retiring owner and transfers Mongo write-behind state, `finalize` installs the new ownership epoch and expected target, and the target must not issue Mongo `store`/`storeAll`/`delete`/`deleteAll`/`load`/`loadAll` calls before finalize commits.
- all promotion, finalize, retry, flush, and offload-completion paths must validate the partition ownership epoch plus expected source/target member identity and fail closed on mismatch.
- old-owner fencing is explicit: once handoff starts, the retiring owner rejects new partition mutations for that epoch, stops new Mongo I/O for that partition, and drops late flush completions or retries from the retired epoch.

### Offload scope

- current Helios core does not implement offload semantics.
- this plan must add real offload semantics for Mongo-backed load/store/delete paths.
- `offload=true` must execute external Mongo I/O off the hot operation/partition path while
  preserving per-map, per-partition FIFO ordering, error propagation, and bounded backpressure
  behavior.
- `offload=false` must also be supported, with explicit tests for synchronous/inlined semantics and
  no fake acceptance.

### `load-all-keys` compatibility

- `load-all-keys=true` and `load-all-keys=false` are both supported.
- `load-all-keys=false` + `EAGER` must fail fast during MapStore initialization because Helios EAGER
  loading is defined in terms of `loadAllKeys()`.
- when `load-all-keys=false`, LAZY mode remains valid and `map.clear()` must use an explicit Mongo
  collection delete path that does not depend on key enumeration.
- collection-wide `clear()` is allowed only when startup validation proves unique writable ownership
  of that database+collection pair by a single map configuration.
- startup validation must reject multiple writable maps targeting the same database+collection pair.
- load-only/read-only contract is explicit: a binding is read-only only when the resolved
  implementation exposes `MapLoader` behavior without `MapStore` write/delete methods.
- multiple read-only bindings may target the same database+collection pair.
- writable and read-only bindings may not share the same database+collection pair in v1.
- `clear()` ordering is fixed for `load-all-keys=false`: the runtime must first quiesce the map's
  offloaded work and write-behind queue, then apply the collection-wide delete exactly once, then
  prevent any pre-clear queued write from replaying after the delete completes.

### Bulk path wiring

- `IMap.getAll()` already has a bulk-miss path in `src/map/impl/MapProxy.ts`, but it first loops
  through per-key `get()` calls; tests must prove the final missing-key path reaches `loadAll()`.
- `IMap.putAll()` currently loops over `put()`. Therefore any claim that Mongo bulk writes are wired
  through normal `IMap.putAll()` usage is false until core code changes.
- adapter bulk logic alone is insufficient; core map runtime must be covered.

### Query/index consistency

- lazy load-on-miss currently writes loaded entries back through `PutOperation`, which can update
  indexes through normal proxy logic.
- EAGER prepopulation currently bypasses `MapProxy` index maintenance.
- therefore this plan must rebuild indexes after EAGER preload before the first map operation resolves.
- indexed-query parity remains in scope only because this core fix is required, not optional.

### `loadAllKeys()` scale limitation

- current Helios SPI returns `Promise<K[]>`, not a streaming iterable.
- this plan must add an explicit canonical SPI type, `MapKeyStream<K>`, for streaming/non-array key
  enumeration so Mongo-backed maps can handle unbounded datasets without loading all keys into memory.
- `MapKeyStream<K>` is fixed as:

```ts
export interface MapKeyStream<K> extends AsyncIterable<K> {
  close(): Promise<void>;
}
```

- final contract is fixed: `loadAllKeys()` returns `Promise<MapKeyStream<K>>`.
- the implementation must migrate all in-repo array-returning loaders in the same change set; no
  array-returning `loadAllKeys()` path remains after Block M2 closes.
- all runtime code consumes `MapKeyStream<K>` directly.
- producer ownership is explicit: adapter/store implementations produce the stream; core/runtime owns
  batching, backpressure, ordering, and full-scan consumption semantics.
- end/error semantics are fixed: normal completion is async-iterator `done=true`, failures surface
  by throwing from the iterator, and runtime must call `close()` in `finally` on all full or
  partial scans.
- EAGER and repair flows that need full-key scans must use the new streaming contract with bounded
  batching/backpressure and tests for large collections.

## Configuration Contract

Add a Mongo-specific config layer on top of `MapStoreConfig.properties`.

Required supported properties:

- `connection-string`
- `database`
- `external-name`
- `mode=document`
- `id-column`
- `columns`
- `load-all-keys=true|false`
- `single-column-as-value=true|false`
- `replace-strategy=updateOne|replaceOne`
- `upsert=true|false`
- `read-preference`
- `write-concern`
- `retry-writes=true|false`

Optional Helios-only properties:

- `key-field-serializer`
- `value-type`
- `projection-strict=true|false`
- `allow-partial-document-updates=true|false`
- `max-batch-size`
- `connect-timeout-ms`
- `server-selection-timeout-ms`

Required config clarifications:

- precedence is fixed:
  - direct `implementation` instances own their constructor config; `MapStoreConfig.properties` do not mutate an already-constructed store instance
  - `factoryImplementation`, registry-backed providers, and dynamic-loading factories receive `MapStoreConfig.properties`; explicit properties override factory/provider defaults
  - constructor defaults inside the created Mongo store/factory apply only when the property is absent
- default `mode` is `document`
- `external-name` is the canonical and only supported MapStore property name for collection binding in `MapStoreConfig.properties`; `collection` remains a constructor/factory option only
- legal combinations are fixed:
  - `single-column-as-value=true` requires `mode=document` and exactly one non-id column in `columns`
  - `replace-strategy=replaceOne` is valid only in `mode=document` with no `columns` projection
  - `replace-strategy=updateOne` is required when `columns` is set
  - `mode=blob` is invalid and must fail fast during config validation
- the dynamic-loading string contract for `className` / `factoryClassName` is `module-specifier#exportName`, with fail-fast validation for malformed specifiers, missing modules, and missing exports
- `load-all-keys=false` is legal only in LAZY mode and must use collection-wide clear semantics that do not enumerate keys
- writable Mongo stores are single-map-per-collection; startup rejects multiple writable maps targeting the same database+collection pair
- multiple read-only/load-only bindings may share a collection; writable bindings are exclusive and cannot share a collection with read-only bindings
- supported wiring scope is `implementation`, `factoryImplementation`, registry-backed config wiring, and dynamic-loading config wiring
- lifecycle precedence is fixed:
  - injected `MongoClient` wins over client-construction settings
  - supplying both an injected `MongoClient` and connection-string/client-creation options is invalid
  - owned clients created by the store are closed on `destroy()`; injected clients are never closed by the store

## Architecture

### Package surface

Create or refactor these package files in `packages/mongodb/src/`:

- `MongoMapStore.ts` - public entry point
- `MongoMapStoreFactory.ts` - property-driven factory
- `MongoConfig.ts` - typed config
- `MongoPropertyResolver.ts` - normalize `MapStoreConfig.properties`
- `MongoDocumentMapper.ts` - key/value <-> BSON document mapping
- `MongoCollectionBinding.ts` - collection init, indexes, validation, capability checks
- `MongoBulkWriter.ts` - storeAll/deleteAll batching
- `MongoFailureClassifier.ts` - retryable vs fatal errors
- `MongoLoadAllKeysStream.ts` - cursor/iterator based key enumeration with bounded batching
- `MongoStructuredLogger.ts` - structured logging and redaction helpers for adapter/runtime events
- `MapKeyStream.ts` - canonical streaming key-enumeration contract shared by core and adapters

### Core integration points

Touch these Helios core areas only where required:

- `src/config/MapStoreConfig.ts` - preserve existing behavior only where real runtime support exists; align config fields with actual resolution path
- `src/config/ConfigLoader.ts` - preserve config-origin metadata for file-based dynamic-loading resolution
- `src/config/HeliosConfig.ts` - carry provider registry and config-origin metadata through instance bootstrap
- `src/map/MapKeyStream.ts` - canonical stream contract and wrapper normalization helpers
- `src/map/impl/mapstore/MapStoreContext.ts` - ensure Mongo-specific lifecycle, eager load interactions, and config validation are covered
- `src/map/impl/mapstore/MapStoreProviderRegistry.ts` - explicit provider/registry path for config-driven store resolution
- `src/map/impl/mapstore/MapStoreDynamicLoader.ts` - `className` / `factoryClassName` loading via Bun `import()` and export resolution
- `src/map/MapLoader.ts` / `src/map/MapStore.ts` / wrappers - adopt `MapKeyStream<K>` as the only `loadAllKeys` contract and migrate all in-repo implementations in the same change set
- `src/map/impl/MapProxy.ts` / container wiring - add end-to-end verification for Mongo-backed maps, including bulk paths and required index consistency
- `src/map/impl/NetworkedMapProxy.ts` - implement clustered persistence semantics without duplicate external writes
- `src/map/impl/MapContainerService.ts` - ensure eager preload, query/index wiring, and collection-clear semantics are coherent and index-safe
- `src/spi/impl/operationservice/impl/OperationServiceImpl.ts` and related runtime surfaces - add offload execution semantics for MapStore I/O
- `src/instance/impl/HeliosInstanceImpl.ts` - make shutdown await MapStore flush completion
- examples/docs for the supported programmatic, registry-backed, and dynamic-loading wiring paths

### Validation hook points

The plan must bind each runtime guarantee to a concrete implementation point:

- EAGER preload gating happens in the async MapStore/map-operation path so the first map read/write
  waits for preload completion before resolving.
- cluster owner-only persistence gating happens before any remote replay/backup/migration path can
  invoke Mongo writes.
- `load-all-keys=false` validation happens during Mongo config resolution / MapStore init, and clear
  semantics for that mode bind to collection-delete behavior immediately.
- EAGER index consistency is satisfied by rebuilding indexes after preload before the first map operation resolves.
- dynamic-loading validation happens during config resolution before the first map operation can
  reach a partially loaded or missing export.
- file-origin resolution context is preserved from `ConfigLoader` into mapstore initialization before
  any dynamic-loading config path is used.

### Mongo test harness and CI contract

Real MongoDB proof requires an explicit test harness.

- use a real MongoDB instance for integration/e2e coverage, provisioned by CI and by local
  contributors through a documented command or container workflow
- required env vars and defaults are fixed:
  - `HELIOS_MONGODB_TEST_URI` default `mongodb://127.0.0.1:27017`
  - `HELIOS_MONGODB_TEST_DB_PREFIX` default `helios_mapstore_test`
  - `HELIOS_MONGODB_TEST_CLEANUP` default `true`
  - `HELIOS_MONGODB_TEST_TIMEOUT_MS` default `30000`
- each test run uses `HELIOS_MONGODB_TEST_DB_PREFIX` plus a unique suffix for isolation
- require integration/e2e tests in this plan to run without manual test edits or skipped proof-gate
  cases
- every label in the proof gate must map to a concrete command, test file glob, or CI job name

## Delivery Blocks

### Block M0 - Parity audit and contract freeze

Goal: turn Hazelcast references and current-repo constraints into a Helios acceptance matrix before
core/runtime implementation starts.

Deliverables:

- parity matrix mapping each Hazelcast behavior to Helios Mongo implementation
- explicit keep/adapt matrix and TypeScript-native replacement notes where Java-only mechanics differ
- final config/property contract
- final decision that `document` mode is the only supported persistence mode
- explicit list of Java-specific internal mechanisms that are replaced with TypeScript/Bun-native equivalents without changing required behavior
- explicit supported wiring scope frozen to `implementation`, `factoryImplementation`, registry-backed config wiring, and dynamic-loading config wiring

Exit gate:

- every behavior from the listed Hazelcast tests is mapped to a concrete Helios implementation block, proof label, or TS-native replacement note
- no Mongo MapStore feature-parity item remains without an implementation block and proof gate

### Block M1 - Core runtime gap closure

Goal: close the existing Helios runtime gaps that would leave Mongo MapStore only partially wired.

Deliverables:

- shutdown path awaits MapStore flush completion
- EAGER load timing is explicit and no longer lazy-by-accident
- registry/provider config wiring is added alongside raw string-based dynamic resolution
- dynamic-loading config wiring is added for `className` / `factoryClassName`
- cluster persistence semantics are implemented end-to-end without duplicate external writes
- offload semantics are implemented in core/runtime for MapStore I/O
- `load-all-keys=false` is supported in LAZY mode with collection-delete clear semantics
- streaming `loadAllKeys()` contract is implemented end-to-end
- all in-repo `loadAllKeys()` implementations are migrated to `MapKeyStream<K>`
- bulk `putAll()` / `getAll()` core wiring is implemented end-to-end before bulk parity is claimed
- query/index consistency behavior after MapStore loads is implemented

Tests:

- shutdown waits for write-behind flush
- EAGER preload completes before the first map read/write operation resolves
- invalid config combinations fail at startup
- dynamic-loading config resolves to a real Mongo export path
- clustered mutations persist exactly once externally and backups/replays do not duplicate writes
- offloaded MapStore I/O stays off the hot operation path and preserves ordering
- `load-all-keys=false` LAZY mode works and `clear()` does not enumerate keys
- streaming `loadAllKeys()` handles large collections without full in-memory materialization
- all in-repo `loadAllKeys()` implementations pass under the `MapKeyStream<K>` contract
- registry/provider config wiring resolves to a real Mongo store path
- `putAll()` and `getAll()` exercise store bulk paths
- lazy/eager loaded entries preserve query/index visibility

Exit gate:

- no known core-runtime gap remains that would leave Mongo MapStore partially wired after adapter work

### Block M2 - Mongo config and property resolution

Goal: make MongoMapStore configurable from `MapStoreConfig.properties` and factory wiring.

Deliverables:

- typed `MongoConfig` expanded for production settings
- property resolver with validation and defaults
- support for `external-name`, `id-column`, `columns`, `load-all-keys`, `single-column-as-value`
- deterministic error messages for invalid combinations
- explicit precedence rules between constructor config, properties, and factory defaults
- programmatic factory wiring path for `factoryImplementation`
- registry/provider path for config-driven Mongo factory instantiation, bound to a public
  `HeliosConfig` registration API
- dynamic-loading path for `className` / `factoryClassName`
- explicit selector contract: `className` / `factoryClassName` values first resolve through the
  provider registry by exact key, then fall back to `module-specifier#exportName` dynamic loading
- file-based config resolution path through `ConfigLoader` / JSON / YAML loading with the documented
  relative-specifier rules
- carried-through config-origin metadata on `HeliosConfig` so file-based dynamic-loading resolution
  has a real base directory at runtime
- repo-wide `loadAllKeys()` contract upgrade: all loaders are migrated to `MapKeyStream<K>` in the
  same implementation; array-returning loaders are removed from the final runtime contract

Tests:

- property parsing unit tests
- invalid boolean / missing required property tests
- compatibility tests for direct constructor config vs factory-created config
- programmatic factory wiring tests
- registry/provider config wiring tests
- dynamic-loading resolution tests
- registry-vs-dynamic selector precedence tests for `className` / `factoryClassName`
- file-based config resolution tests for relative and package specifiers
- config-origin metadata propagation tests from `ConfigLoader` into MapStore initialization
- repo migration tests proving all in-repo loaders now implement `MapKeyStream<K>`
- `load-all-keys=false` LAZY-mode config tests
- `load-all-keys=false` + `EAGER` rejection tests

Exit gate:

- config matrix tests green

### Block M3 - Document mapping engine

Goal: add true field-level Mongo document mapping as the only supported persistence model.

Deliverables:

- `document` mapper for object/record values
- custom key-field mapping (`_id` default, configurable field name support)
- column projection support
- single-column-as-value support
- frozen semantics for `null`, `undefined`, missing fields, projected fields, and unknown extra fields
- frozen semantics for `updateOne` vs `replaceOne` and partial-document preservation

Tests:

- unit tests for object -> document -> object round-trip
- null/undefined/missing field handling tests
- custom `id-column` tests
- single-column-as-value tests
- projection-preservation tests for `updateOne` vs `replaceOne`

Exit gate:

- parity tests for `load`, `loadAll`, `store`, `storeAll`, `delete`, `deleteAll` pass in document mode

### Block M4 - Init, validation, and lifecycle hardening

Goal: make startup deterministic and production-safe.

Deliverables:

- connection lifecycle manager
- database/collection binding resolution
- collection binding strategy is fixed: `init()` verifies connectivity, resolves the database and
  collection handles, and creates required validation/index metadata during init; collection
  document storage itself remains Mongo-native and is created on first write if still absent
- document-mode validation for required fields/projections
- clean `destroy()` semantics for owned vs injected clients

Tests:

- init on owned client vs injected client
- destroy closes owned client only
- startup failure messages for binding/preflight validation failures defined by the selected collection existence strategy
- repeated init/destroy idempotency tests

Exit gate:

- lifecycle tests green with no leaked clients

### Block M5 - Bulk I/O and failure handling

Goal: make store/delete paths production-grade under load and failure.

Deliverables:

- batched `storeAll` and `deleteAll`
- configurable batch sizing
- retry ownership is fixed: the adapter classifies errors and may retry synchronous write-through paths; write-behind flush retries are owned by core and must not be nested by adapter retries
- duplicate key / conflict handling policy
- partial batch failure reporting with deterministic behavior
- explicit ownership rules for retry behavior across Mongo driver, adapter, and Helios write-behind core so retries are not stacked blindly
- collection-wide clear/delete behavior for `load-all-keys=false`
- collection-wide `clear()` ordering contract: quiesce offloaded work, drain or cancel pre-clear
  write-behind entries deterministically, execute the delete once, and block stale post-clear replay

Tests:

- `bulkWrite` success path
- empty batch no-op behavior
- duplicate key/update fallback behavior where applicable
- retryable vs fatal error classification
- partial failure tests
- fatal errors are not retried indefinitely in write-behind
- collection-wide `clear()` path tests
- collection-wide `clear()` with pending offloaded/write-behind work tests

Exit gate:

- bulk path tests green; no silent drop behavior

### Block M6 - Helios MapStore runtime integration

Goal: prove the Mongo package works correctly with the actual Helios map runtime.

Deliverables:

- write-through integration coverage
- write-behind integration coverage
- eager and lazy initial load coverage
- clear flush/shutdown guarantees
- restart persistence proof
- verified `getAll()` and `putAll()` bulk runtime wiring
- query/index consistency after eager/lazy loads
- explicit `load-all-keys=false` LAZY-mode coverage
- streaming `loadAllKeys()` integration coverage
- deterministic `clear()` semantics with pending offloaded/write-behind work

Tests:

- `IMap.put/get/remove/getAll/putAll/clear` with Mongo-backed map
- process restart or fresh-instance reload test
- eager preload finishes before the first map operation resolves
- lazy load fetches on miss
- write-behind flush on shutdown
- query/index visibility after eager/lazy load test
- `load-all-keys=false` LAZY-mode tests including `clear()`
- large-collection `loadAllKeys()` streaming tests
- `clear()` tests with queued/offloaded writes to prove no post-clear replay

Exit gate:

- Helios integration suite green against real MongoDB

### Block M7 - Offload, cluster, and resilience

Goal: harden Mongo MapStore runtime under pressure, offload, and clustered execution.

Deliverables:

- timeout propagation and cancellation boundaries
- bounded write-behind queue coverage
- failure semantics when Mongo becomes unavailable mid-flight
- recovery behavior after transient outage
- offload execution semantics and ordering guarantees
- cluster owner-only persistence, migration-safe write-behind, and replay-safe semantics
- clustered EAGER join-during-load continuity: one coordinated preload epoch survives member join/rebalance without deadlock, without a second full Mongo key scan, and without duplicate Mongo reads/writes
- clustered proof fixtures capture per-call provenance (`memberId`, `partitionId`, `replicaRole`, `partitionEpoch`, `operationKind`) for every physical external Mongo call
- three-member clustered Mongo suites run as separate Helios member processes with distinct TCP listeners over real `TcpClusterTransport`; shared-process, in-memory, or direct-call cluster harnesses are non-gating only
- owner crash plus transport-boundary drop/delay on owner-routed map-operation, backup, migration-handoff, and replica-sync traffic preserve owner-only external writes and the documented at-least-once durability contract

Tests:

- slow Mongo path does not corrupt map state
- write-behind queue saturation behavior
- Mongo outage during store/load/delete
- restart after outage with pending write-behind flush
- offload behavior tests for `offload=true` and `offload=false`
- two-member and multi-member cluster tests prove no duplicate physical external Mongo writes/deletes by asserting on captured per-call provenance, not just final collection contents
- migration/rebalance tests for write-behind ownership transfer also assert that promoted owners and backups do not both issue the same physical external call for one logical mutation
- staged promotion/finalize tests proving the promoted target performs no Mongo writes before finalize and the retired owner cannot leak late Mongo writes after epoch change
- expected-target/epoch fencing tests proving stale finalize, retry, offload-completion, and flush-ack messages are rejected during owner change
- two-member clustered EAGER test where member 2 joins mid-load and proves one epoch, one full `loadAllKeys()` scan, no deadlock, and no duplicate Mongo reads/writes for already assigned keys

Exit gate:

- resilience, offload, and cluster suites green; failure modes documented

### Block M8 - Observability and operability

Goal: make the adapter operable in production.

Deliverables:

- structured logging hooks
- redaction rules for connection strings and credentials

Tests:

- log redaction tests

Exit gate:

- logging contract documented and tested

### Block M9 - Examples and docs

Goal: make the feature consumable.

Deliverables:

- programmatic examples for Mongo-backed maps using supported wiring only
- registry/provider config examples for Mongo-backed maps using supported wiring only, including the
  required `HeliosConfig.registerMapStoreProvider(...)` bootstrap step
- dynamic-loading config examples for Mongo-backed maps using supported wiring only
- operational docs: indexes, write concern, batching, single-column mapping, and document update semantics
- explicit docs for supported runtime scope: clustered support, offload behavior, `loadAllKeys` streaming semantics, and all supported wiring modes
- clustered Mongo docs/examples are blocked until Phase 21.4 is green; before that, docs/examples may describe only the single-member, offload, and wiring scope closed in Phase 19
- exact local/CI test harness instructions for the real MongoDB proof path

Tests:

- example smoke tests

Exit gate:

- examples run cleanly; docs cover setup and failure modes

### Block M10 - Production proof gate

Goal: do not ship until the full vertical slice is proven.

Phase gate: Block M10 is the full-plan proof gate, not the Phase 19 gate. For Phase 19 closure, only the single-member proof subset may be required or cited. `mapstore-mongodb-clustered`, the clustered multi-member scenario, and any clustered Mongo production-readiness claim remain gated behind Phase 21.4.

Required proof:

- `bun run typecheck` green
- `bun --cwd packages/mongodb run typecheck` green
- `bun --cwd packages/mongodb test` green
- root mapstore-focused tests green via a documented `bun test ...` command or CI label mapping
- real MongoDB integration/e2e suite green via a documented command or CI job mapping
- cold-start + restart persistence scenario green
- outage recovery scenario green
- write-through and write-behind both green
- shutdown flush durability scenario green
- EAGER preload-before-first-operation scenario green
- LAZY load-on-miss scenario green
- supported wiring scenario green for direct `implementation`, `factoryImplementation`, registry-backed config wiring, and dynamic-loading config wiring
- each supported wiring path must pass as its own independent proof target; one passing path may not satisfy or stand in for any other path
- the required independent wiring proof set is fixed:
  - direct `implementation`
  - direct `factoryImplementation`
  - registry-backed config wiring
  - dynamic-loading config wiring from programmatic config
  - dynamic-loading config wiring from JSON file config
  - dynamic-loading config wiring from YAML file config
  - config-origin-relative dynamic-loading resolution for file-based config
  - installed-package dynamic-loading via bare/package specifier
- offload scenario green
- clustered multi-member scenario green with per-call provenance capture (`memberId`, `partitionId`, `replicaRole`, `partitionEpoch`, `operationKind`) and duplicate-physical-call assertions for Mongo `store` / `storeAll` / `delete` / `deleteAll`
- clustered multi-member scenario green on separate Helios member processes over real TCP; shared-process or direct-call cluster tests do not satisfy this proof item
- clustered failure proof includes process-boundary owner crash plus transport-boundary drop/delay injection on owner-routed map-operation, backup, migration-handoff, and replica-sync traffic
- query/index consistency scenario green
- `load-all-keys=false` LAZY-mode scenario green
- streaming `loadAllKeys()` large-collection scenario green

Required command mapping:

- Block M10 must add and use these exact workspace commands or CI jobs with the same names:

```text
bun run typecheck
bun --cwd packages/mongodb run typecheck
bun run test:mapstore:mongodb:unit
bun run test:mapstore:mongodb:core
bun run test:mapstore:mongodb:offload
bun run test:mapstore:mongodb:cluster
bun run test:mapstore:mongodb:e2e
bun run test:mapstore:mongodb:wiring:implementation
bun run test:mapstore:mongodb:wiring:factory-implementation
bun run test:mapstore:mongodb:wiring:registry
bun run test:mapstore:mongodb:wiring:dynamic-programmatic
bun run test:mapstore:mongodb:wiring:dynamic-json
bun run test:mapstore:mongodb:wiring:dynamic-yaml
bun run test:mapstore:mongodb:wiring:config-origin-relative
bun run test:mapstore:mongodb:wiring:dynamic-package
```

- each proof label below must map to one or more of those committed commands or to a committed CI
  job that runs the same coverage

Exact label-to-command mapping is fixed:

- `typescript` -> `bun run typecheck` and `bun --cwd packages/mongodb run typecheck`
- `mongodb-unit` -> `bun run test:mapstore:mongodb:unit`
- `mongodb-e2e` -> `bun run test:mapstore:mongodb:e2e`
- `mapstore-mongodb-wiring-aggregate` -> requires all of `mapstore-mongodb-wiring-implementation`, `mapstore-mongodb-wiring-factory-implementation`, `mapstore-mongodb-wiring-registry`, `mapstore-mongodb-wiring-dynamic-programmatic`, `mapstore-mongodb-wiring-dynamic-json`, `mapstore-mongodb-wiring-dynamic-yaml`, `mapstore-mongodb-wiring-config-origin-relative`, and `mapstore-mongodb-wiring-dynamic-package`; no subset pass is sufficient
- `mapstore-mongodb-wiring-implementation` -> `bun run test:mapstore:mongodb:wiring:implementation`
- `mapstore-mongodb-wiring-factory-implementation` -> `bun run test:mapstore:mongodb:wiring:factory-implementation`
- `mapstore-mongodb-wiring-registry` -> `bun run test:mapstore:mongodb:wiring:registry`
- `mapstore-mongodb-wiring-dynamic-programmatic` -> `bun run test:mapstore:mongodb:wiring:dynamic-programmatic`
- `mapstore-mongodb-wiring-dynamic-json` -> `bun run test:mapstore:mongodb:wiring:dynamic-json`
- `mapstore-mongodb-wiring-dynamic-yaml` -> `bun run test:mapstore:mongodb:wiring:dynamic-yaml`
- `mapstore-mongodb-wiring-config-origin-relative` -> `bun run test:mapstore:mongodb:wiring:config-origin-relative`
- `mapstore-mongodb-wiring-dynamic-package` -> `bun run test:mapstore:mongodb:wiring:dynamic-package`
- `mapstore-mongodb-writethrough` -> `bun run test:mapstore:mongodb:core`
- `mapstore-mongodb-writebehind` -> `bun run test:mapstore:mongodb:core`
- `mapstore-mongodb-putall-getall-bulk-runtime` -> `bun run test:mapstore:mongodb:core`
- `mapstore-mongodb-shutdown-durability` -> `bun run test:mapstore:mongodb:core`
- `mapstore-mongodb-eager-load` -> `bun run test:mapstore:mongodb:core`
- `mapstore-mongodb-lazy-load` -> `bun run test:mapstore:mongodb:core`
- `mapstore-mongodb-restart` -> `bun run test:mapstore:mongodb:cluster`
- `mapstore-mongodb-offload` -> `bun run test:mapstore:mongodb:offload`
- `mapstore-mongodb-clustered` -> `bun run test:mapstore:mongodb:cluster`
- `mapstore-mongodb-query-index-consistency` -> `bun run test:mapstore:mongodb:core`
- `mapstore-mongodb-outage-recovery` -> `bun run test:mapstore:mongodb:e2e`
- `mapstore-mongodb-loadallkeys` -> `bun run test:mapstore:mongodb:e2e`

Required output:

```text
GATE-CHECK: block=M10 required=24 passed=24 labels=mongodb-unit,mongodb-e2e,mapstore-mongodb-wiring-implementation,mapstore-mongodb-wiring-factory-implementation,mapstore-mongodb-wiring-registry,mapstore-mongodb-wiring-dynamic-programmatic,mapstore-mongodb-wiring-dynamic-json,mapstore-mongodb-wiring-dynamic-yaml,mapstore-mongodb-wiring-config-origin-relative,mapstore-mongodb-wiring-dynamic-package,mapstore-mongodb-wiring-aggregate,mapstore-mongodb-writethrough,mapstore-mongodb-writebehind,mapstore-mongodb-putall-getall-bulk-runtime,mapstore-mongodb-shutdown-durability,mapstore-mongodb-eager-load,mapstore-mongodb-lazy-load,mapstore-mongodb-restart,mapstore-mongodb-offload,mapstore-mongodb-clustered,mapstore-mongodb-query-index-consistency,mapstore-mongodb-outage-recovery,mapstore-mongodb-loadallkeys,typescript
```

Exact command contract above is required for Block M10 closure.

## Test Matrix

### Unit labels

- `mongodb-config`
- `mongodb-mapper-document`
- `mongodb-bulk`
- `mongodb-failure-classifier`
- `mongodb-lifecycle`

### Integration labels

- `mapstore-mongodb-writethrough`
- `mapstore-mongodb-writebehind`
- `mapstore-mongodb-eager-load`
- `mapstore-mongodb-lazy-load`
- `mapstore-mongodb-restart`
- `mapstore-mongodb-outage-recovery`
- `mapstore-mongodb-shutdown-durability`
- `mapstore-mongodb-wiring-implementation`
- `mapstore-mongodb-wiring-factory-implementation`
- `mapstore-mongodb-wiring-registry`
- `mapstore-mongodb-wiring-dynamic-programmatic`
- `mapstore-mongodb-wiring-dynamic-json`
- `mapstore-mongodb-wiring-dynamic-yaml`
- `mapstore-mongodb-wiring-config-origin-relative`
- `mapstore-mongodb-wiring-dynamic-package`
- `mapstore-mongodb-wiring-aggregate`
- `mapstore-mongodb-putall-getall-bulk-runtime`
- `mapstore-mongodb-offload`
- `mapstore-mongodb-clustered`
- `mapstore-mongodb-query-index-consistency`
- `mapstore-mongodb-loadallkeys`

Each label above must map to a real test file glob, exact command, or CI job name before Block M10 closes.

### Parity labels

- `mongodb-parity-load-all-keys`
- `mongodb-parity-id-column`
- `mongodb-parity-columns`
- `mongodb-parity-single-column`
- `mongodb-parity-store-update`
- `mongodb-parity-delete-all`
- `mongodb-parity-putall-getall-bulk-runtime`
- `mongodb-parity-eager-timing`
- `mongodb-parity-dynamic-loading`
- `mongodb-parity-offload`
- `mongodb-parity-clustered`

## Suggested File Targets

Package work:

- `packages/mongodb/src/MongoMapStore.ts`
- `packages/mongodb/src/MongoConfig.ts`
- `packages/mongodb/src/index.ts`
- new helper files listed in Architecture
- `packages/mongodb/test/*.test.ts`

Core verification work:

- `src/map/impl/mapstore/MapStoreContext.ts`
- `src/map/impl/mapstore/MapStoreProviderRegistry.ts`
- `src/map/impl/mapstore/MapStoreDynamicLoader.ts`
- `src/config/HeliosConfig.ts`
- `src/map/MapKeyStream.ts`
- `src/map/MapLoader.ts`
- `src/map/MapStore.ts`
- `src/map/impl/MapProxy.ts`
- `src/map/impl/NetworkedMapProxy.ts`
- `src/map/impl/MapContainerService.ts`
- `src/config/MapStoreConfig.ts`
- `src/spi/impl/operationservice/impl/OperationServiceImpl.ts`
- `src/instance/impl/HeliosInstanceImpl.ts`
- `test/map/**`
- `test/instance/**`
- `examples/nestjs-app/src/main.ts`
- `examples/nestjs-app/src/mongodb-store/**`

## Explicit Non-Goals

- port Hazelcast SQL mapping internals line-by-line
- add Hazelcast SQL/DataConnection subsystem to Helios v1 just for MongoDB MapStore
- implement enterprise-only durability guarantees beyond Helios MapStore scope

## Final Acceptance Criteria

This plan is complete only when all of the following are true:

- MongoDB MapStore supports direct implementation, `factoryImplementation`, registry-backed config wiring, and raw `className` / `factoryClassName` dynamic loading.
- Helios can persist and reload map data across process restarts using MongoDB.
- Hazelcast parity behaviors from the referenced Mongo/GenericMapStore tests are covered by concrete implementation blocks and proof gates.
- write-through and write-behind both work against real MongoDB in single-node and clustered modes.
- `shutdownAsync()` waits for write-behind flush completion before resolving.
- EAGER preload completes before the first map read/write operation resolves.
- offload semantics are implemented and verified for Mongo-backed operations.
- clustered owner-only persistence semantics prevent duplicate external writes during replay, backup, migration, and rebalance, proven by per-call provenance capture (`memberId`, `partitionId`, `replicaRole`, `partitionEpoch`, `operationKind`) and duplicate-physical-call assertions rather than final-state-only checks.
- clustered Mongo proof uses separate Helios member processes over real TCP and includes transport-boundary crash/drop/delay fault injection; shared-process or direct-call simulations do not satisfy clustered acceptance.
- `load-all-keys=true|false` both work with explicit semantics, and `load-all-keys=false + EAGER` is rejected deterministically.
- `loadAllKeys()` supports streaming/unbounded enumeration without full in-memory materialization.
- query/index state stays correct after eager/lazy loads for Helios maps using configured predicates and indexes.
- every documented config path is backed by a real runtime resolution path.
- config/property validation fails fast with actionable errors.
- docs and examples only claim supported wiring and supported runtime scope.
- `document` mode is the only supported persistence mode and is fully implemented end to end.
