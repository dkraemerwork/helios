# Topic + ReliableTopic Unified Implementation Plan

## Goal

Define a single execution plan for finishing Helios topic messaging in v1 by:

- hardening classic `ITopic` as one Helios-owned service-backed distributed pub/sub path in single-node and multi-node mode
- implementing `getReliableTopic()` on a real ringbuffer-backed path with no throw stubs and no hidden alternate store
- aligning config, runtime wiring, tests, and docs so both topic modes are production-usable and honestly documented

This plan supersedes the topic-only parts of `plans/DISTRIBUTED_QUEUE_TOPIC_PLAN.md`.
It is the authoritative implementation detail for Phase 19T in `plans/TYPESCRIPT_PORT_PLAN.md`.

## Current State

### What already exists

- `getTopic()` is wired in `src/instance/impl/HeliosInstanceImpl.ts` to `TopicProxyImpl` and `DistributedTopicService` when transport is enabled.
- `DistributedTopicService` already supports:
  - cross-node publish fan-out
  - owner-routed publish when `TopicConfig.globalOrderingEnabled` is true
  - local listener registration
  - local topic stats
- Multi-node topic behavior is already covered by:
  - `test/cluster/tcp/MultiNodeTcpIntegrationTest.test.ts`
  - `test/topic/DistributedTopicService.test.ts`
- Ringbuffer internals already exist under `src/ringbuffer/impl/*`, including add/read operations and wait-oriented reads.

### Repo realities that this plan must close explicitly

- `getTopic()` still falls back to local `TopicImpl` when TCP transport is off, and that local path currently ignores `TopicConfig` semantics such as `statisticsEnabled`.
- `getReliableTopic()` still throws in both `src/instance/impl/HeliosInstanceImpl.ts` and `src/test-support/TestHeliosInstance.ts`.
- `DistributedTopicService.destroy()` only drops service runtime state; `HeliosInstanceImpl` still caches topic proxies by name, so destroy semantics are not end to end yet.
- `DistributedTopicService` can currently recreate topic runtime state through calls like `removeMessageListener()`, `getLocalTopicStats()`, or late inbound messages after destroy unless this is explicitly fixed.
- `ConfigLoader` currently parses maps only; file-based config cannot define reliable-topic or ringbuffer settings yet.
- `RingbufferService` exists but is not fully wired into instance bootstrap, cluster routing, replication, migration, and public config loading.
- `OperationServiceImpl` still executes operations with `beforeRun()` plus `run()` directly and does not yet honor generic wait semantics needed for true blocking ringbuffer consumption.

### What is still missing or incomplete

- `getReliableTopic()` still throws in `src/instance/impl/HeliosInstanceImpl.ts`.
- There is no public reliable-topic implementation, proxy, service, or config model.
- Classic topic semantics are implemented, but not yet formalized as a complete feature with parity boundaries, durability expectations, and failure-mode tests.
- There is no explicit lifecycle split between classic topic and reliable topic objects.
- There is no public `getRingbuffer()` accessor or topic-facing bridge to ringbuffer state.
- Reliable listener sequence tracking, overflow handling, and lag policies do not exist yet.

## Product Decision

Helios should support two topic modes with explicit semantics:

### 1. Classic Topic

Use `getTopic()` for lightweight distributed pub/sub.

Properties:

- fan-out delivery to listeners on all connected members
- optional global owner-routed ordering via `TopicConfig`
- no durability guarantee across node loss
- best for notifications, invalidations, and lightweight event fan-out

### 2. Reliable Topic

Use `getReliableTopic()` for ringbuffer-backed consumption.

Properties:

- messages stored in a partition-owned ringbuffer
- listeners consume by sequence
- lag/overflow behavior is explicit and configurable
- survives listener restarts and slow-consumer gaps within ringbuffer retention bounds
- best for replayable event streams and consumers that cannot depend on live fan-out only

## Non-Goals

The first delivery should not attempt to implement everything Hazelcast supports.

Explicitly out of scope for this plan:

- split-brain merge policies for topics
- WAN replication
- enterprise persistence / hot restart
- full event-service parity with every Hazelcast internal abstraction
- exactly-once delivery guarantees
- transactional topic integration

## Design Principles

