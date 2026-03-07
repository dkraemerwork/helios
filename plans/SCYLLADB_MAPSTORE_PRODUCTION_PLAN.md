# DynamoDB-Compatible MapStore Production Plan

## Goal

Deliver a production-ready DynamoDB-compatible MapStore for Helios that supports single-member and
clustered deployments, fits Helios's owner-authoritative MapStore runtime, and is safe to use for
serious in-memory-first workloads.

This plan assumes the intended architectural stance is:

- Helios memory is the live working set and primary read/write path.
- a DynamoDB-compatible backend is the durable external backing store.
- write-behind is the recommended production mode.
- write-through must still be correct and tested.
- external persistence semantics remain at-least-once at the adapter boundary unless stronger
  guarantees are explicitly implemented and proven.

This plan is complete only when the adapter is not merely unit-tested in isolation but is proven
through Helios runtime integration, clustered owner-only external I/O proof, operational guidance,
and documented production boundaries.

## Scope

This plan covers:

- the DynamoDB-compatible MapStore package and its public API
- shared table design for Helios map persistence on DynamoDB-compatible backends
- adapter correctness for `MapStore` and `MapLoaderLifecycleSupport`
- write-through and write-behind behavior through Helios runtime
- clustered owner-only semantics and migration/failover proof
- observability, docs, and production readiness criteria

For v1, the package is intentionally DynamoDB-compatible at the API level, with Scylla/Alternator
as the first production-proof target. Additional providers may be tested later, but they should not
be claimed as production-ready until they have their own proof path.

V1 product decisions already locked for this plan:

- public naming moves to a generic DynamoDB-compatible package/API
- `clear()` is supported in v1
- `loadAllKeys()` must be truly streaming before the backend is called production-ready
- Scylla/Alternator is the only required v1 production-proof provider
- v1 must include explicit timeout config, bounded retry/backoff with jitter, and TLS/custom CA
  support
- `bucketCount` is immutable per persisted map in v1
- v1 scope remains string keys plus serialized values

This plan does not include:

- exactly-once external persistence
- split-brain merge correctness
- treating the external store as the live source of truth over Helios memory
- automatic online migration from other MapStore backends
- production claims for untested providers

## Current Helios Snapshot

Helios already has the MapStore runtime needed for a DynamoDB-compatible adapter:

- `src/map/MapStore.ts`
- `src/map/MapLoaderLifecycleSupport.ts`
- `src/map/MapStoreFactory.ts`
- `src/config/MapStoreConfig.ts`
- `src/map/impl/mapstore/MapStoreContext.ts`
- `src/map/impl/mapstore/writethrough/WriteThroughStore.ts`
- `src/map/impl/mapstore/writebehind/*`
- clustered owner-only routing and fencing in the current MapStore runtime

The repo now also has an initial implementation under `packages/scylla/`:

- `packages/scylla/src/ScyllaMapStore.ts`
- `packages/scylla/src/ScyllaConfig.ts`
- `packages/scylla/src/index.ts`
- `packages/scylla/test/ScyllaMapStore.test.ts`

Current reality of that package:

- package builds and unit tests pass
- it implements the basic `MapStore` surface
- it uses the DynamoDB-compatible Alternator API
- it is not yet proven end-to-end against a real provider
- it is not yet proven through Helios runtime integration or clustered proof
- it has no production docs/examples yet

## Product Decisions

### 1. The external store is the durability backend, not the live consistency authority

Helios remains in-memory first.

- live reads should usually come from Helios memory
- write-behind should smooth persistence latency and batch writes
- the external store is used for durability, restart recovery, and cold miss loading

### 2. The adapter targets DynamoDB-compatible item persistence

The adapter is implemented over the DynamoDB-compatible API.

- item writes are key-based upserts
- deletes are key-based
- `loadAll` uses batch-get semantics
- `loadAllKeys` uses bucketed key queries and must stream keys lazily in v1
- the public contract should support one endpoint or multiple endpoints
- Scylla/Alternator is the first proven provider, not necessarily the only future one

### 3. Public naming is generic in v1

The package and public types should match the product direction.

- rename away from Scylla-specific public naming
- package should move toward a generic DynamoDB-compatible identity
- Scylla remains the first proven provider, not the package identity

