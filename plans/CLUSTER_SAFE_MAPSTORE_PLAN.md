# Cluster-Safe MapStore Plan

## Goal

Deliver owner-authoritative clustered MapStore semantics for Helios so multiple Helios instances can
share the same external persistence layer without duplicate writes, duplicate deletes, fake
single-node fallbacks, or hand-wavy failover behavior.

This plan covers:

- the core clustered execution substrate required for authoritative partition-owner map operations
- the MapStore runtime changes needed for per-partition ownership, backup behavior, and migration
- write-through and write-behind behavior in a real multi-member Helios TCP cluster
- cluster-safe eager load, lazy load, clear, and bulk path semantics
- real proof using at least one production adapter after the single-node adapter work is complete
- docs, examples, and acceptance gates that only claim what the runtime can actually do

This plan is not complete if clustered MapStore still depends on mutation broadcast replay,
caller-side persistence, or adapter-specific hacks.

## Reference Sources

Hazelcast clustered MapStore behavior and ownership rules are taken from these Java references in
`../helios-1/`:

- `hazelcast/src/main/java/com/hazelcast/map/impl/mapstore/BasicMapStoreContext.java`
- `hazelcast/src/main/java/com/hazelcast/map/impl/mapstore/MapStoreManager.java`
- `hazelcast/src/main/java/com/hazelcast/map/impl/mapstore/writethrough/WriteThroughStore.java`
- `hazelcast/src/main/java/com/hazelcast/map/impl/mapstore/writebehind/WriteBehindStore.java`
- `hazelcast/src/main/java/com/hazelcast/map/impl/mapstore/writebehind/StoreWorker.java`
- `hazelcast/src/main/java/com/hazelcast/map/impl/operation/MapChunk.java`
- `hazelcast/src/main/java/com/hazelcast/map/impl/proxy/MapProxySupport.java`
- `hazelcast/src/test/java/com/hazelcast/map/impl/mapstore/writebehind/MapStoreWriteBehindSplitBrainTest.java`
- `hazelcast/src/test/java/com/hazelcast/map/impl/mapstore/MapStoreDataLoadingContinuesWhenNodeJoins.java`

## Current Helios Snapshot

Helios already has building blocks that matter for clustered MapStore, but they do not yet form an
honest owner-authoritative runtime:

- `src/spi/impl/operationservice/impl/OperationServiceImpl.ts` has routing scaffolding, retry, and
  remote-send hooks.
- `src/internal/partition/impl/InternalPartitionServiceImpl.ts` has partition ownership,
  repartitioning, and migration-aware-service scaffolding.
- `src/map/impl/operation/MapReplicationOperation.ts` and
  `src/map/impl/operation/WriteBehindStateHolder.ts` already sketch write-behind replication state.

But the live clustered map path is still incompatible with honest clustered MapStore:

- `src/map/impl/NetworkedMapProxy.ts` broadcasts `MAP_PUT`, `MAP_REMOVE`, and `MAP_CLEAR` to peers.
- `src/instance/impl/HeliosInstanceImpl.ts` applies those peer messages directly into local map
  state, which means every member can replay the same logical mutation.
- `src/map/impl/MapProxy.ts` calls `MapDataStore.add/remove/load/clear` in the caller after the
  partition operation returns, so persistence side effects are not tied to partition ownership.
- `src/spi/impl/NodeEngineImpl.ts` still wires a single-node partition service and an
  `OperationServiceImpl` without a real remote operation path.
- `src/map/impl/mapstore/MapStoreContext.ts` creates one `MapDataStore` per map, not one
  partition-scoped data store per local partition replica.
- `src/map/impl/MapContainerService.ts` does not participate in migration as a
  `MigrationAwareService`.
- current EAGER load behavior is member-local and map-wide, not ownership-aware.

This means current multi-node MapStore behavior is not just incomplete. It is structurally unsafe:
two members can reach the same external store for one logical mutation.

## Dependency Rule

This plan builds on the single-node MapStore closure work in
`plans/MONGODB_MAPSTORE_PRODUCTION_PLAN.md` and any equivalent adapter-level single-node proof.

- no block here may weaken single-node correctness to get clustered behavior faster
- no adapter may claim clustered MapStore support until both its single-node proof and this core
  clustered proof are green

## Implementable Target

Clustered MapStore support is complete only when all of the following are true:

1. map mutations route to the current partition owner through the operation service, not through
   mutation broadcast replay.