1. Keep `getTopic()` and `getReliableTopic()` separate at runtime even if they share interfaces.
2. Do not regress the already-working classic topic path while adding reliable topic.
3. Reuse existing ringbuffer infrastructure instead of inventing a second durable queue-like store.
4. Make failure semantics explicit in config and tests.
5. Prefer narrow, testable services over one giant topic subsystem.

## Required Architecture

## A. Classic Topic hardening

Classic topic is already implemented, so the remaining work is hardening and boundary definition.

### A1. Freeze classic topic semantics

Document and enforce that classic topic guarantees:

- at-most-once live listener delivery
- local listener callbacks on every receiving node
- owner-routed publish when global ordering is enabled
- direct broadcast publish when global ordering is disabled
- no replay after listener registration

Classic topic must use one service-backed runtime path in both single-node and multi-node mode.

Implementation rule:

- route all `getTopic()` calls through `DistributedTopicService`, even without TCP peers
- remove any remaining production reliance on a separate `TopicImpl`-only behavior contract
- keep one config, stats, destroy, and lifecycle contract for classic topic everywhere

### A2. Tighten lifecycle and failure behavior

Add tests and code paths for:

- listener cleanup on shutdown and destroy
- member-loss behavior while publishing
- publish timeout / owner-loss recovery when global ordering is enabled
- duplicate suppression expectations, if any, during peer churn
- pending publish timer cleanup on destroy and shutdown
- prevention of topic-runtime resurrection after destroy from late inbound messages or stat/listener API calls
- post-destroy cache eviction from `HeliosInstanceImpl` so `getTopic(name)` returns a fresh object rather than a dead cached proxy
- explicit listener exception policy: isolate a failing listener and continue fan-out, or document fail-fast behavior and test it

### A3. Clarify config contract

`TopicConfig` should remain the config surface for classic topic and clearly own:

- global ordering
- statistics enabled
- `multiThreadingEnabled` listener concurrency behavior

If a behavior belongs only to reliable topic, it must not leak into `TopicConfig`.

Validation rule:

- `globalOrderingEnabled=true` and `multiThreadingEnabled=true` must fail fast as incompatible settings

The plan must also close file-based config parity by updating:

- `src/config/ConfigLoader.ts`
- any JSON/YAML examples and docs that describe topic config

And it must verify that the real `HeliosInstanceImpl.getTopic()` path honors config rather than only unit-test doubles doing so.

### A4. Membership and in-flight publish handling

Classic topic needs explicit coordinator integration for owner-routed publish.

Add a concrete task to subscribe `DistributedTopicService` to membership changes and define exact behavior for in-flight publishes when the owner disappears:

- immediate reject
- reroute and retry
- bounded wait then fail

Recommendation:

- reject quickly on owner loss in v1 rather than retrying silently, unless a concrete reroute contract is implemented and tested.

## B. Reliable Topic architecture

Reliable topic should be implemented as a dedicated ringbuffer-backed path.

### B1. Public API decision

Keep `HeliosInstance.getReliableTopic<E>(name: string): ITopic<E>` as the public entrypoint for v1.

Internally introduce reliable-specific types where needed, for example:

- `ReliableTopicConfig`
- `ReliableTopicService`
- `ReliableTopicProxyImpl`
- `ReliableTopicRunner` or listener-consumer loop
- `ReliableMessageListenerLike` or an equivalent Bun/TypeScript-native reliable-listener contract

Optional extension point for later phases:

- add a richer public `IReliableTopic<T>` interface if Helios needs explicit replay or sequence APIs

### B2. Storage model

Each reliable topic maps to one ringbuffer instance, ideally by a deterministic derived name such as:

- `__hz.reliable-topic.<topicName>`

The ringbuffer must own:

- payload data
- publish time
- publisher member id
- sequence number

If needed, define an internal envelope type such as `ReliableTopicMessageRecord`.

The plan must require that this storage path uses the real ringbuffer runtime, not a bespoke in-memory array or a second hidden topic store.

### B3. Listener model

Reliable listeners should run as sequence consumers:

- each registration starts from a configured initial sequence position
- each listener tracks its own next sequence
- reads use ringbuffer read operations
- when no item is available, the listener waits and resumes when new data arrives

Important: listener execution must not block the core transport thread.

Implementation rule:

- keep the public `ITopic.addMessageListener(...)` shape for v1
- add an internal Bun/TypeScript-native reliable-listener contract covering initial sequence, stored-sequence progression, loss tolerance, terminal error, and cancellation
- adapt plain `MessageListener` registrations deterministically onto that contract instead of inventing a second lightweight path
- default plain-listener start position is `tail + 1`