### 4. The v1 table design must avoid hot-partition collapse

Using `map_name` alone as the partition key would concentrate an entire map into one physical
partition for key scans and can become a scaling bottleneck.

The v1 design therefore uses deterministic bucketed partitioning.

- partition key: `bucket_key`
- sort key: `entry_key`
- `bucket_key = <mapName>#<bucketNumber>`
- value payload stored in `entry_value`
- `bucketCount` is treated as immutable per persisted map in v1

### 5. Full-item writes are the default contract

The adapter will optimize for simple, idempotent, full-item writes.

- no partial-update contract in v1
- no read-modify-write dependence in v1
- no optimistic concurrency/CAS semantics in v1
- key contract in v1 is string keys plus serialized values

This aligns with the currently implemented Helios MapStore SPI and with simple write-only item
persistence on DynamoDB-compatible backends.

### 6. Production readiness requires real-cluster proof

No production claim is valid based on mock-only tests.

- unit tests are necessary but insufficient
- a real provider environment must be exercised
- clustered Helios proof must verify owner-only external calls

## Implementable Target

The DynamoDB-compatible MapStore is considered production-ready only when all of the following are
true:

1. the adapter correctly implements `store`, `storeAll`, `delete`, `deleteAll`, `load`, `loadAll`,
   and `loadAllKeys`.
2. default JSON serialization works and custom serializer overrides are supported.
3. writes are idempotent and safe under retry/replay.
4. write-through works correctly through Helios runtime.
5. write-behind works correctly through Helios runtime.
6. single-member shutdown/restart durability semantics are tested.
7. `clear()` behavior is defined, implemented, and tested.
8. clustered owner-only external write semantics are proven.
9. failover/migration behavior is documented and tested to the level Helios currently guarantees.
10. docs explain the real consistency and durability contract honestly.
11. examples and package docs are enough for a user to configure the backend without reverse
    engineering the source.
12. provider support claims are scoped to providers that have actually been proven.
13. `loadAllKeys()` is truly streaming and does not require materializing all keys in memory.
14. transport config supports explicit timeouts, bounded retry/backoff with jitter, and TLS/custom
    CA configuration.

## Proposed Table Design

The v1 table should be:

- table name: `helios_mapstore` by default
- partition key: `bucket_key` (string)
- sort key: `entry_key` (string)

Stored item shape:

```text
bucket_key   = <mapName>#<bucket>
entry_key    = <logical map key>
entry_value  = <serialized value>
updated_at   = <epoch millis>
```

Rationale:

- preserves per-map logical isolation through `mapName`
- spreads a hot map across multiple deterministic buckets
- keeps single-key reads/writes efficient
- allows `loadAllKeys()` to query all buckets without table scans

## Critical Gaps To Close From The Current Package

The current implementation still needs these production closures:

- generic package/class rename and API stabilization
- define and implement `clear()` semantics through the Helios runtime path
- real provider integration tests, not just mock tests
- explicit handling and tests for `UnprocessedKeys` retry in batch-get under real behavior
- explicit wiring docs for credentials, endpoint or endpoints, endpoint strategy, region, bucket
  count, and read consistency
- true streaming `loadAllKeys()` implementation instead of buffered accumulation
- timeout, TLS/custom CA, and bounded backoff/jitter transport controls
- bucket-count immutability validation per persisted map
- Helios runtime integration coverage for LAZY and EAGER loading
- clustered proof and failover behavior against a real external store
- package README and root README example updates

## Step-by-Step Execution Plan

### Step 1: Freeze the v1 production contract

Lock the product stance before expanding the implementation.

- the external store is durability behind Helios memory
- write-behind is recommended; write-through must remain correct
- full-item writes only in v1
- no external CAS/version semantics in v1
- clustered semantics are owner-only and at-least-once at the boundary
- public package/class naming is generic DynamoDB-compatible naming
- Scylla/Alternator is the only required v1 production-proof provider
- `clear()` is supported, but documented as an expensive bucket sweep on large maps
- `loadAllKeys()` must be truly streaming in v1
- `bucketCount` is immutable per persisted map
- v1 contract remains string keys plus serialized values

Acceptance:

- plan, package README, and repo README describe the same guarantees and non-goals

### Step 2: Rename the package and public types

Execute the naming decision before expanding the public surface further.

- move toward a generic package name such as `packages/dynamodb`
- rename public types toward `DynamoDbMapStore` / `DynamoDbConfig`
- update exports, workspace wiring, README references, and tests
- keep Scylla/Alternator as the first provider-specific proof target in docs

Acceptance:

- the package identity matches the generic DynamoDB-compatible product direction

### Step 3: Review and harden the package API

Stabilize the public package/API surface.

- review config fields for completeness and naming clarity
- confirm table defaults, bucket defaults, consistency-read option, endpoint selection behavior, and
  auto-create-table behavior
- add explicit timeout config
- add TLS/custom CA configuration support
- define bounded retry/backoff+jitter config ownership
- decide which config fields are public contract versus internal tuning knobs
- add validation and fail-fast errors for invalid config

Also lock compatibility rules:

- validate string-key contract explicitly
- validate `bucketCount` compatibility so persisted maps cannot silently change bucket layout

Acceptance:

- package API is explicit enough that future tests/docs do not rely on hidden behavior

### Step 4: Define and implement `clear()` semantics

The adapter is not production-ready until map clear behavior is explicit.

Implementation target:

- delete only the rows/items for the current map across all buckets
- avoid cross-map deletion bugs in a shared table
- ensure behavior is safe under write-through and write-behind paths
- document that this is a bucket-by-bucket sweep and can be expensive on very large maps

Acceptance:

- adapter-level and runtime-level tests prove map-scoped clear correctness

### Step 5: Harden transport and retry behavior

Move from simple happy-path correctness to production retry behavior.

- add explicit request timeout control
- add TLS/custom CA support and test coverage
- confirm `BatchWriteItem` retry loop handles unprocessed writes deterministically
- confirm `BatchGetItem` retry loop handles unprocessed keys deterministically
- implement bounded backoff with jitter rather than unbounded tight retry loops
- classify missing-item versus real transport errors cleanly
- document whether non-retryable errors bubble directly to Helios runtime

Acceptance:

- tests exercise retry paths and failure classification explicitly

### Step 6: Implement true streaming `loadAllKeys()`

Replace buffered accumulation with real lazy key streaming.

- stream query results bucket by bucket
- preserve pagination without loading all keys into memory first
- verify behavior on large logical keyspaces
- document operational cost even though the implementation streams

Acceptance:

- `loadAllKeys()` can enumerate keys without materializing the full keyset in memory

### Step 7: Add package-level edge-case tests

Expand beyond the current mock suite.

- empty `storeAll` / `deleteAll` / `loadAll` behavior
- duplicate keys in batch input handling expectations
- serializer failure propagation
- consistent-read flag propagation
- bucket hashing determinism
- map isolation across multiple map names in one table
- auto-create-table race tolerance (`ResourceInUseException`)
- streaming `loadAllKeys()` pagination behavior
- timeout and TLS config propagation
- bucket-count compatibility validation

Acceptance:

- the adapter test suite covers normal, edge, and retry paths

### Step 8: Add real provider integration tests

Create a real-environment proof path against an actual DynamoDB-compatible endpoint.

The test surface must cover:

- table auto-creation or pre-provisioned table use
- store/load/delete
- storeAll/loadAll/deleteAll
- streaming `loadAllKeys()` across multiple buckets
- clear behavior
- serializer round-trip
- not-found handling
- timeout and TLS/auth wiring in the real provider setup where applicable
- bucket-count compatibility behavior

Provider proof rule:

- Scylla/Alternator is the first required proof target
- additional providers can be added later, but each one needs its own proof path before being listed
  as production-ready

The proof target must be a real provider deployment, not only mocks.

Acceptance:

- an integration suite can be run repeatedly against a real provider and passes deterministically

### Step 9: Add Helios runtime vertical-slice tests

Prove that the adapter behaves correctly through Helios, not just directly.

- `MapStoreConfig.setImplementation(new ScyllaMapStore(...))` or the renamed generic class once the
  package naming decision is made
- write-through `put/get/remove`
- write-behind flush behavior
- shutdown flush semantics
- restart recovery
- LAZY load-on-miss
- EAGER preload if supported by the configured map flow

