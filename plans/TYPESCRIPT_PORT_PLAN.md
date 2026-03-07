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
- Remaining master-plan work is Phase 17R, Phase 18, Phase 19, Phase 19T, Phase 20, and Phase 21.
- Executor scatter-closure implementation detail lives in `plans/EXECUTOR_SCATTER_PRODUCTION_PLAN.md`.
- The canonical implementation detail for the remaining Blitz work lives in `plans/BLITZ_EMBEDDED_NATS_PLAN.md` Appendix B.
- MongoDB MapStore implementation detail lives in `plans/MONGODB_MAPSTORE_PRODUCTION_PLAN.md`.
- Topic and reliable-topic implementation detail lives in `plans/TOPIC_RELIABLE_TOPIC_UNIFIED_PLAN.md`.
- Cluster-safe MapStore implementation detail lives in `plans/CLUSTER_SAFE_MAPSTORE_PLAN.md`.
- Remote-client implementation detail lives in `plans/CLIENT_E2E_PARITY_PLAN.md`, `plans/CLIENT_E2E_EXECUTION_BACKLOG.md`, and `plans/CLIENT_E2E_PARITY_MATRIX.md`.
- Backup partition promotion/recovery parity detail lives in `plans/BACKUP_PARTITION_RECOVERY_PARITY_PLAN.md`.

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
- `scatter` is the production default backend, while `inline` remains an explicit test or dev-only path
- distributed task registration is module-backed and worker-materializable
- worker crash, timeout, cancellation, shutdown, and task-lost semantics are deterministic and acceptance-tested

### Phase 18 — Blitz Distributed Embedded Cluster Default

Goal: make Blitz distributed by default in Helios multi-node deployments.

- every Helios node hosts one local embedded NATS node
- the current Helios master acts as the Blitz bootstrap authority for topology and seed routing
- starting a second Helios node automatically forms the shared NATS/JetStream cluster
- Helios owns the distributed control plane, lifecycle wiring, and reconciliation behavior

### Phase 19 - MongoDB MapStore Production Readiness

Goal: deliver the MongoDB-backed MapStore contract defined in
`plans/MONGODB_MAPSTORE_PRODUCTION_PLAN.md` with real Helios runtime wiring and end-to-end proof
against a real MongoDB instance.

- direct, factory, registry-backed, and dynamic-loading wiring paths are honest and fully wired
- document-mode Mongo persistence is the only supported persistence model and is end to end real
- shutdown, restart, validation, eager/lazy load, bulk, clear, and `loadAllKeys()` semantics are
  production-ready and free of hidden stubs
- exact proof commands/docs/examples only claim the Mongo scope that is actually implemented

### Phase 19T - Topic + ReliableTopic Production Closure

Goal: finish classic `ITopic` and ringbuffer-backed `getReliableTopic()` as real Helios messaging
primitives with one honest runtime path per mode, explicit lifecycle/config/failure semantics, and
no throw stubs, fake local-only alternates, or hidden in-memory side paths.

- classic topic uses one Helios-owned service-backed runtime path in single-node and multi-node mode
- reliable topic is backed by the real ringbuffer runtime, not local listener arrays or bespoke storage
- reliable listener semantics are explicit, Bun/TypeScript-native, and parity-aware for sequence, loss, terminal error, and cancellation behavior
- overload, retention, destroy, shutdown, owner-loss, and failover behavior are deterministic and acceptance-tested
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

### Phase 21 — Cluster-Safe MapStore Across Multiple Helios Instances

Goal: make Helios MapStore owner-authoritative and cluster-safe so multiple Helios members can
share one external persistence layer without duplicate writes, duplicate deletes, or fake
broadcast-replay semantics.

- clustered partition recovery is Bun-native and TypeScript-native, with one real runtime path and no weird fallbacks
- owner death promotes surviving backups first, then refills backup slots with real replicated state transfer
- anti-entropy and replica sync automatically repair missed backup state after crashes, packet loss, and rejoin
- total replica loss is reported honestly through partition-lost signaling rather than hidden recovery shortcuts
- partition owners are the only external MapStore writers
- backup replicas shadow state for failover and migration without writing externally while backups
- owner-routed operations replace mutation broadcast as the authoritative clustered map path
- write-through, write-behind, eager load, lazy load, clear, and bulk paths are end to end honest
- at least one real adapter proves the clustered vertical slice after its single-node proof is green

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
- [x] Make `scatter` the production default backend, keep `inline` explicit for tests or development only, and fail closed when Scatter is unavailable or unhealthy instead of silently falling back.
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
- [x] Implement mandatory re-registration behavior after master change or topology invalidation.
- [x] Add tests that prove topology messages, snapshot authority, retry handling, and re-registration are real protocol behavior, not mocks.
- [x] Run a verification task that proves config, protocol, and topology state are end to end and production ready.

