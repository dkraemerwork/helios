# Backup Partition Recovery Parity Plan

## Purpose

This plan closes the gap between Helios and Hazelcast for partition-backup recovery after member
death. The target outcome is full feature parity for:

- surviving backup promotion when the owner dies
- deterministic refill of missing backup replicas after promotion
- automatic anti-entropy repair of stale or missed backup state
- partition-lost detection when all replicas are gone
- end-to-end multi-node correctness under crash, rejoin, and packet-loss scenarios

This is an execution plan, not a research note. It is intentionally narrower than
`plans/MULTI_NODE_RESILIENCE_PLAN.md`: it focuses only on the owner-loss / backup-recovery path and
the runtime wiring required to make that path real in production.

Implementation constraints for this plan:

- Bun-native and TypeScript-native only
- no Java-style compatibility shims that keep parallel old and new runtimes alive indefinitely
- no fake fallbacks, no local-only bypasses, no test-only recovery shortcuts in production paths
- no block is complete unless the production runtime itself uses the new path end to end

**Repo:** `/Users/zenystx/IdeaProjects/helios/`
**Java reference:** `/Users/zenystx/IdeaProjects/helios-1/` (read-only)

---

## Why This Plan Exists

Helios already contains pieces of the Phase 16 partition and replica machinery, but the current
runtime is not yet end-to-end equivalent to Hazelcast for backup recovery:

- the live clustered partition table is managed in `src/instance/impl/HeliosClusterCoordinator.ts`
- `NodeEngineImpl` still exposes a single-node partition service stub in
  `src/spi/impl/NodeEngineImpl.ts`
- `InternalPartitionServiceImpl.memberRemoved()` recomputes assignments directly instead of running
  Hazelcast-style promotion + refill repair flow
- anti-entropy classes exist, but they are not wired into the production runtime as a scheduled,
  gated background process
- replica sync classes exist, but they are not yet full remote request/response runtime operations
- there is no partition-lost listener/event surface

As a result, a node death may appear to rebalance ownership, but Helios does not yet guarantee the
same semantics Hazelcast provides: promote first surviving backup, preserve partition continuity,
rebuild backup redundancy, and automatically recover stale backup state.

---

## Hazelcast Semantics To Match

The implementation in `helios` should match these Hazelcast behaviors exactly in intent:

1. Member leaves or crashes.
2. Partition service performs removal bookkeeping and cancels in-flight replica sync work for the
   departed member.
3. Missing owners are repaired by promoting the first surviving backup to owner.
4. If no replica survives, a partition-lost event is emitted.
5. After promotions, repartitioning fills newly empty backup slots on remaining/joining members.
6. Background anti-entropy verifies backup versions and triggers replica sync for missed state.
7. Replica sync is a real remote protocol with retries, throttling, timeouts, and stale-response
   rejection.

Primary Java reference points:

- `hazelcast/src/main/java/com/hazelcast/internal/partition/impl/InternalPartitionServiceImpl.java`
- `hazelcast/src/main/java/com/hazelcast/internal/partition/impl/MigrationManagerImpl.java`
- `hazelcast/src/main/java/com/hazelcast/internal/partition/impl/PartitionReplicaManager.java`
- `hazelcast/src/main/java/com/hazelcast/internal/partition/operation/PartitionBackupReplicaAntiEntropyOperation.java`
- `hazelcast/src/main/java/com/hazelcast/internal/partition/operation/PartitionReplicaSyncRequest.java`
- `hazelcast/src/main/java/com/hazelcast/internal/partition/operation/PartitionReplicaSyncResponse.java`
- `hazelcast/src/main/java/com/hazelcast/internal/partition/impl/PartitionEventManager.java`

---

## Current Gap Summary

### 1. Split runtime authority

The largest correctness problem is that the authoritative partition table for clustered mode lives
outside the runtime services that execute operations.

- `src/instance/impl/HeliosClusterCoordinator.ts` owns clustered partition snapshots and rewrites
  them on membership changes
