# Cloudflare D1 MapStore Plan

## Goal

Deliver a production-ready Cloudflare D1-backed MapStore for Helios that fits Helios's existing
owner-authoritative clustered MapStore runtime and treats D1 as an asynchronous durability layer
behind in-memory map state.

This plan assumes the intended operating model is:

- Helios memory is the live working set and primary read/write path.
- D1 is the persisted backing store used for durability and load-on-miss / restart recovery.
- write-behind is the default persistence mode for this adapter.
- clustered semantics remain owner-only for external MapStore I/O, with at-least-once behavior at
  the adapter boundary.

This plan is complete only when Helios can run a D1-backed map in single-member and multi-member
topologies without duplicate healthy-path external writes, without pretending D1 is a distributed
transaction coordinator, and without claiming stronger guarantees than the runtime actually
provides.

## Scope

This plan covers:

- a new `packages/d1/` adapter package for Cloudflare D1
- schema design for D1 as a shared multi-map persistence store
- Helios MapStore integration using the existing SPI/runtime
- write-behind operation, batching, idempotency, and replay safety
- local correctness tests plus clustered proof against owner-only external writes
- documentation and operational guidance for realistic D1 scaling limits

This plan does not include:

- exactly-once persistence guarantees
- split-brain merge correctness
- using D1 as the authoritative system of record for live writes
- Worker-native Helios runtime porting
- a full generic SQL abstraction for arbitrary external databases

## Current Helios Snapshot

Helios already has the runtime pieces a D1 adapter needs:

- `src/map/MapStore.ts`
- `src/map/MapLoaderLifecycleSupport.ts`
- `src/map/MapStoreFactory.ts`
- `src/config/MapStoreConfig.ts`
- `src/map/impl/mapstore/MapStoreContext.ts`
- `src/map/impl/mapstore/writethrough/WriteThroughStore.ts`
- `src/map/impl/mapstore/writebehind/*`

Helios also already ships a structurally similar SQL-ish adapter:

- `packages/turso/src/TursoMapStore.ts`
- `packages/turso/src/TursoConfig.ts`

That Turso adapter is the closest implementation template because it already models:

- string key/value persistence
- JSON serialization by default
- `storeAll` / `deleteAll` batching
- per-map initialization and table setup
- `load`, `loadAll`, and `loadAllKeys` on top of a SQLite/libSQL-style backend

## Product Decisions

### 1. D1 is a durability backend, not the live consistency authority

The adapter will be designed for the architecture the user described:

- Helios in-memory state is authoritative for active requests.
- D1 is updated asynchronously through write-behind by default.
- D1 read paths are primarily for lazy miss loading, restart recovery, and optional eager preload.

### 2. Shared-table schema is the v1 default

The D1 adapter will not create one physical table per Helios map by default.

- one shared table is simpler to operate and migrate
- dynamic table creation per map is unnecessary for D1 v1
- multi-map storage is handled by a `map_name` discriminator

### 3. Idempotent upsert/delete semantics are mandatory

Because clustered MapStore is at-least-once at the adapter boundary, the adapter must be replay-safe.

- writes use upsert semantics
- deletes must be harmless when repeated
- correctness must not depend on exactly-once delivery

### 4. External revisioning is out of scope for v1

Helios internal record versions exist, but they are not part of the current MapStore SPI.

- v1 D1 persistence stores only the persisted key/value plus basic timestamps
- optimistic concurrency columns may be added later, but the adapter must not pretend Helios is
  already sending compare-and-set metadata to the backend

### 5. The adapter transport must be replaceable

Cloudflare D1 access may be implemented through:

- direct remote API/client calls from the Helios runtime, or
- an internal service/Worker boundary that fronts D1

The adapter package should keep the storage contract stable so transport details can change without
rewriting the Helios MapStore integration.

## Target Behavior

The D1 MapStore is considered complete only when all of the following are true:

1. `store`, `storeAll`, `delete`, `deleteAll`, `load`, `loadAll`, and `loadAllKeys` work through
   the Helios `MapStore` SPI.
2. default serialization stores values as JSON text and supports a custom serializer contract.
3. writes are idempotent and safe under retry/replay.
4. write-through works for correctness, even if write-behind is the recommended production mode.
5. write-behind works with batching and bounded flush sizes appropriate for D1.
6. single-node restart recovery works for both LAZY and EAGER load modes that Helios already
   supports.
7. clustered owner-only external write semantics hold: backups never write to D1 while acting as
   backups.