### Block 18.3 — Helios runtime wiring + distributed-auto startup/join/rejoin flow

Goal: make Helios own Blitz lifecycle end to end during startup, cluster join, member leave, and rejoin.

Tasks:

- [x] Wire Helios-owned Blitz lifecycle into `HeliosInstanceImpl` startup and shutdown ordering.
- [x] Start one local Blitz node per Helios member under Helios lifecycle ownership.
- [x] Enforce join/master readiness gates before topology-dependent Blitz calls are allowed.
- [x] Implement the one-time bootstrap-local to clustered cutover path.
- [x] Implement deterministic cleanup on member leave, failed join, and instance shutdown.
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
- [x] Implement routable advertise-host behavior for real multi-node environments.
- [x] Reuse the Helios-owned Blitz instance inside the NestJS bridge instead of spinning up parallel unmanaged instances.
- [x] Update exports/docs/examples as needed for the distributed-default mode.
- [x] Add tests for env-helper behavior, replica fencing, reconciliation, advertise-host correctness, and NestJS reuse of Helios-owned Blitz.
- [x] Run a verification task that proves reconciliation and integration behavior are production ready and not split across duplicate runtimes.

### Block 18.5 — Multi-node HA verification

Goal: prove the full Phase 18 system works under realistic HA flows.

Tasks:

- [x] Add verification scenario for first-node-alone boot.
- [x] Add verification scenario for second-node auto-cluster formation.
- [x] Add verification scenario for current-master handoff.
- [x] Add verification scenario for retryable topology responses during re-registration sweep.
- [x] Add verification scenario for restart and rejoin.
- [x] Add verification scenario for `shutdownAsync()` lifecycle and cleanup.
- [x] Add verification scenario proving no child-process leaks remain after repeated start/stop cycles.
- [x] Add distributed-default acceptance coverage across Helios + Blitz + any reused NestJS bridge surfaces.
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
- [x] Wire the exact local/CI MongoDB test harness, proof commands, and label-to-command mapping required by `plans/MONGODB_MAPSTORE_PRODUCTION_PLAN.md`.
- [x] Update exports/docs/examples only for supported programmatic, registry-backed, dynamic-loading, and JSON/YAML-wired Mongo paths.
- [x] Run a final verification task that proves the MongoDB MapStore vertical slice is production ready, fully wired, and free of hidden stubs or placeholder proof gates.

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
- [x] Close the ringbuffer wait/notify and lifecycle gaps required by reliable listeners so multiple waiting readers, append wake-ups, destroy/shutdown cancellation, backup replication, owner promotion, and new-backup resync are all real runtime behavior rather than assumed properties.
- [x] Wire publish routing, listener delivery, failover, and destroy/shutdown semantics end to end for both topic modes, including no runtime resurrection after destroy, no surviving runners or timers after shutdown, and deterministic owner-loss behavior.
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

- [ ] Add `src/client/HeliosClient.ts` and the client runtime shell needed for `HeliosClient` to implement `HeliosInstance`.
- [ ] Add lifecycle service, shutdown-all tracking, and named-client registry policy for the remote client runtime.
- [ ] Rewrite `src/client/config/ClientConfig.ts` into the real root client config instead of a near-cache-only helper.
- [ ] Add typed client config surfaces for network, connection strategy, retry, security, metrics, failover, and any other retained Hazelcast-parity client config sections.
- [ ] Add production client-config loading and validation for the file/config path external users will actually use.
- [ ] Establish one real client serialization owner used by all request/response paths.
- [ ] Fail fast on unsupported config sections instead of silently accepting them.
- [ ] Run a verification task that proves a separate Bun app can import the public client surface only, construct config, and initialize the real client runtime shell with no internal imports or fake config fallbacks.

### Block 20.3 — Member-side client protocol server + auth/session lifecycle

Goal: create the real member/server counterpart the remote client will talk to.

Tasks:

- [ ] Add a dedicated member-side client-protocol server/runtime outside `src/client`.
- [ ] Move any current member-side client-protocol handlers out of `src/client` into server/member packages.
- [ ] Add client protocol framing/version negotiation compatibility on the member side.
- [ ] Add authentication request handling, session creation, endpoint/session registry ownership, and disconnect cleanup.
- [ ] Add request-dispatch registry from client message type to member-side handler.
- [ ] Add correlation-aware response routing and event-push path support.
- [ ] Add heartbeat handling and lifecycle bookkeeping for connected clients.
- [ ] Run a verification task that proves a raw socket client can authenticate, issue at least one request, receive a response, and disconnect cleanly against a real Helios member.

### Block 20.4 — Client connection manager + invocation/cluster/partition/listener services

Goal: make the client runtime actually connect, route requests, and recover listeners through one real runtime path.

Tasks:

- [ ] Add `ClientConnection`, `ClientConnectionManager`, and connection-state ownership for the remote client runtime.
- [ ] Implement bootstrap, multi-address connect, auth failure classification, heartbeat, timeout, backoff, reconnect, and cluster-mismatch behavior.
- [ ] Add `ClientInvocation`, `ClientInvocationService`, `ClientClusterService`, `ClientPartitionService`, and `ClientListenerService`.
- [ ] Add member-list refresh, partition-table refresh, correlation tracking, retry classification, and redirection/resubmission behavior.
- [ ] Add listener registration bookkeeping, reconnect re-registration, and event-delivery semantics through one central listener service.
- [ ] Add the required member-side protocol tasks for cluster view, partition metadata, listener registration/removal, and distributed-object metadata.
- [ ] Run a verification task that proves all remote calls and listeners flow through the central client runtime services only, with no in-process fake backing stores or test-only runtime shortcuts.

### Block 20.5 — Server-capability closure for shared `HeliosInstance` contract

Goal: eliminate any gap between the shared `HeliosInstance` contract and what a remote client can honestly do.

Tasks:

- [ ] Audit every `HeliosInstance` method against current member/runtime capability and keep the parity matrix current.
- [ ] Close the server/runtime gaps for any retained remote `HeliosInstance` capability before declaring the client GA-ready.
- [ ] Resolve current blockers around `getList()`, `getSet()`, `getReliableTopic()`, `getMultiMap()`, `getReplicatedMap()`, `getDistributedObject()`, `getConfig()`, and `getExecutorService()`.
- [ ] Ensure no `HeliosInstance` method remains on `HeliosClient` as a permanent half-implemented throw-stub.
- [ ] If a capability cannot honestly be made remote-capable in this phase window, narrow `HeliosInstance` itself before GA rather than letting member and client diverge or shipping a fake remote implementation.
- [ ] Run a verification task that proves every retained remote `HeliosInstance` method has a named owner, a real runtime path, and a real-network acceptance owner.

### Block 20.6 — Proxy manager + distributed object lifecycle + core remote proxies

Goal: give every remote distributed object one creation path and one real invocation path.

Tasks:

- [ ] Add client proxy base and proxy-manager ownership for all remote distributed objects.
- [ ] Add distributed-object create/destroy/list protocol tasks and client-side lifecycle cleanup.
- [ ] Implement `ClientMapProxy`, `ClientQueueProxy`, and `ClientTopicProxy` over the real invocation/runtime stack.
- [ ] Implement additional remote proxies only after their backing server/runtime capability is proven by Block 20.5.
- [ ] Ensure every retained client codec is owned by a real proxy or runtime service, and delete any orphan codec that is not.
- [ ] Ensure same-name distributed objects return stable proxy instances until destroy/shutdown.
- [ ] Run a verification task that proves a separate Bun app can use every shipped proxy over real sockets with no internal imports, fake stores, or partial destroy semantics.

### Block 20.7 — Near-cache completion + advanced feature closure

Goal: finish the higher-level client behavior only after the real runtime/proxy/listener stack exists.

Tasks:

- [ ] Rewrite the current client near-cache wrappers to sit on top of real remote proxies rather than synchronous in-process backing-store contracts.
- [ ] Wire metadata fetchers through the real binary client protocol instead of in-process member objects.
- [ ] Complete reconnect re-registration, stale-read detection, metrics wiring, and destroy/shutdown cleanup for near-cache behavior.
- [ ] Close or explicitly defer advanced client surfaces such as cache client, query cache, transactions, SQL, reliable topic, PN counter, flake ID, scheduled executor, and other secondary services based on honest server/runtime support.
- [ ] Keep package exports and docs/examples aligned with only the advanced features that are truly wired.
- [ ] Run a verification task that proves near-cache and any retained advanced client feature work over real sockets and are free of hidden mini-runtimes or fake parity claims.

### Block 20.8 — Examples/docs/exports + final remote-client GA proof

Goal: make the client consumable and prove the whole vertical slice end to end.

Tasks:

- [ ] Update `src/index.ts`, package exports, and any user-facing subpaths to expose only the intentional client surface.
- [ ] Add a separate Bun remote-client example against a real Helios cluster.
- [ ] Add auth, reconnect, and near-cache examples only for truly wired client behavior.
- [ ] Add real-network acceptance suites for every exported distributed object family and every exported advanced feature family.
- [ ] Add hygiene gates proving no member-side protocol handler remains under `src/client`, no wildcard export leaks unfinished client internals, and no client proof path relies on REST when binary protocol support is claimed.
- [ ] Run a final verification task that proves the remote client is production ready, end to end, contract-honest, and free of fake transports, orphan codecs, hidden stubs, or test-only runtime shortcuts.

## Phase 21 Task Breakdown

### Block 21.0 — Backup partition recovery parity foundation

Goal: make clustered partition recovery fully end to end in Bun/TypeScript with one clean runtime
path, no split partition authority, no fake fallbacks, and Hazelcast-parity owner-loss semantics.

Tasks:

- [ ] Bind this block to `plans/BACKUP_PARTITION_RECOVERY_PARITY_PLAN.md` as the authoritative implementation detail.
- [ ] Replace split clustered partition authority with one production partition-service owner used by `NodeEngine`, operation routing, migration, backup execution, and instance-level ownership queries.
- [ ] Remove clustered recovery shortcuts that rebuild or shadow partition state outside the real runtime partition service.
- [ ] Add Hazelcast-style member-removal bookkeeping, including sync-cancellation, departed-member repair bookkeeping, and deterministic repair triggering.
- [ ] Implement promotion-first recovery so a surviving backup becomes owner before refill or rebalance work starts.
- [ ] Implement refill of missing backup slots via real migration or replica-transfer paths so redundancy is restored when capacity exists.
- [ ] Add partition-lost event and listener support for partitions with no surviving replicas.
- [ ] Wire anti-entropy as a real runtime scheduler and make replica sync a real remote protocol with throttling, retries, timeout cleanup, and stale-response rejection.
- [ ] Audit and close service-state replication for every supported partition-scoped service touched by failover, refill, and replica sync; explicitly defer and document any unsupported service instead of letting partition-metadata parity imply runtime parity.
- [ ] Freeze and wire operator-facing recovery config/defaults, observability, docs/examples, and test-support for anti-entropy cadence, sync timeout/retry/throttle behavior, degraded redundancy, repair progress, and partition-lost signaling.
- [ ] Add stale-rejoin fencing and shutdown/demotion cleanup so restarted or demoted members cannot leak stale replica state, stale sync responses, or orphaned repair work back into the cluster.
- [ ] Add real multi-node crash, rejoin, packet-loss, promotion, refill, and partition-lost tests proving the recovery path is production real.
- [ ] Run a verification task that proves clustered partition recovery is Bun-native, TypeScript-native, end to end, and free of stubs, fake fallbacks, duplicate authorities, or test-only runtime shortcuts.

### Block 21.1 — Cluster execution substrate + owner-routed map path

Goal: replace local-mutate-then-broadcast behavior with real partition-owner execution for clustered
maps.

Tasks:

- Make clustered `NodeEngine` / partition-owner routing real in TCP-clustered mode.
- Fully wire remote operation request/response/backup handling for partition-routed operations.
- Remove `MAP_PUT` / `MAP_REMOVE` / `MAP_CLEAR` as the authoritative clustered map consistency path.
- Make clustered map correctness depend on owner-routed operations, not peer replay.
- Add tests proving non-owner callers execute map mutations on the current partition owner.
- Run a verification task that proves the clustered map execution substrate is real and no longer
  relies on mutation broadcast shortcuts.

### Block 21.2 — Partition-scoped MapStore runtime + owner-only persistence

