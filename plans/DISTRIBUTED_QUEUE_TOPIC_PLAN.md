# Distributed IQueue + ITopic Plan

## Goal

Promote `IQueue` and `ITopic` from local-only placeholders to real cluster-backed
distributed objects in `../helios`.

For the trading rewrite, the intended split is:

- `IQueue` for single-consumer work distribution
- `ITopic` for fan-out notifications
- `IExecutorService + IMap` for keyed owner execution and durable workflow state

This plan focuses on the missing queue/topic primitives only.

**Repo:** `/Users/zenystx/IdeaProjects/helios/`
**Java reference:** `/Users/zenystx/IdeaProjects/helios-1/` (read-only)

---

## Current Helios Reality

The public surface already claims distributed queue/topic support, but the current runtime is
still local-only for both structures.

### Verified current state

- `src/instance/impl/HeliosInstanceImpl.ts` registers only `MapService` with the node engine.
- `src/instance/impl/HeliosInstanceImpl.ts` creates queues with `new QueueImpl()` in
  `getQueue()` and topics with `new TopicImpl()` in `getTopic()`.
- `src/collection/impl/QueueImpl.ts` explicitly describes itself as an "In-memory single-node
  IQueue implementation".
- `src/topic/impl/TopicImpl.ts` explicitly describes itself as an "In-memory single-node
  ITopic implementation".
- `src/instance/impl/HeliosInstanceImpl.ts` has no public `getRingbuffer()` accessor even
  though `src/ringbuffer/impl/RingbufferService.ts` and ringbuffer operations already exist.
- `src/spi/impl/operationservice/impl/OperationServiceImpl.ts` currently executes operations
  by calling `beforeRun()` and `run()` directly; it does not honor `CallStatus.WAIT` or a
  generic wait/notify contract yet.
- `src/` currently has no cluster event-service implementation analogous to Hazelcast's
  `EventService`, which classic topic fan-out depends on.

### Consequence

Today:

- `IQueue` cannot scale out across members
- `ITopic` cannot fan out across members
- queue blocking semantics are not backed by the runtime
- topic ordering and listener distribution are not backed by the runtime

---

## Hazelcast Reference Model

### Queue reference path

Hazelcast's queue is a partition-owned distributed object.

Primary reference files:

- `helios-1/hazelcast/src/main/java/com/hazelcast/collection/impl/queue/QueueService.java`
- `helios-1/hazelcast/src/main/java/com/hazelcast/collection/impl/queue/QueueProxySupport.java`
- `helios-1/hazelcast/src/main/java/com/hazelcast/collection/impl/queue/QueueProxyImpl.java`
- `helios-1/hazelcast/src/main/java/com/hazelcast/collection/impl/queue/QueueContainer.java`
- `helios-1/hazelcast/src/main/java/com/hazelcast/collection/impl/queue/operations/OfferOperation.java`
- `helios-1/hazelcast/src/main/java/com/hazelcast/collection/impl/queue/operations/PollOperation.java`
- `helios-1/hazelcast/src/main/java/com/hazelcast/collection/impl/queue/operations/QueueReplicationOperation.java`

Key Hazelcast properties to preserve:

- queue name determines partition ownership
- all mutating queue operations route to that partition owner
- backup operations replicate queue state to replicas
- migration replicates the whole queue container
- blocking `offer` / `poll` use wait-notify keys
- listeners receive added/removed item events

### Topic reference path

Hazelcast has two distinct topic paths:

1. classic topic via event service
2. reliable topic via ringbuffer

Primary reference files:

- `helios-1/hazelcast/src/main/java/com/hazelcast/topic/impl/TopicService.java`
- `helios-1/hazelcast/src/main/java/com/hazelcast/topic/impl/TopicProxy.java`
- `helios-1/hazelcast/src/main/java/com/hazelcast/topic/impl/PublishOperation.java`
- `helios-1/hazelcast/src/main/java/com/hazelcast/topic/impl/reliable/ReliableTopicProxy.java`

Key Hazelcast properties to preserve:

- classic topic = fan-out to all listeners, not work distribution
- reliable topic = ringbuffer-backed listener consumption with sequence tracking
- total ordering is a separate concern from basic pub/sub

---

## Architectural Decision

### 1. Implement distributed `IQueue` first

For command-style work distribution, queue semantics are the best match of the two missing
primitives.

`IQueue` should become:

- partition-owned by queue name
- operation-routed through `OperationService`
- backup-aware
- migration-aware
- blocking for timed `offer` / `poll`

### 2. Implement topic on the reliable path first

For Helios, the best scalable topic path is not the current local listener-array model.
It is a ringbuffer-backed topic.

Reason:

- Helios already has meaningful ringbuffer internals in `src/ringbuffer/impl/*`
- Helios does not yet have a real cluster event service in `src/`
- a reliable topic is a better fit for cluster fan-out than the current single-node `TopicImpl`

### 3. Do not use topic as a queue substitute

