# Scheduled Executor Implementation Plan

## Purpose

This plan defines the full Helios implementation path for `IScheduledExecutorService`.

This plan defined the full implementation path for `IScheduledExecutorService`, delivered in
Phase 22. The scheduled executor is now production-ready with partition-owned durable scheduling,
fixed-rate periodic tasks, member-owned scheduling, full client parity, and migration/recovery.

Primary parity target: mirror Hazelcast's scheduled-executor product model and behavioral contract
from `helios-1`, while implementing it with Helios-native TypeScript runtime pieces.

## Implementation Status

- `src/instance/impl/HeliosInstanceImpl.ts` exposes `getScheduledExecutorService()` as a real
  `ScheduledExecutorServiceProxy` backed by `ScheduledExecutorContainerService`.
- `src/client/proxy/ClientScheduledExecutorProxy.ts` provides the client-side proxy with full
  parity for scheduling, handler reacquisition, and lifecycle.
- The scheduled executor builds on the Phase 17 executor runtime (task registration, remote
  routing, worker execution, cancellation, result envelopes) and adds durable schedule state,
  a timer-coordinated trigger engine, and migration-aware scheduled-task ownership.

## Scope

Full implementation means all of the following are releaseable:

1. Server-side `IScheduledExecutorService` API and runtime.
2. Delayed one-shot tasks.
3. Periodic tasks.
4. Partition-owned scheduling and member-owned scheduling.
5. Durable partition-owned task recovery across owner loss and partition migration, plus
   Hazelcast-parity member-lifecycle semantics for member-targeted tasks.
6. Backup replication / anti-entropy for scheduled-task metadata.
7. Cancellation, shutdown, and lost-owner semantics.
8. Observability, config, docs, and examples.
9. Client protocol and client proxy support.

## Non-Goals For Initial Launch

- Cron-expression parsing. Hazelcast scheduled executor is delayed + fixed-rate scheduling, not a
  cron-expression engine, and Helios should mirror that scope.
- Split-brain protection at the first server GA cut unless cluster-wide split-brain support lands
  first for executor-family services.
- Transparent replay of already-started worker execution after the owning member accepts a run and
  crashes mid-execution. The scheduler may reschedule future firings, but accepted in-flight runs
  still need explicit semantics.

## Hazelcast Parity Anchors

Helios should mirror the following Hazelcast contract points unless a later Helios extension is
explicitly called out:

- full product surface means both server runtime and client proxy/protocol
- API supports one-shot and fixed-rate scheduling; there is no `scheduleWithFixedDelay(...)`
- fixed-rate tasks never overlap with themselves; overdue slots are skipped rather than queued
- if a periodic run throws, subsequent executions are suppressed
- partition-owned tasks are durable according to configured durability
- member-targeted and member-fanout tasks are tied to member lifecycle semantics, not partition
  durability
- callers receive a durable `ScheduledTaskHandler` and can reacquire a future via
  `getScheduledFuture(handler)`
- the service exposes `getAllScheduledFutures()`
- named tasks provide duplicate protection and task identity
- handler identity is portable/serializable and suitable for persistence or later lookup

## Locked Product Decisions

The following decisions are now fixed for implementation unless explicitly revised later.

- The first release considered complete must include both server runtime and client support, in
  line with Hazelcast's full scheduled-executor product surface.
- Durable scheduled-task metadata lives in a partitioned replicated store as the source of truth.
- Every task, named or unnamed, returns a durable handler ID and can be reacquired later by that
  handler ID.
- Handler identity is portable and structured, mirroring Hazelcast's `ScheduledTaskHandler`
  approach: scheduler name, task name, owner locator, plus an opaque durable ID.
- Member-owned task metadata is anchored in the partitioned store by hashing a stable task ID,
  while the record still carries target-member metadata.
- Anti-entropy runs both periodically and on ownership events.
- Conflict resolution prefers highest owner epoch, then highest version within that epoch.
- Scheduling uses a wall-clock + monotonic hybrid: persisted due times use wall clock; local wait
  and drift calculations use monotonic time.