If Helios later adds a richer public reliable-topic-specific interface, it must be introduced in the same phase that documents and tests it end to end.

### B4. Overflow and loss policy

Reliable topic must define what happens when a listener falls behind and its next sequence becomes stale.

Introduce config and runtime rules for this decision with Hazelcast-parity policy names and behavior:

- `topicOverloadPolicy: "ERROR" | "DISCARD_OLDEST" | "DISCARD_NEWEST" | "BLOCK"`
- `readBatchSize`
- default plain-listener initial-sequence behavior, with `tail + 1` as the default

Recommended v1 minimum:

- support `tail + 1` startup behavior by default for plain listeners
- on stale sequence, fail the listener with a deterministic error and remove registration unless config says otherwise

The plan must also define:

- whether listener failure is surfaced only to logs, to a callback, or through a returned registration handle
- whether one failing reliable listener can affect other listeners on the same topic

### B5. Service ownership

Reliable topic should not be hidden inside `DistributedTopicService`.

Instead:

- keep classic topic in `DistributedTopicService`
- add `ReliableTopicService` for ringbuffer-backed topic runtime
- let `HeliosInstanceImpl` own both service references and wire the correct proxy per accessor

## C. Ringbuffer integration requirements

### C1. Public access and wiring

Keep ringbuffer internal for this feature in v1; topic closure does not require a new public `getRingbuffer()` API.

But this plan must still require explicit internal wiring for:

- `RingbufferService` registration during instance bootstrap
- ringbuffer config registration from `HeliosConfig`
- topic-to-ringbuffer name derivation and lookup
- topic destroy/shutdown cleanup against the backing ringbuffer runtime

### C2. Wait-notify correctness

Reliable listener polling depends on ringbuffer reads that can wait for future items.

Before reliable topic is considered done, verify that the current operation runtime correctly supports:

- read-one waiting when sequence is `tail + 1`
- wake-up on ringbuffer add
- cancellation on topic destroy / member shutdown

If generic wait-notify support is still partial, close that gap before enabling reliable listeners in production.

Do not leave this as a vague verification step. Extend `OperationServiceImpl` so generic operation wait semantics are real for ringbuffer-backed reads and wake-ups.

Implementation rule:

- multiple parked readers must unblock independently
- append wake-ups must not cause head-of-line blocking between unrelated readers
- destroy and shutdown must cancel waiting reads deterministically

### C3. Partition ownership and backup behavior

Reliable topic durability is only as strong as ringbuffer replication.

Verify and test:

- primary/backup replication of ringbuffer content
- owner promotion after shutdown
- continued reads from promoted backup
- writes after promotion

Do not leave replication as an implied property of ringbuffer existence. This plan must include concrete implementation work for:

- sync and async backup behavior for ringbuffer writes
- state transfer or resync when a new backup joins
- service participation in migration and owner-promotion flows
- registration with the partition runtime if migration-aware service hooks are required

Ringbuffer failover proof is part of this plan, not a separate future prerequisite.

## D. Config model

Introduce `src/config/ReliableTopicConfig.ts` with at least:

- `name`
- `topicOverloadPolicy`
- `readBatchSize`
- `statisticsEnabled`
- default plain-listener initial-sequence behavior, if Helios keeps that configurable

Also decide where ringbuffer durability settings live. The implementation must not depend on hidden defaults that users cannot configure.

Recommended rule:

- `ReliableTopicConfig` owns topic-facing behavior
- `RingbufferConfig` owns storage-facing behavior such as capacity, TTL, and backup counts
- `HeliosConfig` must gain an explicit ringbuffer-config registry if reliable topic depends on non-default ringbuffer behavior

And extend `HeliosConfig` with:

- `addReliableTopicConfig(...)`
- `getReliableTopicConfig(name)`
- `addRingbufferConfig(...)`
- `getRingbufferConfig(name)` if ringbuffer config stays public in config loading

Config rules:

- missing reliable-topic config falls back to sensible defaults
- classic `TopicConfig` and `ReliableTopicConfig` stay independent
- if both exist for the same logical name, behavior is explicit and documented rather than merged implicitly
- reliable-topic config lookup is driven by the logical topic name and wildcard/default matching rules
- the backing ringbuffer name is derived deterministically from the logical topic name and stays internal unless a public override is explicitly added and fully wired

