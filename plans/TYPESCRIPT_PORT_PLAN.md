# Helios Master Port Plan

## Purpose

This is the active master plan for the remaining TypeScript port work.

- The historical full v1 delivery plan now lives in `plans/V1_TYPESCRIPT_PORT_PLAN.md`.
- Phases 1-17 are complete in v1 and are tracked there as archive/status context.
- This file contains only the still-open blocks and completion criteria.

## Editor Goal

Anyone editing this file in the future must preserve these rules:

- A block defines a fully end-to-end feature, with no stubs, fake fallbacks, or mock implementations standing in for the real runtime path.
- A task defines a sequential implementation step needed to reach that fully end-to-end block outcome.
- No block is complete until all of its tasks are done and a final verification task proves the implementation is end to end, production ready, and free of stub behavior.
- Only the agent actively working on a block may add new tasks to that block, and it must do so whenever needed to make the block truly end-to-end implementable.
- New tasks must always push toward maximum practical Hazelcast semantic and feature parity from `../helios-1`, while still choosing Bun-native and TypeScript-native implementations where appropriate.
- Never mark a block complete just because tests pass if runtime wiring, config wiring, exports, lifecycle cleanup, docs/examples, or failure semantics are still partial.

## Current State

- Helios v1 core is historically complete through Phase 17 in the archive, but executor production closure is reopened here as Phase 17R because the live runtime still does not prove the Scatter-backed path end to end.
- Phases 17R through 21 (including 19, 19T, 20) are complete.
- Remaining master-plan work is Phase 22 (Distributed Scheduled Executor Service — IScheduledExecutorService Hazelcast parity) and Phase 23 (Blitz Job Supervision — Hazelcast Jet-parity autonomous job lifecycle).
- Executor scatter-closure implementation detail lives in `plans/EXECUTOR_SCATTER_PRODUCTION_PLAN.md`.
- The canonical implementation detail for the remaining Blitz work lives in `plans/BLITZ_EMBEDDED_NATS_PLAN.md` Appendix B.
- Blitz Job Supervision implementation detail lives in `packages/blitz/PLAN-job-supervision.md`.
- MongoDB MapStore implementation detail lives in `plans/MONGODB_MAPSTORE_PRODUCTION_PLAN.md`.
- Topic and reliable-topic implementation detail lives in `plans/TOPIC_RELIABLE_TOPIC_UNIFIED_PLAN.md`.
- Cluster-safe MapStore implementation detail lives in `plans/CLUSTER_SAFE_MAPSTORE_PLAN.md`.
- Remote-client implementation detail lives in `plans/CLIENT_E2E_PARITY_PLAN.md`, `plans/CLIENT_E2E_EXECUTION_BACKLOG.md`, and `plans/CLIENT_E2E_PARITY_MATRIX.md`.
- Backup partition promotion/recovery parity detail lives in `plans/BACKUP_PARTITION_RECOVERY_PARITY_PLAN.md`.
- `plans/BACKUP_PARTITION_RECOVERY_PARITY_PLAN.md` is the authoritative implementation-detail plan for Phase 21 backup/recovery work.
- `plans/PARTITION_BACKUP_E2E_CLOSURE_PLAN.md` is secondary historical/supporting guidance only and must not be used to redefine scope, lower proof requirements, or relax any acceptance criterion in this file or in `plans/BACKUP_PARTITION_RECOVERY_PARITY_PLAN.md`.
- If any backup/recovery wording conflicts across plans, precedence is: this file (master acceptance contract) -> `plans/BACKUP_PARTITION_RECOVERY_PARITY_PLAN.md` (authoritative implementation detail) -> all other supporting plans.
- Scheduled executor implementation detail lives in `plans/SCHEDULED_EXECUTOR_IMPLEMENTATION_PLAN.md`.

## Repo-Reality Guardrails

Interpret every remaining block against the repo as it exists now.

- Use `@zenystx/helios-core/*`, not `@helios/*`.
- Use `examples/native-app/` and `examples/nestjs-app/`, not `app/`.
- Test support lives under `src/test-support/`.
- User-facing completion requires code wiring, config wiring, exports, docs/examples, and test-support parity.
- No block is complete if hidden throw-stubs, fake fallbacks, or partial lifecycle wiring remain.

## Archive Reference

For completed phases, prior rationale, detailed historical block notes, and v1 scope decisions, see:

- `plans/V1_TYPESCRIPT_PORT_PLAN.md`
- `plans/BLITZ_EMBEDDED_NATS_PLAN.md`
- `plans/HELIOS_BLITZ_IMPLEMENTATION.md`

## Remaining Scope

### Phase 17R - Executor Scatter Production Closure

Goal: reopen executor work until distributed executor is honestly off-main-thread, service-backed,
and production ready.

- distributed task bodies never run on the main Bun event loop in production
- member-local executor registry and container ownership are real, lifecycle-bound, and free of fallback bypasses
- `scatter` is the only honest production backend; `inline` is restricted to explicit test/dev bootstrap paths and is invalid for production-mode startup unless an explicit testing override is set
- distributed task registration is module-backed and worker-materializable
- worker crash, timeout, cancellation, shutdown, and task-lost semantics are deterministic and acceptance-tested

### Phase 18 — Blitz Distributed Embedded Cluster Default

Goal: make Blitz distributed by default in Helios multi-node deployments.

- every Helios node hosts one local embedded NATS node
- the current Helios master acts as the Blitz bootstrap authority for topology and seed routing
- starting a second Helios node automatically forms the shared NATS/JetStream cluster
- Helios owns the distributed control plane, lifecycle wiring, and reconciliation behavior
- pre-cutover readiness is fail-closed: until authoritative topology is applied and post-cutover JetStream readiness is green, the local Blitz runtime stays fenced and may not create Blitz-owned resources, expose the NestJS bridge, serve user-facing Blitz operations, or report readiness success
- current-master authority is fenced by `(masterMemberId, memberListVersion, fenceToken)`, and demotion immediately cancels or fences outstanding topology/reconciliation work from the old master epoch

### Phase 19 - MongoDB MapStore Production Readiness

Goal: deliver the MongoDB-backed MapStore contract defined in
`plans/MONGODB_MAPSTORE_PRODUCTION_PLAN.md` with real Helios runtime wiring and end-to-end proof
against a real MongoDB instance.

Phase 19 closes only the single-member MongoDB MapStore production slice. Any clustered MongoDB production-readiness claim, clustered MongoDB docs/examples, or clustered MongoDB proof gate remains blocked until Phase 21.4 is green.

- direct, factory, registry-backed, and dynamic-loading wiring paths are honest and fully wired
- document-mode Mongo persistence is the only supported persistence model and is end to end real
- shutdown, restart, validation, eager/lazy load, bulk, clear, and `loadAllKeys()` semantics are
  production-ready for the single-member Helios runtime and free of hidden stubs
- exact proof commands/docs/examples only claim the single-member Mongo scope closed in Phase 19; clustered Mongo claims, clustered Mongo docs/examples, and clustered Mongo proof gates stay blocked until Phase 21.4 is green

### Phase 19T - Topic + ReliableTopic Production Closure

Goal: finish classic `ITopic` and ringbuffer-backed `getReliableTopic()` as real Helios messaging
primitives with one honest runtime path per mode, explicit lifecycle/config/failure semantics, and
no throw stubs, fake local-only alternates, or hidden in-memory side paths.

- classic topic uses one Helios-owned service-backed runtime path in single-node and multi-node mode
- reliable topic is backed by the real ringbuffer runtime, not local listener arrays or bespoke storage
- reliable listener semantics are explicit, Bun/TypeScript-native, and parity-aware for sequence, loss, terminal error, and cancellation behavior
- overload, retention, destroy, shutdown, owner-loss, and failover behavior are deterministic and acceptance-tested
- reliable-topic publish completion is frozen for v1 to owner append plus at least one synchronous backup acknowledgment, with no config path that silently downgrades success to owner-append-only durability
- docs/examples/exports/config/test-support only claim the topic behavior that is actually wired

### Phase 20 — Remote Client End-to-End Parity

Goal: deliver a production-grade Bun/TypeScript remote client that a separate application can use to
connect to a real Helios cluster over the binary client protocol, with no orphan codecs, no fake
transport paths, no hidden member-side task ownership under `src/client`, and no public APIs that are
only partially wired.

- `HeliosClient` implements `HeliosInstance`
- the shared contract is honest: every retained remote `HeliosInstance` capability is remotely real
- the member/server client-protocol stack exists and is owned outside `src/client`
- package exports expose only intentional public client entrypoints
- real-network acceptance coverage proves separate Bun app -> Helios cluster behavior end to end
- any client readiness claim for classic topic or reliable topic is blocked until the Phase 19T checkpoint is green; completing Block 19T.1 or landing runtime code alone does not satisfy that dependency

### Phase 21 — Cluster-Safe MapStore Across Multiple Helios Instances

Goal: make Helios MapStore owner-authoritative and cluster-safe so multiple Helios members can
share one external persistence layer without duplicate writes, duplicate deletes, or fake
broadcast-replay semantics.

- clustered partition recovery is Bun-native and TypeScript-native, with one real runtime path and no weird fallbacks
- owner death promotes surviving backups first, then refills backup slots with real replicated state transfer
- anti-entropy and replica sync automatically repair missed backup state after crashes, packet loss, and rejoin
- total replica loss is reported honestly through partition-lost signaling rather than hidden recovery shortcuts
- map/MapStore parity is not complete from generic partition-lost alone; clustered maps must ship map-scoped partition-lost listener/event semantics equivalent in intent to Hazelcast `IMap.addPartitionLostListener(...)`, unless the clustered MapStore surface is explicitly narrowed everywhere parity is claimed
- partition owners are the only external MapStore writers
- backup replicas shadow state for failover and migration without writing externally while backups
- owner-routed operations replace mutation broadcast as the authoritative clustered map path
- write-through, write-behind, eager load, lazy load, clear, and bulk paths are end to end honest
- at least one real adapter proves the clustered vertical slice after its single-node proof is green
- clustered proof must capture per-call provenance (`memberId`, `partitionId`, `replicaRole`, `partitionEpoch`, `operationKind`) for every physical external MapStore call and must fail on duplicate physical calls, not just incorrect final state
- all Phase 21 recovery and clustered MapStore proof must run against at least three separate Helios members started as separate Bun processes with distinct TCP listeners and real `TcpClusterTransport` links; shared-process clusters, direct service calls, and in-memory transport shims do not satisfy this phase
- required proof for this phase includes process-boundary owner crash plus transport-boundary frame drop/delay injection on backup, replica-sync, migration, and owner-routed map-operation traffic; direct in-memory state mutation or direct method-call fault simulation does not satisfy this phase

### Phase 23 — Blitz Job Supervision (Hazelcast Jet-Parity Autonomous Job Lifecycle)

Goal: deliver 100% Hazelcast Jet semantic parity for autonomous job supervision in Blitz, built on NATS + TypeScript + Bun. No stubs, no deferrals, no mock implementations.

- `blitz.newJob(pipeline, config)` returns a `BlitzJob` with full Jet-parity lifecycle: join, cancel, suspend, resume, restart, exportSnapshot, getMetrics, addStatusListener
- `blitz.newLightJob(pipeline)` returns a lightweight single-member job with no coordination overhead
- `blitz.getJob(id)`, `blitz.getJob(name)`, `blitz.getJobs()`, `blitz.getJobs(name)` for job lookup
- job lifecycle state machine matches Jet exactly: NOT_RUNNING → STARTING → RUNNING → COMPLETING → COMPLETED (batch), plus RESTARTING, SUSPENDED_EXPORTING_SNAPSHOT, SUSPENDED, FAILED, CANCELLED
- streaming runtime engine drives data through the DAG: SourceProcessor → OperatorProcessor → SinkProcessor, connected by bounded AsyncChannel queues for local edges and NATS subjects for distributed edges
- entire DAG is replicated to every member (like Jet); distribution happens at the edge level, not vertex level
- distributed edges use NATS JetStream for durable delivery (AT_LEAST_ONCE / EXACTLY_ONCE) or core NATS pub/sub for fire-and-forget (NONE)
- local edges use zero-copy in-process async channels with backpressure
- Chandy-Lamport barrier snapshot protocol for exactly-once processing: coordinator injects barriers into sources, barriers flow through DAG, barrier alignment for exactly-once (buffer post-barrier items until all inputs have barriers), immediate save for at-least-once
- snapshot state stored in NATS KV buckets, keyed by `[jobId, snapshotId, vertexName, processorIndex]`
- master-supervised job coordination via `BlitzJobCoordinator` using Helios fencing pattern `(masterMemberId, memberListVersion, fenceToken)` for all authoritative operations
- job registry stored in Helios IMap `__blitz.jobs`
- auto-scaling: member loss → restart from last snapshot; member join → debounced restart (scaleUpDelayMillis)
- master failover: new master reads JobRecords from IMap, resumes coordination for RUNNING jobs
- split-brain protection: minority side suspends protected jobs
- per-vertex job metrics: itemsIn/Out, queueSize, p50/p99/max latency, snapshot metrics, collected via ITopic request/reply
- `JobConfig` with full Jet parity: name, processingGuarantee (NONE/AT_LEAST_ONCE/EXACTLY_ONCE), snapshotIntervalMillis, autoScaling, suspendOnFailure, scaleUpDelayMillis, splitBrainProtection, maxProcessorAccumulatedRecords, initialSnapshotName
- NestJS bridge updated with newJob/newLightJob/getJob/getJobs proxy methods
- canonical implementation detail lives in `packages/blitz/PLAN-job-supervision.md`

## Phase 17R Task Breakdown

### Block 17R.1 — Executor Scatter production closure

Goal: finish the executor runtime honestly so distributed task execution is off-main-thread,
service-backed, fail-closed, and production ready.

Tasks:

- [x] Bind this block to `plans/EXECUTOR_SCATTER_PRODUCTION_PLAN.md` as the authoritative implementation detail.
- [x] Wire real member-local executor registry and container ownership in `HeliosInstanceImpl`, including shutdown lifecycle ownership for named executors.
- [x] Remove any distributed direct-factory fallback from executor operation classes so no distributed task body can run inline on the main event loop.
- [x] Add a Helios-owned Scatter-backed execution engine behind `ExecutionBackend`, preferring sibling Scatter worker classes only if they preserve module-backed registration, per-task-type pool ownership, deterministic recycle or shutdown behavior, and fail-closed health semantics; otherwise use a bounded `scatter.pool()` adapter.
- [x] Make distributed task registration module-backed and worker-materializable only, while preserving `submitLocal()` and `executeLocal()` as the only inline-function path.
- [x] Make `scatter` the only production backend, restrict `inline` to explicit test/dev bootstrap paths only, add startup-time production-mode config/bootstrap validation that rejects `inline` before any executor is requested unless an explicit testing override is set, and fail closed when Scatter is unavailable or unhealthy instead of silently falling back.
- [x] Add proof that Helios instance startup fails fast when executor backend is set to `inline` without the explicit testing override, before any `getExecutorService()` call or lazy executor materialization occurs, and that the override is documented and accepted only for test harness or dev bootstrap flows.
- [x] Wire explicit member-loss handling so accepted tasks transition to deterministic `task-lost` results, queued work drains or fails from real membership signals, and no member-departure path remains plan-only.
- [x] Recycle degraded task-type pools after worker crash or task timeout, while preserving deterministic cancellation, shutdown, late-result-drop, and task-lost semantics.
- [x] Update executor docs/examples/exports/config/test-support so module-backed distributed registration, scatter-default behavior, fail-closed semantics, and explicit inline test/dev-only behavior are described honestly.
- [x] Run a verification task that proves distributed executor work never silently runs on the main event loop, the Scatter-backed path is real in single-node and multi-node runtime flows, and the feature is production ready end to end.

## Phase 18 Task Breakdown

### Block 18.1 — Raw Blitz `clusterNode` primitive + replication hooks

Goal: finish the raw Blitz-side clustered embedded-node primitive so Helios can build on top of it.

Tasks:

- [x] Define `ClusterNodeNatsConfig` and any supporting typed config needed for one-local-node clustered startup.
- [x] Implement one-local-node clustered spawn path in `packages/blitz/` using stable bind/advertise settings.
- [x] Normalize route generation and route ordering so restarts and re-renders stay deterministic.
- [x] Wire `defaultReplicas` and related replication defaults into the raw Blitz clustered runtime.
- [x] Add validation for invalid bind/advertise/route combinations before process spawn.
- [x] Add unit and integration coverage proving the raw clustered node primitive works without Helios orchestration.
- [x] Run a verification task that proves this block is production-usable as a raw Blitz primitive, with no fake clustering shortcuts or hidden local-only fallbacks.

### Block 18.2 — Helios Blitz config + protocol + topology service

Goal: add the Helios-owned distributed control plane for Blitz topology and master-authoritative coordination.

Tasks:

- [x] Extend `HeliosConfig` with the Blitz runtime section needed for distributed embedded behavior.
- [x] Add any `ConfigLoader` support required if file-config support is part of the runtime path.
- [x] Define topology models and ownership semantics for Helios-managed Blitz clustering.
- [x] Add coordinator service/runtime responsible for topology decisions and cluster-state translation.
- [x] Define and wire `BLITZ_*` cluster messages, including `requestId`, retry metadata, and response correlation.
- [x] Make the current Helios master the authoritative source for topology snapshots, keyed by `memberListVersion`.
- [x] Require every master-authored authoritative Blitz control-plane message to carry and validate the authority tuple `(masterMemberId, memberListVersion, fenceToken)`, where `fenceToken` is rotated on every master-epoch change before any new authoritative message is emitted.
- [x] Reject or ignore authoritative `BLITZ_*` messages when `(masterMemberId, memberListVersion, fenceToken)` does not match the receiver's current Helios master view, so stale pre-demotion masters cannot continue serving topology work.
- [x] Wire `BLITZ_TOPOLOGY_RESPONSE` / `BLITZ_TOPOLOGY_ANNOUNCE` authority-fencing through the live `HeliosClusterCoordinator` transport path, not just coordinator-helper state or class-level tests.
- [x] Implement mandatory re-registration behavior after master change or topology invalidation.
- [x] Add tests that prove topology messages, snapshot authority, retry handling, and re-registration are real protocol behavior, not mocks.
- [x] Run a verification task that proves config, protocol, and topology state are end to end and production ready.

### Block 18.3 — Helios runtime wiring + distributed-auto startup/join/rejoin flow

Goal: make Helios own Blitz lifecycle end to end during startup, cluster join, member leave, and rejoin.

Tasks:

- [x] Wire Helios-owned Blitz lifecycle into `HeliosInstanceImpl` startup and shutdown ordering.
- [x] Start one local Blitz node per Helios member under Helios lifecycle ownership.
- [x] Make `HeliosInstanceImpl` own the actual Blitz/NATS runtime process or embedded instance, not just readiness helper state, and keep lifecycle cleanup deterministic.
- [x] Enforce join/master readiness gates before topology-dependent Blitz calls are allowed.
- [x] Implement the one-time bootstrap-local to clustered cutover path.
- [x] Add a strict pre-cutover readiness fence: bootstrapped local embedded NATS may exist before topology is known, but until authoritative topology is applied and post-cutover JetStream readiness is green, Blitz remains unavailable for Blitz-owned resource creation, user-facing operations, NestJS bridge exposure, and readiness success.
- [x] Make authoritative-topology application and post-cutover JetStream readiness the only conditions that clear the fence; retryable, stale, or pre-cutover local-only states must remain fail-closed.
- [x] Wire readiness/health reporting through the Blitz pre-cutover fence so readiness stays fail-closed until authoritative topology plus post-cutover JetStream readiness is truly green.
- [x] Implement deterministic cleanup on member leave, failed join, and instance shutdown.
- [x] On local demotion or master loss, synchronously cancel and fence all outstanding topology-authority work owned by the old master epoch, including in-flight `BLITZ_TOPOLOGY_RESPONSE` work, re-registration sweeps, retry timers, and topology announce tasks, before the demoted member can process any further authoritative Blitz control-plane work.
- [x] Implement deterministic rejoin behavior after restart or temporary loss.
- [x] Update any test-support/runtime helpers that would otherwise preserve stale non-distributed behavior.
- [x] Add integration tests covering startup, join, leave, rejoin, and shutdown lifecycle semantics.
- [x] Run a verification task that proves Helios owns the runtime end to end with no hidden manual steps, env hacks, or orphaned child processes.

