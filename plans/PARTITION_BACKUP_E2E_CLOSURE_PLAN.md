# Partition + Backup End-to-End Closure Plan

## Goal

Close the remaining gap between the current Helios clustered runtime and honest Hazelcast-style
partition/backup behavior so partition ownership, promotion, refill, anti-entropy, replica sync,
and service-state failover are fully wired end to end in production.

This plan exists because Helios now contains partial Block 21.0-era recovery logic, but that logic
is not yet the single live clustered runtime path. The codebase currently has a mix of:

- real recovery primitives in `src/internal/partition/impl/InternalPartitionServiceImpl.ts`
- legacy single-node partition wiring in `src/spi/impl/NodeEngineImpl.ts`
- cluster-level partition recomputation in `src/instance/impl/HeliosClusterCoordinator.ts`
- anti-entropy and replica-sync surfaces that are only partially wired into real runtime lifecycle

The target outcome is not "tests for helper methods pass." The target outcome is:

- one clustered partition authority in production
- owner death promotes a surviving backup through the live runtime path
- missing backups refill through real state transfer
- anti-entropy and replica sync run for real after startup and after topology changes
- stale rejoin state is fenced and cannot leak back into service
- supported partition-scoped services remain correct after crash, rejoin, promotion, and refill

---

## Java Reference

Use Hazelcast Java behavior in `../helios-1/hazelcast/` as the semantic source of truth unless this
plan explicitly narrows to a Bun-native/TypeScript-native implementation shape.

Primary references:

- `hazelcast/src/main/java/com/hazelcast/internal/partition/impl/InternalPartitionServiceImpl.java`
- `hazelcast/src/main/java/com/hazelcast/internal/partition/impl/MigrationManagerImpl.java`
- `hazelcast/src/main/java/com/hazelcast/internal/partition/impl/PartitionReplicaManager.java`
- `hazelcast/src/main/java/com/hazelcast/internal/partition/operation/PartitionBackupReplicaAntiEntropyOperation.java`
- `hazelcast/src/main/java/com/hazelcast/internal/partition/operation/PartitionReplicaSyncRequest.java`
- `hazelcast/src/main/java/com/hazelcast/internal/partition/operation/PartitionReplicaSyncResponse.java`
- `hazelcast/src/main/java/com/hazelcast/internal/partition/impl/PartitionEventManager.java`

---

## Current Repo Reality

The following gaps are still present in the current codebase and prevent honest parity claims.

### 1. Runtime partition authority is still split

- `src/spi/impl/NodeEngineImpl.ts` still defaults to `SingleNodePartitionService`.
- `src/instance/impl/HeliosInstanceImpl.ts` still asks `HeliosClusterCoordinator` for owner and
  backup IDs.
- `src/instance/impl/HeliosClusterCoordinator.ts` still recomputes a fresh partition arrangement
  instead of driving repair through the live partition service.

Result: partition metadata and recovery helpers can diverge from the runtime that actually routes
operations.

### 2. Promotion-first recovery exists in code, but not as the sole production path

- `src/internal/partition/impl/InternalPartitionServiceImpl.ts` has `memberRemovedWithRepair()`.
- But cluster membership handling still uses recompute/apply flows in the coordinator.

Result: the runtime can still bypass the intended promotion/refill pipeline.

### 3. Anti-entropy lifecycle is present, but the real cycle is still placeholder-level

- `startAntiEntropy()` and `stopAntiEntropy()` exist.
- `_runAntiEntropyCycle()` is still a placeholder comment.
- No production wiring currently starts anti-entropy from instance startup / cluster lifecycle.

Result: stale backup repair is not actually running end to end.

### 4. Replica sync bookkeeping exists, but not a full runtime protocol

- sync-request registration, epochs, and stale-response rejection exist in the partition service
- but the real remote operation flow is not yet clearly driving request/response through the live
  operation service path during normal runtime recovery

Result: protocol semantics exist on paper, but not yet as the authoritative cluster repair path.

### 5. Service-state parity is not yet closed by live runtime proof

- `InternalPartitionServiceImpl` declares supported services, but that is not the same as proving
  migration, promotion, refill, and sync correctness for each service

Result: partition-table parity could be claimed before actual service payload parity is proven.

---

## Non-Negotiable Constraints

- Bun-native and TypeScript-native only
- no hidden single-node fallback in clustered production mode
- no duplicate partition authority between coordinator and runtime services
- no test-only recovery shortcuts in production code paths
- no block is complete if docs, config, exports, examples, or test-support still imply stale behavior
- when parity is ambiguous, prefer Hazelcast failure semantics and invariants

---

## Closure Blocks

### Block C1 - Make `InternalPartitionServiceImpl` the single clustered partition authority

Goal: remove split partition ownership and make the runtime partition service authoritative for all
clustered code paths.

Tasks:

- Stop defaulting clustered `NodeEngineImpl` to `SingleNodePartitionService`.
- Ensure clustered startup injects the real `InternalPartitionServiceImpl` into `NodeEngineImpl`.
- Move `getPartitionOwnerId()` / `getPartitionBackupIds()` style instance-level ownership queries to
  the same live partition service instead of coordinator-owned parallel state.
- Reduce `HeliosClusterCoordinator` to transport/publication/orchestration only, or remove its
  duplicate partition-state responsibility entirely if cleaner.
- Remove any production path that creates a fresh partition arrangement just to recompute ownership
  outside the active runtime partition service.

Completion gate:

- in clustered mode, there is exactly one production partition table authority
- operation routing, metrics, backup targeting, and public ownership queries all read the same state

### Block C2 - Route member removal through one promotion-first repair pipeline

Goal: ensure node death always uses the repair semantics already modeled in the partition service.