- `src/spi/impl/NodeEngineImpl.ts` still exposes `SingleNodePartitionService` to runtime consumers

This must be unified before promotion, refill, or anti-entropy can be trustworthy.

### 2. No true promotion pipeline

`src/internal/partition/impl/InternalPartitionServiceImpl.ts` currently calls repartition directly
on member removal. That is not equivalent to Hazelcast promotion semantics. The system needs a
staged repair pipeline:

- remove dead member from table
- promote surviving replica into owner slot
- publish updated runtime state
- refill missing backup slots via migration/state transfer

### 3. No partition-lost feature

If all replicas are gone, Helios currently has no listener/event surface equivalent to Hazelcast's
partition-lost reporting.

### 4. Anti-entropy is modeled but not runtime-wired

`src/internal/partition/impl/AntiEntropyTask.ts` and related classes exist, but there is no
production scheduler, gating, or partition-thread style dispatch path that continuously verifies
backup health.

### 5. Replica sync is incomplete as a networked protocol

Helios has request/response classes, but not yet the full runtime behavior Hazelcast relies on:

- sync-request registry
- timeout cleanup
- retry response path
- stale-response rejection
- per-namespace or equivalent fragment accounting
- real remote routing through `OperationService`

### 6. End-to-end proof is missing

Current tests do not yet prove the full owner-crash -> promotion -> refill -> anti-entropy repair
story on a real multi-node clustered runtime.

---

## Design Rules

- One partition table authority in production. `HeliosClusterCoordinator` and runtime partition
  services must not diverge.
- Prefer replacement over layering. If an old clustered shortcut conflicts with the real recovery
  path, remove it instead of preserving it behind fallback switches.
- Promotion is not the same as repartitioning. Promote first, rebalance second.
- Runtime consumers (`OperationService`, map/queue services, backup execution, migration logic,
  metrics) must all read from the same partition service.
- Partition continuity is preserved by promoting surviving replicas, not by recomputing a fresh
  arrangement from scratch.
- Anti-entropy is mandatory for correctness, not optional monitoring.
- If no replica survives, fail honestly with partition-lost signaling rather than silently
  inventing recovery.
- Production code must have one clean runtime path. Test helpers may simulate failures, but they may
  not introduce alternate recovery logic unavailable to real nodes.

---

## Implementation Blocks

### Block R1 - Unify clustered partition authority

Goal: make the runtime partition service the only production source of truth for ownership and
replicas.

Tasks:

- Replace the single-node `NodeEngineImpl` partition-service stub with the clustered
  `InternalPartitionServiceImpl` when TCP-clustered mode is active.
- Define whether `HeliosClusterCoordinator` becomes:
  - a thin transport/control-plane facade over `InternalPartitionServiceImpl`, or
  - fully subsumed into cluster + partition runtime services.
- Remove production-time stub partition services and any runtime branch that keeps a fake
  single-node partition authority alive in clustered mode.
- Remove any production path where membership changes rebuild a parallel partition table outside the
  runtime partition service.
- Ensure `getPartitionOwnerId()`, `getPartitionBackupIds()`, operation routing, backup execution,
  and migration code all consult the same partition table.

Primary touched areas:

- `src/spi/impl/NodeEngineImpl.ts`
- `src/instance/impl/HeliosInstanceImpl.ts`
- `src/instance/impl/HeliosClusterCoordinator.ts`
- `src/internal/partition/impl/InternalPartitionServiceImpl.ts`

Exit criteria:

- no split-brain partition authority remains in production clustered mode
- owner/backup lookup used by metrics and by execution path is identical

### Block R2 - Member-removal bookkeeping and repair trigger

Goal: match Hazelcast's removal handling before repair starts.

Tasks:

- Add a real member-removal path that performs bookkeeping before partition repair.
- Cancel replica-sync requests targeting the departed member.
- Preserve departed-member partition snapshot state where needed for master recovery logic.
- Add new-master recovery behavior for stale partition-table takeover scenarios.
- Introduce a delayed control-task or equivalent repair trigger instead of immediate full rewrite.
- On shutdown, master loss, or local demotion, cancel anti-entropy schedules, pending repair
  intents, sync registries, and permits so no zombie repair work survives role change.

Primary Hazelcast reference:

- `InternalPartitionServiceImpl.memberRemoved(...)`
- `MigrationManagerImpl` control-task scheduling

Exit criteria:

- member death enters a deterministic repair workflow
- in-flight sync work against the dead member is cleaned up
- new master can recover from stale or partially published partition state

### Block R3 - Promotion-first repair pipeline

Goal: when an owner disappears, promote the first surviving backup into owner slot before any
repartition/refill work.

Tasks:

- Detect partitions whose owner is missing.
- Find first surviving replica index `1..N` and construct promotion work.
- Apply promotion as a partition-table mutation that preserves replica ordering semantics.
- Increment partition versions with Hazelcast-compatible promotion/failure semantics.
- Publish the post-promotion runtime state to all members.
- Ensure promoted owner immediately becomes authoritative for operation routing and backups.

Important behavior:

- do not replace promotion with a generic fresh assignment
- do not allow operation routing to race against stale pre-promotion owner data

Primary touched areas:

- `src/internal/partition/impl/MigrationManager.ts`
- `src/internal/partition/impl/InternalPartitionServiceImpl.ts`
- `src/internal/partition/impl/InternalPartitionImpl.ts`
- `src/internal/partition/impl/PartitionStateManager.ts`

Exit criteria:

- owner crash causes backup promotion, not full reassignment masquerading as promotion
- promoted owner serves traffic without waiting for full rebalance

### Block R4 - Backup refill and rebalance after promotion

Goal: after promotion, restore redundancy by filling empty backup slots on surviving or newly
joined members.

Tasks:

- Plan refill migrations separately from owner promotion.
- Transfer partition replica state to newly assigned backups.
- Preserve backup version metadata and post-copy sync state.
- Support refill after crash, graceful leave, and later member rejoin.
- Make refill observable through partition-table publication and cluster-safe checks.
- Fence rejoining members with stale local replica data until authoritative partition-table
  epoch/version is installed and required service-state sync completes; stale local state must never
  self-promote.

Primary touched areas:

- `src/internal/partition/impl/MigrationManager.ts`
- `src/internal/partition/impl/PartitionContainer.ts`
- `src/internal/partition/operation/*Migration*`
- service-specific replication holders used during migration

Exit criteria:

- after owner crash, cluster converges to expected backup count when capacity exists
- newly assigned backups receive real state, not empty slot markers only

### Block R5 - Partition-lost event model and listener API

Goal: fail honestly when all replicas for a partition are gone.

Tasks:

- Add partition-lost event type and listener registration/removal APIs.
- Add internal dispatch path for partition-aware services.
- Emit partition-lost when owner and all backups are absent.
- Define local-vs-cluster listener semantics consistent with existing Helios listener patterns.
- Add minimal public surfacing on `HeliosInstance` / partition service APIs if supported.

Primary touched areas:

- `src/internal/partition/` event model
- `src/internal/partition/impl/InternalPartitionServiceImpl.ts`
- `src/instance/` public wiring where appropriate

Exit criteria:

- partition loss is observable and testable
- no code path silently treats total replica loss as successful recovery

### Block R6 - Runtime anti-entropy scheduling and execution

Goal: continuously verify backup health and trigger repair for missed state.

Tasks:

- Wire `AntiEntropyTask` into production startup.
- Gate scheduling on startup completion, active runtime state, and migration-allowed conditions.
- Run anti-entropy only for locally owned partitions.
- Dispatch one verification op per local partition per backup replica.
- Ensure repeated scheduling continues across promotions, refill, and member changes.
- Add throttling to avoid bursty OOM or event-loop starvation.
- Anti-entropy may wire scheduler scaffolding earlier, but it must remain production-disabled until
  `R7` replica-sync protocol semantics are complete end to end.