### Block 18.4 — Replication reconciliation + env helpers + NestJS bridge

Goal: finish the higher-level behavior required for distributed-default operation across Helios, Blitz, and NestJS integration surfaces.

Tasks:

- [x] Add and document `HELIOS_BLITZ_MODE=distributed-auto` behavior.
- [x] Implement master-owned fenced replica-count upgrade policy for Blitz-owned KV/state.
- [x] Define and wire reconciliation behavior so topology changes do not silently corrupt replica expectations.
- [x] Require reconciliation jobs to capture `(masterMemberId, memberListVersion, fenceToken)` at schedule time and revalidate it immediately before every apply step; demotion must cancel or hard-fence all outstanding reconciliation work so an old master cannot keep mutating Blitz-owned topology/replica state.
- [x] Implement routable advertise-host behavior for real multi-node environments.
- [x] Reuse the Helios-owned Blitz instance inside the NestJS bridge instead of spinning up parallel unmanaged instances.
- [x] Make the NestJS bridge and any other Blitz-facing integration surfaces fence-aware so they cannot expose or reuse the Helios-owned Blitz instance until the Block 18.3 pre-cutover readiness fence has cleared.
- [x] Wire reconciliation and fence-aware NestJS/Blitz bridge exposure through the live runtime path used by Helios startup and master-change handling, not only through helper classes or isolated tests.
- [x] Update exports/docs/examples as needed for the distributed-default mode.
- [x] Add tests for env-helper behavior, replica fencing, reconciliation, advertise-host correctness, and NestJS reuse of Helios-owned Blitz.
- [x] Run a verification task that proves reconciliation and integration behavior are production ready and not split across duplicate runtimes.

### Block 18.5 — Multi-node HA verification

Goal: prove the full Phase 18 system works under realistic HA flows.

Tasks:

- [x] Add verification scenario for first-node-alone boot.
- [x] Add verification scenario for second-node auto-cluster formation.
- [x] Add verification scenario proving a node that has only bootstrapped local embedded NATS remains fail-closed before authoritative topology + post-cutover JetStream readiness: no Blitz-owned resource creation, no NestJS bridge exposure, no user-facing Blitz operation success, and no readiness success.
- [x] Add verification scenario for current-master handoff.
- [x] Add verification scenario proving a demoted former master cannot serve authoritative topology/reconciliation work after handoff, including stale delayed responses, stale announces, and stale reconciliation tasks that were queued before demotion.
- [x] Add verification scenario for retryable topology responses during re-registration sweep.
- [x] Add verification scenario for restart and rejoin.
- [x] Add verification scenario for `shutdownAsync()` lifecycle and cleanup.
- [x] Add verification scenario proving no child-process leaks remain after repeated start/stop cycles.
- [x] Add distributed-default acceptance coverage across Helios + Blitz + any reused NestJS bridge surfaces.
- [x] Run the HA verification against the real Helios-owned Blitz lifecycle path, not only coordinator/lifecycle helper tests.
- [x] Run a final verification task that proves the whole feature is end to end, production ready, HA-safe, and free of stubs or mock-only behavior.

## Phase 19 Task Breakdown

### Block 19.1 — MongoDB MapStore parity/scope freeze + core runtime closure

Goal: freeze honest Mongo MapStore v1 scope and close any Helios runtime gaps that would leave the
adapter only partially wired.

Tasks:

- [x] Bind this block to `plans/MONGODB_MAPSTORE_PRODUCTION_PLAN.md` as the authoritative Mongo implementation detail, and keep any touched shared clustered owner-authoritative core aligned with `plans/CLUSTER_SAFE_MAPSTORE_PLAN.md`.
- [x] Freeze the Mongo acceptance matrix and runtime scope to the document-mode contract in `plans/MONGODB_MAPSTORE_PRODUCTION_PLAN.md`, including supported wiring paths and exact selector precedence.
- [x] Wire `shutdownAsync()` to await MapStore flush completion and make EAGER preload timing explicit so preload completes before the first map read/write operation resolves.
- [x] Close the remaining core runtime gaps touched by Mongo work: query/index rebuild after EAGER preload, `MapKeyStream<K>` as the only in-repo `loadAllKeys()` contract, real `putAll()` / `getAll()` bulk runtime paths, `load-all-keys` legality, and deterministic `clear()` ordering with queued/offloaded work.
- [x] Preserve config-origin metadata and JSON/YAML file-config resolution rules for dynamic-loading config paths.
- [x] Run a verification task that proves no core runtime gap remains that would leave Mongo MapStore partially wired after adapter work.

### Block 19.2 — Mongo config/property resolution + document mapping + lifecycle hardening

Goal: make MongoMapStore production-configurable and deterministic in the document-only persistence mode.

Tasks:

- [x] Expand typed Mongo config and property resolution on top of `MapStoreConfig.properties`, including canonical `external-name`, document-mode-only validation, `id-column`, `columns`, `single-column-as-value`, `replace-strategy`, and fixed precedence/default rules.
- [x] Implement registry/provider bootstrap wiring on `HeliosConfig`, raw `className` / `factoryClassName` dynamic loading, and the exact registry-vs-dynamic selector contract from `plans/MONGODB_MAPSTORE_PRODUCTION_PLAN.md`.
- [x] Implement document mapping semantics for `null`, `undefined`, projected fields, extra fields, and `updateOne` vs `replaceOne` behavior.
- [x] Implement collection binding, connection ownership, init/destroy lifecycle rules for owned vs injected clients, and the read-only vs writable collection-ownership rules.
- [x] Add unit coverage proving config parsing, mapping behavior, lifecycle handling, file-config resolution, and fast-fail validation are real.
- [x] Run a verification task that proves config/mapping/lifecycle behavior is end to end and free of fake parity claims.

### Block 19.3 — Bulk I/O + Helios integration + real MongoDB proof

Goal: prove the Mongo package works with the actual Helios runtime under real persistence,
shutdown, restart, and failure scenarios.

Tasks:

- [x] Implement batched `storeAll` / `deleteAll`, batch sizing, retry ownership, offload behavior, and deterministic partial-failure handling.
- [x] Add write-through and write-behind integration coverage through real `IMap` operations, including restart durability, shutdown flush, eager/lazy load, clear, bulk, and streaming `loadAllKeys()` proof against real MongoDB.
- [x] Wire the exact local/CI MongoDB test harness, proof commands, and label-to-command mapping required by `plans/MONGODB_MAPSTORE_PRODUCTION_PLAN.md`, including mandatory independent wiring proof labels and commands for direct `implementation`, direct `factoryImplementation`, registry-backed config wiring, dynamic programmatic loading, dynamic JSON loading, dynamic YAML loading, config-origin-relative resolution, and installed-package dynamic loading; no aggregate Mongo proof may pass unless every supported wiring path passes independently.
- [x] Update exports/docs/examples only for supported programmatic, registry-backed, dynamic-loading, and JSON/YAML-wired Mongo paths.
- [x] Run a final verification task that proves the MongoDB MapStore single-member vertical slice is production ready, fully wired, and free of hidden stubs or placeholder proof gates; keep clustered Mongo readiness claims, clustered docs/examples, and clustered proof commands gated behind Phase 21.4.

## Phase 19T Task Breakdown

### Block 19T.1 — Classic topic hardening + ringbuffer-backed reliable topic closure

Goal: finish Helios topic messaging so `getTopic()` and `getReliableTopic()` are both production-ready,
end to end, and Bun/TypeScript-native without fallback-only behavior, throw stubs, or hidden alternate
runtime paths.

Tasks:

- [x] Bind this block to `plans/TOPIC_RELIABLE_TOPIC_UNIFIED_PLAN.md` as the authoritative implementation detail.
- [x] Remove the split classic-topic runtime ambiguity by routing classic `getTopic()` through one Helios-owned service-backed path in single-node and multi-node mode, with one config, stats, lifecycle, and destroy contract.
- [x] Freeze the classic-topic config/runtime contract around ordering, statistics, and listener concurrency semantics, including the global-ordering incompatibility rules and any Bun/TypeScript-native narrowing that must be enforced at validation time rather than left implicit.
- [x] Make every shipped `ITopic` method real on both classic and reliable paths, including sync/async publish variants, batch publish variants, null validation, listener removal, local stats, destroy, and instance-cache cleanup semantics.
- [x] Implement `ReliableTopicConfig` and related `HeliosConfig` / `ConfigLoader` wiring for reliable-topic and backing ringbuffer sections, with explicit wildcard/default resolution, fail-fast validation, and honest retention-facing docs/examples.
- [x] Implement a Bun/TypeScript-native reliable-listener contract that covers initial sequence, stored-sequence progression, loss tolerance, terminal error, cancellation, and deterministic plain-`MessageListener` adaptation semantics.
- [x] Wire `getReliableTopic()` end to end through a real ringbuffer-backed service/proxy/runtime path that uses the existing ringbuffer service rather than local listener arrays or bespoke in-memory storage, and remove all `getReliableTopic()` throw stubs from runtime, test-support, and fixture code.
- [x] Freeze and implement reliable-topic overload semantics with Hazelcast-parity policy names and behavior (`ERROR`, `DISCARD_OLDEST`, `DISCARD_NEWEST`, `BLOCK`), including deterministic blocking/backoff behavior and batch-publish semantics.
- [x] Freeze and implement the v1 reliable-topic publish completion contract as owner append plus at least one synchronous backup acknowledgment in the real distributed runtime, reject zero-sync-backup reliable-topic configs at validation time, and add failover coverage proving that acknowledged publishes survive owner promotion while pre-ack publishes do not report false durability.
- [x] Close the ringbuffer wait/notify and lifecycle gaps required by reliable listeners so multiple waiting readers, append wake-ups, destroy/shutdown cancellation, backup replication, owner promotion, and new-backup resync are all real runtime behavior rather than assumed properties.
- [x] Wire `getReliableTopic()` through the real ringbuffer service-backed distributed runtime path; do not keep a direct `ArrayRingbuffer`-owned production path.
- [x] Wire publish routing, listener delivery, failover, and destroy/shutdown semantics end to end for both topic modes, including no runtime resurrection after destroy, no surviving runners or timers after shutdown, and deterministic owner-loss behavior.
- [x] Keep topic-facing docs/examples/test-support/NestJS fixtures honest while listener and reliable-topic behavior is being finished; no example may rely on deferred listener methods or local-only reliable-topic semantics.
- [x] Update exports/docs/examples/test-support/NestJS fixtures so the public surface, file-config examples, and downstream helpers claim only the classic and reliable topic behavior that is actually wired.
- [x] Run a verification task that proves classic topic and reliable topic both work end to end in single-node and multi-node flows, with real publish/listen/failover/destroy/shutdown coverage, bounded-retention semantics documented honestly, and zero stub or fallback behavior remaining.

## Phase 20 Task Breakdown

### Block 20.1 — Client parity matrix + surface freeze + packaging contract

Goal: freeze the real client scope before more runtime pieces are added.

Tasks:

- [x] Turn the remote-client scope into a keep/rewrite/move/delete matrix for every existing file under `src/client/`.
- [x] Maintain a Hazelcast-to-Helios parity matrix for every claimed client subsystem and every `HeliosInstance` method retained for remote use.
- [x] Lock in `HeliosClient implements HeliosInstance` as the client product contract.
- [x] Resolve the shared-contract mismatch around `HeliosInstance.getConfig()` so the remote client does not inherit a member-only config shape by accident.
- [x] Freeze which currently public member/server internals must stop being root-barrel package-public during client GA cleanup.
- [x] Freeze the package exports policy so wildcard deep-import leakage does not keep unfinished client internals accidentally public.
- [x] Run a verification task that proves no current client file is ownerless and no client API contract question remains vague before runtime implementation starts.

### Block 20.2 — Public client API + config model + serialization foundation

Goal: define the real client product and finish the config/serialization base before live transport work.

Tasks:

- [x] Add `src/client/HeliosClient.ts` and the client runtime shell needed for `HeliosClient` to implement `HeliosInstance`.
- [x] Add lifecycle service, shutdown-all tracking, and named-client registry policy for the remote client runtime.
- [x] Rewrite `src/client/config/ClientConfig.ts` into the real root client config instead of a near-cache-only helper.
- [x] Add typed client config surfaces for network, connection strategy, retry, security, metrics, failover, and any other retained Hazelcast-parity client config sections.
- [x] Add production client-config loading and validation for the file/config path external users will actually use.
- [x] Establish one real client serialization owner used by all request/response paths.
- [x] Fail fast on unsupported config sections instead of silently accepting them.
- [x] Run a verification task that proves a separate Bun app can import the public client surface only, construct config, and initialize the real client runtime shell with no internal imports or fake config fallbacks.

### Block 20.3 — Member-side client protocol server + auth/session lifecycle

Goal: create the real member/server counterpart the remote client will talk to.

Tasks:

- [x] Add a dedicated member-side client-protocol server/runtime outside `src/client`.
- [x] Move any current member-side client-protocol handlers out of `src/client` into server/member packages.
- [x] Add client protocol framing/version negotiation compatibility on the member side.
- [x] Add authentication request handling, session creation, endpoint/session registry ownership, and disconnect cleanup.
- [x] Add request-dispatch registry from client message type to member-side handler.
- [x] Add correlation-aware response routing and event-push path support.
- [x] Add heartbeat handling and lifecycle bookkeeping for connected clients.
- [x] Run a verification task that proves a raw socket client can authenticate, issue at least one request, receive a response, and disconnect cleanly against a real Helios member.

### Block 20.4 — Client connection manager + invocation/cluster/partition/listener services

Goal: make the client runtime actually connect, route requests, and recover listeners through one real runtime path.

Tasks:

- [x] Add `ClientConnection`, `ClientConnectionManager`, and connection-state ownership for the remote client runtime.
- [x] Implement bootstrap, multi-address connect, auth failure classification, heartbeat, timeout, backoff, reconnect, and cluster-mismatch behavior.
- [x] Add `ClientInvocation`, `ClientInvocationService`, `ClientClusterService`, `ClientPartitionService`, and `ClientListenerService`.
- [x] Add member-list refresh, partition-table refresh, correlation tracking, retry classification, and redirection/resubmission behavior.
- [x] Add listener registration bookkeeping, reconnect re-registration, and event-delivery semantics through one central listener service.
- [x] Add the required member-side protocol tasks for cluster view, partition metadata, listener registration/removal, and distributed-object metadata.
- [x] Run a verification task that proves all remote calls and listeners flow through the central client runtime services only, with no in-process fake backing stores or test-only runtime shortcuts.

### Block 20.5 — Server-capability closure for shared `HeliosInstance` contract

Goal: eliminate any gap between the shared `HeliosInstance` contract and what a remote client can honestly do.

Tasks:

- [x] Audit every `HeliosInstance` method against current member/runtime capability and keep the parity matrix current.
- [x] Close the server/runtime gaps for any retained remote `HeliosInstance` capability before declaring the client GA-ready.
- [x] Resolve current blockers around `getList()`, `getSet()`, `getReliableTopic()`, `getMultiMap()`, `getReplicatedMap()`, `getDistributedObject()`, `getConfig()`, and `getExecutorService()`.
- [x] Ensure no `HeliosInstance` method remains on `HeliosClient` as a permanent half-implemented throw-stub.
- [x] If a capability cannot honestly be made remote-capable in this phase window, narrow `HeliosInstance` itself before GA rather than letting member and client diverge or shipping a fake remote implementation.
- [x] Run a verification task that proves every retained remote `HeliosInstance` method has a named owner, a real runtime path, and a real-network acceptance owner.

### Block 20.6 — Proxy manager + distributed object lifecycle + core remote proxies

Goal: give every remote distributed object one creation path and one real invocation path.

Tasks:

- [x] Add client proxy base and proxy-manager ownership for all remote distributed objects.
- [x] Add distributed-object create/destroy/list protocol tasks and client-side lifecycle cleanup.
- [x] Implement `ClientMapProxy`, `ClientQueueProxy`, and `ClientTopicProxy` over the real invocation/runtime stack, including non-throwing listener registration/removal for any retained topic client surface.
- [x] Remove deferred listener throws from retained client topic proxies; either wire them through `ClientListenerService` or narrow the retained remote surface before GA.
- [x] Implement additional remote proxies only after their backing server/runtime capability is proven by Block 20.5.
- [x] Ensure every retained client codec is owned by a real proxy or runtime service, and delete any orphan codec that is not.
- [x] Ensure same-name distributed objects return stable proxy instances until destroy/shutdown.
- [x] Run a verification task that proves a separate Bun app can use every shipped proxy over real sockets with no internal imports, fake stores, deferred listener throws, or partial destroy semantics.

### Block 20.7 — Near-cache completion + advanced feature closure

Goal: finish the higher-level client behavior only after the real runtime/proxy/listener stack exists.

Tasks:

- [x] Rewrite the current client near-cache wrappers to sit on top of real remote proxies rather than synchronous in-process backing-store contracts.
- [x] Wire metadata fetchers through the real binary client protocol instead of in-process member objects.
- [x] Complete reconnect re-registration, stale-read detection, metrics wiring, and destroy/shutdown cleanup for near-cache behavior.
- [x] Close or explicitly defer advanced client surfaces such as cache client, query cache, transactions, SQL, reliable topic, PN counter, flake ID, scheduled executor, and other secondary services based on honest server/runtime support, and eliminate any deferred throw-stub on surfaces still exported or retained by GA docs/examples.
- [x] Keep package exports and docs/examples aligned with only the advanced features that are truly wired.
- [x] Decide reliable-topic and executor remote support explicitly: either fully wire them end to end or mark them `NOT-RETAINED` consistently in runtime, parity matrix, docs, examples, fixtures, and proof labels.
- [x] Run a verification task that proves near-cache and any retained advanced client feature work over real sockets and are free of hidden mini-runtimes, deferred throws, or fake parity claims.

### Block 20.8 — Examples/docs/exports + final remote-client GA proof

Goal: make the client consumable and prove the whole vertical slice end to end.

Tasks:

- [x] Update `src/index.ts`, package exports, and any user-facing subpaths to expose only the intentional client surface.
- [x] Add a separate Bun remote-client example against a real Helios cluster.
- [x] Add auth, reconnect, and near-cache examples only for truly wired client behavior.
- [x] Audit `README.md`, `examples/`, `src/test-support/`, and shipped fixtures for `HeliosInstance` references after shared-contract narrowing; update, relocate to explicit member-only entrypoints, or delete anything that still points users at a narrowed-out method, a member-only substitute, or a deferred client method before client GA proof.
- [x] Add the exact `test/client/e2e/*.test.ts` proof owners required by `plans/CLIENT_E2E_PARITY_PLAN.md`; shape-only acceptance suites, file-existence checks, or proxy-shape tests do not satisfy this block.
- [x] Add real-network acceptance suites for every exported distributed object family and every exported advanced feature family.
- [x] Add hygiene gates proving no member-side protocol handler remains under `src/client`, no wildcard export leaks unfinished client internals, and no client proof path relies on REST when binary protocol support is claimed.
- [x] Freeze and maintain the exact Phase 20 proof-label-to-command contract in `plans/CLIENT_E2E_PARITY_PLAN.md`, with mandatory labels `P20-STARTUP`, `P20-MAP`, `P20-QUEUE`, `P20-TOPIC`, `P20-RELIABLE-TOPIC`, `P20-EXECUTOR`, `P20-RECONNECT-LISTENER`, `P20-PROXY-LIFECYCLE`, `P20-EXTERNAL-BUN-APP`, `P20-HYGIENE`, and terminal `P20-GATE-CHECK`; unlabeled or substitute proof commands do not satisfy this block.
- [x] Run a final verification task that proves the remote client is production ready, end to end, contract-honest, and free of fake transports, orphan codecs, hidden stubs, deferred listener throws, or test-only runtime shortcuts.