- Capacity defaults mirror Hazelcast `PER_NODE` semantics, i.e. per executor per member.
- Clients in the first complete release get full parity for scheduling, handler reacquisition,
  result/history/stats reads, cancel, and dispose.
- One-shot crash recovery is explicitly at-least-once.
- A partition-owned one-shot firing is only considered consumed after owner commit plus required
  backup acknowledgements.
- Schedule/create success is acknowledged to callers only after the required durable replication
  acknowledgements arrive.
- Named scheduled tasks default to `fail-if-exists`.
- Periodic tasks do not overlap with themselves. If the next firing time arrives while a run is
  still active, Helios skips that scheduled execution instead of postponing it, matching Hazelcast
  fixed-rate semantics.
- After pause, migration, or owner recovery, overdue periodic firings coalesce to at most one
  immediate catch-up run, then resume on the original fixed-rate cadence anchor.
- If a periodic run throws or times out, future firings are suppressed.
- `cancel()` stops future scheduling and does not interrupt a currently running task, matching
  Hazelcast `IScheduledFuture.cancel(...)` semantics.
- `dispose()` permanently removes task state and frees the task name/handler target; `cancel()`
  preserves terminal metadata until disposal.
- Named task uniqueness is per scheduled executor name, cluster-wide.
- History retention is bounded by config using oldest-entry eviction.
- During migration handoff, only the promoted/new owner may decide whether an overdue task should
  run or catch up.
- Graceful shutdown transfer for owned future schedules blocks until durable handoff ack or explicit
  shutdown failure/timeout.
- Shutdown policy should start with two explicit modes: `GRACEFUL_TRANSFER` and `FORCE_STOP`.
- Task lifecycle semantics are explicit and include stored/runtime handling for `scheduled`,
  `running`, `done`, `cancelled`, `disposed`, `suspended`, and stale-task behavior.
- Dispatch/completion validation requires owner epoch, record version, and per-firing `attemptId`.
- Unnamed partition-owned tasks generate a stable task ID at submission time and hash that ID to
  determine partition ownership.
- After recovery catch-up, fixed-rate scheduling resumes at the next aligned slot on the original
  cadence timeline.
- Cancel/dispose vs completion races resolve by versioned terminal-write ordering.
- Each history entry stores attempt identity, timing, outcome, error summary, and epoch/version
  metadata.
- Hazelcast `StatefulTask` parity is deferred explicitly; first release documents task-held durable
  state snapshotting as a known follow-up gap.

## Reusable Foundations

The scheduled executor should build on existing Helios primitives instead of creating a separate
runtime stack.

### Existing executor runtime

- `src/executor/IExecutorService.ts`
- `src/executor/impl/ExecutorServiceProxy.ts`
- `src/executor/impl/ExecutorContainerService.ts`
- `src/executor/impl/TaskTypeRegistry.ts`
- `src/executor/impl/ScatterExecutionBackend.ts`

Reuse these for:

- task-type registration and fingerprint validation
- worker-safe module execution
- result envelope handling
- cancellation plumbing
- bounded queue / pool behavior

### Existing transport and invocation plumbing

- `src/spi/impl/operationservice/impl/OperationServiceImpl.ts`
- `src/spi/impl/operationservice/PartitionInvocation.ts`
- `src/spi/impl/operationservice/TargetInvocation.ts`
- `src/spi/impl/operationservice/OperationWireCodec.ts`

Reuse these for:

- schedule/create/cancel/dispose operations
- owner-targeted run dispatch
- partition-owned metadata mutations
- future/result propagation

### Existing migration and replication primitives

- `src/internal/partition/MigrationAwareService.ts`
- `src/internal/partition/impl/InternalPartitionServiceImpl.ts`
- `src/internal/partition/impl/PartitionReplicaManager.ts`
- `src/internal/partition/operation/PartitionReplicaSyncRequest.ts`
- `src/internal/partition/operation/PartitionReplicaSyncResponse.ts`