Acceptance:

- Helios runtime integration tests pass with the proven provider backend

### Step 10: Prove clustered owner-only semantics

Run the adapter through the clustered MapStore proof path.

- only partition owners write externally
- backups never write externally while in backup role
- owner-side load-on-miss is the only external load path for owned data
- clustered clear does not duplicate external deletes

Acceptance:

- clustered proof captures external-call provenance and passes against the proven provider backend

### Step 11: Prove failover and migration behavior

The adapter is not production-ready for Helios clustering until failover behavior is explicit.

- partition migration with pending write-behind entries
- owner promotion after source failure
- graceful shutdown handoff/flush behavior
- replay-safe eventual convergence of persisted state

Acceptance:

- tests document and prove the current durability semantics without overstating them

### Step 12: Add operational observability

Make the backend supportable in production.

- surface flush latency, batch size, retry count, and external error rate
- document what to log for external persistence operations
- expose enough signals to diagnose hot partitions, batch retries, and load pressure

Acceptance:

- operators can tell whether external persistence is healthy or degraded

### Step 13: Add package docs and examples

Document how users should actually run this.

- package README with setup instructions
- example `MapStoreConfig` for write-behind
- table/schema explanation
- recommended provider settings and caveats
- note on simple write patterns versus read-modify-write/isolation choices
- explicit note that Scylla/Alternator is the only v1 production-proof provider
- explicit note that `clear()` is expensive and `loadAllKeys()` is streaming but still operationally
  heavy
- explicit note that `bucketCount` is immutable per persisted map

Acceptance:

- a new user can configure the package without inspecting source files

### Step 14: Update root docs conservatively

Only after proof exists, update the repo-level documentation.

- root README package list
- mapstore package matrix
- short usage snippet
- no unsupported production claims
- no language that implies universal DynamoDB-compatibility certification

Acceptance:

- repo docs describe exactly the tested support level

### Step 15: Add production readiness checklist

Before calling the adapter production-ready, verify all closure criteria.

- package builds cleanly
- package tests pass
- real integration tests pass
- Helios runtime integration tests pass
- clustered proof passes
- failover tests pass
- docs/examples are present
- known limitations are written down

Acceptance:

- a release review can use a single checklist rather than tribal knowledge

## Test Plan

### Package-level tests

- command construction and field mapping
- serializer behavior
- batch chunking
- retry loops for unprocessed writes/reads
- bucket hashing and map isolation
- table auto-create behavior
- clear semantics
- streaming key enumeration
- timeout/TLS config propagation
- bucket-count compatibility checks

### Real integration tests

- CRUD against a live Alternator endpoint
- batched writes and reads
- streaming key enumeration across buckets
- clear correctness
- repeated test reruns against an existing table

### Helios runtime tests

- write-through persistence
- write-behind persistence
- shutdown flush
- restart recovery
- lazy loading
- eager loading if enabled

### Clustered proof tests

- owner-only writes
- owner-only loads on miss
- backup no-write behavior
- migration/failover durability behavior
- no healthy-path duplicate external writes

## Operational Guidance To Document

The production docs must explain at least:

- write-behind is recommended for latency smoothing
- persisted state is still at-least-once at the boundary
- Scylla consistency level/read mode choices and their impact
- why bucket count matters for scale and scans
- why `loadAllKeys()` is more expensive than point lookup and should be used with care even when
  implemented as a true stream
- what state classes are appropriate for this backend
- `bucketCount` is immutable per persisted map in v1
- Scylla/Alternator is the only production-proof provider in v1

## Recommended First Production Milestone

The first milestone after the current package state should be:

1. close `clear()` and retry semantics
2. rename the package/API to generic DynamoDB-compatible naming
3. add true streaming `loadAllKeys()`
4. add real Scylla integration tests
5. add Helios single-member vertical-slice tests
6. add package README and usage example

Do not claim end-to-end readiness before those are green.

## Done Criteria

This plan is done only when:

- the package is stable and documented
- the adapter passes package, integration, runtime, and clustered proof tests
- real provider environments are part of the validation story
- docs explain the true consistency/durability model honestly
- Helios users can adopt the backend without reading internal implementation code