Goal: move MapStore side effects onto partition owners and give backups explicit no-external-write
behavior.

Tasks:

- Refactor `MapStoreContext` into shared map-level lifecycle plus partition-scoped runtime state.
- Move MapStore `store` / `delete` / `load` behavior out of proxy caller-side code and onto the
  owner-executed map path.
- Give backups explicit shadow-state behavior for write-through and write-behind without external
  writes.
- Upgrade `putAll()` / `getAll()` to real owner-routed bulk MapStore paths.
- Add tests proving exactly one external write/delete per logical clustered mutation.
- Run a verification task that proves partition owners are the only external writers.

### Block 21.3 — Migration, failover, shutdown handoff, and coordinated eager/clear

Goal: preserve clustered MapStore correctness while partitions move, owners change, and members shut
down.

Tasks:

- Make `MapContainerService` participate in migration as a real `MigrationAwareService`.
- Wire write-behind queue/flush metadata replication into migration and promotion flows.
- Implement deterministic owner demotion/promotion cutover so backups become writers only after
  finalization.
- Add coordinated clustered EAGER load and clustered clear flows that do not duplicate external work
  per member.
- Add graceful shutdown behavior that flushes or hands off owned write-behind work deterministically.
- Add tests for migration, owner promotion, eager-load coordination, clear coordination, and
  shutdown handoff.
- Run a verification task that proves ownership changes do not create duplicate external writers or
  silent write loss beyond the documented at-least-once contract.

### Block 21.4 — Real adapter proof + clustered MapStore production gate

Goal: prove the clustered MapStore core works with a real adapter and only document supported
behavior.

Tasks:

- Prove clustered write-through and write-behind correctness with a deterministic counting test
  adapter.
- Prove the full clustered vertical slice with MongoDB after Phase 19 single-node readiness is
  already green.
- Document clustered MapStore durability scope, failover semantics, and adapter-eligibility rules.
- Update exports/docs/examples only for supported clustered paths.
- Run a final verification task that proves clustered MapStore is production ready, end to end, and
  free of hidden broadcast-replay or duplicate-write behavior.

### Master Todo List

> Canonical loop-selection source: only the `- [ ] **Block ...` lines in this file.