Tasks:

- Wire membership-removal handling to `memberRemovedWithRepair()` as the live path.
- Remove or isolate any remaining coordinator-led full recompute path that can bypass repair.
- Ensure repair publication/versioning happens through the same runtime state publication channel used
  by the cluster.
- Preserve delayed repair/control-task semantics where needed instead of immediate fresh assignment.

Completion gate:

- owner loss always triggers promotion-first repair before refill
- no clustered member-removal path bypasses runtime repair semantics

### Block C3 - Finish real anti-entropy runtime execution

Goal: make anti-entropy a real background repair mechanism rather than a lifecycle stub.

Tasks:

- Implement `_runAntiEntropyCycle()` so it actually identifies locally owned partitions and dispatches
  verification/repair work.
- Wire anti-entropy startup and shutdown into `HeliosInstanceImpl` and clustered lifecycle events.
- Pause/resume or gate anti-entropy around startup, demotion, migration-sensitive windows, and
  shutdown.
- Ensure anti-entropy continues correctly after promotion, refill, master change, and member rejoin.

Completion gate:

- anti-entropy runs automatically in production clustered mode
- dropped or delayed backup writes eventually trigger real repair activity

### Block C4 - Finish real remote replica sync protocol wiring

Goal: turn replica sync into the actual repair transport used by anti-entropy and refill.

Tasks:

- Route sync request/response through the real `OperationService` network path.
- Enforce timeout, retry, stale-epoch rejection, ownership validation, and cleanup on member death.
- Ensure sync requests are invalidated on demotion, shutdown, restart, rejoin, and owner change.
- Ensure refill/new-backup assignment can trigger the same real sync machinery.

Completion gate:

- replica sync is not just modeled; it is the real networked repair path used in clustered runtime

### Block C5 - Close service-state failover parity for all supported partition-scoped services

Goal: make supported services survive promotion/refill/sync honestly, not just partition metadata.

Tasks:

- Produce an explicit supported-service matrix from the real repo state.
- For each supported service, verify and close:
  - migration export/import
  - owner promotion cutover
  - refill/new-backup state transfer
  - anti-entropy sync payload correctness
  - shutdown/destroy cleanup
  - stale-rejoin fencing
- Any unsupported service must be explicitly documented as unsupported and excluded from parity
  claims in docs/examples/test-support.

Completion gate:

- supported services remain correct through crash, promotion, refill, and rejoin
- no parity claim rests on partition-table correctness alone

### Block C6 - Operator-visible closure: config, observability, docs, examples, test-support

Goal: ensure the real runtime path is the only documented and operable clustered recovery path.

Tasks:

- Decide which recovery settings are configurable and wire them honestly through `HeliosConfig` and
  `ConfigLoader` if exposed.
- Expose recovery metrics/events/logging for promotion, refill backlog, retries, timeouts,
  stale-response rejection, degraded safety, and partition-lost.
- Update `README.md`, examples, and `src/test-support/` so they reflect the real clustered recovery
  contract only.
- Remove any example, helper, or fixture that still implies local-only or coordinator-only fallback
  behavior.

Completion gate:

- observability and docs match the real runtime path exactly
- examples/test-support do not preserve obsolete clustered shortcuts

### Block C7 - Real multi-node acceptance proof

Goal: prove the full recovery story over the live network runtime.

Required scenarios:

- 3-node owner crash promotes first surviving backup and operations continue on promoted owner
- promoted owner later refills a new backup when capacity exists
- dropped/delayed backup traffic is repaired by anti-entropy + replica sync without manual action
- rejoining member stays fenced until authoritative partition/service-state sync completes
- owner + all replicas lost emits partition-lost and remains honest about irrecoverable loss
- recovery metrics and safety/degraded-state reporting reflect repair progress correctly
- repeated crash/rejoin cycles do not leak zombie repair loops, stale syncs, or duplicate owners

Completion gate:

- all recovery claims are backed by real TCP multi-node tests
- no final proof depends on direct test-only state injection for runtime behaviors under claim

---

## Recommended Execution Order

1. `C1` - single partition authority
2. `C2` - live promotion-first member-removal path
3. `C4` - real remote replica sync wiring
4. `C3` - real anti-entropy runtime execution
5. `C5` - service-state failover parity
6. `C6` - config/observability/docs/examples/test-support closure
7. `C7` - multi-node acceptance proof

Notes:

- `C4` must be live before `C3` can honestly claim repair completeness.
- `C5` must complete before clustered MapStore can claim durability/failover correctness on top of
  the partition system.

---

## Completion Standard

This plan is not complete unless all of the following are true:

- clustered production mode no longer uses `SingleNodePartitionService` as the active authority
- `HeliosClusterCoordinator` does not own an alternate partition-state truth source
- owner loss is repaired through the single live promotion/refill pipeline
- anti-entropy and replica sync are both active runtime behavior, not helper-level or placeholder-only
- stale rejoin state is fenced until authoritative sync completes
- supported partition-scoped services are proven correct through failover
- operator-facing docs/examples/config/test-support describe only the real runtime path
- real multi-node acceptance proof is green

---

## Suggested Cross-References

- `plans/BACKUP_PARTITION_RECOVERY_PARITY_PLAN.md`
- `plans/TYPESCRIPT_PORT_PLAN.md`
- `plans/CLUSTER_SAFE_MAPSTORE_PLAN.md`
- `src/spi/impl/NodeEngineImpl.ts`
- `src/instance/impl/HeliosClusterCoordinator.ts`
- `src/instance/impl/HeliosInstanceImpl.ts`
- `src/internal/partition/impl/InternalPartitionServiceImpl.ts`
