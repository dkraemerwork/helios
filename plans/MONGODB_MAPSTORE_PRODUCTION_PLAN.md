# MongoDB MapStore Production Plan

## Goal

Deliver a production-ready MongoDB-backed MapStore for Helios with feature parity for the
Hazelcast MongoDB/GenericMapStore path, while staying idiomatic to the current Helios
TypeScript/Bun architecture.

This plan covers:

- core MapStore runtime behavior already present in Helios and the remaining parity gaps
- the `packages/mongodb/` adapter
- config/property wiring
- end-to-end tests against a real MongoDB instance
- operational hardening, observability, and release readiness

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

But the current MongoDB adapter is still below Hazelcast parity:

- fixed `{ _id, value }` storage shape only
- no property-driven runtime config parity (`id-column`, `columns`, `external-name`, `load-all-keys`, etc.)
- no schema/field validation on init
- no real end-to-end tests against MongoDB
- no production observability, retry policy, or failure classification
- no documented migration path between current blob mode and parity document mode

## Parity Target

The Helios MongoDB implementation must support the following behaviors before this work is
considered complete:

1. `MapStoreFactory` and direct `implementation` wiring both work.
2. `init()` / `destroy()` lifecycle works deterministically.
3. `load`, `loadAll`, `loadAllKeys`, `store`, `storeAll`, `delete`, `deleteAll` are parity-safe.
4. custom key field support exists (`id-column` parity; Mongo default remains `_id`).
5. configurable collection resolution exists (`external-name` parity).
6. selective field projection exists (`columns` parity).
7. `load-all-keys=true|false` behavior matches Hazelcast semantics.
8. single-field value mapping is supported (`single-column-as-value` parity).
9. document/object mapping and current serialized-value mapping are both supported.
10. write-through and write-behind both work with Helios core MapStore runtime.
11. offload behavior is preserved by Helios runtime contract.
12. real MongoDB integration tests prove startup, CRUD, restart survival, eager/lazy load, and failure handling.

## Product Decisions

### 1. Two storage modes

To preserve current Helios behavior without blocking Hazelcast parity, the MongoDB adapter will
support two explicit modes:

- `blob` mode: current behavior, stores `{ _id, value }` with serializer
- `document` mode: parity mode, maps object fields into MongoDB document fields

`document` mode becomes the recommended production mode. `blob` mode remains supported for
backward compatibility and opaque-value persistence.

### 2. Mongo-native adaptation of GenericMapStore parity

Hazelcast GenericMapStore is SQL/mapping based. Helios must preserve the user-visible behavior,
not the SQL implementation details. For MongoDB that means:

- replace SQL mapping creation with Mongo collection/field capability validation
- replace SQL column metadata with Mongo field metadata/config validation
- preserve config/property semantics where they make sense
- fail fast with clear Mongo-specific diagnostics when parity assumptions are invalid

### 3. No silent schema guessing

If `document` mode is configured and Helios cannot derive a valid mapping contract from the
value shape plus config, startup fails. Production mode must not guess field layouts.

## Configuration Contract

Add a Mongo-specific config layer on top of `MapStoreConfig.properties`.

Required supported properties:

- `connection-string`
- `database`
- `collection` or `external-name`
- `mode=blob|document`
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
- `MongoMetrics.ts` - counters/timers hooks

### Core integration points

Touch these Helios core areas only where required:

- `src/config/MapStoreConfig.ts` - preserve existing behavior; document required property shapes
- `src/map/impl/mapstore/MapStoreContext.ts` - ensure Mongo-specific lifecycle and eager load interactions are covered
- `src/map/impl/MapProxy.ts` / container wiring - add e2e verification for Mongo-backed maps
- examples/docs/config parsing if XML/YAML support for properties needs extension coverage

## Delivery Blocks

### Block M1 - Parity audit and contract freeze

Goal: turn Hazelcast references into a Helios acceptance matrix.

Deliverables:

- parity matrix mapping each Hazelcast behavior to Helios Mongo implementation
- explicit keep/adapt/defer list
- final config/property contract
- backward-compatibility decision for current `blob` mode

Exit gate:

- every behavior from the listed Hazelcast tests is mapped to a Helios test label

### Block M2 - Mongo config and property resolution

Goal: make MongoMapStore configurable from `MapStoreConfig.properties` and factory wiring.

Deliverables:

- typed `MongoConfig` expanded for production settings
- property resolver with validation and defaults
- support for `external-name`, `id-column`, `columns`, `load-all-keys`, `single-column-as-value`
- deterministic error messages for invalid combinations

Tests:

- property parsing unit tests
- invalid boolean / missing required property tests
- compatibility tests for direct constructor config vs factory-created config

Exit gate:

- config matrix tests green

### Block M3 - Document mapping engine

Goal: add true field-level Mongo document mapping instead of only serialized blob storage.

Deliverables:

- `blob` mapper retaining current behavior
- `document` mapper for object/record values
- custom key-field mapping (`_id` default, configurable field name support)
- column projection support
- single-column-as-value support

Tests:

- unit tests for object -> document -> object round-trip
- null/undefined/missing field handling tests
- custom `id-column` tests
- single-column-as-value tests

Exit gate:

- parity tests for `load`, `loadAll`, `store`, `storeAll`, `delete`, `deleteAll` pass in both modes

### Block M4 - Init, validation, and lifecycle hardening

Goal: make startup deterministic and production-safe.

Deliverables:

- connection lifecycle manager
- database/collection binding resolution
- collection existence strategy decision (`create-if-missing` vs fail-fast)
- document-mode validation for required fields/projections
- clean `destroy()` semantics for owned vs injected clients

Tests:

- init on owned client vs injected client
- destroy closes owned client only
- startup failure messages for missing database/collection/schema mismatch
- repeated init/destroy idempotency tests

Exit gate:

- lifecycle tests green with no leaked clients

### Block M5 - Bulk I/O and failure handling

Goal: make store/delete paths production-grade under load and failure.

Deliverables:

- batched `storeAll` and `deleteAll`
- configurable batch sizing
- retry classification for transient Mongo errors
- duplicate key / conflict handling policy
- partial batch failure reporting with deterministic behavior

Tests:

- `bulkWrite` success path
- empty batch no-op behavior
- duplicate key/update fallback behavior where applicable
- retryable vs fatal error classification
- partial failure tests

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

Tests:

- `IMap.put/get/remove/getAll/putAll/clear` with Mongo-backed map
- process restart or fresh-instance reload test
- eager load seeds map on startup
- lazy load fetches on miss
- write-behind flush on shutdown

Exit gate:

- Helios integration suite green against real MongoDB

### Block M7 - Concurrency, offload, and resilience

Goal: align with Hazelcast mapstore runtime expectations under pressure.

Deliverables:

- explicit verification that Mongo operations stay off the hot in-memory path
- timeout propagation and cancellation boundaries
- bounded write-behind queue coverage
- failure semantics when Mongo becomes unavailable mid-flight
- recovery behavior after transient outage

Tests:

- slow Mongo path does not corrupt map state
- write-behind queue saturation behavior
- Mongo outage during store/load/delete
- restart after outage with pending write-behind flush

Exit gate:

- resilience suite green; failure modes documented

### Block M8 - Observability and operability

Goal: make the adapter operable in production.

Deliverables:

- structured logging hooks
- metrics for load/store/delete/batch operations, failures, retries, queue depth, flush latency
- health-check helper for examples/NestJS integration
- redaction rules for connection strings and credentials

Tests:

- metrics emission unit tests
- log redaction tests
- health status tests with reachable/unreachable Mongo

Exit gate:

- metrics and logging contract documented and tested

### Block M9 - Config parser, examples, and docs

Goal: make the feature consumable.

Deliverables:

- XML/YAML/property examples for Mongo-backed maps
- update `examples/nestjs-app/` to use the production config surface
- migration notes from current constructor-only API
- operational docs: indexes, write concern, batching, blob vs document trade-offs

Tests:

- config round-trip tests if XML/YAML parser support is extended
- example smoke tests

Exit gate:

- examples run cleanly; docs cover setup and failure modes

### Block M10 - Production proof gate

Goal: do not ship until the full vertical slice is proven.

Required proof:

- all Mongo package unit tests green
- all Helios MapStore integration tests green
- real MongoDB e2e tests green
- `bun run tsc --noEmit` green
- workspace tests related to mapstore green
- cold-start + restart persistence scenario green
- write-through and write-behind both green

Required output:

```text
GATE-CHECK: block=M10 required=6 passed=6 labels=mongodb-unit,mongodb-e2e,mapstore-core,mapstore-writebehind,mapstore-writethrough,typescript
```

## Test Matrix

### Unit labels

- `mongodb-config`
- `mongodb-mapper-blob`
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

### Parity labels

- `mongodb-parity-load-all-keys`
- `mongodb-parity-id-column`
- `mongodb-parity-columns`
- `mongodb-parity-single-column`
- `mongodb-parity-store-update`
- `mongodb-parity-delete-all`

## Suggested File Targets

Package work:

- `packages/mongodb/src/MongoMapStore.ts`
- `packages/mongodb/src/MongoConfig.ts`
- `packages/mongodb/src/index.ts`
- new helper files listed in Architecture
- `packages/mongodb/test/*.test.ts`

Core verification work:

- `src/map/impl/mapstore/MapStoreContext.ts`
- `src/map/impl/MapProxy.ts`
- `src/config/MapStoreConfig.ts`
- `test/map/**`
- `test/instance/**`
- `examples/nestjs-app/src/main.ts`

## Explicit Non-Goals

- port Hazelcast SQL mapping internals line-by-line
- add Hazelcast SQL/DataConnection subsystem to Helios v1 just for MongoDB MapStore
- implement enterprise-only durability guarantees beyond Helios MapStore scope

## Final Acceptance Criteria

This plan is complete only when all of the following are true:

- MongoDB MapStore supports both direct implementation and factory wiring.
- Helios can persist and reload map data across process restarts using MongoDB.
- Hazelcast parity behaviors from the referenced Mongo/GenericMapStore tests are covered.
- write-through and write-behind both work against real MongoDB.
- config/property validation fails fast with actionable errors.
- production docs and examples are updated.
- the current simple blob-based API either remains backward-compatible or has a documented migration path.