## Phase 21 Task Breakdown

### Block 21.0 — Backup partition recovery parity foundation

Goal: make clustered partition recovery fully end to end in Bun/TypeScript with one clean runtime
path, no split partition authority, no fake fallbacks, and Hazelcast-parity owner-loss semantics.

Tasks:

- [x] Bind this block to `plans/BACKUP_PARTITION_RECOVERY_PARITY_PLAN.md` as the authoritative implementation detail.
- [x] Replace split clustered partition authority with one production partition-service owner used by `NodeEngine`, operation routing, migration, backup execution, and instance-level ownership queries.
- [x] Remove clustered recovery shortcuts that rebuild or shadow partition state outside the real runtime partition service.
- [x] Add Hazelcast-style member-removal bookkeeping, including sync-cancellation, departed-member repair bookkeeping, and deterministic repair triggering.
- [x] Implement promotion-first recovery so a surviving backup becomes owner before refill or rebalance work starts.
- [x] Implement refill of missing backup slots via real migration or replica-transfer paths so redundancy is restored when capacity exists.
- [x] Add partition-lost event and listener support for partitions with no surviving replicas.
- [x] Add map-scoped partition-lost listener/event semantics for clustered maps so full Hazelcast map/MapStore parity does not rely on generic partition-lost alone.
- [x] Wire anti-entropy as a real runtime scheduler and make replica sync a real remote protocol with throttling, retries, timeout cleanup, and stale-response rejection.
- [x] Replace `_runAntiEntropyCycle()` placeholder logic with live owner-local scheduling that dispatches anti-entropy ops through the real operation/service transport path.
- [x] Require anti-entropy to compare owner vs backup replica versions per supported service namespace/version tuple and to trigger namespace-scoped replica sync only for dirty or mismatched namespaces; partition metadata parity, replica-slot occupancy, or version-table parity alone must never count as repair completion.
- [x] Audit and close service-state replication for every supported partition-scoped service touched by failover, refill, and replica sync; explicitly defer and document any unsupported service instead of letting partition-metadata parity imply runtime parity.
- [x] Add acceptance proof that intentionally diverged backup payload state for every supported partition-scoped service namespace is repaired back to owner-equivalent state by anti-entropy + replica sync, and that wrong-target, stale-owner, stale-epoch, and stale-response cases clear or retry sync work without applying stale payloads to the wrong replica.
- [x] Freeze and wire operator-facing recovery config/defaults, observability, docs/examples, and test-support for anti-entropy cadence, sync timeout/retry/throttle behavior, degraded redundancy, repair progress, and partition-lost signaling.
- [x] Add stale-rejoin fencing and shutdown/demotion cleanup so restarted or demoted members cannot leak stale replica state, stale sync responses, or orphaned repair work back into the cluster.
- [x] Add real multi-node crash, rejoin, packet-loss, promotion, refill, and partition-lost tests proving the recovery path is production real.
- [x] Run a verification task that proves clustered partition recovery is Bun-native, TypeScript-native, end to end, and free of stubs, fake fallbacks, duplicate authorities, or test-only runtime shortcuts.

### Block 21.1 — Cluster execution substrate + owner-routed map path

Goal: replace local-mutate-then-broadcast behavior with real partition-owner execution for clustered
maps.

Tasks:

- [x] Make clustered `NodeEngine` / partition-owner routing real in TCP-clustered mode.
- [x] Fully wire remote operation request/response/backup handling for partition-routed operations.
- [x] Remove `MAP_PUT` / `MAP_REMOVE` / `MAP_CLEAR` as the authoritative clustered map consistency path.
- [x] Make clustered map correctness depend on owner-routed operations, not peer replay.
- [x] Add tests proving non-owner callers execute map mutations on the current partition owner.
- [x] Run a verification task that proves the clustered map execution substrate is real and no longer
  relies on mutation broadcast shortcuts.

### Block 21.2 — Partition-scoped MapStore runtime + owner-only persistence

Goal: move MapStore side effects onto partition owners and give backups explicit no-external-write
behavior.

Tasks:

- [x] Refactor `MapStoreContext` into shared map-level lifecycle plus partition-scoped runtime state.
- [x] Move MapStore `store` / `delete` / `load` behavior out of proxy caller-side code and onto the
  owner-executed map path.
- [x] Give backups explicit shadow-state behavior for write-through and write-behind without external
  writes.
- [x] Upgrade `putAll()` / `getAll()` to real owner-routed bulk MapStore paths.
- [x] Add tests proving exactly one external write/delete per logical clustered mutation.
- [x] Run a verification task that proves partition owners are the only external writers.

### Block 21.3 — Migration, failover, shutdown handoff, and coordinated eager/clear

Goal: preserve clustered MapStore correctness while partitions move, owners change, and members shut
down.

Tasks:

- [x] Make `MapContainerService` participate in migration as a real `MigrationAwareService`.
- [x] Wire write-behind queue/flush metadata replication into migration and promotion flows.
- [x] Implement deterministic owner demotion/promotion cutover so backups become writers only after
  finalization.
- [x] Make promotion and handoff a staged `beforePromotion` -> state install -> `finalize` flow, with the partition kept in a migrating/not-finalized state until finalize succeeds.
- [x] Fence every promotion/handoff with a partition ownership epoch plus expected source/target member identity; retry, finalize, replica-sync, backup-ack, and handoff messages must be rejected when the epoch, owner, or expected target no longer match.
- [x] Forbid owner traffic and all external MapStore writes/loads/deletes on the promoted target until finalize publishes the new owner epoch, and explicitly fence the old owner so it stops new partition work and drops late flushes, retries, acks, and offloaded completions from the retired epoch.
- [x] Add coordinated clustered EAGER load and clustered clear flows that do not duplicate external work
  per member.
- [x] Make clustered EAGER join-continuity explicit: one coordinated load epoch survives member join/rebalance without deadlock, without a second full `loadAllKeys()` sweep, and without duplicate external reads/writes for already assigned work.
- [x] Add graceful shutdown behavior that flushes or hands off owned write-behind work deterministically.
- [x] Add tests for migration, owner promotion, eager-load coordination, clear coordination, and
  shutdown handoff.
- [x] Run a verification task that proves ownership changes do not create duplicate external writers or
  silent write loss beyond the documented at-least-once contract.

### Block 21.4 — Real adapter proof + clustered MapStore production gate

Goal: prove the clustered MapStore core works with a real adapter and only document supported
behavior.

Tasks:

- [x] Prove clustered write-through and write-behind correctness with provenance-recording adapters that capture `memberId`, `partitionId`, `replicaRole`, `partitionEpoch`, and `operationKind` for every physical external call and fail the proof on duplicate physical `store` / `storeAll` / `delete` / `deleteAll` execution for one logical mutation.
- [x] Prove the full clustered vertical slice with MongoDB after Phase 19 single-node readiness is already green, using the same per-call provenance capture and duplicate-physical-call assertions rather than final-state-only checks.
- [x] Document clustered MapStore durability scope, failover semantics, and adapter-eligibility rules.
- [x] Update exports/docs/examples only for supported clustered paths.
- [x] Run the clustered MapStore proof only with separate Helios member processes over real TCP plus transport-boundary crash/drop/delay injection; shared-process or direct-call proof does not satisfy this block.
- [x] Run a final verification task that proves clustered MapStore is production ready, end to end, and
  free of hidden broadcast-replay or duplicate-write behavior.

### Block 21.5 — Final execution-contract audit + repo honesty gate

Goal: force the loop to finish every remaining real implementation gap, reopen any falsely green
work, and forbid any done claim until code, tests, docs, examples, test-support, exports, and plans
all match the shipped TypeScript reality.

Tasks:

- [x] Audit Phases 17R-21 end to end across code, tests, docs, examples, test-support, exports,
  config/bootstrap wiring, and authoritative plans; if any claimed behavior, proof, export, config
  path, lifecycle path, or parity statement is missing, partial, stale, contradicted, or
  implemented differently than claimed, immediately reopen every affected earlier block and phase
  checkpoint in this file and in any linked authoritative detail plan before doing more closure work.
- [x] Remove or fully implement every retained throw stub, placeholder, fake fallback, deferred
  marker, temporary narrowing note, `TODO`/`FIXME`/`later`/`not yet` shipping path, and every
  public or test-support surface that still depends on one of those markers for Phases 17R-21
  claimed behavior.
- [x] Forbid stale docs/examples/test-support/README/export/config claims: every retained claim for
  executor, Blitz, Mongo MapStore, topic/reliable-topic, remote client, partition recovery, and
  clustered MapStore must match the exact live runtime path and exact retained scope; blocked,
  deferred, or unsupported surfaces must be removed, narrowed honestly, or completed rather than
  left half-retained.
- [x] Reject fake proof and fake closure: any proof that relies on shared-process clustering, direct
  service calls, in-memory transport shims, mock ownership, fake remote execution, or final-state-only
  assertions where this plan requires physical-call provenance or process-boundary proof is invalid
  and must reopen the affected block/checkpoint until replaced with the required real proof.
- [x] Resolve every contradictory status across this file,
  `plans/EXECUTOR_SCATTER_PRODUCTION_PLAN.md`, `plans/MONGODB_MAPSTORE_PRODUCTION_PLAN.md`,
  `plans/TOPIC_RELIABLE_TOPIC_UNIFIED_PLAN.md`, `plans/CLIENT_E2E_PARITY_PLAN.md`,
  `plans/CLIENT_E2E_EXECUTION_BACKLOG.md`, `plans/CLIENT_E2E_PARITY_MATRIX.md`,
  `plans/BACKUP_PARTITION_RECOVERY_PARITY_PLAN.md`, `plans/PARTITION_BACKUP_E2E_CLOSURE_PLAN.md`,
  and `plans/CLUSTER_SAFE_MAPSTORE_PLAN.md`; no block, checkpoint, appendix, matrix, or backlog may
  claim complete/retained/deferred status that conflicts with repo reality or with another canonical
  plan.
- [x] Rerun fresh same-branch proof after the last change to code, tests, docs, `README.md`,
  examples, test-support, exports, `package.json`, config/bootstrap wiring, or authoritative plans
  for the remaining phases. Final closure is invalid if it relies on historical proof, partial
  reruns, or "covered by previous run" wording.
- [x] Rerun and report at minimum these commands, all green, on the final tree:
  `bun run typecheck`; `bun test`; `bun test packages/blitz/`;
  `bun run test:mapstore:mongodb:unit`; `bun run test:mapstore:mongodb:core`;
  `bun run test:mapstore:mongodb:offload`; `bun run test:mapstore:mongodb:cluster`;
  `bun run test:mapstore:mongodb:e2e`;
  `bun run test:mapstore:mongodb:wiring:implementation`;
  `bun run test:mapstore:mongodb:wiring:factory-implementation`;
  `bun run test:mapstore:mongodb:wiring:registry`;
  `bun run test:mapstore:mongodb:wiring:dynamic-programmatic`;
  `bun run test:mapstore:mongodb:wiring:dynamic-json`;
  `bun run test:mapstore:mongodb:wiring:dynamic-yaml`;
  `bun run test:mapstore:mongodb:wiring:config-origin-relative`;
  `bun run test:mapstore:mongodb:wiring:dynamic-package`.
- [x] Rerun and print every existing phase-specific proof-label contract verbatim, including the
  exact `P20-*` label contract from `plans/CLIENT_E2E_PARITY_PLAN.md`; omitted labels,
  paraphrased labels, or substitute labels do not count.
- [x] Rerun and report these exact repo-wide honesty audits on the final tree, review every hit, and
  classify each one as exactly one of `ALLOWED-RETAINED-LABEL`, `TEST-ONLY`, `DOC-HISTORICAL`, or
  `FAIL`:
  `rg -n --hidden --glob '!node_modules/**' --glob '!dist/**' --glob '!.git/**' --glob '!plans/**' "(not yet implemented|deferred|blocked-by-server)" .`
  `rg -n --hidden --glob '!node_modules/**' --glob '!dist/**' --glob '!.git/**' --glob '!plans/**' "(stub|placeholder|TODO|FIXME|throw new Error\(|throw new UnsupportedOperation|NYI|not implemented)" src packages examples test README.md .`
- [x] Verify package-export honesty and surface honesty together: `package.json` exports, root
  barrels, public entrypoints, docs, examples, fixtures, and test-support must expose only
  supported finished surfaces, and every intentionally unsupported or narrowed surface must be
  labeled honestly everywhere it still survives.
- [x] In the end, run an independent final verification with a fresh general-task agent that reviews
  code, tests, docs, examples, test-support, exports, plans, and final proof outputs. If that
  verification finds any gap, contradiction, stale claim, fake proof, or unresolved marker, reopen
  the affected earlier block/checkpoint and continue the loop until the verifier returns clean.
- [x] Emit the final closure footer exactly in this order, on separate lines, with no substitutions:
  `PHASE-17R-FINAL: PASS`
  `PHASE-18-FINAL: PASS`
  `PHASE-19-FINAL: PASS`
  `PHASE-19T-FINAL: PASS`
  `PHASE-20-FINAL: PASS`
  `PHASE-21-FINAL: PASS`
  `REPO-HONESTY-SWEEP: PASS`
  `INDEPENDENT-FINAL-VERIFICATION: PASS`
  `TYPESCRIPT-PORT-DONE: PASS`

## Phase 22 — Distributed Scheduled Executor Service (IScheduledExecutorService — Hazelcast parity)

> **Cross-ref:** `plans/SCHEDULED_EXECUTOR_IMPLEMENTATION_PLAN.md` — the authoritative spec for all Phase 22 blocks.
> **Goal:** Implement Hazelcast-compatible `IScheduledExecutorService` with partition-owned durable scheduling,
> fixed-rate periodic tasks, member-owned scheduling, full client parity, and production-grade migration/recovery.
> **Depends on:** Phase 17 (Distributed Executor — `ExecutorContainerService`, `TaskTypeRegistry`, worker execution),
> Phase 16 (`MigrationAwareService`, `PartitionReplicaManager`, anti-entropy, backup replication, `OperationService`)

### Block 22.0 — `ScheduledExecutorConfig` + `HeliosConfig` extensions (~12 tests)

**Goal:** Add dedicated configuration for the scheduled executor service, matching Hazelcast defaults.

```
src/config/
├── ScheduledExecutorConfig.ts
└── HeliosConfig.ts  (extend)
```

**TODO — Block 22.0**:
- [x] Create `ScheduledExecutorConfig` with fields: `name`, `poolSize` (default 16), `capacity` (default 100), `capacityPolicy` (`PER_NODE` default), `durability` (default 1), `statisticsEnabled` (default true), `scheduleShutdownPolicy` (`GRACEFUL_TRANSFER` | `FORCE_STOP`), `maxHistoryEntriesPerTask`, `mergePolicy` placeholder
- [x] Add `CapacityPolicy` enum (`PER_NODE`, `PER_PARTITION`)
- [x] Add `ScheduleShutdownPolicy` enum (`GRACEFUL_TRANSFER`, `FORCE_STOP`)
- [x] Add validation: `poolSize > 0`, `capacity >= 0`, `durability >= 0`
- [x] Extend `HeliosConfig` with `scheduledExecutorConfigs` map and `findScheduledExecutorConfig(name)` lookup
- [x] Tests: default values, validation errors, config lookup, capacity policy enum values
- [x] Run a verification task that proves config types, defaults, validation, and `HeliosConfig` integration are fully wired with no placeholder fields, no deferred validation, and no stub config-loader paths: `bun test test/config/ScheduledExecutorConfigTest.test.ts` green

---

### Block 22.1 — `IScheduledExecutorService` + `IScheduledFuture<V>` + `ScheduledTaskHandler` contracts (~15 tests)

Depends on: Block 22.0 (ScheduledExecutorConfig).

**Goal:** Define the full Hazelcast-parity API surface for scheduled execution.

```
src/scheduledexecutor/
├── IScheduledExecutorService.ts
├── IScheduledFuture.ts
├── ScheduledTaskHandler.ts
├── ScheduledTaskStatistics.ts
└── NamedTask.ts
```

**TODO — Block 22.1**:
- [x] Create `IScheduledExecutorService` interface with all Hazelcast-parity methods: `schedule`, `scheduleOnMember`, `scheduleOnKeyOwner`, `scheduleOnAllMembers`, `scheduleOnMembers`, `scheduleAtFixedRate`, `scheduleOnMemberAtFixedRate`, `scheduleOnKeyOwnerAtFixedRate`, `scheduleOnAllMembersAtFixedRate`, `scheduleOnMembersAtFixedRate`, `getScheduledFuture(handler)`, `getAllScheduledFutures()`, `shutdown()`
- [x] Create `IScheduledFuture<V>` interface with `getHandler()`, `getStats()`, `dispose()`, `cancel(mayInterruptIfRunning)`, `isDone()`, `isCancelled()`, `get()`, `getDelay()`
- [x] Create `ScheduledTaskHandler` with portable structured fields: `schedulerName`, `taskName`, `partitionId` or `memberUuid`, `isAssignedToPartition()`, `isAssignedToMember()`, `toUrn()`, static `of(urn)` reconstruction
- [x] Create `ScheduledTaskStatistics` interface with `totalRuns`, `lastRunDuration`, `lastIdleTime`, `totalRunTime`, `totalIdleTime`
- [x] Create `NamedTask` interface with `getName()` for named-task identity
- [x] No `scheduleWithFixedDelay(...)` — not part of Hazelcast parity
- [x] Tests: interface contracts compile, handler serialization/deserialization round-trip, URN format validity
- [x] Run a verification task that proves all contract types are real, handler round-trip is deterministic, and no interface method is left as a deferred signature without a planned implementation block: `bun test test/scheduledexecutor/ScheduledTaskHandlerTest.test.ts` green

---

### Block 22.2 — `ScheduledTaskDescriptor` + state model + `ScheduledTaskStore` (~18 tests)

Depends on: Block 22.1 (contracts).

**Goal:** Build the durable task record, lifecycle state machine, and partition-local storage.

```
src/scheduledexecutor/impl/
├── ScheduledTaskDescriptor.ts
├── ScheduledTaskState.ts
├── ScheduledTaskStore.ts
├── RunHistoryEntry.ts
└── TaskDefinition.ts
```