2. external `store`, `storeAll`, `delete`, and `deleteAll` calls happen only on partition owners.
3. backup replicas do not call the external MapStore while acting as backups.
4. MapStore runtime state is partition-scoped, with explicit owner and backup behavior.
5. write-through and write-behind both work correctly in a multi-member Helios TCP cluster.
6. `get`/`getAll` misses call `load`/`loadAll` only on the owner member for the relevant partition.
7. EAGER loading does not cause every member to enumerate or load the entire external dataset.
8. `clear()` does not fan out duplicate external deletes across members.
9. `putAll()` and `getAll()` use real owner-routed bulk runtime paths and reach `storeAll()` /
   `loadAll()` end to end.
10. migration and owner promotion preserve in-memory data plus write-behind metadata so pending
    writes are not silently dropped.
11. graceful shutdown of an owning member flushes or hands off owned write-behind work
    deterministically before shutdown completes.
12. crash/failover durability semantics are explicit and tested; no exact-once guarantee is claimed
    unless it is actually implemented.
13. at least one real adapter proves the full clustered vertical slice against a real external
    store after adapter-level single-node work is complete.

This target explicitly excludes split-brain merge correctness, exactly-once external persistence,
WAN replication, and any adapter that has not passed the clustered proof gate.

## Product Decisions

### 1. Partition owner is the only external writer

Helios will match Hazelcast's core rule:

- the partition owner is authoritative for external MapStore writes and deletes
- backups replicate state needed for failover and migration
- backups do not talk to the external store while they are backups

### 2. Clustered MapStore is at-least-once at the adapter boundary

This plan does not claim exactly-once external persistence.

- successful healthy-cluster execution must never produce duplicate external writes just because
  multiple members saw the same logical mutation
- crash, timeout, retry, and owner-failover semantics are at-least-once unless a later block adds
  stronger transactional guarantees and proves them

### 3. MapStore lifecycle splits into map-level and partition-level state

Helios will keep one map-level wrapper/lifecycle owner per map per member and many partition-scoped
`MapDataStore` instances underneath it.

- map-level concerns: adapter instantiation, `init()`, `destroy()`, shared properties, logging
- partition-level concerns: owner/backup role, write-through behavior, write-behind queues,
  flush sequence tracking, migration capture, promotion, and handoff

### 4. Clustered EAGER load is coordinated, not repeated on every member

EAGER preload in clustered mode must be a single coordinated load epoch per map.

- one authoritative sweep enumerates keys once for the map-load epoch
- keys are partitioned by current owner and loaded where they belong
- backups receive data through normal backup replication, not through independent store reads

### 5. Legacy map broadcast becomes signaling only or is removed

`MAP_PUT`, `MAP_REMOVE`, and `MAP_CLEAR` cannot remain the authoritative clustered map data path.

- owner-routed operations become the consistency path
- any remaining transport broadcast is limited to non-authoritative signaling such as invalidation,
  and only if still needed after the owner-routed path is complete

### 6. Adapter support is opt-in and proof-based

Finishing this core plan does not automatically make every MapStore adapter cluster-safe.

- an adapter becomes cluster-safe only after it passes the clustered proof suite
- MongoDB is the first intended real-adapter proof target after Phase 19 single-node readiness

## Critical Wiring Decisions

### Cluster execution substrate

- `NodeEngineImpl` must stop acting like a single-node engine in TCP-clustered mode.
- `OperationServiceImpl` remote invocation path must be fully wired, including request dispatch,
  response correlation, error propagation, and backup acknowledgements.
- `NetworkedMapProxy` must stop being the clustered data-consistency mechanism.

### MapStore call site

- external persistence must move out of `MapProxy` caller-side post-processing.
- owner-executed map operations or owner-side record-store logic must become the place where
  MapStore side effects occur.
- non-owner members must never call `store`/`delete`/`load` locally for partition-owned data just
  because a proxy method was invoked there.

### Partition-scoped runtime

- `MapStoreContext` must manage shared wrapper lifecycle plus partition-scoped data stores.
- owner and backup roles must be explicit in code, not inferred indirectly from transport behavior.
- write-behind queue state and flush metadata must be scoped per partition replica.

### Migration and promotion

- `MapContainerService` must become migration-aware for map data and write-behind state.
- backup-to-owner promotion must have an explicit cutover point after migration finalization.
- a promoted backup must continue pending write-behind work without replaying already-finished work.

### EAGER load and clear