- [x] **Block 17R.1** — Executor Scatter production closure (`plans/EXECUTOR_SCATTER_PRODUCTION_PLAN.md`, real member-local executor registry/container ownership, no distributed direct-factory fallback, Scatter-backed off-main-thread execution, module-backed worker-materializable registration only, scatter default with inline explicit-only for tests/dev, deterministic cancel/shutdown/task-lost/member-loss semantics, fail-closed backend health, recycle-on-crash-or-timeout behavior, docs/examples/config/test-support honesty) — ~24 tests
- [ ] **Phase 17R checkpoint** — root typecheck green; executor unit/integration tests green; targeted real multi-node Scatter-backed executor suites green; distributed executor work is observably off-main-thread; config/docs/examples/test-support/public claims are aligned with module-backed distributed execution and explicit inline test/dev usage; 0 fail, 0 error
- [x] **Block 18.1** — Raw Blitz `clusterNode` primitive + replication hooks (`ClusterNodeNatsConfig`, one-local-node clustered spawn path, typed bind/advertise config, stable route normalization, `defaultReplicas`) — ~18 tests
- [x] **Block 18.2** — Helios Blitz config + protocol + topology service (`HeliosConfig` Blitz runtime section, topology models, coordinator service, `BLITZ_*` cluster messages with `requestId`/retry metadata, authoritative route-list schema for clustered restart, current-master snapshot authority using `memberListVersion`, explicit expected-registrant sweep rules after master change) — ~18 tests
- [x] **Block 18.3** — Helios runtime wiring + distributed-auto startup/join/rejoin flow (`HeliosInstanceImpl` lifecycle ownership, local Blitz boot, join/master readiness gate before topology calls, one-time bootstrap-local -> clustered cutover, deterministic cleanup on member leave/shutdown) — ~18 tests
- [x] **Block 18.4** — Replication reconciliation + Helios env helpers + NestJS bridge (`HELIOS_BLITZ_MODE=distributed-auto`, master-owned fenced but recomputable replica-count upgrade policy for Blitz-owned KV/state, routable advertise-host behavior, Helios-owned Blitz instance mandatorily reused by NestJS) — ~16 tests
- [x] **Block 18.5** — Multi-node HA verification (first-node-alone boot, second-node auto-cluster, current-master handoff, retryable topology responses during re-registration sweep, restart/rejoin, `shutdownAsync()` lifecycle, no child-process leaks, distributed-default acceptance) — ~20 tests
- [ ] **Phase 18 checkpoint** — `bun test packages/blitz/` + targeted Helios/Blitz multi-node tests green; starting a second Helios node auto-forms the Blitz cluster; topology protocol, cutover path, re-registration behavior, reconciliation fencing, and lifecycle wiring are fully exercised; 0 fail, 0 error
- [x] **Block 19.1** — MongoDB MapStore parity/scope freeze + core runtime closure (`plans/MONGODB_MAPSTORE_PRODUCTION_PLAN.md` binding, document-only scope freeze, `shutdownAsync()` flush await, realistic EAGER timing, `MapKeyStream<K>` closure, bulk/clear/loadAllKeys legality, query/index rebuild, JSON/YAML config-origin wiring) — ~18 tests
- [x] **Block 19.2** — Mongo config/property resolution + document mapping + lifecycle hardening (`MapStoreConfig.properties` resolution, document-only mode, `id-column`, `columns`, `single-column-as-value`, `replace-strategy`, registry/provider bootstrap, dynamic loading, owned vs injected client lifecycle, read-only vs writable collection ownership) — ~20 tests
- [x] **Block 19.3** — Bulk I/O + Helios integration + real MongoDB proof (`storeAll`/`deleteAll` batching, retry ownership, offload behavior, write-through/write-behind integration, restart/shutdown/eager/lazy/clear/bulk/loadAllKeys proof, exact Mongo harness/proof commands, supported docs/examples) — ~22 tests
- [ ] **Phase 19 checkpoint** — root and `packages/mongodb` typechecks green; Mongo package tests green; exact Mongo unit/core/offload/cluster/e2e proof commands from `plans/MONGODB_MAPSTORE_PRODUCTION_PLAN.md` are green; supported wiring paths, document-mode mapping, shutdown flush, restart persistence, eager/lazy load, clear, bulk, and `loadAllKeys()` streaming semantics are all exercised; 0 fail, 0 error
- [x] **Block 19T.1** — Classic topic hardening + ringbuffer-backed reliable topic closure (`plans/TOPIC_RELIABLE_TOPIC_UNIFIED_PLAN.md`, one service-backed classic-topic runtime path, Bun/TypeScript-native reliable-listener contract, real `getReliableTopic()` ringbuffer runtime, Hazelcast-parity overload semantics, no throw stubs or hidden local-only alternate path, failover/destroy/shutdown cleanup, docs/examples/config/exports/test-support honesty) — ~26 tests
- [ ] **Phase 19T checkpoint** — root typecheck green; topic and ringbuffer tests green; `getTopic()` and `getReliableTopic()` both work in single-node and multi-node flows; reliable-topic publish/listen/failover/destroy/shutdown and overload/retention semantics are fully exercised; no `getReliableTopic()` throw stubs or local-only alternate classic-topic path remain; 0 fail, 0 error
- [x] **Block 20.1** — Client parity matrix + surface freeze + packaging contract (`src/client` keep/rewrite/move/delete matrix, Hazelcast-to-Helios parity matrix, `HeliosClient implements HeliosInstance`, `getConfig()` contract decision, root export cleanup, wildcard export freeze) — ~12 tests/docs gates
- [ ] **Block 20.2** — Public client API + config model + serialization foundation (`HeliosClient`, lifecycle shell, shutdown-all policy, real `ClientConfig`, typed network/security/retry/failover config, production config loading, single serialization owner) — ~18 tests
- [ ] **Block 20.3** — Member-side client protocol server + auth/session lifecycle (server-owned client protocol runtime outside `src/client`, moved task handlers, auth/session registry, request dispatch, response correlation, heartbeat/disconnect handling) — ~20 tests
- [ ] **Block 20.4** — Client connection manager + invocation/cluster/partition/listener services (`ClientConnectionManager`, reconnect/backoff/auth classification, `ClientInvocationService`, `ClientClusterService`, `ClientPartitionService`, `ClientListenerService`, member-list/partition refresh, listener re-registration) — ~22 tests
- [ ] **Block 20.5** — Server-capability closure for shared `HeliosInstance` contract (method-by-method audit, remote closure for retained contract items, blockers resolved for list/set/reliableTopic/multimap/replicatedMap/distributedObject/getConfig/executor, no permanent half-stubs on `HeliosClient`) — ~18 tests
- [ ] **Block 20.6** — Proxy manager + distributed object lifecycle + core remote proxies (`ProxyManager`, distributed object create/destroy/list tasks, `ClientMapProxy`, `ClientQueueProxy`, `ClientTopicProxy`, additional proxies only after server closure, orphan codec deletion) — ~24 tests
- [ ] **Block 20.7** — Near-cache completion + advanced feature closure (real remote near-cache wrapping, binary metadata fetch, reconnect repair/stale-read protection, advanced-feature keep/defer closure for cache/query-cache/transactions/SQL/secondary services) — ~22 tests
- [ ] **Block 20.8** — Examples/docs/exports + final remote-client GA proof (public exports only, separate Bun client example, auth/reconnect/nearcache examples, real-network acceptance suites, hygiene gates for no REST fallback/no orphan handlers/no wildcard leakage) — ~18 tests
- [ ] **Phase 20 checkpoint** — root typecheck green; client runtime tests green; targeted real-network client protocol tests green; separate Bun app can import `HeliosClient` from `@zenystx/helios-core`, connect over binary protocol, use every retained remote `HeliosInstance` capability honestly, survive reconnect, and shut down cleanly; 0 fail, 0 error
- [ ] **Block 21.0** — Backup partition recovery parity foundation (`plans/BACKUP_PARTITION_RECOVERY_PARITY_PLAN.md`, one partition-service authority, no clustered recovery shortcuts, member-removal bookkeeping, promotion-first repair, backup refill, partition-lost signaling, runtime anti-entropy, real remote replica sync, service-state replication closure, stale-rejoin fencing, observability/config/docs/test-support closure, crash/rejoin proof) — ~28 tests
- [ ] **Block 21.1** — Cluster execution substrate + owner-routed map path (real partition-owner routing, remote operation request/response/backup flow, no authoritative `MAP_PUT` / `MAP_REMOVE` / `MAP_CLEAR` replay path) — ~18 tests
- [ ] **Block 21.2** — Partition-scoped MapStore runtime + owner-only persistence (shared map-level lifecycle + partition-scoped stores, owner-side `store`/`delete`/`load`, backup no-external-write semantics, clustered `putAll`/`getAll` bulk paths) — ~22 tests
- [ ] **Block 21.3** — Migration, failover, shutdown handoff, and coordinated eager/clear (`MigrationAwareService` participation, write-behind queue replication, owner promotion cutover, clustered eager-load coordination, clustered clear, deterministic shutdown handoff) — ~24 tests
- [ ] **Block 21.4** — Real adapter proof + clustered MapStore production gate (counting-store proof, Mongo clustered proof after Phase 19, durability docs, supported clustered docs/examples only) — ~18 tests
- [ ] **Phase 21 checkpoint** — clustered partition recovery tests green; one partition-service authority is used in production clustered mode; owner crash promotes surviving backups before refill; anti-entropy and replica sync repair stale backups automatically; partition-lost is emitted when no replica survives; service-state replication is closed for all supported partition-scoped services; stale rejoin state is fenced until authoritative sync completes; recovery metrics/events/docs/examples/test-support are aligned with the real runtime path; clustered operation-routing tests green; exactly one external write/delete per logical clustered mutation; backups never write externally while backups; migration/promotion/eager-load/clear/shutdown handoff are fully exercised; counting-store proof and Mongo clustered proof are green after Phase 19; 0 fail, 0 error