Reuse these for:

- partition-owned schedule replication
- promotion / demotion lifecycle hooks
- anti-entropy repair of scheduled-task state

### Existing durable/fenced state model reference

- `src/map/impl/MapContainerService.ts`
- `src/map/impl/mapstore/MapStoreContext.ts`

Reuse these as the reference pattern for:

- owner fencing
- epoch-based promotion
- staged handoff during migration
- shutdown flush / activation boundaries

## Required New Architecture

## 1. Public API layer

Add a real `IScheduledExecutorService` contract that covers:

- `schedule(task, delay, unit)`
- `scheduleOnMember(task, member, delay, unit)`
- `scheduleOnKeyOwner(task, key, delay, unit)`
- `scheduleOnAllMembers(...)`
- `scheduleOnMembers(...)`
- `scheduleAtFixedRate(...)`
- `scheduleOnMemberAtFixedRate(...)`
- `scheduleOnKeyOwnerAtFixedRate(...)`
- `scheduleOnAllMembersAtFixedRate(...)`
- `scheduleOnMembersAtFixedRate(...)`
- `getScheduledFuture(handler)`
- `getAllScheduledFutures()`
- `shutdown()`
- named-task access / duplicate-name policy
- cancellation and future retrieval
- task statistics / local stats

Do not add `scheduleWithFixedDelay(...)` to the Hazelcast-parity plan. Hazelcast does not offer an
equivalent API, so Helios should not introduce one in the parity implementation.

Helios-specific extensions should mirror the current executor model:

- registration-based distributed tasks only
- inline local-only scheduled tasks only where they never cross the network
- explicit worker-safe module requirements for distributed scheduling
- portable structured handler identities with reacquisition support for named and unnamed tasks

## 2. Task identity and state model

Introduce a durable task record for every scheduled task.

Suggested fields:

- `taskName`
- `handlerId`
- `executorName`
- `taskType`
- `registrationFingerprint`
- `inputData`
- `scheduleKind` (`one-shot`, `fixed-rate`)
- `ownerKind` (`partition`, `member`)
- `partitionId` or `memberUuid`
- `initialDelayMillis`
- `periodMillis`
- `nextRunAt`
- `lastRunStartedAt`
- `lastRunCompletedAt`
- `runCount`
- `state` (`scheduled`, `running`, `cancelled`, `done`, `disposed`, `suspended`)
- `durabilityReplicaCount`
- `ownerEpoch`
- `version`
- `attemptId`
- `lastResultSummary`

Implementation notes:

- the authoritative metadata store is partitioned and replicated
- member-owned schedules still persist in the partitioned store, with member targeting represented
  as task metadata rather than a separate source of truth
- member-owned schedules are anchored by hashing a stable task ID into the partitioned store
- unnamed partition-owned schedules also generate a stable task ID and hash that ID for partition
  placement
- named and unnamed tasks are both re-acquirable through the durable handler ID
- run history retention must be bounded by config even though the product decision is to retain full
  history by default
- stale/disposed semantics should mirror Hazelcast future/handler behavior even if `stale` remains
  a derived API condition rather than a persisted record state

The scheduler must treat schedule metadata and execution attempts as separate concerns:

- metadata is durable and replicated
- each individual firing is dispatched into the existing executor backend
- periodic tasks recompute `nextRunAt` only through fenced owner logic
- completion consumes one-shot tasks only after owner commit plus backup acks
- dispatch and completion must match current `ownerEpoch`, `version`, and `attemptId`
- terminal races resolve through versioned state transitions

## 3. Ownership model

Support two ownership modes.

### Partition-owned tasks

- default for `schedule(...)` and `scheduleOnKeyOwner(...)`
- metadata lives with the partition
- promotion on partition migration must preserve task identity and future firings
- this is the primary durability model