Even after this plan lands:

- use `IQueue` for one-consumer command distribution
- use `ITopic` for fan-out notifications
- use `IExecutorService + IMap` for owner-routed execution workflows

`ITopic` should not become the new outbound command bus.

---

## Scope Decision

This plan intentionally splits delivery into two tracks.

### In scope for the first real delivery

- distributed `IQueue`
- runtime wait-notify support needed by queue blocking operations
- ringbuffer-backed cluster topic path
- service registration and distributed-object wiring for queue/topic/ringbuffer
- multi-node tests proving non-local behavior

### Explicitly deferred from the first delivery

- queue store / queue persistence
- transactional queue
- classic Hazelcast event-service topic parity
- total-ordered classic topic
- split-brain merge policies for queue/topic

Those are real features, but they are not required to replace the current single-node stubs.

---

## Runtime Gaps That Must Close First

### Gap A - Service registration and distributed object wiring

Current Helios instance boot only registers map services. Queue/topic/ringbuffer need
real service lifecycles and distributed-object factories.

Files that will need changes:

- `src/instance/impl/HeliosInstanceImpl.ts`
- `src/spi/impl/NodeEngineImpl.ts`
- `src/core/HeliosInstance.ts`
- `src/spi/NodeEngine.ts`

### Gap B - Generic wait-notify runtime

Queue `offer(timeout)` and `poll(timeout)` require a real wait-notify mechanism.
The current operation runtime does not expose it yet.

Files that will need changes:

- `src/spi/impl/operationservice/impl/OperationServiceImpl.ts`
- `src/spi/impl/operationservice/Operation.ts`
- new wait-notify support under `src/spi/impl/operationservice/`

Important note:

- ringbuffer operations already model `CallStatus.WAIT` and wait-notify keys
- the runtime simply does not honor those contracts generically yet

So this work helps both queue and ringbuffer-backed topic paths.

### Gap C - Public config surface

Helios currently has no `QueueConfig` or `TopicConfig` classes in `src/config/`.

Minimum additions:

- `src/config/QueueConfig.ts`
- `src/config/TopicConfig.ts`
- optional `src/config/ReliableTopicConfig.ts` if the API stays separate

---

## Recommended Delivery Order

## Phase 1 - Distributed Queue Runtime

### 1.1 Add queue config and service skeleton

Create:

- `src/config/QueueConfig.ts`
- `src/collection/impl/queue/QueueService.ts`
- `src/collection/impl/queue/QueueContainer.ts`
- `src/collection/impl/queue/QueueItem.ts`
- `src/collection/impl/queue/QueueWaitNotifyKey.ts`

Responsibilities:

- own queue containers keyed by queue name
- derive partition ownership from queue name
- hold queue config and capacity rules
- expose migration-replication hooks

### 1.2 Add queue operations and backup operations

Create operation classes under `src/collection/impl/queue/operations/` mirroring the Hazelcast
shape where it matters:

- `OfferOperation`
- `PollOperation`
- `PeekOperation`
- `SizeOperation`
- `IsEmptyOperation`
- `RemainingCapacityOperation`
- `RemoveOperation`
- `ContainsOperation`
- `IteratorOperation`
- `DrainOperation`
- `AddAllOperation`
- `CompareAndRemoveOperation`
- `ClearOperation`

Backup companions where needed:

- `OfferBackupOperation`
- `PollBackupOperation`
- `RemoveBackupOperation`
- `DrainBackupOperation`
- `AddAllBackupOperation`
- `CompareAndRemoveBackupOperation`
- `ClearBackupOperation`

Use existing backup runtime pieces already present in Helios:

- `src/spi/impl/operationservice/BackupAwareOperation.ts`
- `src/spi/impl/operationservice/OperationBackupHandler.ts`
- `src/spi/impl/operationservice/operations/Backup.ts`

### 1.3 Add queue proxy and public accessor wiring

Create:

- `src/collection/impl/queue/QueueProxySupport.ts`
- `src/collection/impl/queue/QueueProxyImpl.ts`

Change:

- `src/instance/impl/HeliosInstanceImpl.ts`

Replace:

- current direct `new QueueImpl()` path in `getQueue()`

With:

- service-backed proxy creation
- same-name idempotent caching
- real partition-routed invocation

### 1.4 Add queue migration replication

Create:

- `src/collection/impl/queue/operations/QueueReplicationOperation.ts`

Add queue service hooks for:

- prepare replication operation for a partition+replica index
- commit migration cleanup
- rollback migration cleanup

This should follow the same general partition migration rules already used by map/ringbuffer
subsystems.

### 1.5 Add runtime wait-notify support

The queue cannot be correct without this.

Create runtime pieces under `src/spi/impl/operationservice/`:

- `BlockingOperation.ts`
- `Notifier.ts`
- `WaitNotifyKey.ts`
- `WaitSet.ts`
- `WaitNotifyService.ts`