- clustered EAGER load must use a coordinated one-sweep model.
- clustered `clear()` must use an ownership-aware delete path that does not duplicate external work.
- a per-member best-effort `loadAllKeys()`/`deleteAll()` loop is not acceptable.

### Failure contract

- migration-in-flight partitions must reject or retry persistence-bearing operations cleanly.
- graceful shutdown must flush or hand off owner-scoped write-behind work deterministically.
- crash/failover durability semantics must be written down and proven, not implied.

## Architecture

### Core surfaces that must change

Cluster-safe MapStore is a core-runtime project, not an adapter-only project. Expect changes in at
least these areas:

- `src/spi/impl/NodeEngineImpl.ts`
- `src/spi/impl/operationservice/impl/OperationServiceImpl.ts`
- `src/cluster/tcp/ClusterMessage.ts`
- `src/cluster/tcp/TcpClusterTransport.ts`
- `src/instance/impl/HeliosInstanceImpl.ts`
- `src/map/impl/NetworkedMapProxy.ts`
- `src/map/impl/MapProxy.ts`
- `src/map/impl/MapContainerService.ts`
- `src/map/impl/mapstore/MapStoreContext.ts`
- `src/map/impl/mapstore/MapDataStore.ts`
- `src/map/impl/mapstore/writethrough/*`
- `src/map/impl/mapstore/writebehind/*`
- `src/map/impl/operation/*`
- `src/internal/partition/impl/*` where migration finalization and service replication are wired
- `test/map/**`
- `test/instance/**`
- real-adapter integration tests after adapter-level single-node proof is done

### Recommended runtime split

The clustered runtime should have three layers:

1. cluster execution layer
   - resolves partition owner
   - invokes the operation on the owner member
   - delivers backup operations and acknowledgements

2. owner-side map mutation layer
   - mutates the owner `RecordStore`
   - performs MapStore side effects on the owner only
   - emits invalidation or listener notifications after authoritative execution

3. partition-scoped MapStore layer
   - owner: real write-through or write-behind behavior
   - backup: state-shadowing behavior only, no external writes
   - migration/promotion: capture, apply, resume, and finalize

### MapStore context model

Refactor the current per-map `MapStoreContext` into a model that can support both shared lifecycle
and partition-scoped runtime state.

Minimum structure:

- shared wrapper per map/member
- shared adapter lifecycle per map/member
- partition-scoped `MapDataStore` instances for local primary and backup replicas
- explicit role transitions on migration and promotion

### EAGER and clear coordinator model

Clustered EAGER load and clustered clear must be coordinated operations, not accidental side
effects of local map creation.

- one coordinator enumerates keys once for the map-load or map-clear epoch
- keys are partitioned by current partition ownership
- owners perform the actual `loadAll` / `deleteAll` work for their partitions
- backups are populated through replication, not duplicated external operations

### Migration model

Use the existing migration-aware scaffolding instead of inventing adapter-specific failover code.

- `MapContainerService` prepares map replication state and write-behind state for the migrating
  partition
- destination applies the partition state before becoming authoritative
- finalization promotes the new owner and demotes or clears the old owner state

## Delivery Blocks

### Block C0 - Clustered MapStore contract freeze

Goal: freeze an honest clustered MapStore contract before changing the runtime.

Deliverables:

- keep/adapt/defer matrix against Hazelcast clustered MapStore behavior
- explicit durability statement: clustered MapStore is at-least-once at the adapter boundary
- explicit rule that only partition owners may call the external store
- explicit adapter-eligibility rule: no clustered support claim without real proof
- removal of any docs/plan language that implies current broadcast replay is acceptable

Exit gate:

- there is a single written contract for clustered MapStore semantics, durability scope, and proof
  requirements; no hidden assumptions remain

### Block C1 - Cluster execution substrate for owner-routed maps

Goal: make clustered map operations truly owner-routed instead of locally applied then broadcast.

Deliverables:

- cluster-aware `NodeEngineImpl` wiring for TCP-clustered mode
- real partition-owner view exposed to operation routing
- `OperationServiceImpl` remote-send path fully wired with request/response correlation
- transport handling for `OPERATION`, `OPERATION_RESPONSE`, `BACKUP`, and `BACKUP_ACK`
- map mutation correctness no longer depends on `MAP_PUT`, `MAP_REMOVE`, or `MAP_CLEAR`

Tests:

- partition-owned operation executes on the remote owner when caller is not owner
- operation responses and failures round-trip correctly across members
- sync backup acknowledgements are delivered through the real remote path
- map correctness still holds when legacy mutation broadcast is disabled for the tested path