### Member-owned tasks

- used by `scheduleOnMember(...)`
- metadata still persists in the partitioned replicated store as the source of truth
- the stable metadata anchor is the hashed task ID in the partitioned store; the record also
  carries target-member identity for lookup and lifecycle handling
- Hazelcast parity note: member-targeted tasks are tied to the targeted member lifecycle rather
  than partition durability

### Member fanout tasks

- `scheduleOnAllMembers(...)` and `scheduleOnMembers(...)` create one scheduled future per target
  member
- parity behavior mirrors Hazelcast: if a member leaves, its member-owned task is lost rather than
  transparently migrated

The plan should implement partition-owned scheduling first, then member-owned scheduling once the
metadata model is stable.

## 4. Scheduler engine

Add a member-local scheduler loop that:

- scans only task sets currently owned by this member
- wakes on nearest `nextRunAt` boundary
- fences execution by partition/member ownership epoch
- dispatches ready firings into `ExecutorContainerService`
- updates metadata atomically after completion or reschedule

Preferred implementation:

- a small timer coordinator per service instance
- partition-local min-heap or time-bucket index for ready times
- explicit rehydration from replicated state on startup / promotion

Avoid:

- one `setTimeout` per task as the core model
- unfenced periodic rescheduling from worker completion callbacks
- direct worker execution from the timer loop

## 5. Service runtime

Create a dedicated service rather than overloading the current executor container.

Recommended new components:

- `src/scheduledexecutor/IScheduledExecutorService.ts`
- `src/scheduledexecutor/ScheduledTaskDescriptor.ts`
- `src/scheduledexecutor/ScheduledTaskHandler.ts`
- `src/scheduledexecutor/impl/ScheduledExecutorServiceProxy.ts`
- `src/scheduledexecutor/impl/ScheduledExecutorContainerService.ts`
- `src/scheduledexecutor/impl/ScheduledTaskRegistry.ts`
- `src/scheduledexecutor/impl/ScheduledTaskStore.ts`
- `src/scheduledexecutor/impl/ScheduledTaskScheduler.ts`
- `src/scheduledexecutor/impl/operation/*`

This service should depend on the existing executor runtime for actual execution, but own:

- schedule metadata
- owner selection
- trigger computation
- migration hooks
- replication state
- handler lookup by task name / owner

## 6. Operations and wire protocol

Add scheduled-executor operations for at least:

- create schedule
- create named schedule if absent / duplicate policy
- get task handler by name
- cancel task
- dispose task
- read task state / stats
- replicate partition schedule state
- run-ready-task handoff if remote execution dispatch is needed

Each operation must have deterministic owner routing:

- partition-owned metadata mutations go through partition invocations
- member-owned metadata mutations go through target invocations
- handler lookup must never guess the owner

## 7. Replication and migration

This is the core feature gap between today's executor and the planned scheduled executor.

Required behavior:

- scheduled executor becomes a `MigrationAwareService`
- task metadata replicates to backups
- anti-entropy can repair missing or stale schedule metadata
- before-migration fences old owners from firing new runs
- commit-migration installs the new owner epoch and rehydrates local ready queues
- rollback restores the old owner cleanly

Use `MapContainerService` promotion fencing as the model for owner-epoch handling.

## 8. Durability semantics

The plan should distinguish three durability boundaries.

### Durable metadata

Must survive:

- owner member crash
- partition migration
- backup promotion

### Non-durable in-flight execution

May still fail if:

- a worker has already accepted the firing and crashes mid-run
- the owner dies after dispatch but before recording completion

### Deterministic recovery policy

The scheduler on promotion must follow these rules:

- a one-shot firing is consumed only when completion is durably recorded
- a firing that was accepted or started but not durably completed is eligible for recovery handling
- the promoted owner must fence the retired owner epoch before replay or reschedule decisions
- recovery must prefer at-least-once completion safety over dropping work based only on acceptance
- overdue periodic schedules after pause, migration, or promotion coalesce to at most one immediate
  catch-up firing before the next aligned fixed-rate cadence slot is computed