File-config rules:

- `ConfigLoader` must parse topic, reliable-topic, and ringbuffer sections from JSON and YAML
- invalid config combinations must fail fast with descriptive errors
- docs and examples must show at least one file-config example for reliable topic

## E. Implementation Phases

### Phase 1 - Stabilize classic topic

Deliverables:

- define and document current classic topic guarantees
- add tests for destroy, shutdown, peer loss, and ordering boundaries
- clean up any ambiguous timeout/ack behavior in `DistributedTopicService`
- replace the remaining split `TopicImpl` production path with the service-backed classic-topic runtime
- fix destroy/runtime-resurrection bugs in classic topic service and instance caches

Exit criteria:

- all current topic tests still pass
- new failure-mode coverage exists
- docs clearly distinguish classic topic from reliable topic

### Phase 2 - Add reliable topic config and service skeleton

Deliverables:

- `ReliableTopicConfig`
- `ReliableTopicService`
- `ReliableTopicProxyImpl`
- `HeliosInstanceImpl.getReliableTopic()` wiring
- `TestHeliosInstance.getReliableTopic()` wiring
- `ConfigLoader` parsing for reliable-topic and required ringbuffer config
- public exports in `src/index.ts`

Exit criteria:

- `getReliableTopic()` returns a real object
- single-node publish/listen works on ringbuffer backing
- no throw path remains in public API
- no throw path remains in repo fixtures/test-support helpers used by downstream tests
- implementation uses the real ringbuffer runtime rather than an ad hoc in-memory store

### Phase 3 - Implement listener sequence consumption

Deliverables:

- per-listener registration state
- Bun/TypeScript-native reliable-listener contract plus deterministic plain-listener adaptation
- background consumption loop
- stale sequence handling
- destroy/removal/cancellation logic
- listener error isolation policy
- shutdown cleanup so no runner/timer/wait survives instance shutdown

Exit criteria:

- listeners receive ringbuffer-backed messages in order
- slow-consumer stale sequence path is deterministic and tested
- listener removal stops polling cleanly

### Phase 4 - Multi-node reliable topic

Deliverables:

- publish routing to ringbuffer owner
- cross-node listener consumption
- owner failover and continued publish/read behavior
- backup replication and new-backup resync for ringbuffer-backed topic data
- explicit publish completion contract: owner append only vs owner append plus sync backup

Exit criteria:

- multi-node integration tests prove remote publish and remote listener delivery
- failover tests prove promoted owner continues serving the topic
- unread retained messages are still consumable after owner promotion within configured retention bounds

### Phase 5 - Production hardening

Deliverables:

- local stats for reliable topic
- metrics hooks if needed
- docs and examples
- smoke tests using both topic modes side by side
- file-based config examples and docs
- downstream test-support and package fixture parity

Exit criteria:

- example app demonstrates when to use each topic type
- user-facing docs explain guarantees and limits

## F. Concrete File Plan

### Likely new files

- `src/config/ReliableTopicConfig.ts`
- `src/topic/impl/reliable/ReliableTopicService.ts`
- `src/topic/impl/reliable/ReliableTopicProxyImpl.ts`
- `src/topic/impl/reliable/ReliableTopicMessageRecord.ts`
- `src/topic/impl/reliable/ReliableTopicListenerRunner.ts`
- `test/topic/ReliableTopicService.test.ts`
- `test/topic/ReliableTopicProxyImpl.test.ts`
- `test/topic/ReliableTopicIntegration.test.ts`
- `test/topic/ReliableTopicConfig.test.ts`

### Likely modified files

- `src/instance/impl/HeliosInstanceImpl.ts`
- `src/core/HeliosInstance.ts`
- `src/index.ts`
- `src/config/HeliosConfig.ts`
- `src/config/ConfigLoader.ts`
- `src/topic/impl/DistributedTopicService.ts`
- `src/topic/impl/TopicImpl.ts` or its call sites if classic topic is unified to one runtime path
- `src/test-support/TestHeliosInstance.ts`
- `test/cluster/tcp/MultiNodeTcpIntegrationTest.test.ts`
- `test/instance/HeliosInstanceImplTest.ts`
- `examples/helios-smoke-test.ts`
- `examples/native-app/src/app.ts`
- `examples/native-app/README.md`
- `README.md`