Primary touched areas:

- `src/internal/partition/impl/PartitionReplicaManager.ts`
- `src/internal/partition/impl/AntiEntropyTask.ts`
- runtime startup/lifecycle wiring

Exit criteria:

- anti-entropy runs automatically in clustered production mode
- stale backups are eventually detected without user action

### Block R7 - Full remote replica sync protocol

Goal: make backup repair a real distributed protocol, not an in-memory helper.

Tasks:

- Route sync requests and responses through `OperationService`.
- Add sync-request registration and timeout cleanup.
- Add retry response behavior when migrations are paused, owner changed, or capacity is saturated.
- Reject stale sync responses using version and ownership checks.
- Support fragment or namespace-aware transfer semantics needed by current/future replicated
  services.
- Release permits deterministically on success, retry, timeout, and member death.
- Ensure promoted backups can request missed state from the new primary after role change.
- Require replica-sync/session invalidation across restart, rejoin, owner change, shutdown, and
  member death so stale responses from prior ownership epochs are always rejected.

Primary touched areas:

- `src/internal/partition/operation/PartitionBackupReplicaAntiEntropyOp.ts`
- `src/internal/partition/operation/PartitionReplicaSyncRequest.ts`
- `src/internal/partition/operation/PartitionReplicaSyncResponse.ts`
- `src/internal/partition/impl/PartitionReplicaManager.ts`
- `src/spi/impl/operationservice/`

Exit criteria:

- stale or missed backup state is repaired automatically over the network
- sync protocol survives timeouts, wrong targets, member loss, and repeated retries

### Block R8 - Service-state replication closure

Goal: ensure promoted/refilled replicas actually contain the service state needed for correctness.

Tasks:

- Produce a supported-service matrix covering maps, queues, ringbuffer or reliable-topic state,
  write-behind metadata, and every migration-aware partition-scoped state holder.
- For each supported service, verify migration export/import, promotion cutover, refill transfer,
  anti-entropy sync payloads, destroy or shutdown cleanup, and rejoin fencing.
- Close any gap where partition ownership changes but the target member lacks required data.
- Any unsupported service must be explicitly marked unsupported in docs, examples, and test-support
  and excluded from parity claims and acceptance language.

Exit criteria:

- promotion/refill correctness is real for supported distributed objects, not just partition metadata
- unsupported services are documented honestly rather than implicitly claimed by cluster metrics

### Block R8A - Observability, config, docs, and test-support closure

Goal: make recovery behavior operable, configurable where intended, and impossible to claim without
the real runtime path.

Tasks:

- Define whether anti-entropy interval, throttle, sync timeout, retry budget, and degraded-redundancy
  thresholds are fixed internal constants or operator-configurable; wire the chosen contract through
  `HeliosConfig` and `ConfigLoader` if configurable.
- Expose repair observability: promotion count, refill backlog, sync retries/timeouts,
  stale-response rejects, degraded redundancy, and partition-lost metrics, events, and logging.
- Update docs, examples, and test-support to use only the real clustered recovery path, including
  packet-loss and rejoin harness guidance with no alternate recovery helpers.
- Publish exact proof commands or suites for crash, rejoin, packet-loss, promotion, refill,
  anti-entropy, partition-lost, and stale-rejoin rejection.

Exit criteria:

- operator-facing recovery defaults and knobs are explicit and honestly wired
- observability reflects real recovery progress and failure states
- docs, examples, and test-support align with the single production recovery path

### Block R9 - End-to-end crash and recovery proof

Goal: prove the full recovery story in real multi-node tests.

Required acceptance scenarios:

- 3-node owner crash promotes first backup and operations continue on promoted owner
- 3-node owner crash later refills backup slot on surviving or rejoined member
- dropped/delayed backup traffic is repaired by anti-entropy without manual intervention
- owner + all backups lost emits partition-lost exactly once per lost partition
- repeated crash/rejoin cycles converge without stuck sync permits or ghost owners
- cluster-safe/readiness signals reflect degraded redundancy during repair and return to safe after
  refill
- restarted or rejoining members are fenced from serving stale replica state until authoritative sync
  completes
- repair metrics, retry or timeout counters, and partition-lost signals are observable through the
  supported runtime surfaces

Suggested test locations:

- `test/cluster/tcp/`
- `test/internal/partition/impl/`
- `test/internal/partition/operation/`
- targeted service-level failover suites for maps/queues

Exit criteria:

- all core recovery claims are backed by real TCP multi-node tests
- no acceptance proof relies on direct test-only state injection when production runtime behavior is
  under test

---

## Recommended Execution Order

1. `R1` - unify partition authority
2. `R2` - member-removal bookkeeping
3. `R3` - promotion-first repair
4. `R4` - backup refill and rebalance
5. `R5` - partition-lost events
6. `R7` - full remote replica sync protocol
7. `R6` - anti-entropy runtime scheduling
8. `R8` - service-state replication closure
9. `R8A` - observability, config, docs, and test-support closure
10. `R9` - end-to-end crash/recovery proof

Notes:

- `R6` and `R7` should not be treated as optional polish after promotion. Without them, missed
  backup state after packet loss or timing races can survive indefinitely.
- final production enablement order is `R7` then `R6`; scheduling scaffolding may land earlier, but
  repair is not complete until the full sync protocol is live.
- `R8` must run before claiming parity complete; otherwise partition metadata may recover while real
  service state still diverges.

---

## Deliverables

- production runtime uses one clustered partition service authority
- owner-loss repair path matches Hazelcast promotion-first semantics
- backup redundancy is automatically restored when capacity exists
- anti-entropy and replica sync automatically repair stale/missed backup state
- partition-lost is observable when recovery is impossible
- stale rejoin state is fenced until authoritative partition and service-state sync completes
- operator-facing recovery config, metrics, events, docs, examples, and proof commands reflect the
  single real runtime path
- real multi-node tests prove crash, promotion, refill, and anti-entropy behavior end to end

## Explicit Non-Goals

- preserving fake clustered shortcuts just to keep legacy tests green
- shipping partial parity behind hidden env flags or silent fallback branches
- claiming recovery for services whose partition state is not actually replicated yet

---

## Completion Gate

This plan is not complete unless all of the following are true:

- a primary owner crash causes deterministic promotion of a surviving backup
- promoted owner immediately becomes the routing authority for partition traffic
- missing backup slots are refilled automatically when another eligible member exists
- stale backup state caused by dropped/delayed backup traffic is eventually repaired by anti-entropy
- total replica loss emits partition-lost and does not masquerade as successful recovery
- supported partition-scoped services remain correct after promotion, refill, replica sync,
  shutdown, and rejoin; partition metadata parity alone is not sufficient
- restarted or rejoining members cannot serve or advertise stale replica state before authoritative
  partition and service-state sync completes
- operator-facing recovery metrics, events, readiness signals, docs, examples, and proof commands
  all reflect the single real production recovery path
- operation routing, backup execution, migration, and metrics all consult the same partition table
- real multi-node tests cover crash, promotion, refill, anti-entropy repair, and partition-lost
- docs/plans do not claim parity beyond what the tests prove

---

## Suggested Cross-References

- `plans/MULTI_NODE_RESILIENCE_PLAN.md`
- `plans/TYPESCRIPT_PORT_PLAN.md`
- `src/internal/partition/impl/InternalPartitionServiceImpl.ts`
- `src/internal/partition/impl/MigrationManager.ts`
- `src/internal/partition/impl/PartitionReplicaManager.ts`
- `src/instance/impl/HeliosClusterCoordinator.ts`