- conflicts resolve by highest owner epoch, then highest version within the epoch
- only the new owner decides catch-up/replay during migration and promotion windows

This remains the highest-risk behavioral area and must be validated with crash-loop tests.

## 9. Configuration

Add a dedicated `ScheduledExecutorConfig` instead of stretching `ExecutorConfig`.

Suggested fields:

- `name`
- `poolSize` / worker config reuse hook
- `capacity`
- `durability`
- `capacityPolicy` (`PER_NODE`, later `PER_PARTITION` as parity expands)
- `statisticsEnabled`
- `mergePolicy` placeholder if split-brain support lands later
- `scheduleShutdownPolicy` (`GRACEFUL_TRANSFER`, `FORCE_STOP`)
- `maxNamedTaskCount`
- `maxInitialDelayMillis`
- `maxPeriodMillis`
- `maxActiveSchedules`
- `maxHistoryEntriesPerTask`

`ExecutorConfig` should remain focused on immediate execution.

Mirror Hazelcast config semantics where practical:

- default capacity behavior should map to `PER_NODE`
- durability applies to partition-owned tasks
- capacity should be ignored during partition migration for data-loss prevention, with counts
  repaired after migration settles
- durable create/update acknowledgement should wait for required replica acknowledgements

## 10. Client support

After the server runtime is stable, add:

- client protocol messages
- `src/client/proxy/ClientScheduledExecutorProxy.ts`
- client task handler surface
- parity tests for server/client interoperability

The current roadmap already marks the client as blocked by missing server runtime, so client work
must trail server stabilization, but the first release considered complete is server + client
together.

## Phased Delivery Plan

## Phase 0 - Design lock

Goal: eliminate semantic ambiguity before code lands.

Deliverables:

- API contract doc for `IScheduledExecutorService`
- config shape decision
- portable `ScheduledTaskHandler` format spec
- task lifecycle/state-machine spec
- attempt fencing spec (`ownerEpoch` + `version` + `attemptId`)
- implementation notes for durable-completion crash recovery
- implementation notes for full-history retention and bounding config
- implementation notes for overdue periodic catch-up coalescing
- implementation notes for graceful shutdown transfer
- explicit shutdown policy enum semantics
- explicit first-release limitation note for Hazelcast `StatefulTask` parity
- explicit Hazelcast parity matrix: mirrored, adapted, and deferred behaviors

Exit criteria:

- locked decisions are reflected in API docs, runtime invariants, and test plans
- no unresolved questions on crash-recovery fencing, handler identity, or fixed-rate timing math
- no unresolved questions on history retention bounds, shutdown transfer semantics, or lifecycle
  race resolution

## Phase 1 - Server API and local one-shot prototype

Goal: get the surface and a non-distributed local correctness slice working.

Deliverables:

- `IScheduledExecutorService`
- scheduled task handler/future types
- portable handler serialization/reconstruction support
- one-shot local schedule execution using existing executor backend
- deterministic cancel/dispose/status behavior

Exit criteria:

- one-shot local scheduling tests pass
- no distributed transport yet
- no periodic semantics yet

## Phase 2 - Distributed one-shot partition-owned scheduling

Goal: first releaseable distributed scheduling path.

Deliverables:

- partition-owned task metadata store
- create/cancel/get operations
- ready-task scheduler loop
- dispatch from scheduler into `ExecutorContainerService`
- owner fencing and task-state transitions
- durable create ack after required backup acknowledgements

Exit criteria:

- schedule on partition owner works across members
- delayed task executes exactly once in the steady-state path and follows documented at-least-once
  recovery semantics under owner crash/promotion
- cancellation before firing is strong
- result retrieval is deterministic

## Phase 3 - Periodic scheduling semantics

Goal: support Hazelcast-style fixed-rate periodic behavior correctly.

Deliverables:

- fixed-rate reschedule engine
- no-overlap skip policy and backpressure policy
- named periodic task handling
- next-aligned-slot computation after recovery catch-up

Exit criteria:

- drift behavior is documented and tested
- no duplicate firings under steady ownership
- no self-overlap under steady ownership or delayed completions
- exceptions suppress future firings
- recovery catch-up resumes on the next aligned fixed-rate slot
- late completion does not corrupt next-run computation

## Phase 4 - Replication, migration, and recovery

Goal: make the scheduler durable enough to justify shipping.

Deliverables:

- `MigrationAwareService` integration
- replication operation for partition-owned schedules
- anti-entropy state sync
- promotion fencing / epoch management
- restart and promotion rehydration

Exit criteria:

- member crash before firing preserves future task execution
- migration does not duplicate or lose scheduled metadata
- promoted owner resumes ready queue without double fire during normal migration handoff and with
  documented at-least-once replay behavior only in crash-recovery paths

## Phase 5 - Member-owned scheduling

Goal: add the non-partition ownership surface.

Deliverables:

- `scheduleOnMember(...)`
- `scheduleOnAllMembers(...)`
- `scheduleOnMembers(...)`
- member-owned metadata store and lookup
- member-targeted lifecycle/loss semantics matching Hazelcast

Exit criteria:

- behavior under target member loss matches Hazelcast semantics and is tested
- API parity is acceptable with the chosen Helios semantics

## Phase 6 - Client support and docs

Goal: complete the public product surface.

Deliverables:

- client proxy and protocol
- docs, examples, config docs, roadmap updates
- honest capability matrix updates

Exit criteria:

- client/server scheduling E2E passes
- docs no longer describe the feature as deferred

## Phase 7 - Production hardening

Goal: make the feature operationally trustworthy.

Deliverables:

- metrics and local stats
- admin visibility / diagnostics
- queue bound validation
- scheduler-lag metrics
- shutdown / drain behavior
- chaos tests for crash, migration, and backup promotion
- documented first-release limitation for missing Hazelcast `StatefulTask` parity

Exit criteria:

- full repository stays green
- no duplicate-fire regressions in stress tests
- no orphaned task metadata after repeated migration loops

## Locked Design Decisions

1. The first release considered complete is server + client together.
2. One-shot crash recovery is at-least-once and a firing is consumed only after owner commit plus
   required backup acknowledgements.
3. Durable metadata uses a partitioned replicated store as the source of truth.
4. Every task returns a portable structured handler and can be reacquired later by handler ID.
5. Unnamed tasks are also re-acquirable by generated handler ID.
6. Named task uniqueness is per scheduled executor name, cluster-wide.
7. Member-owned task metadata is anchored by hashing a stable task ID into the partitioned store.
8. Anti-entropy runs periodically and on ownership events.
9. Repair conflicts resolve by highest epoch, then highest version.
10. Scheduling uses a wall-clock + monotonic hybrid.
11. Capacity defaults mirror Hazelcast `PER_NODE` semantics, i.e. per executor per member.
12. Clients in the first complete release get full parity for scheduling, handler reacquisition,
     result/history/stats reads, cancel, and dispose.
13. Named tasks default to `fail-if-exists`.
14. Periodic tasks are single-flight and must not overlap with themselves; overdue slots are
    skipped.
15. Overdue periodic firings after pause, migration, or recovery coalesce to one immediate catch-up
    run, then resume on the next aligned slot of the original fixed-rate cadence.
16. If a periodic run throws or times out, future firings are suppressed.
17. `cancel()` stops future scheduling and does not interrupt an in-flight run.
18. `dispose()` removes task state and frees the name/handler target; `cancel()` preserves terminal
    state until disposal.
19. During migration handoff, only the new/promoted owner decides whether to run or catch up.
20. Graceful shutdown transfer blocks until durable handoff ack or explicit timeout/failure.
21. Member-targeted and member-fanout tasks mirror Hazelcast member-lifecycle semantics rather than
    partition-durable rehome semantics.