8. failover/retry behavior is documented as at-least-once at the D1 boundary.
9. `clear()` behavior is explicit and tested against shared-table map scoping.
10. docs explain realistic D1 scaling/performance tradeoffs and do not oversell D1 as infinitely
    scalable.

## Proposed Schema

The v1 schema is a single shared table:

```sql
CREATE TABLE IF NOT EXISTS helios_mapstore (
  map_name TEXT NOT NULL,
  entry_key TEXT NOT NULL,
  entry_value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (map_name, entry_key)
);

CREATE INDEX IF NOT EXISTS idx_helios_mapstore_map_name
  ON helios_mapstore (map_name);
```

Rationale:

- `(map_name, entry_key)` matches Helios map scoping naturally
- `entry_value` as text keeps serialization simple and flexible
- `updated_at` gives basic operational visibility without pretending to be a strict consistency token
- no per-map tables means simpler migrations and easier operational tooling

## Query Contract

The adapter should standardize on these operations:

### Upsert

```sql
INSERT INTO helios_mapstore (map_name, entry_key, entry_value, updated_at)
VALUES (?, ?, ?, unixepoch())
ON CONFLICT(map_name, entry_key) DO UPDATE SET
  entry_value = excluded.entry_value,
  updated_at = excluded.updated_at;
```

### Delete One

```sql
DELETE FROM helios_mapstore
WHERE map_name = ? AND entry_key = ?;
```

### Load One

```sql
SELECT entry_value
FROM helios_mapstore
WHERE map_name = ? AND entry_key = ?;
```

### Load Many

```sql
SELECT entry_key, entry_value
FROM helios_mapstore
WHERE map_name = ?
  AND entry_key IN (?, ?, ...);
```

### Load All Keys

```sql
SELECT entry_key
FROM helios_mapstore
WHERE map_name = ?;
```

### Delete Many

```sql
DELETE FROM helios_mapstore
WHERE map_name = ?
  AND entry_key IN (?, ?, ...);
```

## Step-by-Step Execution Plan

### Step 1: Freeze the v1 contract

Write down and keep fixed the initial product contract before coding.

- D1 is durability only, not live write authority
- shared-table schema is the v1 default
- JSON text serializer is the default value format
- write-behind is the recommended production mode
- no external revision/CAS semantics in v1

Acceptance:

- this document and adapter README describe the same guarantees and non-goals

### Step 2: Create the package skeleton

Add a new package under `packages/d1/`.

Expected files:

- `packages/d1/src/D1MapStore.ts`
- `packages/d1/src/D1Config.ts`
- `packages/d1/src/index.ts`
- `packages/d1/test/*.test.ts`
- package metadata matching the repo's package layout conventions

Use `packages/turso/` as the packaging and API-shape reference.

Acceptance:

- the package builds and exports a usable `D1MapStore`

### Step 3: Define configuration and serializer contracts

Create a `D1Config` type that covers the stable adapter-facing inputs.

Minimum config:

- database/binding/client access input
- optional table name override, defaulting to `helios_mapstore`
- optional serializer override
- optional batch size override, if the transport layer benefits from a lower limit than core

Do not bake Worker-only assumptions into the public config if the runtime may also use a remote
service/client path.

Acceptance:

- adapter can be instantiated without leaking transport-specific internals into every call site

### Step 4: Implement the core adapter methods

Implement the full Helios MapStore SPI.

- `store`
- `storeAll`
- `delete`
- `deleteAll`
- `load`
- `loadAll`
- `loadAllKeys`

Implementation rules:

- always scope by `map_name`
- serialize values before persistence
- deserialize values on load
- keep `storeAll` and `deleteAll` chunked to safe sizes
- mirror the `TursoMapStore` structure where possible

Acceptance:

- single-node CRUD tests pass entirely through the adapter surface

### Step 5: Add lifecycle support

If the chosen D1 access path needs explicit setup or teardown, implement
`MapLoaderLifecycleSupport` semantics.

- create the shared table during `init()` if needed
- capture `mapName` and derived runtime config there
- release/close any client resources during `destroy()` if applicable

Acceptance:

- repeated init/destroy cycles are deterministic and safe in tests

### Step 6: Make writes replay-safe by design

Build idempotency in before performance tuning.

- all writes use upsert semantics
- all deletes are repeat-safe
- bulk operations remain correct if retried after partial progress