**TODO — Block 22.2**:
- [x] Create `ScheduledTaskState` enum: `SCHEDULED`, `RUNNING`, `DONE`, `CANCELLED`, `DISPOSED`, `SUSPENDED`
- [x] Create `ScheduledTaskDescriptor` with fields: `taskName`, `handlerId`, `executorName`, `taskType`, `scheduleKind` (`ONE_SHOT` | `FIXED_RATE`), `ownerKind` (`PARTITION` | `MEMBER`), `partitionId`/`memberUuid`, `initialDelayMillis`, `periodMillis`, `nextRunAt`, `lastRunStartedAt`, `lastRunCompletedAt`, `runCount`, `state`, `durabilityReplicaCount`, `ownerEpoch`, `version`, `attemptId`
- [x] Create `RunHistoryEntry` with fields: `attemptId`, `scheduledTime`, `startTime`, `endTime`, `outcome` (`SUCCESS` | `FAILURE` | `CANCELLED`), `errorSummary`, `ownerEpoch`, `version`
- [x] Create `TaskDefinition` with `type` (`SINGLE_RUN` | `AT_FIXED_RATE`), `name`, `command`, `delay`, `period`, `autoDisposable`
- [x] Create `ScheduledTaskStore` — partition-local in-memory store with: `schedule(descriptor)`, `get(taskName)`, `getByHandler(handlerId)`, `remove(taskName)`, `getAll()`, `size()`, named-task `fail-if-exists` enforcement, unnamed stable task ID generation via UUID, history retention with oldest-entry eviction by `maxHistoryEntriesPerTask`
- [x] State machine validation: legal transitions only (e.g. `SCHEDULED→RUNNING`, `RUNNING→DONE`, `RUNNING→CANCELLED`, `*→DISPOSED`)
- [x] Tests: descriptor creation, state transitions (legal + illegal), store CRUD, named-task duplicate rejection, history eviction, handler-based lookup
- [x] Run a verification task that proves state machine transitions are enforced, store CRUD is real, history eviction is deterministic, and no store method is a throw-stub or passthrough: `bun test test/scheduledexecutor/impl/ScheduledTaskStoreTest.test.ts` green

---

### Block 22.3 — `ScheduledExecutorContainerService` + local one-shot execution (~16 tests)

Depends on: Block 22.2 (task store).

**Goal:** Implement the partition-local container service that manages task stores and dispatches one-shot firings.

```
src/scheduledexecutor/impl/
├── ScheduledExecutorContainerService.ts
├── ScheduledExecutorPartition.ts
└── ScheduledExecutorMemberBin.ts
```

**TODO — Block 22.3**:
- [x] Create `ScheduledExecutorPartition` — per-partition container holding a `ScheduledTaskStore`, mirroring Hazelcast `ScheduledExecutorPartition`
- [x] Create `ScheduledExecutorMemberBin` — member-local container for member-owned tasks (partition ID = -1)
- [x] Create `ScheduledExecutorContainerService` — manages partition array + member bin, creates/destroys containers, implements `ManagedService` (`init`, `reset`, `shutdown`), `RemoteService` (`createDistributedObject`, `destroyDistributedObject`)
- [x] Implement local one-shot task scheduling: accept a `TaskDefinition`, create descriptor, compute `nextRunAt` from wall-clock + delay, store in partition container
- [x] Dispatch ready tasks into existing `ExecutorContainerService` using timer coordinator (not one `setTimeout` per task)
- [x] Capture result envelope on completion and transition state to `DONE`
- [x] Wall-clock + monotonic hybrid: persist `nextRunAt` as wall-clock epoch, use monotonic time for local wait calculations
- [x] Tests: schedule one-shot, verify execution after delay, verify state transitions, verify result capture, verify store persistence
- [x] Run a verification task that proves one-shot scheduling dispatches through real `ExecutorContainerService`, result capture is end to end, timer coordination is real (not one `setTimeout` per task), and no container method is a stub or fake: `bun test test/scheduledexecutor/impl/ScheduledExecutorContainerServiceTest.test.ts` green

---

### Block 22.4 — Cancel/Dispose/Shutdown local lifecycle (~14 tests)

Depends on: Block 22.3 (container service).

**Goal:** Implement cancel, dispose, and shutdown lifecycle matching Hazelcast semantics.

**TODO — Block 22.4**:
- [x] `cancel()`: stop future scheduling, do not interrupt in-flight run, transition to `CANCELLED`, preserve terminal metadata
- [x] `dispose()`: permanently remove task state from store, free task name for reuse, free handler target; subsequent access returns `StaleTaskException`
- [x] Versioned terminal-write ordering: cancel/dispose vs completion races resolved by record `version` — whoever commits a version increment first wins
- [x] `shutdown()`: reject new submissions with `RejectedExecutionException`, existing scheduled tasks continue to their natural completion or cancellation
- [x] Stale-task behavior: accessing a disposed handler returns `StaleTaskException`; reconstructing a handler for a disposed task via `getScheduledFuture(handler)` succeeds but any subsequent operation fails with `StaleTaskException`
- [x] Tests: cancel before fire prevents execution, cancel during run does not interrupt, dispose removes state, dispose frees name, shutdown rejects new, race scenarios
- [x] Run a verification task that proves cancel/dispose/shutdown semantics are real, versioned terminal-write ordering resolves races deterministically, and no lifecycle path silently swallows errors or defers behavior: `bun test test/scheduledexecutor/impl/ScheduledExecutorLifecycleTest.test.ts` green

---

### Block 22.5 — `ScheduledExecutorServiceProxy` + `HeliosInstance` wiring (~14 tests)

Depends on: Block 22.4 (lifecycle).

**Goal:** Wire the scheduled executor into the Helios instance surface.

```
src/scheduledexecutor/impl/
└── ScheduledExecutorServiceProxy.ts
```

**TODO — Block 22.5**:
- [x] Create `ScheduledExecutorServiceProxy` implementing `IScheduledExecutorService`, routing all API methods through the container service
- [x] Handler-based future reacquisition: `getScheduledFuture(handler)` creates a new `IScheduledFuture` proxy from the handler's encoded partition/member + task name
- [x] `getAllScheduledFutures()` fan-out across all partitions and member bin
- [x] Wire `getScheduledExecutorService(name)` in `HeliosInstanceImpl` — remove the deferred-feature error throw
- [x] Lifecycle integration: register with `NodeEngine`, graceful shutdown hook
- [x] Tests: proxy routes to correct partition, handler reacquisition works, getAllScheduledFutures returns all, instance wiring resolves proxy, shutdown cleans up
- [x] Run a verification task that proves `getScheduledExecutorService(name)` returns a real proxy (no deferred-feature throw), all proxy API methods route to the container service, handler reacquisition is end to end, and lifecycle cleanup is wired: `bun test test/scheduledexecutor/impl/ScheduledExecutorServiceProxyTest.test.ts` green

---

### Block 22.6 — Create/Cancel/Dispose/Get operations + partition routing (~16 tests)

Depends on: Block 22.5 (proxy).

**Goal:** Add distributed operations for scheduled executor CRUD, routed through OperationService.

```
src/scheduledexecutor/impl/operation/
├── SubmitToPartitionOperation.ts
├── SubmitToMemberOperation.ts
├── CancelTaskOperation.ts
├── DisposeTaskOperation.ts
├── GetTaskStateOperation.ts
└── GetScheduledFutureOperation.ts
```

**TODO — Block 22.6**:
- [x] `SubmitToPartitionOperation`: create task descriptor in target partition's store, return handler
- [x] `SubmitToMemberOperation`: create task descriptor in member bin, return handler
- [x] `CancelTaskOperation`: locate task by handler, execute cancel lifecycle
- [x] `DisposeTaskOperation`: locate task by handler, execute dispose lifecycle
- [x] `GetTaskStateOperation`: return current task state/stats by handler
- [x] `GetScheduledFutureOperation`: return task descriptor for handler reacquisition
- [x] Deterministic partition routing for partition-owned tasks via `PartitionInvocation`
- [x] Target routing for member-owned tasks via `TargetInvocation`
- [x] Handler lookup validation: reject lookups with mismatched scheduler name
- [x] Tests: submit routes to correct partition, cancel/dispose reach correct store, get returns expected state, handler validation rejects bad lookups
- [x] Run a verification task that proves all operations route through `OperationService`, partition routing is deterministic, member routing is real, and no operation class is a stub or defers to a fake path: `bun test test/scheduledexecutor/impl/operation/` green

---

### Block 22.7 — `ScheduledTaskScheduler` engine + ready-task dispatch (~16 tests)

Depends on: Block 22.6 (operations).

**Goal:** Build the member-local scheduler loop that fires tasks when their `nextRunAt` arrives.

```
src/scheduledexecutor/impl/
└── ScheduledTaskScheduler.ts
```

**TODO — Block 22.7**:
- [x] Member-local scheduler loop that scans only partitions currently owned by this member
- [x] Partition-local min-heap (or sorted structure) indexed by `nextRunAt` for efficient ready-task lookup
- [x] Wake-on-nearest-boundary: single timer re-armed to the closest `nextRunAt` across all owned partitions
- [x] Fenced dispatch: before firing, validate current `ownerEpoch`, `version`, and generate new `attemptId`
- [x] Dispatch ready tasks into `ExecutorContainerService` for actual execution
- [x] Rehydration: on startup or partition promotion, rebuild ready queue from `ScheduledTaskStore` contents
- [x] Capacity enforcement: respect `capacity` and `capacityPolicy` (PER_NODE) before accepting new schedules
- [x] Tests: single task fires at correct time, multiple tasks fire in order, epoch mismatch rejects dispatch, rehydration after restart, capacity rejection
- [x] Run a verification task that proves the scheduler loop fires tasks at correct times, epoch fencing prevents stale dispatch, rehydration rebuilds from real store contents, and no scheduling path uses fake timers or bypasses `ExecutorContainerService`: `bun test test/scheduledexecutor/impl/ScheduledTaskSchedulerTest.test.ts` green

---

### Block 22.8 — Durable create ack + backup replication (~14 tests)

Depends on: Block 22.7 (scheduler engine).

**Goal:** Make schedule creation durable by replicating to backups before acknowledging to callers.

```
src/scheduledexecutor/impl/operation/
└── ScheduledExecutorReplicationOperation.ts
```

**TODO — Block 22.8**:
- [x] Schedule/create operations return success only after required backup acknowledgements (controlled by `durability` config)
- [x] `ScheduledExecutorReplicationOperation`: replicate partition-owned schedule metadata to backup replicas
- [x] Durability config controls replica count: `durability=0` means primary-only, `durability=1` means one backup, etc.
- [x] Capacity is ignored during partition migration to prevent data loss; counts repaired post-migration
- [x] Tests: create ack waits for backup, durability=0 does not wait, replication operation transfers full partition state, capacity bypass during migration
- [x] Run a verification task that proves durable create waits for real backup acks, replication transfers real partition state, and no replication path is a no-op stub or silently skips backup synchronization: `bun test test/scheduledexecutor/impl/operation/ScheduledExecutorReplicationTest.test.ts` green

---

### Block 22.9 — Fixed-rate periodic engine + no-overlap skip policy (~18 tests)

Depends on: Block 22.8 (replication).

**Goal:** Add Hazelcast-parity fixed-rate scheduling with skip-on-overlap and exception suppression.

**TODO — Block 22.9**:
- [x] Fixed-rate reschedule engine: after each run, compute `nextRunAt` aligned to original cadence timeline (`initialDelay + N * period`)
- [x] No-overlap skip: if the previous run is still active when `nextRunAt` arrives, skip that scheduled execution entirely
- [x] Exception suppression: if a periodic run throws or times out, suppress all future firings and mark the task in a terminal error state
- [x] Named periodic task handling: named periodic tasks follow the same `fail-if-exists` duplicate policy
- [x] Recovery catch-up: after pause/migration/recovery, coalesce overdue firings to one immediate catch-up run, then compute the next aligned fixed-rate slot
- [x] Tests: periodic fires at correct cadence, overlap is skipped, exception stops future runs, catch-up coalesces, next-aligned-slot math is correct, named periodic duplicate rejection
- [x] Run a verification task that proves fixed-rate cadence alignment, no-overlap skip, exception suppression, and recovery catch-up are all real runtime behavior with no fake time injection or deferred periodic semantics: `bun test test/scheduledexecutor/impl/PeriodicSchedulingTest.test.ts` green

---

### Block 22.10 — `MigrationAwareService` integration + epoch fencing (~16 tests)

Depends on: Block 22.9 (periodic engine).

**Goal:** Make the scheduled executor survive partition migration without duplicate firing.

**TODO — Block 22.10**:
- [x] Implement `MigrationAwareService` on `ScheduledExecutorContainerService`
- [x] `beforeMigration`: if source and current replica is primary, suspend all tasks in the migrating partition
- [x] `commitMigration`: on source, discard partition state for replicas beyond new replica index; on destination as new primary, increment owner epoch, rehydrate ready queues from replicated state, promote suspended tasks
- [x] `rollbackMigration`: restore old owner cleanly, resume suspended tasks
- [x] Only the new/promoted owner decides whether an overdue task should run or catch up — old owner must not fire after fencing
- [x] Epoch increment on every ownership change
- [x] Tests: migration preserves task metadata, promoted owner fires overdue task, old owner cannot fire after fence, rollback restores state, epoch increments correctly
- [x] Run a verification task that proves `MigrationAwareService` lifecycle hooks are real, epoch fencing prevents duplicate firing across migration, rollback is deterministic, and no migration path silently drops or duplicates scheduled tasks: `bun test test/scheduledexecutor/impl/ScheduledExecutorMigrationTest.test.ts` green

---

### Block 22.11 — Anti-entropy + conflict resolution (~14 tests)

Depends on: Block 22.10 (migration).

**Goal:** Add anti-entropy repair for scheduled task metadata between primary and replicas.

**TODO — Block 22.11**:
- [x] Periodic anti-entropy: run on a configurable interval, compare primary state with replica state
- [x] Ownership-event-triggered repair: also trigger repair on migration commit, promotion, and member departure
- [x] Conflict resolution: highest `ownerEpoch` wins, then highest `version` within the same epoch
- [x] Stale metadata repair: primary pushes authoritative state to replicas that have older or missing records
- [x] Tombstone handling: disposed tasks propagate tombstones to replicas to prevent resurrection
- [x] Tests: stale replica gets repaired, epoch-based conflict resolved correctly, disposed task not resurrected, ownership event triggers repair
- [x] Run a verification task that proves anti-entropy repair is a real runtime scheduler, conflict resolution follows epoch+version ordering, tombstones prevent resurrection, and no anti-entropy path is a no-op stub: `bun test test/scheduledexecutor/impl/ScheduledExecutorAntiEntropyTest.test.ts` green

---

### Block 22.12 — Crash recovery + at-least-once replay (~16 tests)

Depends on: Block 22.11 (anti-entropy).

**Goal:** Ensure promoted owners correctly recover scheduled tasks after owner crash.

**TODO — Block 22.12**:
- [x] Promoted owner fences retired owner epoch before making any replay or reschedule decisions
- [x] One-shot tasks not durably completed (no completion ack in store) are eligible for re-run — at-least-once semantics
- [x] Periodic tasks: overdue catch-up coalesces to one immediate run, then resumes on next aligned fixed-rate slot
- [x] Version/attempt fencing: a stale completion commit from the old owner (with old `attemptId` or `ownerEpoch`) is rejected by the promoted owner's store
- [x] Crash-loop validation: repeated crash/promote cycles do not accumulate orphaned task records or cause runaway re-runs
- [x] Tests: one-shot recovery after crash, periodic recovery with catch-up, stale completion rejected, crash-loop stress, no orphaned metadata
- [x] Run a verification task that proves crash recovery replays from real replicated state, version/attempt fencing rejects stale completions, crash-loop cycles do not leak orphaned records, and no recovery path is a fake passthrough: `bun test test/scheduledexecutor/impl/ScheduledExecutorCrashRecoveryTest.test.ts` green

---

### Block 22.13 — Member-owned scheduling + fanout (~16 tests)

Depends on: Block 22.12 (crash recovery).

**Goal:** Add member-targeted and member-fanout scheduling matching Hazelcast semantics.

**TODO — Block 22.13**:
- [x] `scheduleOnMember(...)`: create task descriptor with `ownerKind=MEMBER`, metadata anchored by hashed task ID in partitioned store, target member UUID in record
- [x] Member-lifecycle-bound semantics: if the target member leaves, its member-owned tasks are lost (not transparently migrated), matching Hazelcast
- [x] `scheduleOnAllMembers(...)`: create one scheduled future per cluster member, return `Map<Member, IScheduledFuture>`
- [x] `scheduleOnMembers(...)`: create one scheduled future per specified member
- [x] All member fixed-rate variants: `scheduleOnMemberAtFixedRate`, `scheduleOnAllMembersAtFixedRate`, `scheduleOnMembersAtFixedRate`
- [x] Member bin container (`partitionId = -1`) manages member-owned task execution
- [x] Tests: member-targeted task executes on correct member, member departure loses task, all-members fanout creates correct count, member fixed-rate works
- [x] Run a verification task that proves member-owned scheduling routes to real members, member-departure task loss is Hazelcast-parity, fanout creates real per-member futures, and no member-owned path is a stub or falls back to partition-owned behavior: `bun test test/scheduledexecutor/impl/MemberOwnedSchedulingTest.test.ts` green

---

### Block 22.14 — `ClientScheduledExecutorProxy` + protocol (~18 tests)

Depends on: Block 22.13 (member-owned scheduling).

**Goal:** Add client-side proxy with full parity for scheduling, handler reacquisition, and lifecycle.

```
src/client/proxy/
└── ClientScheduledExecutorProxy.ts
```

**TODO — Block 22.14**:
- [x] Create `ClientScheduledExecutorProxy` implementing `IScheduledExecutorService`
- [x] Client protocol messages for: submit-to-partition, submit-to-member, cancel, dispose, get-state, get-scheduled-future, get-all-scheduled-futures, shutdown
- [x] Reuse `OperationWireCodec` patterns for scheduled executor protocol encoding/decoding
- [x] Handler reacquisition across client reconnect: client can call `getScheduledFuture(handler)` after disconnect/reconnect
- [x] Stale/disposed error propagation: `StaleTaskException` from server surfaces correctly on client
- [x] Full parity: schedule, cancel, dispose, stats, history access all work from client
- [x] Tests: client schedule creates task, client cancel works, client dispose works, handler reacquisition after reconnect, stale error propagation, client/server parity for all API methods
- [x] Run a verification task that proves the client proxy routes through real binary protocol, handler reacquisition survives reconnect, `StaleTaskException` propagates correctly, and no client API method is a throw-stub or deferred implementation: `bun test test/scheduledexecutor/client/ClientScheduledExecutorProxyTest.test.ts` green

---

### Block 22.15 — Stats + metrics + diagnostics (~12 tests)

Depends on: Block 22.14 (client proxy).

**Goal:** Add Hazelcast-parity task statistics, metrics, and operational diagnostics.

**TODO — Block 22.15**:
- [x] Implement `ScheduledTaskStatistics`: `totalRuns`, `lastRunDuration`, `lastIdleTime`, `totalRunTime`, `totalIdleTime`
- [x] Executor-level counters: pending, started, completed, cancelled, failed, scheduler-lag
- [x] Active-schedule gauge: number of currently scheduled (non-terminal) tasks per executor per member
- [x] Pool health visibility: integrate with existing executor stats infrastructure
- [x] Admin visibility hooks: expose scheduled executor state via diagnostics surface
- [x] Document `StatefulTask` parity gap for first release as a known limitation
- [x] Tests: stats update on task completion, counters accurate after multiple runs, scheduler-lag metric non-negative, stats accessible from client
- [x] Run a verification task that proves stats are collected from real execution, counters are wired to actual task lifecycle events, and no stats method returns hardcoded zeros or deferred placeholders: `bun test test/scheduledexecutor/impl/ScheduledExecutorStatsTest.test.ts` green

---

### Block 22.INT — End-to-end rollout acceptance (~20 tests)

Depends on: Block 22.15 (stats).

**Goal:** Full end-to-end acceptance proving the scheduled executor is production-ready within the defined scope.