22. Lifecycle semantics explicitly cover `scheduled`, `running`, `done`, `cancelled`, `disposed`,
    `suspended`, and stale-task behavior.
23. Dispatch/completion attempts must match `ownerEpoch`, `version`, and `attemptId`.
24. Unnamed partition-owned tasks generate a stable task ID and hash that ID for placement.
25. Schedule/create success is visible only after required backup acknowledgements.
26. Cancel/dispose vs completion races resolve by versioned terminal-write ordering.
27. History entries contain timing, outcome, attempt identity, and epoch/version metadata.
28. Shutdown policy starts with `GRACEFUL_TRANSFER` and `FORCE_STOP`.
29. Hazelcast `StatefulTask` parity is deferred explicitly and documented as a first-release gap.
30. Delivery remains phased: partition-owned scheduling first, member-owned parity later.

## Test Strategy

Minimum test layers:

- unit tests for descriptor validation, trigger calculation, next-run math, and handler state
- service tests for create/cancel/dispose and ready-queue behavior
- cluster tests for partition ownership, migration, and promotion fencing
- crash/recovery tests for backup promotion and anti-entropy repair
- client/server parity tests once the client lands
- stress tests for periodic drift, duplicate-fire prevention, and cancel-race paths

Must-have acceptance scenarios:

- delayed one-shot executes with at-least-once crash-recovery semantics and no duplicate fire in
  the steady-state non-failure path
- cancel-before-fire prevents execution
- fixed-rate tasks skip overlap and preserve original cadence
- handler serialization/deserialization can reacquire named and unnamed tasks after reconnect
- cancel/dispose races against completion follow versioned terminal-write rules
- member crash before due time does not lose partition-owned tasks
- migration during ready-to-fire window does not double fire
- shutdown preserves or rejects tasks according to the documented policy

## Sequencing Recommendation

Recommended delivery order:

1. Design lock.
2. Partition-owned one-shot server runtime.
3. Periodic semantics.
4. Replication and migration.
5. Member-owned semantics.
6. Client support.
7. Hardening and docs cleanup.

This keeps the hardest correctness problem - ownership transfer without unexpected duplicate firing
in steady-state plus documented at-least-once recovery behavior under crashes - in the center of
the plan instead of hiding it behind API work.

## Success Bar

Do not mark scheduled executor complete until all of the following are true:

- `getScheduledExecutorService()` no longer throws a deferred-feature error
- partition-owned schedules survive migration and owner loss with no duplicate firing in the normal
  handoff path and only documented at-least-once replay in crash-recovery paths
- periodic fixed-rate semantics are documented and verified
- the client surface is shipped with parity support
- roadmap and parity documents are honest and consistent

## Recommended First Execution Slice

If implementation starts now, the first coding milestone should be:

1. add `IScheduledExecutorService` and handler contracts
2. add `ScheduledExecutorConfig`
3. build a partition-owned `ScheduledExecutorContainerService`
4. support one-shot delayed tasks only
5. make that path deterministic under cancel/shutdown before adding periodic behavior

That gives Helios a narrow but real foundation instead of jumping directly into full parity.

## Known First-Release Limitations

### `StatefulTask` Parity Gap

Hazelcast's `StatefulTask<K, V>` interface allows scheduled tasks to save and restore
user-defined state across replicas via `save(Map<K, V>)` and `load(Map<K, V>)` callbacks.
This enables tasks to carry durable application state through migrations and replica promotions.

**Helios first release does not implement `StatefulTask`.** Scheduled tasks are stateless
from the framework's perspective — they carry execution metadata (run count, timing, epoch,
version) but not user-defined key-value state snapshots.

Applications requiring durable task state should persist it externally (e.g., in a Helios
`IMap`, database, or other store) and reload it at task execution time.

This is tracked as a known follow-up item for a future release (see Locked Design Decision #29).