Upgrade `OperationServiceImpl` so it can:

- detect operations that should wait
- park them under a `WaitNotifyKey`
- expire timed waits deterministically
- wake parked operations when notifier operations complete

This runtime work should be shared by queue and ringbuffer operations.

### 1.6 Phase 1 exit gate

`IQueue` is considered real only when all of these pass:

- offering on node A is visible when polling from node B
- blocking `poll(timeout)` unblocks when another node offers
- queue state survives owner migration through replica promotion
- backup copies receive primary mutations
- non-local queue operations do not use local-only shortcuts

---

## Phase 2 - Ringbuffer-Backed Topic

### 2.1 Expose ringbuffer publicly enough to support reliable topic

Helios already has the core ringbuffer engine, but it is not exposed through the public
instance surface.

Minimum work:

- add a public/public-enough ringbuffer proxy surface
- register `RingbufferService` with the node engine during instance boot
- wire distributed-object creation instead of leaving ringbuffer as internal-only code

Likely files:

- `src/ringbuffer/` public interfaces
- `src/instance/impl/HeliosInstanceImpl.ts`
- `src/core/HeliosInstance.ts`

### 2.2 Replace local `TopicImpl` with a ringbuffer-backed topic path

Create:

- `src/topic/impl/reliable/ReliableTopicProxy.ts`
- `src/topic/impl/reliable/ReliableMessageRunner.ts`
- `src/topic/impl/reliable/ReliableTopicMessage.ts`
- `src/topic/impl/reliable/ReliableMessageListenerAdapter.ts`
- `src/topic/impl/reliable/ReliableTopicService.ts`

The implementation should follow the Hazelcast reliable-topic model conceptually:

- publish appends to a ringbuffer
- each listener tracks its own sequence cursor
- listeners resume from the next sequence instead of relying on in-memory callback arrays
- backpressure/overflow policy is explicit

### 2.3 Decide public API shape

There are two valid options. Pick one explicitly before coding.

Option A:

- `getTopic()` becomes ringbuffer-backed by default
- simpler for callers
- semantic change from the current local topic stub, but acceptable because the current stub is not
  a real distributed topic anyway

Option B:

- keep `getTopic()` for future classic topic
- add `getReliableTopic()` now
- cleaner Hazelcast parity, but larger public API surface immediately

Recommendation:

- use Option B if strict Hazelcast parity matters
- use Option A if the primary goal is to ship a real scalable topic primitive quickly

### 2.4 Defer classic topic unless it is truly required

Classic Hazelcast topic depends on a proper cluster `EventService` and ordering locks.
That is a larger runtime feature than the current Helios ringbuffer path.

If classic topic is needed later, implement it separately with:

- `src/topic/impl/TopicService.ts`
- `src/topic/impl/TopicProxy.ts`
- `src/topic/impl/PublishOperation.ts`
- new cluster event-service runtime

But do not block the distributed queue delivery on that larger event-service project.

### 2.5 Phase 2 exit gate

The topic path is considered real only when all of these pass:

- publishing on node A is consumable by listeners on node B and C
- listener cursors survive normal cluster churn without duplicate local callbacks
- overload behavior is explicit and tested
- the implementation no longer depends on `TopicImpl`'s local listener map

---

## Phase 3 - Integration and Contract Cleanup

### 3.1 Update README and examples

After queue/topic are truly distributed:

- fix or confirm the data-structure table in `README.md`
- add one real multi-node queue example
- add one real multi-node topic example

### 3.2 Add end-to-end tests

Minimum integration coverage:

#### Queue

- two-node offer/poll
- three-node owner migration with backup promotion
- blocking poll wake-up from another node
- offer rejected when queue capacity is full
- drain/clear behavior across members

#### Topic / reliable topic

- publish on one node, consume on all nodes
- two listeners with independent cursors
- listener removal stops further delivery
- overflow policy behavior under bounded capacity

### 3.3 Re-evaluate outbound-flow fit

After both primitives are real, document the right usage in Helios terms:

- commands -> `IQueue` or `IExecutorService + IMap`
- fan-out events -> topic
- keyed execution -> executor

---

## Recommendation For The Trading Rewrite

Even after this plan lands, the recommended architecture for the trading backend remains:

- keyed execution -> `IExecutorService`
- durable workflow state -> `IMap`
- optional work queue when true queue semantics are needed -> `IQueue`
- fan-out updates -> topic

That gives the cleanest separation:

- `IQueue` solves work distribution
- `ITopic` solves fan-out
- neither has to impersonate a Redis stream

---

## Concrete First Milestone

Ship this first before attempting full topic parity:

1. `QueueConfig`
2. `QueueService` + `QueueContainer`
3. `OfferOperation` + `PollOperation` + backup ops
4. wait-notify runtime support
5. `QueueProxyImpl`
6. multi-node queue tests

That milestone alone gives Helios a real scale-out work-distribution primitive and removes the
current single-node queue limitation cleanly.