## End-to-End Completion Requirements

Phases 17R-21 are not complete unless all of the following are true:

- distributed executor task bodies run off-main-thread through a real Scatter-backed execution path in production, with the main Bun event loop limited to transport, routing, backpressure, and response correlation
- no distributed executor path falls back to direct factory invocation or silent inline execution on the main event loop
- distributed executor registrations are module-backed, worker-materializable, and rejected deterministically when they are not
- worker crash, timeout, cancellation, shutdown, and member-loss executor behavior is acceptance-tested and fail-closed rather than silently degraded
- executor config defaults, validation, and any touched file-config/bootstrap entrypoints honestly enforce scatter-default and fail-closed behavior rather than hiding environment-specific fallback rules
- executor docs/examples/exports/test-support only claim module-backed distributed execution and explicit inline test/dev usage; no user-facing surface implies closure-backed distributed execution or silent inline fallback

- embedded Blitz cluster formation works without manual master env flags
- Helios owns startup, join, rejoin, master-change, and shutdown lifecycle end to end
- config is wired through `HeliosConfig`, runtime bootstrap, and any file/env-driven entrypoints used by the repo
- NestJS/Blitz integration reuses the Helios-owned Blitz instance where intended
- replication and reconciliation behavior are explicit, fenced, and tested
- no child-process leaks remain after shutdown or restart tests
- docs/examples/exports reflect the distributed-default Blitz behavior
- MongoDB MapStore meets the contract and proof gates in `plans/MONGODB_MAPSTORE_PRODUCTION_PLAN.md`, including direct/factory/registry/dynamic-loading wiring, document-mode mapping, lifecycle cleanup, eager/lazy load, clear, bulk, and `loadAllKeys()` streaming semantics
- write-through and write-behind Mongo persistence work against real MongoDB with restart/shutdown durability proof and no hidden runtime bypasses
- Mongo docs/examples/proof gates only claim supported programmatic, registry-backed, dynamic-loading, and JSON/YAML-wired paths and are backed by exact runnable commands
- classic topic uses one service-backed runtime path in single-node and clustered mode, with explicit ordering, stats, concurrency, destroy, and owner-loss semantics rather than a separate local-only alternate contract
- `getReliableTopic()` is a real ringbuffer-backed distributed object; no throw stubs remain in runtime, test-support, or shipped fixture implementations
- reliable-topic listener semantics are explicit and implemented for initial sequence, stored-sequence progression, loss tolerance, terminal error, cancellation, and deterministic plain-listener adaptation behavior
- reliable-topic overload, retention, failover, and destroy/shutdown behavior are explicit, tested, and limited to the supported parity contract
- ringbuffer wait/notify, backup replication, owner promotion, and new-backup resync are real runtime behavior for reliable topic rather than assumed side effects of ringbuffer existence
- topic docs/examples/config/exports only claim the classic and reliable topic behavior that is actually wired, including replay and bounded-retention limits
- `HeliosClient` is a real public product surface and implements the shared `HeliosInstance` contract honestly
- the member/server client protocol runtime exists outside `src/client` and owns auth, sessions, dispatch, and event push end to end
- every retained `HeliosInstance` capability is remotely real over the binary protocol, or `HeliosInstance` itself was narrowed before GA so member and client still share one honest contract
- no wildcard package export or root-barrel leakage leaves unfinished client internals accidentally public
- no client proof path relies on REST, in-process fake backing stores, or test-only runtime shortcuts when remote support is claimed
- real-network acceptance coverage exists for every exported remote client capability and any exported advanced client feature
- clustered partition recovery runs through one Bun-native, TypeScript-native production runtime path with no split authority, no fake fallback, and no hidden local-only repair shortcut
- owner crash promotes a surviving backup first, then restores redundancy through real refill or migration work when capacity exists
- anti-entropy and remote replica sync automatically repair stale or missed backup state after crash, rejoin, or dropped backup traffic
- partition-lost is emitted when no replica survives, and no code path silently pretends recovery succeeded
- supported partition-scoped services remain correct after promotion, refill, replica sync, shutdown, and rejoin; partition metadata parity alone is not sufficient
- restarted or rejoining members cannot serve or advertise stale replica state before authoritative partition/state sync completes
- operator-facing recovery metrics, events, readiness/safe-state signals, docs, examples, and proof commands all reflect the single real production recovery path
- clustered MapStore uses partition-owner execution, not mutation broadcast replay, as the
  authoritative multi-member map path
- clustered MapStore external writes happen only on owners, with backups staying shadow-only until
  promotion
- migration, owner promotion, eager load, clear, and graceful shutdown preserve the documented
  clustered durability contract with no hidden duplicate-write paths
- at least one real adapter proves the clustered MapStore vertical slice after single-node adapter
  readiness is already complete

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

## Commit Convention

```text
feat(<module>): <description> — <N> tests green
fix(<module>): <what was fixed>
refactor(<module>): <what changed>
```

## Plan Note

This file intentionally contains only the remaining master work.

The archived v1 plan is preserved at `plans/V1_TYPESCRIPT_PORT_PLAN.md`.