Exit gate:

- Helios has a real owner-routed clustered map execution substrate that can carry authoritative map
  operations without peer replay

### Block C2 - Owner-authoritative map mutation and load path

Goal: move MapStore side effects and load behavior onto the partition owner.

Deliverables:

- `MapProxy` no longer performs external MapStore work in the caller after `invokeOnPartition()`
- owner-executed mutation path performs write-through or write-behind behavior on the owner only
- owner-executed miss path performs `load` / `loadAll` on the owner only
- `putAll()` and `getAll()` are upgraded to owner-routed bulk paths that reach `storeAll()` /
  `loadAll()` end to end
- `clear()` is routed as an owner-aware multi-partition operation, not caller-local plus global
  MapStore clear side effect

Tests:

- two-node write-through proof with a counting store shows exactly one external write/delete per
  logical mutation
- non-owner caller never invokes adapter `store` / `delete` / `load` locally
- `putAll()` reaches `storeAll()` through the real owner path
- `getAll()` misses reach `loadAll()` through the real owner path
- `clear()` performs one ownership-aware external delete flow, not one flow per member

Exit gate:

- the authoritative clustered data path is owner-routed and MapStore side effects occur only there

### Block C3 - Partition-scoped MapStore runtime and backup roles

Goal: replace the current per-map MapDataStore model with a partition-scoped clustered runtime.

Deliverables:

- refactored `MapStoreContext` that owns shared wrapper/lifecycle plus partition-scoped stores
- partition-scoped write-through behavior with explicit backup no-op semantics for external writes
- partition-scoped write-behind queues and flush metadata
- explicit owner, backup, and promoted-owner role transitions in code
- deterministic init/destroy semantics for shared wrapper vs partition stores

Tests:

- wrapper `init()` happens once per map/member, not once per partition
- backup replicas never call the external store while in backup role
- write-behind queue state is partition-scoped and isolated correctly
- owner promotion changes behavior from shadow-only to external-writer at the correct time

Exit gate:

- clustered MapStore runtime has explicit per-partition ownership semantics; no per-map shortcut
  remains that could cause duplicate external writes

### Block C4 - Migration, failover, and shutdown handoff

Goal: preserve clustered MapStore correctness while ownership changes.

Deliverables:

- `MapContainerService` participates as a `MigrationAwareService`
- `MapReplicationOperation` and `WriteBehindStateHolder` are wired into real migration flow
- migration apply/finalize/rollback paths move map data and write-behind metadata correctly
- owner demotion/promotion cutover is explicit and tested
- graceful member shutdown flushes or hands off owned write-behind work deterministically

Tests:

- partition migration transfers pending write-behind entries and flush metadata
- promoted backup resumes pending writes without replaying already-finished entries
- owner leave and graceful shutdown do not produce duplicate external writes
- migration rollback does not leave two external writers active for the same partition

Exit gate:

- partition ownership changes are compatible with clustered MapStore correctness and write-behind
  durability scope

### Block C5 - Clustered EAGER load and coordinated clear

Goal: make map-wide load and clear semantics ownership-aware in a real cluster.

Deliverables:

- coordinated EAGER preload epoch that enumerates external keys once per map-load event
- partitioning of preload work by current partition owner
- backup population through replication, not repeated store reads
- coordinated external clear flow that partitions delete work by owner
- deterministic behavior when membership changes during EAGER load or clear

Tests:

- EAGER load in a two-node cluster calls `loadAllKeys()` only through the coordinated path, not once
  per member
- EAGER-loaded data lands on owners and becomes visible through normal clustered access
- member join during EAGER load does not cause duplicate external writes or duplicate key loading
- clear in a two-node cluster deletes each external key exactly once

Exit gate:

- cluster-wide load and clear semantics are ownership-aware and free of duplicate external work

### Block C6 - Real adapter proof, docs, and production gate

Goal: prove the core plan works with a real adapter and document only supported behavior.

Deliverables:

- clustered proof suite against a real adapter after its single-node plan is complete
- MongoDB is the first intended proof adapter because Phase 19 already defines its single-node
  production contract
- docs for clustered MapStore scope, durability, failover behavior, and adapter eligibility
- examples only for paths that actually work end to end

Tests:

- counting test adapter proves no duplicate writes/deletes under two-node write-through and
  write-behind flows