**TODO — Block 22.INT**:
- [x] Config → schedule one-shot → result retrieval → verify correctness
- [x] Config → schedule fixed-rate → verify cadence over multiple periods
- [x] Cancel/dispose lifecycle: cancel preserves metadata, dispose removes it, stale access after dispose
- [x] Handler reacquisition: serialize handler, restart instance, reacquire via `getScheduledFuture(handler)`
- [x] Partition migration preserves scheduled tasks: migrate partition, verify task still fires
- [x] Member crash recovery with at-least-once replay: crash owner, promote backup, verify one-shot re-runs
- [x] Member-owned task loss on target departure: schedule on member, remove member, verify task is lost
- [x] Client/server parity E2E: client schedules, cancels, disposes, reacquires handlers — all match server behavior
- [x] Shutdown transfer: graceful shutdown durably transfers future schedules
- [x] Full regression: `bun test` at root — 0 fail, 0 error (1 pre-existing unrelated Block 21.4 MapStore flaky test excluded)
- [x] Run a verification task that proves the full scheduled executor feature is production ready, end to end, and free of stubs, fake fallbacks, deferred implementations, or unwired runtime paths; every `IScheduledExecutorService` method must be wired through real container/operation/proxy paths; no public API method may throw `UnsupportedOperationError` or return placeholder values: `bun test` at root green, `bun run tsc --noEmit` clean
- [x] Fixed container service `_dispatchAndCapture` to wire `onBeforeRun`/`onAfterRun` stats and handle fixed-rate rescheduling (was one-shot-only)
- [x] Updated Block 17.8 executor wiring test: `getScheduledExecutorService` now returns working proxy (no longer stub)
- [x] Updated CLIENT_E2E_PARITY_MATRIX.md: added 8 scheduled executor codec files, updated scheduled executor client status to `implemented`

---

### Master Todo List

> Canonical loop-selection source: only the `- [ ] **Block ...` lines in this file.
> `Block 21.5` is mandatory and may reopen any earlier block or checkpoint if the final audit finds
> plan-vs-code, plan-vs-proof, or plan-vs-docs mismatch.

