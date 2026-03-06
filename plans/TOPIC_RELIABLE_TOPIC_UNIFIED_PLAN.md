# Topic + ReliableTopic Unified Implementation Plan

## Goal

Define a single execution plan for finishing Helios topic messaging in v1 by:

- hardening classic `ITopic` as the default distributed pub/sub primitive
- implementing `getReliableTopic()` on a real ringbuffer-backed path
- aligning config, runtime wiring, tests, and docs so both topic modes are production-usable

This plan supersedes the topic-only parts of `plans/DISTRIBUTED_QUEUE_TOPIC_PLAN.md`.

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

### A2. Tighten lifecycle and failure behavior

Add tests and code paths for:

- listener cleanup on shutdown and destroy
- member-loss behavior while publishing
- publish timeout / owner-loss recovery when global ordering is enabled
- duplicate suppression expectations, if any, during peer churn

### A3. Clarify config contract

`TopicConfig` should remain the config surface for classic topic and clearly own:

- global ordering
- statistics enabled
- multi-threaded listener behavior if introduced later

If a behavior belongs only to reliable topic, it must not leak into `TopicConfig`.

## B. Reliable Topic architecture

Reliable topic should be implemented as a dedicated ringbuffer-backed path.

### B1. Public API decision

Keep `HeliosInstance.getReliableTopic<E>(name: string): ITopic<E>` as the public entrypoint for v1.

Internally introduce reliable-specific types where needed, for example:

- `ReliableTopicConfig`
- `ReliableTopicService`
- `ReliableTopicProxyImpl`
- `ReliableTopicRunner` or listener-consumer loop

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

### B3. Listener model

Reliable listeners should run as sequence consumers:

- each registration starts from a configured initial sequence position
- each listener tracks its own next sequence
- reads use ringbuffer read operations
- when no item is available, the listener waits and resumes when new data arrives

Important: listener execution must not block the core transport thread.

### B4. Overflow and loss policy

Reliable topic must define what happens when a listener falls behind and its next sequence becomes stale.

Introduce config for this decision, for example:

- `topicOverloadPolicy: "FAIL" | "SKIP_OLDEST" | "BLOCK"`
- `readBatchSize`
- `initialSequencePolicy: "TAIL" | "HEAD"`

Recommended v1 minimum:

- support `TAIL` startup behavior by default
- on stale sequence, fail the listener with a deterministic error and remove registration unless config says otherwise

### B5. Service ownership

Reliable topic should not be hidden inside `DistributedTopicService`.

Instead:

- keep classic topic in `DistributedTopicService`
- add `ReliableTopicService` for ringbuffer-backed topic runtime
- let `HeliosInstanceImpl` own both service references and wire the correct proxy per accessor

## C. Ringbuffer integration requirements

### C1. Public access and wiring

One of these must happen:

1. add `getRingbuffer()` to `HeliosInstance`, or
2. keep ringbuffer internal and let `ReliableTopicService` use `RingbufferService` directly

Recommendation for v1:

- keep ringbuffer internal for now unless another feature already needs public exposure

This reduces public API surface while still allowing reliable topic implementation.

### C2. Wait-notify correctness

Reliable listener polling depends on ringbuffer reads that can wait for future items.

Before reliable topic is considered done, verify that the current operation runtime correctly supports:

- read-one waiting when sequence is `tail + 1`
- wake-up on ringbuffer add
- cancellation on topic destroy / member shutdown

If generic wait-notify support is still partial, close that gap before enabling reliable listeners in production.

### C3. Partition ownership and backup behavior

Reliable topic durability is only as strong as ringbuffer replication.

Verify and test:

- primary/backup replication of ringbuffer content
- owner promotion after shutdown
- continued reads from promoted backup
- writes after promotion

If ringbuffer failover is not yet fully proven, add that as a prerequisite sub-phase.

## D. Config model

Introduce `src/config/ReliableTopicConfig.ts` with at least:

- `name`
- `topicOverloadPolicy`
- `readBatchSize`
- `statisticsEnabled`
- `initialSequencePolicy`
- `ringbufferName` override or derived default

And extend `HeliosConfig` with:

- `addReliableTopicConfig(...)`
- `getReliableTopicConfig(name)`

Config rules:

- missing reliable-topic config falls back to sensible defaults
- classic `TopicConfig` and `ReliableTopicConfig` stay independent
- if both exist for the same logical name, behavior is explicit and documented rather than merged implicitly

## E. Implementation Phases

### Phase 1 - Stabilize classic topic

Deliverables:

- define and document current classic topic guarantees
- add tests for destroy, shutdown, peer loss, and ordering boundaries
- clean up any ambiguous timeout/ack behavior in `DistributedTopicService`

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

Exit criteria:

- `getReliableTopic()` returns a real object
- single-node publish/listen works on ringbuffer backing
- no throw path remains in public API

### Phase 3 - Implement listener sequence consumption

Deliverables:

- per-listener registration state
- background consumption loop
- stale sequence handling
- destroy/removal/cancellation logic

Exit criteria:

- listeners receive ringbuffer-backed messages in order
- slow-consumer stale sequence path is deterministic and tested
- listener removal stops polling cleanly

### Phase 4 - Multi-node reliable topic

Deliverables:

- publish routing to ringbuffer owner
- cross-node listener consumption
- owner failover and continued publish/read behavior

Exit criteria:

- multi-node integration tests prove remote publish and remote listener delivery
- failover tests prove promoted owner continues serving the topic

### Phase 5 - Production hardening

Deliverables:

- local stats for reliable topic
- metrics hooks if needed
- docs and examples
- smoke tests using both topic modes side by side

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

### Likely modified files

- `src/instance/impl/HeliosInstanceImpl.ts`
- `src/core/HeliosInstance.ts`
- `src/index.ts`
- `src/config/HeliosConfig.ts`
- `src/topic/impl/DistributedTopicService.ts`
- `test/cluster/tcp/MultiNodeTcpIntegrationTest.test.ts`
- `examples/helios-smoke-test.ts`
- `README.md`

### Possible prerequisite ringbuffer files

- `src/ringbuffer/impl/RingbufferService.ts`
- `src/ringbuffer/impl/RingbufferContainer.ts`
- `src/ringbuffer/impl/operations/AddOperation.ts`
- `src/ringbuffer/impl/operations/ReadOneOperation.ts`
- `src/spi/impl/operationservice/impl/OperationServiceImpl.ts`

## G. Test Plan

### Unit tests

Classic topic:

- publish with and without global ordering
- ack timeout behavior
- listener removal and destroy
- stats enabled vs disabled

Reliable topic:

- publish stores envelope in ringbuffer
- listener starts at configured sequence policy
- listener receives ordered messages
- stale sequence policy is enforced
- remove listener cancels runner

### Multi-node integration tests

- classic topic remote publish reaches remote listener
- classic topic keeps working after peer loss when ordering allows local publish
- reliable topic remote publish reaches remote listener through ringbuffer owner
- reliable topic owner failover preserves unread messages
- reliable topic continues after listener node restart if within retention window

### Soak or resilience tests

- slow listener under sustained producer load
- burst publish with small ringbuffer capacity
- repeated join/leave while listeners are active

## H. Acceptance Criteria

This plan is complete only when all of the following are true:

- `getTopic()` remains green and explicitly documented as classic distributed pub/sub
- `getReliableTopic()` no longer throws
- reliable topic is backed by ringbuffer, not local listener arrays
- reliable topic has deterministic stale-sequence behavior
- multi-node tests cover publish, consume, failover, and destroy paths
- docs explain when to choose classic topic vs reliable topic

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