- real MongoDB clustered integration suite proves owner-only writes, lazy load, eager load,
  migration, shutdown handoff, and restart/failover behavior
- docs/examples smoke tests run only against supported clustered paths

Exit gate:

- Helios has a real clustered MapStore vertical slice proven by both a deterministic counting store
  and at least one real external adapter

### Block C7 - Production proof gate

Goal: do not ship clustered MapStore until the whole vertical slice is proven under realistic
multi-member flows.

Required proof:

- clustered operation-routing tests green
- clustered write-through tests green
- clustered write-behind tests green
- migration and owner-promotion tests green
- EAGER-load coordination tests green
- clear coordination tests green
- graceful shutdown handoff tests green
- failover durability tests green under the documented at-least-once contract
- real MongoDB clustered proof suite green after adapter single-node readiness is already green
- root and adapter-specific typechecks green

Required output:

```text
GATE-CHECK: block=C7 required=10 passed=10 labels=cluster-mapstore-routing,cluster-mapstore-writethrough,cluster-mapstore-writebehind,cluster-mapstore-migration,cluster-mapstore-owner-promotion,cluster-mapstore-eager-load,cluster-mapstore-clear,cluster-mapstore-shutdown-handoff,cluster-mapstore-mongodb-proof,typescript
```

## Test Matrix

### Core clustered labels

- `cluster-mapstore-routing`
- `cluster-mapstore-writethrough`
- `cluster-mapstore-writebehind`
- `cluster-mapstore-backup-no-external-write`
- `cluster-mapstore-migration`
- `cluster-mapstore-owner-promotion`
- `cluster-mapstore-shutdown-handoff`
- `cluster-mapstore-failover-at-least-once`

### Load and bulk labels

- `cluster-mapstore-lazy-load`
- `cluster-mapstore-eager-load`
- `cluster-mapstore-getall-bulk`
- `cluster-mapstore-putall-bulk`
- `cluster-mapstore-clear`

### Real adapter labels

- `cluster-mapstore-counting-store-proof`
- `cluster-mapstore-mongodb-proof`

Every label above must map to a committed test file, exact command, or CI job before Block C7
closes.

## Suggested File Targets

Core runtime and transport:

- `src/spi/impl/NodeEngineImpl.ts`
- `src/spi/impl/operationservice/impl/OperationServiceImpl.ts`
- `src/cluster/tcp/ClusterMessage.ts`
- `src/cluster/tcp/TcpClusterTransport.ts`
- `src/instance/impl/HeliosInstanceImpl.ts`

Map runtime and MapStore core:

- `src/map/impl/NetworkedMapProxy.ts`
- `src/map/impl/MapProxy.ts`
- `src/map/impl/MapContainerService.ts`
- `src/map/impl/mapstore/MapStoreContext.ts`
- `src/map/impl/mapstore/MapDataStore.ts`
- `src/map/impl/mapstore/writethrough/*.ts`
- `src/map/impl/mapstore/writebehind/*.ts`
- `src/map/impl/operation/*.ts`

Migration and proof:

- `src/internal/partition/impl/*.ts`
- `test/map/**`
- `test/instance/**`
- `packages/mongodb/test/**` after Phase 19 single-node adapter work is green

## Explicit Non-Goals

- exactly-once external persistence across crash, retry, or network partition
- split-brain merge correctness for MapStore
- WAN replication or cross-cluster external-write coordination
- making every current adapter cluster-safe without adapter-specific proof
- preserving legacy broadcast-replay map semantics as an alternate clustered correctness path

Deferred unless a dedicated later block is added and completed:

- split-brain healing parity for write-behind MapStore
- MapStore offload parity in clustered mode
- transactional external persistence semantics stronger than at-least-once
- full client-protocol parity for every clustered MapStore edge case before member-to-member proof is stable

## Final Acceptance Criteria

This plan is complete only when all of the following are true:

- multiple Helios instances can enable the same MapStore-backed map without duplicate external
  writes or deletes caused by member replay
- partition owners are the only external writers
- backups replicate enough state for failover and migration without writing externally while backup
- owner-routed operations, not mutation broadcast, are the authoritative clustered data path
- write-through and write-behind both work across member join, leave, shutdown, and owner change
- EAGER load, LAZY load, clear, getAll, and putAll have real clustered runtime wiring
- migration and shutdown semantics preserve the documented at-least-once durability contract
- at least one real adapter proves the full clustered vertical slice after its single-node proof is complete
- docs, examples, and plan language only claim behavior the repo can actually run end to end