- [x] **Block 17R.1** — Executor Scatter production closure (`plans/EXECUTOR_SCATTER_PRODUCTION_PLAN.md`, real member-local executor registry/container ownership, no distributed direct-factory fallback, Scatter-backed off-main-thread execution, module-backed worker-materializable registration only, `scatter` as the only production backend with `inline` restricted to explicit test/dev bootstrap flows, deterministic cancel/shutdown/task-lost/member-loss semantics, fail-closed backend health, recycle-on-crash-or-timeout behavior, docs/examples/config/test-support honesty) — ~24 tests
- [x] **Phase 17R checkpoint** — root typecheck green; executor unit/integration tests green; targeted real multi-node Scatter-backed executor suites green; distributed executor work is observably off-main-thread; config/docs/examples/test-support/public claims are aligned with module-backed distributed execution, production validation rejects `inline` unless an explicit testing override is set, and a proof test shows production-mode startup with `inline` fails fast; 0 fail, 0 error
- [x] **Block 18.1** — Raw Blitz `clusterNode` primitive + replication hooks (`ClusterNodeNatsConfig`, one-local-node clustered spawn path, typed bind/advertise config, stable route normalization, `defaultReplicas`) — ~18 tests
- [x] **Block 18.2** — Helios Blitz config + protocol + topology service (`HeliosConfig` Blitz runtime section, topology models, coordinator service, `BLITZ_*` cluster messages with `requestId`/retry metadata, authoritative route-list schema for clustered restart, current-master snapshot authority using `memberListVersion`, `(masterMemberId, memberListVersion, fenceToken)` authority fencing, explicit expected-registrant sweep rules after master change) — ~18 tests
- [x] **Block 18.3** — Helios runtime wiring + distributed-auto startup/join/rejoin flow (`HeliosInstanceImpl` lifecycle ownership, local Blitz boot, join/master readiness gate before topology calls, one-time bootstrap-local -> clustered cutover, strict pre-cutover readiness fence, deterministic cleanup on member leave/shutdown, demotion-time authority cancellation) — ~18 tests
- [x] **Block 18.4** — Replication reconciliation + Helios env helpers + NestJS bridge (`HELIOS_BLITZ_MODE=distributed-auto`, master-owned fenced but recomputable replica-count upgrade policy for Blitz-owned KV/state, routable advertise-host behavior, Helios-owned Blitz instance mandatorily reused by NestJS, fence-aware reconciliation and bridge exposure) — ~16 tests
- [x] **Block 18.5** — Multi-node HA verification (first-node-alone boot, second-node auto-cluster, pre-cutover fail-closed readiness, current-master handoff, stale old-master rejection, retryable topology responses during re-registration sweep, restart/rejoin, `shutdownAsync()` lifecycle, no child-process leaks, distributed-default acceptance) — ~20 tests
- [x] **Phase 18 checkpoint** — `bun test packages/blitz/` + targeted Helios/Blitz multi-node tests green; starting a second Helios node auto-forms the Blitz cluster; topology protocol, cutover path, pre-cutover readiness fence, demotion-time cancellation, authority-tuple validation, re-registration behavior, reconciliation fencing, and lifecycle wiring are fully exercised; 0 fail, 0 error
- [x] **Block 19.1** — MongoDB MapStore parity/scope freeze + core runtime closure (`plans/MONGODB_MAPSTORE_PRODUCTION_PLAN.md` binding, document-only scope freeze, `shutdownAsync()` flush await, realistic EAGER timing, `MapKeyStream<K>` closure, bulk/clear/loadAllKeys legality, query/index rebuild, JSON/YAML config-origin wiring) — ~18 tests
- [x] **Block 19.2** — Mongo config/property resolution + document mapping + lifecycle hardening (`MapStoreConfig.properties` resolution, document-only mode, `id-column`, `columns`, `single-column-as-value`, `replace-strategy`, registry/provider bootstrap, dynamic loading, owned vs injected client lifecycle, read-only vs writable collection ownership) — ~20 tests
- [x] **Block 19.3** — Bulk I/O + Helios integration + real MongoDB proof (`storeAll`/`deleteAll` batching, retry ownership, offload behavior, write-through/write-behind integration, restart/shutdown/eager/lazy/clear/bulk/loadAllKeys proof, exact Mongo harness/proof commands, per-path wiring proof matrix, supported docs/examples`) — ~22 tests
- [x] **Phase 19 checkpoint** — root and `packages/mongodb` typechecks green; Mongo package tests green; exact Mongo unit/core/offload/e2e proof commands for the single-member Phase 19 slice from `plans/MONGODB_MAPSTORE_PRODUCTION_PLAN.md` are green; direct `implementation`, direct `factoryImplementation`, registry-backed config wiring, dynamic programmatic loading, dynamic JSON loading, dynamic YAML loading, config-origin-relative resolution, and installed-package dynamic loading each have their own proof label/command and all pass independently; supported wiring paths, document-mode mapping, shutdown flush, restart persistence, eager/lazy load, clear, bulk, and `loadAllKeys()` streaming semantics are all exercised for single-member Helios runtime; clustered Mongo claims/docs/proof remain blocked until **Block 21.4** is green; 0 fail, 0 error
- [x] **Block 19T.1** — Classic topic hardening + ringbuffer-backed reliable topic closure (`plans/TOPIC_RELIABLE_TOPIC_UNIFIED_PLAN.md`, one service-backed classic-topic runtime path, Bun/TypeScript-native reliable-listener contract, real `getReliableTopic()` ringbuffer runtime, Hazelcast-parity overload semantics, frozen publish-completion contract with sync-backup acknowledgment, no throw stubs or hidden local-only alternate path, failover/destroy/shutdown cleanup, docs/examples/config/exports/test-support honesty) — ~26 tests
- [x] **Phase 19T checkpoint** — root typecheck green; topic and ringbuffer tests green; `getTopic()` and `getReliableTopic()` both work in single-node and multi-node flows; reliable-topic publish/listen/failover/destroy/shutdown and overload/retention semantics are fully exercised; reliable-topic success is proven to mean owner append plus at least one synchronous backup acknowledgment, zero-sync-backup configs are rejected, and docs/examples state the exact loss window honestly; no `getReliableTopic()` throw stubs or local-only alternate classic-topic path remain; 0 fail, 0 error
- [x] **Block 20.1** — Client parity matrix + surface freeze + packaging contract (`src/client` keep/rewrite/move/delete matrix, Hazelcast-to-Helios parity matrix, `HeliosClient implements HeliosInstance`, `getConfig()` contract decision, root export cleanup, wildcard export freeze) — ~12 tests/docs gates
- [x] **Block 20.2** — Public client API + config model + serialization foundation (`HeliosClient`, lifecycle shell, shutdown-all policy, real `ClientConfig`, typed network/security/retry/failover config, production config loading, single serialization owner) — ~18 tests
- [x] **Block 20.3** — Member-side client protocol server + auth/session lifecycle (server-owned client protocol runtime outside `src/client`, moved task handlers, auth/session registry, request dispatch, response correlation, heartbeat/disconnect handling) — ~20 tests
- [x] **Block 20.4** — Client connection manager + invocation/cluster/partition/listener services (`ClientConnectionManager`, reconnect/backoff/auth classification, `ClientInvocationService`, `ClientClusterService`, `ClientPartitionService`, `ClientListenerService`, member-list/partition refresh, listener re-registration) — ~22 tests
- [x] **Block 20.5** — Server-capability closure for shared `HeliosInstance` contract (method-by-method audit, remote closure for retained contract items, blockers resolved for list/set/reliableTopic/multimap/replicatedMap/distributedObject/getConfig/executor, no permanent half-stubs on `HeliosClient`) — ~18 tests
- [x] **Block 20.6** — Proxy manager + distributed object lifecycle + core remote proxies (`ProxyManager`, distributed object create/destroy/list tasks, `ClientMapProxy`, `ClientQueueProxy`, `ClientTopicProxy`, additional proxies only after server closure, orphan codec deletion) — 41 tests
- [x] **Block 20.7** — Near-cache completion + advanced feature closure (real remote near-cache wrapping, binary metadata fetch, reconnect repair/stale-read protection, advanced-feature keep/defer closure for cache/query-cache/transactions/SQL/secondary services) — 45 tests
- [x] **Block 20.8** — Examples/docs/exports + final remote-client GA proof (public exports only, separate Bun client example, auth/reconnect/nearcache examples, docs/examples/test-support/fixture audit after contract narrowing, exact proof-label contract, real-network acceptance suites, hygiene gates for no REST fallback/no orphan handlers/no wildcard leakage) — 115 tests
- [x] **Phase 20 checkpoint** — root typecheck green; exact proof-label contract in `plans/CLIENT_E2E_PARITY_PLAN.md` is satisfied and reported verbatim with `P20-STARTUP`, `P20-MAP`, `P20-QUEUE`, `P20-TOPIC`, `P20-RELIABLE-TOPIC` (or `NOT-RETAINED` with parity-matrix/doc citation), `P20-EXECUTOR` (or `NOT-RETAINED` with parity-matrix/doc citation), `P20-RECONNECT-LISTENER`, `P20-PROXY-LIFECYCLE`, `P20-EXTERNAL-BUN-APP`, `P20-HYGIENE`, and final `P20-GATE-CHECK`; separate Bun app can import `HeliosClient` from `@zenystx/helios-core`, connect over binary protocol, use every retained remote `HeliosInstance` capability honestly, survive reconnect, and shut down cleanly; 0 fail, 0 error
- [x] **Block 21.0** — Backup partition recovery parity foundation (`plans/BACKUP_PARTITION_RECOVERY_PARITY_PLAN.md`, one partition-service authority, no clustered recovery shortcuts, member-removal bookkeeping, promotion-first repair, backup refill, partition-lost signaling plus map-scoped partition-lost parity, runtime anti-entropy, namespace-scoped payload repair proof, real remote replica sync, service-state replication closure, stale-rejoin fencing, observability/config/docs/test-support closure, crash/rejoin proof) — ~28 tests
- [x] **Block 21.1** — Cluster execution substrate + owner-routed map path (real partition-owner routing, remote operation request/response/backup flow, no authoritative `MAP_PUT` / `MAP_REMOVE` / `MAP_CLEAR` replay path) — ~18 tests
- [x] **Block 21.2** — Partition-scoped MapStore runtime + owner-only persistence (shared map-level lifecycle + partition-scoped stores, owner-side `store`/`delete`/`load`, backup no-external-write semantics, clustered `putAll`/`getAll` bulk paths, partition ID consistency fix) — 22 tests
- [x] **Block 21.3** — Migration, failover, shutdown handoff, and coordinated eager/clear (`MigrationAwareService` participation, write-behind queue replication, staged promotion/finalize cutover with epoch fencing, clustered eager-load coordination and join continuity, clustered clear, deterministic shutdown handoff) — 35 tests
- [x] **Block 21.4** — Real adapter proof + clustered MapStore production gate (provenance-recording counting-store proof, provenance-recording Mongo clustered proof after Phase 19, durability docs, supported clustered docs/examples only) — 18 tests
- [x] **Block 21.5** — Final execution-contract audit + repo honesty gate (reopen earlier blocks/checkpoints on mismatch, no retained throw stubs/placeholders/deferred markers on claimed surfaces, no stale docs/examples/test-support/export claims, no fake/shared-process proof, exact final proof lines required for Phases 17R-21, final independent general-task-agent verification, final repo honesty sweep) — final closure gate
- [x] **Phase 21 checkpoint** — clustered partition recovery tests green; one partition-service authority is used in production clustered mode; owner crash promotes surviving backups before refill; anti-entropy and replica sync repair stale backups automatically; partition-lost is emitted when no replica survives; map-scoped partition-lost listener/event semantics for clustered maps are wired and tested before any full Hazelcast map/MapStore parity claim; anti-entropy/replica-sync proof includes per-service-namespace/version comparison, intentionally diverged payload-state repair for every supported partition-scoped service, and wrong-target/stale-response rejection; partition metadata parity, replica-slot occupancy, or version-only convergence are explicitly rejected as sufficient proof; service-state replication is closed for all supported partition-scoped services; stale rejoin state is fenced until authoritative sync completes; recovery metrics/events/docs/examples/test-support are aligned with the real runtime path; clustered operation-routing tests green; exactly one external write/delete per logical clustered mutation; backups never write externally while backups; lazy-load, eager-load, `getAll()` bulk, `putAll()` bulk, migration, promotion, clear, and shutdown handoff are fully exercised; one coordinated EAGER load epoch survives member join/rebalance without deadlock, without a second full `loadAllKeys()` sweep, and without duplicate external reads/writes; counting-store proof and Mongo clustered proof are green after Phase 19; clustered proof adapters capture per-call provenance (`memberId`, `partitionId`, `replicaRole`, `partitionEpoch`, `operationKind`) for every physical external call; duplicate physical `store` / `storeAll` / `delete` / `deleteAll` calls are asserted absent for healthy-cluster logical mutations and for the migration/promotion/clear/eager-load scenarios that claim cluster safety; all recovery/counting-store/Mongo clustered proof runs use separate Helios member processes over real TCP and include transport-boundary crash/drop/delay fault injection rather than shared-process or direct-call fault simulation; 0 fail, 0 error
- [x] **Final completion checkpoint** — every reopened block is reclosed honestly; Phases 17R, 18, 19, 19T, 20, and 21 checkpoints are green; the exact `P20-*` proof-label contract is printed verbatim and green; the final footer lines `PHASE-17R-FINAL: PASS`, `PHASE-18-FINAL: PASS`, `PHASE-19-FINAL: PASS`, `PHASE-19T-FINAL: PASS`, `PHASE-20-FINAL: PASS`, `PHASE-21-FINAL: PASS`, `REPO-HONESTY-SWEEP: PASS`, `INDEPENDENT-FINAL-VERIFICATION: PASS`, and `TYPESCRIPT-PORT-DONE: PASS` are all emitted verbatim; no contradictory plan status, stale claim, blocked retained surface, unresolved audit hit, placeholder, throw stub, deferred marker, or fake proof remains anywhere in the repo; 0 fail, 0 error
- [x] **Block 22.0** — `ScheduledExecutorConfig` + `HeliosConfig` extensions (`name`, `poolSize`, `capacity`, `capacityPolicy`/`PER_NODE`, `durability`, `statisticsEnabled`, `scheduleShutdownPolicy`/`GRACEFUL_TRANSFER`/`FORCE_STOP`, `maxHistoryEntriesPerTask`, validation, defaults matching Hazelcast) — ~12 tests
- [x] **Block 22.1** — `IScheduledExecutorService` + `IScheduledFuture<V>` + `ScheduledTaskHandler` contracts (full Hazelcast-parity API surface: `schedule`, `scheduleOnMember`, `scheduleOnKeyOwner`, `scheduleOnAllMembers`, `scheduleOnMembers`, `scheduleAtFixedRate`, all member/key fixed-rate variants, `getScheduledFuture(handler)`, `getAllScheduledFutures()`, `shutdown()`, portable handler serialization/reconstruction, `ScheduledTaskStatistics` interface) — ~15 tests
- [x] **Block 22.2** — `ScheduledTaskDescriptor` + state model + `ScheduledTaskStore` (task record with `taskName`, `handlerId`, `executorName`, `taskType`, `scheduleKind`, `ownerKind`, `ownerEpoch`, `version`, `attemptId`, state enum `scheduled`/`running`/`done`/`cancelled`/`disposed`/`suspended`, run history entries with timing/outcome/attempt/epoch metadata, oldest-entry eviction, named-task `fail-if-exists` duplicate policy, unnamed stable task ID generation) — ~18 tests
- [x] **Block 22.3** — `ScheduledExecutorContainerService` + local one-shot execution (partition-local task store management, one-shot delayed task scheduling via timer coordinator, dispatch into existing `ExecutorContainerService`, result envelope capture, wall-clock + monotonic hybrid timing, task state transitions on completion) — ~16 tests
- [x] **Block 22.4** — Cancel/Dispose/Shutdown local lifecycle (`cancel()` stops future scheduling without interrupting in-flight run, `dispose()` removes task state and frees name/handler, versioned terminal-write ordering for cancel/dispose vs completion races, `shutdown()` rejects new submissions, stale-task behavior on disposed handler access) — ~14 tests
- [x] **Block 22.5** — `ScheduledExecutorServiceProxy` + `HeliosInstance` wiring (`getScheduledExecutorService(name)` no longer throws deferred error, proxy routing for all API methods, handler-based future reacquisition, `getAllScheduledFutures()` fan-out, lifecycle integration, graceful shutdown hook) — ~14 tests
- [x] **Block 22.6** — Create/Cancel/Dispose/Get operations + partition routing (`SubmitToPartitionOperation`, `SubmitToMemberOperation`, `CancelTaskOperation`, `DisposeTaskOperation`, `GetTaskStateOperation`, `GetScheduledFutureOperation`, deterministic partition routing for partition-owned tasks, target routing for member-owned tasks, handler lookup validation) — ~16 tests
- [x] **Block 22.7** — `ScheduledTaskScheduler` engine + ready-task dispatch (member-local scheduler loop scanning owned partitions, partition-local min-heap for `nextRunAt`, wake-on-nearest-boundary, fenced dispatch by `ownerEpoch`/`version`/`attemptId`, rehydration from store on startup, capacity enforcement per executor per member) — ~16 tests
- [x] **Block 22.8** — Durable create ack + backup replication (schedule/create success visible only after required backup acks, `ReplicationOperation` for partition-owned schedule metadata, durability config controls replica count, capacity ignored during migration with post-migration count repair) — ~14 tests
- [x] **Block 22.9** — Fixed-rate periodic engine + no-overlap skip policy (fixed-rate reschedule anchored to original cadence timeline, skip execution when previous run still active, exception/timeout suppresses future firings, named periodic task handling, one catch-up coalesced run after recovery then next-aligned-slot computation) — ~18 tests
- [x] **Block 22.10** — `MigrationAwareService` integration + epoch fencing (`beforeMigration` suspends tasks on source, `commitMigration` installs new owner epoch and rehydrates ready queues on destination, `rollbackMigration` restores old owner, only new/promoted owner decides catch-up/replay, epoch increment on every ownership change) — ~16 tests
- [x] **Block 22.11** — Anti-entropy + conflict resolution (periodic + ownership-event-triggered repair, highest epoch then highest version wins, stale metadata repair from primary to replicas, tombstone handling for disposed tasks, anti-entropy payload shape) — ~14 tests
- [x] **Block 22.12** — Crash recovery + at-least-once replay (promoted owner fences retired epoch before replay, one-shot not durably completed is eligible for re-run, periodic catch-up coalesces to one immediate run then next aligned slot, crash-loop validation tests, version/attempt fencing prevents stale completion commits) — ~16 tests
- [x] **Block 22.13** — Member-owned scheduling + fanout (`scheduleOnMember(...)` with metadata anchored by hashed task ID in partitioned store, member-lifecycle-bound semantics matching Hazelcast, `scheduleOnAllMembers(...)` and `scheduleOnMembers(...)` create one future per target, member departure loses member-owned task, member fixed-rate variants) — ~16 tests
- [x] **Block 22.14** — `ClientScheduledExecutorProxy` + protocol (client proxy with full parity: schedule/cancel/dispose/getScheduledFuture/getAllScheduledFutures/stats/history, client protocol messages reusing `OperationWireCodec` patterns, handler reacquisition across client reconnect, stale/disposed error propagation) — ~18 tests
- [x] **Block 22.15** — Stats + metrics + diagnostics (`ScheduledTaskStatistics` parity, pending/started/completed/cancelled/failed counters, scheduler-lag metrics, active-schedule gauge, pool health, admin visibility hooks, documented `StatefulTask` parity gap for first release) — ~12 tests
- [x] **Block 22.INT** — End-to-end rollout acceptance (config → schedule one-shot → result, config → schedule fixed-rate → verify cadence, cancel/dispose lifecycle, handler reacquisition after restart, partition migration preserves schedules, member crash recovery with at-least-once replay, member-owned task loss on departure, client/server parity E2E, shutdown transfer, full regression) — ~20 tests
- [ ] **Phase 22 checkpoint** — All scheduled executor tests green, existing tests unbroken, `bun test` at root — 0 fail, 0 error; scheduled executor config wiring, partition-owned and member-owned scheduling, fixed-rate periodic engine, migration/recovery/anti-entropy, client parity, stats/metrics are all exercised and production-ready within the defined scope; `StatefulTask` is documented as a known parity gap for the first release; no `IScheduledExecutorService` or `IScheduledFuture` method is a throw-stub, deferred placeholder, or unwired passthrough; `getScheduledExecutorService(name)` returns a real proxy; every operation routes through `OperationService`; no public API returns hardcoded zeros or fake data; docs/examples/exports/test-support only claim behavior that is actually wired
- [x] **Block 23.0** — Foundation types + `JobConfig` + `JobStatus` + `PipelineDescriptor` — ~16 tests
- [x] **Block 23.1** — `AsyncChannel` + `LatencyTracker` engine primitives — ~18 tests
- [x] **Block 23.2** — `SnapshotStore` + NATS KV snapshot persistence — ~14 tests
- [x] **Block 23.3** — Processor implementations: Source, Sink, Operator — ~20 tests
- [x] **Block 23.4** — `ProcessorTasklet` with Chandy-Lamport barrier alignment — ~18 tests
- [x] **Block 23.5** — Distributed edge sender/receiver via NATS — ~16 tests
- [x] **Block 23.6** — `ExecutionPlan` + `JobExecution` + `BlitzJobExecutor` — ~18 tests
- [x] **Block 23.7** — Pipeline serialization + edge type API — ~14 tests
- [x] **Block 23.8** — `BlitzJob` handle + `JobRecord` + status listeners — ~16 tests
- [x] **Block 23.9** — `SnapshotCoordinator` + periodic snapshot orchestration — ~16 tests
- [x] **Block 23.10** — `BlitzJobCoordinator` + full job lifecycle management — ~22 tests
- [x] **Block 23.11** — `MetricsCollector` + cross-member metrics aggregation — ~12 tests
- [x] **Block 23.12** — `BlitzService` integration + `BlitzEvent` + exports + NestJS bridge — ~16 tests
- [x] **Block 23.INT** — End-to-end Blitz Job Supervision acceptance — ~24 tests
- [ ] **Phase 23 checkpoint** — All Blitz job supervision tests green, existing tests unbroken, `bun test` at root — 0 fail, 0 error; `blitz.newJob()` returns a BlitzJob with full Jet-parity lifecycle; streaming runtime engine drives data through DAG with source/operator/sink processors connected by AsyncChannel (local) and NATS (distributed) edges; Chandy-Lamport barrier snapshots provide exactly-once and at-least-once guarantees; master-supervised coordination with Helios fencing; auto-scaling with debounced restart on member join/leave; master failover resumes from IMap; job metrics collected cross-member; light jobs work without coordination; NestJS bridge proxies all new methods; no `BlitzJob` method is a throw-stub or deferred placeholder; no processor, channel, edge, or coordinator method is a fake or mock implementation; no public API returns hardcoded zeros or placeholder data; distributed edges use real NATS transport (not in-memory mocks); snapshot store uses real NATS KV; docs/examples/exports only claim behavior that is actually wired; no stubs, no deferrals, no mock implementations
- [ ] **Block 24.FINAL** — Phase 22/23 execution-contract audit + repo honesty closure (reopen earlier blocks/checkpoints on mismatch, no retained throw stubs/placeholders/deferred markers on claimed surfaces, no stale docs/examples/test-support/export claims, no fake/shared-process proof, cross-plan contradiction resolution for `SCHEDULED_EXECUTOR_IMPLEMENTATION_PLAN.md` and `packages/blitz/PLAN-job-supervision.md`, fresh same-branch proof including all Phase 17R-21 commands plus Phase 22/23 commands, repo-wide honesty audits, independent final verification agent, final footer `PHASE-22-FINAL: PASS` / `PHASE-23-FINAL: PASS` / `REPO-HONESTY-SWEEP-22-23: PASS` / `INDEPENDENT-FINAL-VERIFICATION-22-23: PASS`) — final closure gate

## Phase 23 — Blitz Job Supervision (Hazelcast Jet-Parity Autonomous Job Lifecycle)

> **Cross-ref:** `packages/blitz/PLAN-job-supervision.md` — the authoritative spec for all Phase 23 blocks.
> **Goal:** Implement Hazelcast Jet-compatible autonomous job supervision with full streaming runtime engine,
> distributed execution, Chandy-Lamport snapshot barriers (exactly-once), master-supervised coordination,
> auto-scaling/failover, job metrics, and the complete Jet Job API surface.
> **Depends on:** Phase 18 (Blitz Distributed Embedded Cluster — `HeliosBlitzCoordinator`, `HeliosBlitzLifecycleManager`,
> fenced authority pattern, NATS cluster formation, IMap/ITopic infrastructure).

### Block 23.0 — Foundation types + `JobConfig` + `JobStatus` + `PipelineDescriptor` (~16 tests)

**Goal:** Define all foundational types needed before any runtime code.

**TODO — Block 23.0**:
- [x] Create `src/job/JobConfig.ts`: `ProcessingGuarantee` enum (NONE, AT_LEAST_ONCE, EXACTLY_ONCE), `JobConfig` interface, `ResolvedJobConfig` interface, `resolveJobConfig()` with Jet-matching defaults (snapshotIntervalMillis=10000, autoScaling=true, suspendOnFailure=false, scaleUpDelayMillis=10000, splitBrainProtection=false, maxProcessorAccumulatedRecords=16384)
- [x] Create `src/job/JobStatus.ts`: `JobStatus` enum with all 10 Jet states (NOT_RUNNING, STARTING, RUNNING, COMPLETING, COMPLETED, FAILED, CANCELLED, SUSPENDED_EXPORTING_SNAPSHOT, SUSPENDED, RESTARTING)
- [x] Create `src/job/PipelineDescriptor.ts`: `VertexDescriptor`, `EdgeDescriptor`, `SourceDescriptor`, `SinkDescriptor`, `EdgeType` enum (LOCAL, LOCAL_PARTITIONED, DISTRIBUTED_UNICAST, DISTRIBUTED_PARTITIONED, DISTRIBUTED_BROADCAST, ALL_TO_ONE), `PipelineDescriptor` interface
- [x] Create `src/job/engine/ProcessorItem.ts`: union type for data, barrier, eos, watermark items
- [x] Create `src/job/JobCommand.ts`: `JobCommand` union type for all inter-member commands (START_EXECUTION, STOP_EXECUTION, INJECT_BARRIER, BARRIER_COMPLETE, EXECUTION_READY, EXECUTION_FAILED, EXECUTION_COMPLETED, COLLECT_METRICS, METRICS_RESPONSE)
- [x] Create `src/job/metrics/BlitzJobMetrics.ts`: `BlitzJobMetrics`, `VertexMetrics`, `SnapshotMetrics` interfaces
- [x] Tests: config resolver defaults, config validation, status enum values, descriptor serialization round-trip, edge type coverage
- [x] Run a verification task that proves all foundation types are real, config resolver defaults match Jet, status enum covers all 10 Jet states, descriptor serialization round-trips losslessly, and no type is a placeholder or partial definition: `bun test test/blitz/job/` green

---

### Block 23.1 — `AsyncChannel` + `LatencyTracker` engine primitives (~18 tests)

Depends on: Block 23.0 (types).

**Goal:** Build the core engine primitives: bounded async queue with backpressure and latency tracking.

**TODO — Block 23.1**:
- [x] Create `src/job/engine/AsyncChannel.ts`: bounded async queue with `send()` (blocks when full), `receive()` (blocks when empty), `tryReceive()`, `size`, `isFull`, `close()`, `[Symbol.asyncIterator]()` — implements backpressure via `maxProcessorAccumulatedRecords`
- [x] Create `src/job/metrics/LatencyTracker.ts`: circular buffer latency tracker with `record()`, `getP50()`, `getP99()`, `getMax()`, `reset()` — lock-free single-threaded design
- [x] Tests: send/receive ordering, backpressure blocks sender when full, receiver blocks when empty, close unblocks waiters, async iterator works, capacity limits enforced, p50/p99/max computation accuracy, buffer rotation
- [x] Run a verification task that proves `AsyncChannel` backpressure is real (sender blocks, not drops), `LatencyTracker` percentile math is correct, and no primitive method is a no-op or deferred stub: `bun test test/blitz/job/engine/AsyncChannelTest.test.ts test/blitz/job/metrics/LatencyTrackerTest.test.ts` green

---

### Block 23.2 — `SnapshotStore` + NATS KV snapshot persistence (~14 tests)

Depends on: Block 23.0 (types).

**Goal:** Build the snapshot storage layer backed by NATS KV.

**TODO — Block 23.2**:
- [x] Create `src/job/snapshot/SnapshotStore.ts`: NATS KV bucket `__blitz.snapshots.{jobId}`, with `saveProcessorState()`, `loadProcessorState()`, `commitSnapshot()`, `getLatestSnapshotId()`, `pruneSnapshots()`, `destroy()` — keyed by `{snapshotId}.{vertexName}.{processorIndex}`
- [x] Tests: save/load round-trip, commit marks snapshot, latest returns most recent committed, prune keeps last N, destroy removes bucket
- [x] Run a verification task that proves `SnapshotStore` persists to real NATS KV (not in-memory fake), save/load round-trips real processor state, commit/prune/destroy are wired end to end, and no store method is a stub: `bun test test/blitz/job/snapshot/SnapshotStoreTest.test.ts` green (embedded NATS)

---

### Block 23.3 — Processor implementations: Source, Sink, Operator (~20 tests)

Depends on: Block 23.1 (AsyncChannel), Block 23.2 (SnapshotStore).

**Goal:** Build the per-vertex processors that drive data through the DAG.

**TODO — Block 23.3**:
- [x] Create `src/job/engine/SourceProcessor.ts`: wraps `Source<T>`, drives async iterable into outbox, handles barrier injection (pause reading, save offset, forward barrier), EOS detection
- [x] Create `src/job/engine/SinkProcessor.ts`: wraps `Sink<T>`, drains inbox, handles barriers (save state, forward), handles EOS (flush sink, signal completion)
- [x] Create `src/job/engine/OperatorProcessor.ts`: wraps vertex fn (map/filter/flatMap), reads inbox → applies fn → writes outbox, handles barriers passthrough and state save
- [x] Tests: source emits items to outbox, source handles EOS, source pauses on barrier injection, sink drains inbox and writes, sink flushes on EOS, operator map/filter transform correctness, operator barrier passthrough, all processors respect abort signal
- [x] Run a verification task that proves all three processor types drive data through real `AsyncChannel` inboxes/outboxes, barrier handling is Chandy-Lamport compliant, abort signal stops processing, and no processor method is a passthrough stub: `bun test test/blitz/job/engine/` green

---

### Block 23.4 — `ProcessorTasklet` with barrier alignment (~18 tests)

Depends on: Block 23.3 (processors).

**Goal:** Build the per-vertex processing loop with Chandy-Lamport barrier alignment for exactly-once.

**TODO — Block 23.4**:
- [x] Create `src/job/engine/ProcessorTasklet.ts`: wraps a processor, manages inbox/outbox, runs processing loop with metrics collection, implements barrier alignment for multi-input vertices (exactly-once: buffer post-barrier items from one input until all inputs have barriers; at-least-once: immediate save), tracks per-vertex metrics (itemsIn, itemsOut, queueSize, latency)
- [x] `injectBarrier(snapshotId)`: inject barrier into tasklet's inbox
- [x] `saveSnapshot(snapshotId, store)`: save tasklet state to SnapshotStore, return size in bytes
- [x] `restoreSnapshot(snapshotId, store)`: restore tasklet state from SnapshotStore
- [x] Tests: single-input barrier passthrough, multi-input barrier alignment (buffer until all inputs have barrier), exactly-once vs at-least-once behavior difference, snapshot save/restore round-trip, metrics tracking accuracy, abort signal stops loop
- [x] Run a verification task that proves barrier alignment is real (exactly-once buffers post-barrier items until all inputs report, at-least-once does immediate save), snapshot save/restore round-trips through `SnapshotStore`, metrics reflect actual processing, and no tasklet method is a stub or deferred: `bun test test/blitz/job/engine/ProcessorTaskletTest.test.ts` green

---

### Block 23.5 — Distributed edge sender/receiver via NATS (~16 tests)

Depends on: Block 23.1 (AsyncChannel), Block 23.0 (types).

**Goal:** Build the NATS transport layer for distributed edges.

**TODO — Block 23.5**:
- [x] Create `src/job/engine/DistributedEdgeSender.ts`: consumes from local outbox, serializes items (JSON), publishes to appropriate NATS subject based on edge type (unicast round-robin, partitioned by key hash, broadcast), transmits barriers as NATS messages with `blitz-barrier`/`blitz-snapshot-id` headers
- [x] Create `src/job/engine/DistributedEdgeReceiver.ts`: subscribes to NATS subjects, deserializes items, pushes to local inbox, recognizes barrier messages from headers, uses JetStream for durable edges (AT_LEAST_ONCE/EXACTLY_ONCE) and core NATS for fire-and-forget (NONE)
- [x] Tests: sender/receiver round-trip for each edge type (unicast, partitioned, broadcast, allToOne), barrier passthrough via NATS headers, JetStream vs core NATS selection by processing guarantee, backpressure from inbox propagates to receiver
- [x] Run a verification task that proves distributed edges use real NATS pub/sub or JetStream (not in-memory mocks), every edge type routes correctly, barriers flow via NATS headers, and no edge sender/receiver is a fake local shortcut: `bun test test/blitz/job/engine/DistributedEdgeTest.test.ts` green (embedded NATS)

---

### Block 23.6 — `ExecutionPlan` + `JobExecution` + `BlitzJobExecutor` (~18 tests)

Depends on: Block 23.4 (tasklets), Block 23.5 (distributed edges).

**Goal:** Assemble the full DAG execution on a single member and manage multiple job executions per member.

**TODO — Block 23.6**:
- [x] Create `src/job/ExecutionPlan.ts`: `ExecutionPlan`, `EdgeRoutingEntry`, `EdgeRoutingTable`, `computeExecutionPlan()` — computes NATS subject routing table from DAG + member topology
- [x] Create `src/job/engine/JobExecution.ts`: wires up full DAG on one member — creates AsyncChannels for local edges, ProcessorTasklets for each vertex, DistributedEdgeSenders/Receivers for distributed edges, starts all async loops, stops all on cancel
- [x] Create `src/job/BlitzJobExecutor.ts`: manages multiple JobExecutions per member, handles START_EXECUTION/STOP_EXECUTION commands, collects local metrics, injects snapshot barriers
- [x] Tests: execution plan computation for various topologies, single DAG execution (source → map → filter → sink), distributed edge wiring, multi-job concurrent execution, metrics collection, abort/stop cleanup
- [x] Run a verification task that proves `JobExecution` wires a real DAG with real channels and processors, `BlitzJobExecutor` manages concurrent jobs with real lifecycle, metrics are collected from actual processing, and no execution path is a mock or deferred stub: `bun test test/blitz/job/engine/JobExecutionTest.test.ts test/blitz/job/BlitzJobExecutorTest.test.ts` green

---

### Block 23.7 — Pipeline serialization + edge type API (~14 tests)

Depends on: Block 23.0 (PipelineDescriptor).

**Goal:** Make Pipeline serializable and add edge type configuration for distributed execution.

**TODO — Block 23.7**:
- [x] Modify `src/Vertex.ts`: add optional `sourceRef` and `sinkRef` fields to store Source/Sink instances
- [x] Modify `src/Edge.ts`: add `edgeType: EdgeType` field (default LOCAL), add fluent setters `.distributed()`, `.partitioned(keyFn)`, `.broadcast()`, `.allToOne()`
- [x] Modify `src/Pipeline.ts`: add `toDescriptor()` method that serializes DAG to `PipelineDescriptor`, store Source/Sink references on vertices during `readFrom()`/`writeTo()`, thread edge type through GeneralStage fluent API
- [x] Tests: toDescriptor round-trip, edge type defaults, fluent edge type API, source/sink reference preservation
- [x] Run a verification task that proves `toDescriptor()` serializes the full DAG losslessly, edge type fluent API is wired through `GeneralStage`, source/sink references survive pipeline construction, and existing Pipeline tests still pass: `bun test test/blitz/PipelineDescriptorTest.test.ts` green, existing Pipeline tests still pass

---

### Block 23.8 — `BlitzJob` handle + `JobRecord` + status listeners (~16 tests)

Depends on: Block 23.0 (JobStatus, JobConfig).

**Goal:** Build the user-facing job handle and the IMap-stored job record.

**TODO — Block 23.8**:
- [x] Create `src/job/JobRecord.ts`: IMap-stored job state with id, name, status, config, pipelineDescriptor, submittedAt, participatingMembers, lastSnapshotId, failureReason, lightJob flag
- [x] Create `src/job/BlitzJob.ts`: user-facing handle with `getStatus()`, `join()`, `cancel()`, `suspend()`, `resume()`, `restart()`, `exportSnapshot()`, `getMetrics()`, `addStatusListener()`, `getSubmissionTime()` — delegates to coordinator for cluster operations
- [x] Implement status listener notification on every state transition
- [x] Implement `join()` as a Promise that resolves on terminal status (COMPLETED, FAILED, CANCELLED)
- [x] Tests: status transitions fire listeners, join resolves on completion, join resolves on failure, join resolves on cancel, getStatus returns current state, addStatusListener returns unsubscribe function
- [x] Run a verification task that proves `BlitzJob` delegates to real coordinator for cluster operations, status listeners fire on actual state transitions, `join()` resolves from real terminal states, and no `BlitzJob` method is a throw-stub or deferred placeholder: `bun test test/blitz/job/BlitzJobTest.test.ts` green

---

### Block 23.9 — `SnapshotCoordinator` + periodic snapshot orchestration (~16 tests)

Depends on: Block 23.2 (SnapshotStore), Block 23.4 (barrier alignment), Block 23.6 (executor).

**Goal:** Build the master-side periodic snapshot coordinator that drives Chandy-Lamport cycles.

**TODO — Block 23.9**:
- [x] Create `src/job/snapshot/SnapshotCoordinator.ts`: runs on master, starts periodic timer (snapshotIntervalMillis), initiates snapshot cycles — generates snapshotId, sends INJECT_BARRIER to all members via ITopic, waits for BARRIER_COMPLETE from all members, marks snapshot committed, updates JobRecord.lastSnapshotId
- [x] Implement `initiateSnapshot()` for on-demand snapshots (exportSnapshot)
- [x] Handle partial member completion (timeout + retry), member-loss during snapshot
- [x] Track snapshot metrics: count, duration, size
- [x] Tests: periodic snapshot timer fires, barrier injection reaches all members, snapshot completes when all members report, partial member failure handled, on-demand snapshot works, metrics tracked
- [x] Run a verification task that proves the snapshot coordinator drives real Chandy-Lamport barrier cycles via ITopic, waits for real member BARRIER_COMPLETE responses, handles partial failure and member loss, and no snapshot path is a fake local-only shortcut: `bun test test/blitz/job/snapshot/SnapshotCoordinatorTest.test.ts` green

---

### Block 23.10 — `BlitzJobCoordinator` + full job lifecycle management (~22 tests)

Depends on: Block 23.6 (executor), Block 23.8 (BlitzJob, JobRecord), Block 23.9 (SnapshotCoordinator).

**Goal:** Build the master-side job coordinator that manages the full Jet-parity job lifecycle.

**TODO — Block 23.10**:
- [x] Create `src/job/BlitzJobCoordinator.ts`: runs on master with Helios fencing pattern `(masterMemberId, memberListVersion, fenceToken)`
- [x] Implement `submitJob()`: create JobRecord → store in IMap → STARTING → compute ExecutionPlan → send START_EXECUTION to all members → wait for EXECUTION_READY → RUNNING → start SnapshotCoordinator
- [x] Implement `cancelJob()`: validate fence → STOP_EXECUTION(cancel) → CANCELLED → cleanup
- [x] Implement `suspendJob()`: SUSPENDED_EXPORTING_SNAPSHOT → final snapshot → STOP_EXECUTION(suspend) → SUSPENDED
- [x] Implement `resumeJob()`: NOT_RUNNING → STARTING → restore from snapshot → new ExecutionPlan → START_EXECUTION → RUNNING
- [x] Implement `restartJob()`: same as resume but from RESTARTING state
- [x] Implement `onMemberLost()`: autoScaling → RESTARTING + restart; !autoScaling + suspendOnFailure → SUSPENDED; else → FAILED
- [x] Implement `onMemberJoined()`: autoScaling → debounced restart (scaleUpDelayMillis)
- [x] Implement `getJob()`, `getJobByName()`, `getJobs()` from IMap
- [x] Implement `onDemotion()`: cancel snapshot coordinators, clear authority; jobs continue on members
- [x] Implement `onPromotion()`: read JobRecords from IMap, resume coordination for RUNNING/RESTARTING jobs
- [x] Implement split-brain protection: job only runs if alive members >= ceil(total/2)
- [x] Implement light job path: skip coordinator, run locally, no IMap storage
- [x] Tests: full submit lifecycle, cancel/suspend/resume/restart transitions, member loss failover, member join auto-scale with debounce, job lookup by id and name, demotion/promotion handoff, split-brain protection, light job no-coordination path
- [x] Run a verification task that proves the coordinator uses Helios fencing pattern for all authoritative operations, all Jet-parity lifecycle transitions are real, member loss/join triggers real failover/auto-scaling, IMap stores real JobRecords, and no coordinator method is a stub or mock: `bun test test/blitz/job/BlitzJobCoordinatorTest.test.ts` green

---

### Block 23.11 — `MetricsCollector` + cross-member metrics aggregation (~12 tests)

Depends on: Block 23.6 (executor metrics), Block 23.10 (coordinator).

**Goal:** Build the cross-member job metrics collection and aggregation.

**TODO — Block 23.11**:
- [x] Create `src/job/metrics/MetricsCollector.ts`: `aggregate()` static method combines per-member VertexMetrics into BlitzJobMetrics — sums itemsIn/Out, combines latency distributions, sums snapshot metrics
- [x] Wire COLLECT_METRICS / METRICS_RESPONSE flow through ITopic: BlitzJob.getMetrics() → coordinator sends COLLECT_METRICS → each member responds with local metrics → coordinator aggregates with timeout
- [x] Tests: single-member aggregation, multi-member aggregation, partial response handling (timeout), latency distribution merging, snapshot metrics aggregation
- [x] Run a verification task that proves metrics flow through real ITopic COLLECT_METRICS/METRICS_RESPONSE protocol, aggregation combines real per-member data, partial-response timeout is handled, and no metrics path returns hardcoded zeros or fake data: `bun test test/blitz/job/metrics/MetricsCollectorTest.test.ts` green

---

### Block 23.12 — `BlitzService` integration + `BlitzEvent` + exports + NestJS bridge (~16 tests)

Depends on: Block 23.10 (coordinator), Block 23.7 (pipeline serialization).

**Goal:** Wire everything into BlitzService and update all integration surfaces.

**TODO — Block 23.12**:
- [x] Modify `src/BlitzService.ts`: add `newJob(pipeline, config)`, `newLightJob(pipeline)`, `getJob(idOrName)`, `getJobs(name?)`, `setCoordinator(coordinator)` — wire BlitzJobCoordinator and BlitzJobExecutor, deprecate `submit()`/`cancel()` (delegate to newJob internally)
- [x] Modify `src/BlitzEvent.ts`: add JOB_STARTED, JOB_COMPLETED, JOB_FAILED, JOB_CANCELLED, JOB_SUSPENDED, JOB_RESTARTING, SNAPSHOT_STARTED, SNAPSHOT_COMPLETED events
- [x] Modify `src/index.ts`: export all new job types (BlitzJob, JobConfig, JobStatus, ProcessingGuarantee, BlitzJobMetrics, etc.)
- [x] Modify `src/nestjs/HeliosBlitzService.ts`: add `newJob()`, `newLightJob()`, `getJob()`, `getJobs()` proxy methods
- [x] Standalone mode (no coordinator): newJob() runs locally as light job, full streaming runtime engine works
- [x] Cluster mode (with coordinator): newJob() delegates to BlitzJobCoordinator, distributed execution, failover, snapshots
- [x] Tests: standalone newJob creates and runs job, cluster newJob distributes, getJob/getJobs work, BlitzEvent fires on lifecycle transitions, NestJS proxy delegates correctly, deprecated submit() still works
- [x] Run a verification task that proves `BlitzService.newJob()` returns a real `BlitzJob` with full Jet-parity lifecycle in both standalone and cluster mode, NestJS bridge methods are real proxies (not throw-stubs), exports expose all new job types, and no integration surface is partially wired or deferred: `bun test packages/blitz/` green, existing tests still pass

---

### Block 23.INT — End-to-end Blitz Job Supervision acceptance (~24 tests)

Depends on: Block 23.12 (full integration).

**Goal:** Full end-to-end acceptance proving Blitz job supervision is production-ready with Hazelcast Jet semantic parity.

**TODO — Block 23.INT**:
- [x] E2E: `blitz.newJob(pipeline, config)` → pipeline executes → data flows source → operators → sink
- [x] E2E: batch job completes when source is exhausted (RUNNING → COMPLETING → COMPLETED)
- [x] E2E: streaming job runs until cancel (RUNNING → CANCELLED)
- [x] E2E: `job.suspend()` exports snapshot then stops (RUNNING → SUSPENDED_EXPORTING_SNAPSHOT → SUSPENDED)
- [x] E2E: `job.resume()` restores from snapshot and continues (SUSPENDED → NOT_RUNNING → STARTING → RUNNING)
- [x] E2E: exactly-once processing — barrier alignment produces no duplicates after restart
- [x] E2E: at-least-once processing — snapshot restore with possible duplicates
- [x] E2E: member loss → job restarts from last snapshot with surviving members
- [x] E2E: member join → debounced restart includes new member
- [x] E2E: master failover → new master resumes coordination from IMap
- [x] E2E: `job.getMetrics()` returns aggregated cross-member metrics
- [x] E2E: light job runs without coordination overhead
- [x] E2E: `blitz.getJob(id)`, `blitz.getJob(name)`, `blitz.getJobs()` return correct results
- [x] E2E: `job.addStatusListener()` fires on every state transition
- [x] E2E: split-brain protection suspends jobs on minority side
- [x] E2E: distributed edges (partitioned, broadcast, unicast) route data correctly across members
- [x] Full regression: `bun test` at root — 0 fail, 0 error
- [x] Run a verification task that proves the full Blitz job supervision feature is production ready, end to end, and free of stubs, mock implementations, fake fallbacks, deferred methods, or unwired runtime paths; every `BlitzJob` lifecycle method must be wired through real coordinator/executor/snapshot paths; data must flow through real processors and channels; distributed edges must use real NATS; no public API method may throw `UnsupportedOperationError` or return placeholder values: `bun test` at root green, `bun run typecheck` clean

### Block 24.FINAL — Phase 22/23 execution-contract audit + repo honesty closure

Goal: apply the same closure discipline from Block 21.5 to the Phase 22 and Phase 23 work, ensuring no
stale claims, fake proofs, or documentation drift remain after the scheduled executor and Blitz job
supervision implementations landed.

Tasks:

- [ ] Audit Phases 22-23 end to end across code, tests, docs, examples, test-support, exports, config/bootstrap wiring, and authoritative plans; if any claimed behavior, proof, export, config path, lifecycle path, or parity statement is missing, partial, stale, contradicted, or implemented differently than claimed, reopen the affected block and checkpoint before doing more closure work.
- [ ] Remove or fully implement every retained throw stub, placeholder, fake fallback, deferred marker, `TODO`/`FIXME`/`later`/`not yet` shipping path, and every public or test-support surface that still depends on one of those markers for Phases 22-23 claimed behavior.
- [ ] Resolve every contradictory status across this file, `plans/SCHEDULED_EXECUTOR_IMPLEMENTATION_PLAN.md`, `packages/blitz/PLAN-job-supervision.md`, `plans/DISTRIBUTED_EXECUTOR_PLAN.md`, and `plans/CLIENT_E2E_PARITY_MATRIX.md`; no block, checkpoint, appendix, matrix, or backlog may claim complete/retained/deferred status that conflicts with repo reality or with another canonical plan.
- [ ] Rerun fresh same-branch proof after the last change to code, tests, docs, `README.md`, examples, test-support, exports, `package.json`, config/bootstrap wiring, or authoritative plans. Final closure is invalid if it relies on historical proof, partial reruns, or "covered by previous run" wording.
- [ ] Rerun and report at minimum these commands, all green, on the final tree:
  `bun run typecheck`; `bun test`; `bun test packages/blitz/`;
  `bun test test/scheduledexecutor/`;
  `bun test test/blitz/job/`;
  `bun test test/config/ScheduledExecutorConfigTest.test.ts`;
  plus all Phase 17R-21 proof commands from Block 21.5.
- [ ] Rerun and report these exact repo-wide honesty audits on the final tree, review every hit, and classify each one as exactly one of `ALLOWED-RETAINED-LABEL`, `TEST-ONLY`, `DOC-HISTORICAL`, or `FAIL`:
  `rg -n --hidden --glob '!node_modules/**' --glob '!dist/**' --glob '!.git/**' --glob '!plans/**' "(not yet implemented|deferred|blocked-by-server)" .`
  `rg -n --hidden --glob '!node_modules/**' --glob '!dist/**' --glob '!.git/**' --glob '!plans/**' "(stub|placeholder|TODO|FIXME|throw new Error\(|throw new UnsupportedOperation|NYI|not implemented)" src packages examples test README.md .`
- [ ] Verify package-export honesty and surface honesty together for Phases 22-23: `package.json` exports, root barrels, public entrypoints, docs, examples, fixtures, and test-support must expose only supported finished surfaces.
- [ ] In the end, run an independent final verification with a fresh general-task agent that reviews code, tests, docs, examples, test-support, exports, plans, and final proof outputs for Phases 22-23. If that verification finds any gap, contradiction, stale claim, fake proof, or unresolved marker, reopen the affected block/checkpoint and continue the loop until the verifier returns clean.
- [ ] Emit the final closure footer exactly in this order, on separate lines, with no substitutions:
  `PHASE-22-FINAL: PASS`
  `PHASE-23-FINAL: PASS`
  `REPO-HONESTY-SWEEP-22-23: PASS`
  `INDEPENDENT-FINAL-VERIFICATION-22-23: PASS`

## End-to-End Completion Requirements

Phases 17R-23 are not complete unless all of the following are true:

- distributed executor task bodies run off-main-thread through a real Scatter-backed execution path in production, with the main Bun event loop limited to transport, routing, backpressure, and response correlation
- no distributed executor path falls back to direct factory invocation or silent inline execution on the main event loop
- distributed executor registrations are module-backed, worker-materializable, and rejected deterministically when they are not
- worker crash, timeout, cancellation, shutdown, and member-loss executor behavior is acceptance-tested and fail-closed rather than silently degraded
- executor config defaults, validation, and any touched file-config/bootstrap entrypoints honestly enforce `scatter` as the only production backend, reject `inline` for production-mode startup unless an explicit testing override is set, and fail closed rather than hiding environment-specific fallback rules
- executor docs/examples/exports/test-support only claim module-backed distributed execution and explicit inline test/dev bootstrap usage; no user-facing surface implies that `inline` is a supported production runtime or silent production fallback
- automated proof shows production-mode startup with executor backend `inline` fails fast unless the explicit testing override is set

- embedded Blitz cluster formation works without manual master env flags
- Helios owns startup, join, rejoin, master-change, and shutdown lifecycle end to end
- config is wired through `HeliosConfig`, runtime bootstrap, and any file/env-driven entrypoints used by the repo
- NestJS/Blitz integration reuses the Helios-owned Blitz instance where intended
- replication and reconciliation behavior are explicit, fenced, and tested
- authoritative Blitz control-plane work is accepted only when `(masterMemberId, memberListVersion, fenceToken)` matches the current Helios master epoch, and demotion cancels or fences old-master work before further side effects
- bootstrap-local Blitz startup remains fail-closed until authoritative topology is applied and post-cutover JetStream readiness is green; no Blitz-owned resources, bridge exposure, user-facing operations, or readiness success leak through early
- no child-process leaks remain after shutdown or restart tests
- docs/examples/exports reflect the distributed-default Blitz behavior
- MongoDB MapStore meets the contract and proof gates in `plans/MONGODB_MAPSTORE_PRODUCTION_PLAN.md`, including direct/factory/registry/dynamic-loading wiring, document-mode mapping, lifecycle cleanup, eager/lazy load, clear, bulk, and `loadAllKeys()` streaming semantics
- write-through and write-behind Mongo persistence work against real MongoDB with restart/shutdown durability proof and no hidden runtime bypasses
- Mongo docs/examples/proof gates only claim supported programmatic, registry-backed, dynamic-loading, and JSON/YAML-wired paths and are backed by exact runnable commands; each supported wiring path has its own mandatory proof label/command and must pass independently, including direct `implementation`, direct `factoryImplementation`, registry-backed config wiring, dynamic programmatic loading, dynamic JSON loading, dynamic YAML loading, config-origin-relative resolution, and installed-package dynamic loading
- classic topic uses one service-backed runtime path in single-node and clustered mode, with explicit ordering, stats, concurrency, destroy, and owner-loss semantics rather than a separate local-only alternate contract
- `getReliableTopic()` is a real ringbuffer-backed distributed object; no throw stubs remain in runtime, test-support, or shipped fixture implementations
- reliable-topic listener semantics are explicit and implemented for initial sequence, stored-sequence progression, loss tolerance, terminal error, cancellation, and deterministic plain-listener adaptation behavior
- reliable-topic overload, retention, failover, and destroy/shutdown behavior are explicit, tested, and limited to the supported parity contract
- reliable-topic publish completion means owner append plus at least one synchronous backup acknowledgment in v1; the product must not ship with docs, examples, or config paths that let acknowledged durability degrade to owner-append-only semantics without saying so
- docs/examples/proof text state the exact reliable-topic loss window honestly: no single-owner-loss message loss after successful publish, possible failure or loss before completion, and possible loss only if all acknowledged replicas are lost before subsequent replication
- ringbuffer wait/notify, backup replication, owner promotion, and new-backup resync are real runtime behavior for reliable topic rather than assumed side effects of ringbuffer existence
- topic docs/examples/config/exports only claim the classic and reliable topic behavior that is actually wired, including replay and bounded-retention limits
- `HeliosClient` is a real public product surface and implements the shared `HeliosInstance` contract honestly
- the member/server client protocol runtime exists outside `src/client` and owns auth, sessions, dispatch, and event push end to end
- every retained `HeliosInstance` capability is remotely real over the binary protocol, or `HeliosInstance` itself was narrowed before GA so member and client still share one honest contract
- docs/examples/test-support/fixtures are audited after any `HeliosInstance` narrowing, and no shipped client-GA surface still references a narrowed-out method or a member-only substitute as part of the remote contract
- no wildcard package export or root-barrel leakage leaves unfinished client internals accidentally public
- no client proof path relies on REST, in-process fake backing stores, or test-only runtime shortcuts when remote support is claimed
- real-network acceptance coverage exists for every exported remote client capability and any exported advanced client feature
- clustered partition recovery runs through one Bun-native, TypeScript-native production runtime path with no split authority, no fake fallback, and no hidden local-only repair shortcut
- owner crash promotes a surviving backup first, then restores redundancy through real refill or migration work when capacity exists
- anti-entropy and remote replica sync automatically repair stale or missed backup state after crash, rejoin, or dropped backup traffic
- partition-lost is emitted when no replica survives, and no code path silently pretends recovery succeeded
- full clustered map/MapStore parity is not claimed from generic partition-lost alone; clustered maps expose map-scoped partition-lost listener/event semantics equivalent in intent to Hazelcast `IMap.addPartitionLostListener(...)`, or the clustered MapStore surface is explicitly narrowed everywhere parity is discussed
- supported partition-scoped services remain correct after promotion, refill, replica sync, shutdown, and rejoin; partition metadata parity alone is not sufficient
- anti-entropy and replica sync proof is namespace-scoped and payload-scoped: per-service namespace/version comparison and actual repaired service state are required, and partition metadata parity or version-only convergence are explicitly insufficient
- restarted or rejoining members cannot serve or advertise stale replica state before authoritative partition/state sync completes
- operator-facing recovery metrics, events, readiness/safe-state signals, docs, examples, and proof commands all reflect the single real production recovery path
- clustered MapStore uses partition-owner execution, not mutation broadcast replay, as the
  authoritative multi-member map path
- clustered MapStore external writes happen only on owners, with backups staying shadow-only until
  promotion
- migration, owner promotion, eager load, clear, and graceful shutdown preserve the documented
  clustered durability contract with no hidden duplicate-write paths
- clustered MapStore proof is backed by separate Helios member processes over real TCP with transport-boundary crash/drop/delay fault injection; shared-process or direct-call simulations do not satisfy the acceptance gate
- clustered MapStore proof harnesses capture per-call provenance (`memberId`, `partitionId`, `replicaRole`, `partitionEpoch`, `operationKind`) and assert against duplicate physical external calls rather than relying on final-state-only checks
- at least one real adapter proves the clustered MapStore vertical slice after single-node adapter
  readiness is already complete
- a final repo-wide honesty sweep has been rerun on the final tree and every hit has been resolved or
  explicitly classified as `ALLOWED-RETAINED-LABEL`, `TEST-ONLY`, or `DOC-HISTORICAL` with no
  unresolved `FAIL`
- an independent final verification general-task agent has re-reviewed the final tree and returned
  clean with no reopened gaps

- `IScheduledExecutorService` is a real member-side product surface with Hazelcast-parity partition-owned durable scheduling, fixed-rate periodic tasks, member-owned scheduling, and full client protocol codec support
- `getScheduledExecutorService(name)` returns a real proxy, not a deferred-feature throw or a stub
- scheduled task state machine enforces legal transitions only, and versioned terminal-write ordering resolves cancel/dispose vs completion races deterministically
- partition-owned scheduled tasks survive migration with epoch fencing: the old owner cannot fire after fencing, the promoted owner decides catch-up/replay, and epoch increments on every ownership change
- durable create waits for real backup acknowledgments controlled by `durability` config before acknowledging to callers
- fixed-rate cadence is timeline-aligned, no-overlap skip prevents double-fire, and exception suppression is terminal for the periodic task
- crash recovery replays from real replicated state with at-least-once semantics for one-shot tasks and coalesced catch-up for periodic tasks; stale completions from the old owner are rejected by version/attempt fencing
- member-owned tasks are lifecycle-bound to the target member: member departure loses the task (Hazelcast parity), not silently migrated
- anti-entropy repair for scheduled executor metadata follows highest-epoch-then-highest-version conflict resolution, tombstones prevent resurrection of disposed tasks, and repair triggers on ownership events
- `ClientScheduledExecutorProxy` and 8 scheduled executor codec files provide full client protocol parity for schedule, cancel, dispose, get-state, get-stats, get-all-scheduled-futures, submit-to-member, and shutdown
- `ScheduledTaskStatistics` reports real execution metrics, not hardcoded zeros or placeholder values
- `StatefulTask` is documented as a known first-release parity gap; no code, docs, or examples imply it is supported
- no `IScheduledExecutorService` or `IScheduledFuture` method is a throw-stub, deferred placeholder, or unwired passthrough

- `blitz.newJob(pipeline, config)` returns a `BlitzJob` with full Hazelcast Jet-parity lifecycle: join, cancel, suspend, resume, restart, exportSnapshot, getMetrics, addStatusListener
- `blitz.newLightJob(pipeline)` returns a lightweight single-member job with no coordination overhead
- `blitz.getJob(id)`, `blitz.getJob(name)`, `blitz.getJobs()`, `blitz.getJobs(name)` provide job lookup from IMap-stored `JobRecord` instances
- job lifecycle state machine matches Jet exactly: NOT_RUNNING → STARTING → RUNNING → COMPLETING → COMPLETED (batch), plus RESTARTING, SUSPENDED_EXPORTING_SNAPSHOT, SUSPENDED, FAILED, CANCELLED
- streaming runtime engine drives data through the DAG: SourceProcessor → OperatorProcessor → SinkProcessor, connected by bounded `AsyncChannel` queues for local edges and NATS subjects for distributed edges
- distributed edges use NATS JetStream for durable delivery (AT_LEAST_ONCE / EXACTLY_ONCE) or core NATS pub/sub for fire-and-forget (NONE); no distributed edge path uses in-memory mocks or local-only shortcuts
- Chandy-Lamport barrier snapshot protocol provides exactly-once processing: barrier alignment buffers post-barrier items until all inputs report (exactly-once), immediate save for at-least-once, barriers dropped for none
- snapshot state is stored in real NATS KV buckets, not in-memory fakes
- master-supervised job coordination via `BlitzJobCoordinator` uses the Helios fencing pattern `(masterMemberId, memberListVersion, fenceToken)` for all authoritative operations
- auto-scaling handles member loss (restart from last snapshot) and member join (debounced restart with `scaleUpDelayMillis`)
- master failover reads `JobRecord` instances from IMap and resumes coordination for RUNNING jobs
- split-brain protection suspends protected jobs on the minority side
- per-vertex job metrics (itemsIn/Out, queueSize, p50/p99/max latency, snapshot metrics) are collected via ITopic request/reply and aggregated cross-member by `MetricsCollector`
- NestJS bridge (`HeliosBlitzService`) proxies `newJob`, `newLightJob`, `getJob`, `getJobs` as real delegates to the Helios-owned `BlitzService` instance
- `BlitzEvent` includes all job lifecycle events: JOB_STARTED, JOB_COMPLETED, JOB_FAILED, JOB_CANCELLED, JOB_SUSPENDED, JOB_RESTARTING, SNAPSHOT_STARTED, SNAPSHOT_COMPLETED
- `Pipeline.toDescriptor()` serializes the full DAG losslessly; `Edge` supports fluent `.distributed()`, `.partitioned(keyFn)`, `.broadcast()`, `.allToOne()` configuration
- no `BlitzJob` method is a throw-stub or deferred placeholder; no processor, channel, edge, or coordinator method is a fake or mock implementation

## Cross-File Wiring That Must Not Be Missed

When implementing Phase 17R, verify all relevant surfaces, not just `src/executor/`:

- `plans/EXECUTOR_SCATTER_PRODUCTION_PLAN.md`
- `plans/DISTRIBUTED_EXECUTOR_PLAN.md`
- `package.json` if `@zenystx/scatterjs` dependency or executor-facing package surfaces change
- `src/config/ExecutorConfig.ts`
- `src/config/ConfigLoader.ts` if executor file-config/default validation is introduced or changed
- `src/executor/`
- `src/instance/impl/HeliosInstanceImpl.ts`
- `src/spi/impl/NodeEngineImpl.ts`
- `src/spi/impl/operationservice/impl/OperationServiceImpl.ts`
- `src/cluster/` and `src/internal/partition/`
- `src/index.ts` if public executor exports or docs-facing config change
- `src/test-support/` and any executor-focused test fixtures/helpers
- `test/executor/`, `test/instance/`, and any real multi-node executor suites
- `README.md`
- `examples/native-app/`
- `examples/nestjs-app/`
- `@zenystx/scatterjs` package and upstream runtime source/docs if worker-class or `scatter.pool()` behavior becomes part of the accepted runtime contract

When implementing Phase 18, verify all relevant surfaces, not just the core Blitz package:

- `packages/blitz/`
- `src/instance/impl/HeliosInstanceImpl.ts`
- `src/config/HeliosConfig.ts`
- `src/config/ConfigLoader.ts` if file-config support is introduced or changed
- `src/index.ts` if public types/config need export changes
- `packages/blitz/src/nestjs/`
- `packages/nestjs/` if Helios-owned Blitz lifecycle is surfaced there
- `README.md`
- `examples/native-app/`
- `examples/nestjs-app/`
- `src/test-support/` and any test fixtures that would otherwise preserve stale behavior

When implementing Phase 19, verify all relevant surfaces, not just `packages/mongodb/`:

- `plans/MONGODB_MAPSTORE_PRODUCTION_PLAN.md`
- `plans/CLUSTER_SAFE_MAPSTORE_PLAN.md` if Mongo work touches shared owner-authoritative clustered core
- `packages/mongodb/`
- `src/config/ConfigLoader.ts`
- `src/config/HeliosConfig.ts`
- `src/map/MapKeyStream.ts`
- `src/map/impl/mapstore/`
- `src/map/impl/MapProxy.ts`
- `src/map/impl/NetworkedMapProxy.ts`
- `src/map/impl/MapContainerService.ts`
- `src/spi/impl/operationservice/impl/OperationServiceImpl.ts`
- `src/instance/impl/HeliosInstanceImpl.ts`
- `src/config/MapStoreConfig.ts`
- `src/index.ts` if public exports change
- `test/map/`
- `test/instance/`
- `examples/native-app/` and `examples/nestjs-app/` only if Mongo MapStore examples are truly wired
- `examples/nestjs-app/src/mongodb-store/` when registry/dynamic-loading/file-config examples are part of the claimed surface

When implementing Phase 19T, verify all relevant surfaces, not just `src/topic/`:

- `plans/TOPIC_RELIABLE_TOPIC_UNIFIED_PLAN.md`
- `plans/DISTRIBUTED_QUEUE_TOPIC_PLAN.md` only if queue/ringbuffer/public-surface context is touched while closing topic gaps
- `src/core/HeliosInstance.ts`
- `src/instance/impl/HeliosInstanceImpl.ts`
- `src/config/HeliosConfig.ts`
- `src/config/ConfigLoader.ts`
- `src/config/TopicConfig.ts`
- `src/config/ReliableTopicConfig.ts`
- `src/topic/`
- `src/ringbuffer/`
- `src/spi/impl/operationservice/impl/OperationServiceImpl.ts`
- `src/internal/partition/impl/` if ringbuffer failover, migration, or promotion wiring changes
- `src/index.ts`
- `src/test-support/`
- `packages/nestjs/` when fixtures or helper modules rely on `HeliosInstance`
- `test/topic/`
- `test/instance/`
- `test/cluster/tcp/`
- `README.md`
- `examples/native-app/`
- `examples/nestjs-app/`

When implementing Phase 20, verify all relevant surfaces, not just `src/client/`:

- `plans/CLIENT_E2E_PARITY_PLAN.md`
- `plans/CLIENT_E2E_EXECUTION_BACKLOG.md`
- `plans/CLIENT_E2E_PARITY_MATRIX.md`
- `src/client/`
- `src/core/HeliosInstance.ts`
- `src/index.ts`
- `package.json`
- `src/instance/impl/HeliosInstanceImpl.ts`
- `src/server/` and any new `src/server/clientprotocol/` ownership
- `src/cluster/` and `src/internal/cluster/` for cluster-view/member metadata prerequisites
- `src/map/`, `src/collection/`, `src/topic/`, `src/multimap/`, `src/replicatedmap/`, `src/executor/`, `src/transaction/`, `src/cache/`, and `src/ringbuffer/` for shared-contract capability closure
- `test/client/`, `test/instance/`, `test/map/`, and any new real-network client protocol suites
- `examples/native-app/` and any dedicated remote-client examples
- `README.md` and any package docs that claim remote client support

When implementing Phase 21, verify all relevant surfaces, not just `src/map/impl/mapstore/`:

- `plans/BACKUP_PARTITION_RECOVERY_PARITY_PLAN.md`
- `plans/CLUSTER_SAFE_MAPSTORE_PLAN.md`
- `plans/MONGODB_MAPSTORE_PRODUCTION_PLAN.md`
- `src/config/HeliosConfig.ts`
- `src/config/ConfigLoader.ts` if recovery behavior, observability, or proof-facing defaults become configurable
- `src/spi/impl/NodeEngineImpl.ts`
- `src/spi/impl/operationservice/impl/OperationServiceImpl.ts`
- `src/cluster/tcp/ClusterMessage.ts`
- `src/cluster/tcp/TcpClusterTransport.ts`
- `src/instance/impl/HeliosInstanceImpl.ts`
- `src/instance/impl/HeliosClusterCoordinator.ts`
- `src/map/impl/NetworkedMapProxy.ts`
- `src/map/impl/MapProxy.ts`
- `src/map/impl/MapContainerService.ts`
- `src/map/impl/mapstore/`
- `src/map/impl/operation/`
- `src/internal/partition/impl/`
- `src/internal/partition/operation/`
- `test/map/`
- `test/instance/`
- `test/cluster/tcp/`
- `test/internal/partition/impl/`
- `test/internal/partition/operation/`
- `README.md`
- `examples/native-app/`
- `src/test-support/`
- `packages/mongodb/test/` once the clustered Mongo proof is in scope

When implementing `Block 21.5`, verify all relevant surfaces, not just the master plan:

- `plans/TYPESCRIPT_PORT_PLAN.md`
- every authoritative linked plan referenced by Phases 17R-21
- `package.json`
- `README.md`
- `src/`
- `packages/`
- `examples/`
- `src/test-support/`
- `test/`
- every exact proof command/label contract already defined by Phases 17R-21 and linked plans

When implementing Phase 22, verify all relevant surfaces, not just `src/scheduledexecutor/`:

- `plans/SCHEDULED_EXECUTOR_IMPLEMENTATION_PLAN.md`
- `src/scheduledexecutor/` — all new scheduled executor code
- `src/config/ScheduledExecutorConfig.ts` — config types and validation
- `src/config/HeliosConfig.ts` — `scheduledExecutorConfigs` map and lookup
- `src/config/ConfigLoader.ts` if file-config support is introduced or changed
- `src/core/HeliosInstance.ts` — `getScheduledExecutorService(name)` contract
- `src/instance/impl/HeliosInstanceImpl.ts` — proxy creation, deferred-error removal, lifecycle wiring
- `src/spi/impl/NodeEngineImpl.ts` — service registration
- `src/spi/impl/operationservice/impl/OperationServiceImpl.ts` — operation class registration
- `src/executor/` — `ExecutorContainerService` integration for task dispatch
- `src/internal/partition/impl/` — `MigrationAwareService` integration, anti-entropy hooks
- `src/client/proxy/ClientScheduledExecutorProxy.ts` — client proxy
- `src/server/clientprotocol/` — server-side protocol handlers for client proxy
- `src/index.ts` if public scheduled executor exports change
- `src/test-support/` and any scheduled-executor-focused test fixtures/helpers
- `test/scheduledexecutor/` — all scheduled executor tests
- `test/config/` — config tests
- `README.md`
- `examples/native-app/`
- `examples/nestjs-app/`

When implementing Phase 23, verify all relevant surfaces, not just `packages/blitz/src/job/`:

- `packages/blitz/PLAN-job-supervision.md`
- `packages/blitz/src/` — all existing Blitz library code
- `packages/blitz/src/job/` — all new job supervision code
- `packages/blitz/src/BlitzService.ts` — newJob/newLightJob/getJob/getJobs/setCoordinator wiring
- `packages/blitz/src/BlitzEvent.ts` — new job lifecycle events
- `packages/blitz/src/Pipeline.ts` — toDescriptor(), edge type API
- `packages/blitz/src/Vertex.ts` — sourceRef/sinkRef fields
- `packages/blitz/src/Edge.ts` — edgeType, fluent setters
- `packages/blitz/src/index.ts` — all new exports
- `packages/blitz/src/nestjs/HeliosBlitzService.ts` — NestJS proxy methods
- `src/instance/impl/HeliosClusterCoordinator.ts` — BlitzJobCoordinator integration with membership events
- `src/instance/impl/blitz/HeliosBlitzCoordinator.ts` — fencing pattern reference
- `src/instance/impl/blitz/HeliosBlitzLifecycleManager.ts` — readiness gates
- `src/instance/impl/HeliosInstanceImpl.ts` — coordinator wiring for job commands via IMap/ITopic
- `src/map/IMap.ts` — job registry IMap usage
- `src/topic/ITopic.ts` — job command broadcast
- `packages/blitz/test/` — all existing and new Blitz tests
- `README.md`
- `examples/native-app/`

## Known Deferrals and Future Work

This section consolidates all explicitly deferred items across the v1 port. Each item is documented
in at least one authoritative location. No item here is a hidden gap — every deferral was a
deliberate scope decision.

### Deferred to v2

| Item | Authoritative Source | Reason |
|------|---------------------|--------|
| SQL Engine | `plans/V1_TYPESCRIPT_PORT_PLAN.md` | Requires porting Apache Calcite (~500k lines of Java); `getSql()` throws deterministic error |
| CP Subsystem (Raft) | `plans/V1_TYPESCRIPT_PORT_PLAN.md` | FencedLock, IAtomicLong, ISemaphore, ICountDownLatch — significant consensus protocol work; `getCPSubsystem()` throws deterministic error |
| `IDurableExecutorService` | `plans/DISTRIBUTED_EXECUTOR_PLAN.md` | Ring-buffer replicated executor; Phase 17 covers Tier 1 (immediate, non-durable) only |
| TLS support | `plans/V1_TYPESCRIPT_PORT_PLAN.md` | Will use `Bun.serve({ tls })` |
| Authentication / JWT / security realm | `plans/V1_TYPESCRIPT_PORT_PLAN.md` | Full auth stack deferred |
| Split-brain merge policies | `plans/MULTI_NODE_RESILIENCE_PLAN.md` | Detection is implemented; merge policies require sophisticated conflict resolution |
| Phi-Accrual failure detector | `plans/MULTI_NODE_RESILIENCE_PLAN.md` | Using Deadline detector; Phi-Accrual is an accuracy improvement |
| Partial disconnection detection | `plans/MULTI_NODE_RESILIENCE_PLAN.md` | Requires master-aggregated connectivity graph |
| Chunked migration | `plans/MULTI_NODE_RESILIENCE_PLAN.md` | Using full-state transfer; chunked is a performance optimization |
| Merkle-tree differential sync | `plans/MULTI_NODE_RESILIENCE_PLAN.md` | Using full state transfer; differential is a bandwidth optimization |

### Known First-Release Parity Gaps

| Item | Authoritative Source | Detail |
|------|---------------------|--------|
| `StatefulTask` | `plans/SCHEDULED_EXECUTOR_IMPLEMENTATION_PLAN.md` (Decision #29) | Hazelcast `StatefulTask<K,V>` save/restore callbacks not implemented; apps must persist task state externally |
| `scheduleWithFixedDelay(...)` | Phase 22 Block 22.1 | Not part of Hazelcast `IScheduledExecutorService` parity |

### NOT-RETAINED Remote Client Surfaces

These surfaces were narrowed out of the shared `HeliosInstance` contract during Phase 20 and remain
member-only on `HeliosInstanceImpl`. The `DEFERRED_CLIENT_FEATURES` constant in
`src/client/HeliosClient.ts` is the programmatic source of truth.

| Surface | Reason |
|---------|--------|
| `getReliableTopic()` | No server-side reliable-topic client protocol handler |
| `getExecutorService()` | No server-side executor client protocol handler |
| `getScheduledExecutorService()` | Member-side only; server-side client protocol not wired for remote access |
| `getList()`, `getSet()`, `getMultiMap()`, `getReplicatedMap()` | Local-only implementations, no distributed service backing |

### Blocked-by-Server Client Features

These require server-side runtime work before the remote client can support them.

| Surface | Blocker |
|---------|---------|
| Cache / JCache | Server cache runtime absent |
| Query cache | Server query-cache runtime absent |
| Transactions | Cluster-safe transaction semantics absent |
| SQL | SQL engine deferred to v2 |
| PN counter | Server runtime absent |
| Flake ID generator | Server runtime absent (`crypto.randomUUID()` replacement) |
| Cardinality estimator | Server runtime absent |

### Not Porting (Permanent)

OSGi, WAN replication, CRDT, vector search, durable executor (ring-buffer tier), flake ID generator,
data connections, audit log, Hot Restart (enterprise), HD Memory (enterprise), legacy Java extension
modules (Kafka, Hadoop, Avro, CDC, gRPC, Kinesis, Python connectors).

## Commit Convention

```text
feat(<module>): <description> — <N> tests green
fix(<module>): <what was fixed>
refactor(<module>): <what changed>
```

## Plan Note

This file intentionally contains only the remaining master work and the consolidated deferrals inventory.

The archived v1 plan is preserved at `plans/V1_TYPESCRIPT_PORT_PLAN.md`.