### Possible prerequisite ringbuffer files

- `src/ringbuffer/impl/RingbufferService.ts`
- `src/ringbuffer/impl/RingbufferContainer.ts`
- `src/ringbuffer/impl/operations/AddOperation.ts`
- `src/ringbuffer/impl/operations/ReadOneOperation.ts`
- `src/spi/impl/operationservice/impl/OperationServiceImpl.ts`
- partition/migration hooks under `src/internal/partition/`
- cluster message / runtime files if remote ringbuffer invocation needs explicit protocol additions

### Additional wiring surfaces to review explicitly

- `src/Helios.ts`
- `packages/nestjs/` test fixtures or helper modules that rely on `HeliosInstance`
- any topic-facing examples or README snippets that currently imply only classic live pub/sub semantics

## G. Test Plan

### Unit tests

Classic topic:

- publish with and without global ordering
- ack timeout behavior
- listener removal and destroy
- stats enabled vs disabled
- no runtime recreation after destroy
- single-node `getTopic()` honors the same config and lifecycle contract as clustered topic
- in-flight publish behavior on owner loss is deterministic
- listener exception isolation policy is enforced

Reliable topic:

- publish stores envelope in ringbuffer
- listener starts at configured sequence policy
- listener receives ordered messages
- stale sequence policy is enforced
- remove listener cancels runner
- publish uses ringbuffer-backed storage end to end
- destroy and shutdown cancel all runners and release backing runtime state
- file-based config creates the intended reliable topic behavior

### Multi-node integration tests

- classic topic remote publish reaches remote listener
- classic topic keeps working after peer loss when ordering allows local publish
- classic topic with global ordering enabled has deterministic owner-loss behavior
- reliable topic remote publish reaches remote listener through ringbuffer owner
- reliable topic owner failover preserves unread messages
- reliable topic continues after listener node restart if within retention window
- reliable topic publish durability matches the documented completion contract
- new backup receives ringbuffer state after join

### Soak or resilience tests

- slow listener under sustained producer load
- burst publish with small ringbuffer capacity
- repeated join/leave while listeners are active

## H. Acceptance Criteria

This plan is complete only when all of the following are true:

- `getTopic()` remains green and explicitly documented as classic distributed pub/sub
- classic topic no longer relies on a separate local-only production path
- `getReliableTopic()` no longer throws
- reliable topic is backed by ringbuffer, not local listener arrays
- reliable-listener and plain-listener adaptation semantics are both explicit and tested
- reliable topic has deterministic stale-sequence behavior
- multi-node tests cover publish, consume, failover, and destroy paths
- docs explain when to choose classic topic vs reliable topic
- no `getReliableTopic()` throw stubs remain in repo test-support or fixture implementations
- file-based config can create both classic and reliable topic setups
- public exports are complete for all supported config and topic-facing types introduced by the feature
- shutdown leaves no active reliable-topic runners, timers, or hidden background waits
- destroy semantics are end to end: instance caches, service runtime, listeners, and backing reliable-topic state are all cleaned up according to the documented contract

## I. Recommended Execution Order

1. Harden classic topic first without changing public semantics.
2. Validate ringbuffer wait-notify and failover prerequisites.
3. Add reliable topic config and single-node proxy/service path.
4. Add multi-node publish routing and listener consumption.
5. Add resilience tests, examples, and docs.

## J. Risks

### Risk 1 - Mixing classic and reliable semantics

If classic topic behavior is silently upgraded to reliable behavior, users lose a clear mental model. Keep separate code paths and docs.

### Risk 2 - Incomplete wait-notify support

Reliable listeners depend on blocking ringbuffer reads. If wake-up behavior is incomplete, listeners may stall or spin.

### Risk 3 - Failover looks correct but loses unread messages

Reliable topic must inherit verified ringbuffer replication guarantees, not assumed ones.

### Risk 4 - Listener runners leak after shutdown

Reliable consumers need strict cancellation and cleanup coverage.

## K. Final Recommendation

Treat this as a two-lane delivery:

- lane 1: make classic `ITopic` explicit, stable, and well-tested
- lane 2: add `ReliableTopic` as a separate ringbuffer-backed runtime

That approach preserves the working topic implementation already in the branch while adding the missing durable/replayable path without overloading one service with two incompatible messaging models.