The proof target is not merely final-state correctness. The adapter must be safe under the runtime's
documented at-least-once delivery semantics.

Acceptance:

- retry/replay tests show convergent persisted state without write amplification bugs

### Step 7: Tune for write-behind batching

Optimize around Helios's existing write-behind path.

- confirm `storeAll` is the normal flush path for queued writes
- choose conservative batch sizes for D1
- avoid huge `IN (...)` or giant multi-row payloads that would make D1 the bottleneck
- keep flush latency and database statement size visible in tests/metrics

Acceptance:

- write-behind tests show fewer external calls than write-through for bursty writes
- batch sizing is explicit in code and docs, not accidental

### Step 8: Validate load modes and restart behavior

Prove that D1 persistence can repopulate Helios correctly.

- LAZY load-on-miss works for cold entries
- EAGER preload works when `loadAllKeys` is enabled
- invalid config combinations fail clearly
- shutdown flush plus restart recovery are deterministic

Acceptance:

- restart tests pass for both write-through and write-behind-backed maps

### Step 9: Prove shared-table `clear()` correctness

Ensure `clear()` deletes only the target Helios map's persisted rows.

- no cross-map deletion bugs
- chunked `deleteAll` still scopes by `map_name`
- empty-map clears no-op cleanly

Acceptance:

- tests create multiple logical maps in one D1 database and verify isolation

### Step 10: Add clustered owner-only proof

Run the D1 adapter against Helios's clustered MapStore semantics.

- only partition owners may issue external D1 writes/loads/deletes
- backups must not talk to D1 while in backup role
- migration/failover must preserve the documented at-least-once semantics without healthy-path
  duplicate writes

This proof should follow the spirit of the existing clustered MapStore proof work already present in
the repo and must not rely solely on final database state assertions.

Acceptance:

- a clustered proof test captures external-call provenance and demonstrates owner-only behavior

### Step 11: Add observability hooks and operational docs

Make the adapter supportable before calling it production-ready.

- log/measure flush batch size, flush latency, retry count, and load latency
- document realistic D1 constraints: single-database write bottleneck, statement-size limits, and
  why sharding by map/tenant may be needed for larger deployments
- document recommended MapStore settings for D1, especially write delay and batch size

Acceptance:

- README and package docs explain both the happy path and the scaling limits honestly

### Step 12: Ship only after explicit readiness review

Before claiming support, verify all prior steps with tests and docs in place.

- single-node correctness is green
- clustered proof is green
- write-behind is the documented recommended mode
- no docs claim exactly-once persistence or unlimited D1 scaling

Acceptance:

- package is publishable and repo docs describe the adapter conservatively and accurately

## Test Plan

### Unit tests

- serializer round-trip
- key scoping by `map_name`
- `store` / `load`
- `storeAll` / `loadAll`
- `delete` / `deleteAll`
- `loadAllKeys`
- replay-safe repeated upserts/deletes
- `clear()` isolation across multiple Helios maps

### Runtime integration tests

- write-through map behavior through Helios `IMap`
- write-behind flush behavior through Helios `IMap`
- LAZY load-on-miss after restart
- EAGER preload behavior
- shutdown flush behavior

### Clustered proof tests

- two-node and multi-node owner-only write proof
- failover while write-behind queue contains pending entries
- migration/rebalance without backup-side external writes
- duplicate-retry tolerance at the persisted-state boundary

## Scaling and Performance Guidance

The adapter docs must state these constraints plainly:

- Helios can scale in-memory map traffic horizontally across nodes and partitions.
- a single D1 database does not scale writes the same way; it remains a SQLite-derived serialized
  write target
- write-behind smooths latency and reduces call count, but it does not remove the D1 write ceiling
- larger deployments should shard by map, tenant, or workload across multiple D1 databases
- D1 is a good fit for durable metadata/config/state workloads, not for extreme hot-write streams

## Recommended First Milestone

The first implementation milestone should be intentionally narrow:

1. package skeleton
2. shared-table schema
3. single-node adapter correctness
4. write-behind batching proof
5. restart recovery proof

Do not start with clustered claims, external revisioning, or fancy query features.

## Done Criteria

This plan is done only when:

- `packages/d1/` exists with a stable public API
- the adapter passes single-node and clustered proof tests
- write-behind is tested and documented as the default operational mode
- docs clearly explain at-least-once semantics and D1 scaling limits
- the implementation does not rely on assumptions that the current Helios MapStore SPI does not
  actually provide
