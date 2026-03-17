> **Status: historical archive** — superseded by the official `hazelcast-client` interop boundary approach.

## Helios Full Hazelcast Implementation Plan

Goal: make Helios a fully Hazelcast-compatible OSS cluster so the official Node.js
`hazelcast-client` connects to it and works exactly like it would against Hazelcast.
No stubs. No deferred items. No local-only shortcuts. Production-ready with sane
Hazelcast defaults.

Target: Hazelcast OSS `5.x` behavior, proven against `hazelcast-client@5.6.x`.

---

## 1. What We Are Building

Helios must behave like a real Hazelcast OSS cluster. That means:

- the official Node.js client connects, discovers the cluster, routes requests to the
  correct partition owner, survives reconnects and migrations, and uses every OSS data
  structure and service with correct semantics
- every member-side operation goes through one authoritative clustered execution path —
  embedded calls and remote client calls use the same code
- defaults match Hazelcast so a minimal client config just works
- multi-node correctness is real: topology, partitions, backups, migrations, retries,
  listeners, near cache, transactions, and failover all work properly

---

## 2. What Already Works

Phase 20 delivered a narrow but real foundation:

- `HeliosClient` with lifecycle, shutdown, config, cluster/partition/listener services
- `ClientMapProxy` (basic CRUD), `ClientQueueProxy` (offer/poll/peek/size/clear),
  `ClientTopicProxy` (publish, listeners, reconnect recovery)
- `ClientScheduledExecutorProxy` (full — Phase 22)
- `NearCachedClientMapProxy` with metadata fetchers and metrics
- member-side `ClientProtocolServer` with auth, session management, dispatch
- binary protocol framing, codecs, config loading (JSON/YAML)

What is not good enough yet:

- single-bootstrap connection, not real smart multi-member routing
- protocol handlers hit local record stores directly instead of clustered operations
- `IList`, `ISet`, `MultiMap`, `ReplicatedMap` are local-only, not distributed
- `ReliableTopic`, `Ringbuffer`, transactions, SQL, executor, JCache, CP, PN counter,
  flake ID, cardinality estimator are missing from the remote client path
- no TLS on the client protocol port
- no proof with the official `hazelcast-client` npm package
- defaults not audited against Hazelcast

---

## 3. Rules

- Hazelcast behavior is the source of truth, not Helios' current shape.
- Every feature must work over real sockets using the official Node.js client.
- Every server-side operation must go through the clustered operation service. Protocol
  handlers decode, validate, dispatch — they do not contain business logic.
- Every accepted config field must have real runtime behavior behind it.
- Every default must be audited from Hazelcast source and deliberately encoded.
- Every feature must have happy-path, failure-path, and multi-node test coverage.

---

## 4. Architecture Principles

### 4.1 One Execution Path

All distributed operations — whether from an embedded member call or a remote client
request — go through one clustered operation/invocation service. Protocol handlers are
thin: decode the request, dispatch the operation, encode the response.

Why: this is how Hazelcast works. It prevents semantic drift between embedded and remote
paths, and it means fixing a bug in the operation fixes it everywhere.

### 4.2 One Partition Model

Every partitioned structure (map, queue, list, set, multimap, etc.) sits on the same
partition service. Ownership, backups, migration, and repair are managed centrally.
Cluster-wide operations fan out across partitions and merge results.

Why: this is how Hazelcast achieves consistent distributed behavior. Ad hoc per-structure
distribution code leads to inconsistencies and bugs.

### 4.3 One Event Model

All listeners — entry listeners, topic listeners, near-cache invalidation, membership
events — go through one event service with central registration, deregistration,
reconnect recovery, ordering, and backpressure.

Why: listeners must survive reconnects and migrations. A central model makes recovery
deterministic instead of per-structure special cases.

### 4.4 One Serialization Model

One serialization service owns all encoding: member-to-member, member-to-client, backup
replication, migration, persistence, query, and SQL payloads. Schema and serializer
metadata is globally consistent.

Why: serialization incompatibilities between paths cause silent data corruption. One
owner prevents that.

### 4.5 No Fake Implementations

- `ReliableTopic` is ringbuffer-backed, not a local listener array.
- `ReplicatedMap` replicates to all members with anti-entropy repair.
- `IList`, `ISet`, `MultiMap` are real partition-owned distributed services.
- Transactions use a real coordinator and transaction log.
- CP primitives use a real consensus design.
- SQL uses a real query engine and cursor lifecycle.
- Executor services serialize tasks, route them to the correct member, execute remotely,
  and support cancellation and failure semantics.

Why: fake implementations pass single-node tests but break in production. The official
client expects real Hazelcast behavior.

---

## 5. Implementation Blocks

### Block A — Freeze The Baseline

**Goal:** lock down exactly what we are targeting so every later block has a clear checklist.

**What to do:**

- pin the compatibility target to `hazelcast-client@5.6.x` and the matching Hazelcast OSS version
- audit the official Node client's public API from its source code
- audit the Hazelcast client protocol definitions (every opcode, event, error code)
- audit every Hazelcast default from source (not docs)
- produce two checked-in artifacts:
  - feature/opcode inventory with Helios owner for each item
  - defaults inventory with current Helios value vs required Hazelcast value

**Why:** without a frozen target, implementation work drifts and compatibility claims
are unverifiable.

**Done when:** every required feature, opcode, and default has a named owner and a gap status.

---

### Block B — Cluster Runtime Core

**Goal:** make the cluster core strong enough to host all Hazelcast semantics correctly.

**What to do:**

1. **Invocation monitor** — replace timeout-only pending-response supervision with a real
   invocation monitor that tracks creation time, target member, required backup count, and
   member-left state. On member removal, fail matching invocations immediately. Handle
   late responses, duplicate responses, and late backup acks safely.

2. **Real backup acks** — wire `BACKUP` and `BACKUP_ACK` into the clustered operation path.
   Track required vs received backup count per invocation. Coordinate primary and backup
   completion. Stop treating all remote successes as zero-backup.

3. **Replica sync** — add correlation IDs to sync requests. Reject stale/duplicate
   responses. Add retry with timeout cleanup. Introduce chunked transfer for large
   partition state. Define deterministic apply/finalize for multi-chunk completion.

4. **Invocation backpressure** — cap in-flight remote invocations per member. Define
   explicit reject/wait/shed policy when limit is hit. Add metrics for throttling.

5. **Smart client topology** — define authoritative protocol contracts for member-list and
   partition-table fetch/update with versioning. Define wrong-target, target-not-member,
   and member-left error semantics. Define refresh triggers for stale topology. Maintain
   active connections keyed by member UUID across the full member set.

6. **Correct invocation routing** — route partition-bound requests using the real partition
   table. Replace all local-record-store shortcuts in protocol handlers with clustered
   operation dispatch. Ensure `MapSize`, `MapClear`, and equivalent operations reflect
   cluster-wide state.

**Why:** every data structure and service depends on the cluster core being correct.
Building features on a weak core means rebuilding them later.

**Done when:**
- multi-node correctness proven under load, migration, restart, and failover
- backup acks are real and coordinated
- replica sync handles retries, stale responses, and large payloads
- remote invocation growth is bounded under stress
- the official client maintains a correct topology view in a 3+ node cluster
- remote operations are correct regardless of which member the client connects to

---

### Block C — Client Protocol Server

**Goal:** make the member-side protocol server complete for the targeted baseline.

**What to do:**

1. **Security** — enforce auth guard before any non-auth handler. Reject unauthenticated
   sessions. Fail on unknown opcodes. Validate cluster identity on reconnect. Add audit
   logging for auth events.

2. **Protocol completeness** — implement every opcode, response, and event required by the
   targeted client line. Implement member-list and partition-table publication. Implement
   wrong-target, retryable, and fatal error responses. Implement protocol version
   negotiation.

3. **TLS** — add TLS listener to the client protocol port. Implement certificate and trust
   configuration. Reject TLS mismatches with explicit errors.

**Why:** the official client expects a complete, secure protocol surface. Missing opcodes
cause client exceptions. Missing security lets unauthenticated requests reach data.

**Done when:**
- no operation executes before successful auth
- the official client can connect, auth, discover the cluster, and maintain a smart view
- all targeted opcodes and events are handled
- TLS works end to end

---

### Block D — Invocation Lifecycle, Listeners, And Near Cache

**Goal:** make request execution, event delivery, and near-cache behavior production-safe.

**What to do:**

1. **Invocation lifecycle** — add per-invocation deadlines. Fail pending invocations on
   connection loss unless retry policy applies. Implement retry classification for
   read-only, mutating, blocking, and listener operations. Add backpressure for in-flight
   requests. Define idempotency rules.

2. **Listener recovery** — require server acknowledgement for registration. Persist
   metadata for reconnect recovery. Add retry/backoff for re-registration. Fail observably
   if recovery cannot complete.

3. **Near-cache correctness** — wire real invalidation listeners over the client protocol.
   Implement metadata fetch, repairing task, and anti-entropy end to end. Prove
   invalidate-on-change under concurrent writes, reconnects, and migrations.

**Why:** without bounded invocation lifecycle, requests hang. Without listener recovery,
events are lost after reconnect. Without correct near-cache invalidation, reads return
stale data.

**Done when:**
- no invocation hangs past its deadline
- listeners re-register deterministically after reconnect
- near-cache is correct under concurrent writes, dropped invalidations, and migrations

---

### Block E — Serialization Compatibility

**Goal:** exact binary compatibility with the targeted baseline.

**What to do:**

- verify and complete all serialization primitives and type IDs
- implement compact schema registration, lookup, caching, and evolution
- implement `Portable`, `IdentifiedDataSerializable`, `DataSerializable`, `GenericRecord`
- verify custom serializer registration and failure behavior
- verify numeric, temporal, and null-handling semantics
- test same payloads against Hazelcast and Helios and compare results

**Why:** serialization incompatibility means data written by the official client cannot be
read by Helios or vice versa. This must be exact.

**Done when:** official-client serialization tests pass unchanged against Helios.

---

### Block F — All Core Data Structures

**Goal:** every core Hazelcast distributed structure fully implemented and accessible from
the official client.

**What to do:**

1. **IMap** — complete full CRUD, TTL, max idle, eviction, entry listeners, predicates,
   indexes, aggregations, entry processors, MapStore, partition-aware behavior, backup,
   near-cache invalidation. Add protocol handlers for every map operation.

2. **IQueue** — add `QueueService`, `QueueContainer`, and all operations with backup
   companions (offer, poll, peek, size, isEmpty, remainingCapacity, remove, contains,
   iterator, drain, addAll, clear). Add wait-notify runtime for blocking operations.
   Add migration replication. Finalize async public API.

3. **ITopic** — route all `getTopic()` through `DistributedTopicService` unconditionally.
   Remove the local-only `TopicImpl` production path. Tighten lifecycle: cleanup on
   destroy/shutdown, handle member loss, prevent resurrection after destroy. Add protocol
   handlers for all topic operations.

4. **ReliableTopic** — implement as `getReliableTopic()` backed by a real ringbuffer.
   Add `ReliableTopicConfig`, `ReliableTopicService`, `ReliableTopicProxyImpl`. Each topic
   maps to one ringbuffer by derived name. Publish completes after owner append + sync
   backup ack. Listeners are sequence consumers with per-registration state. Support
   overflow policies: ERROR, DISCARD_OLDEST, DISCARD_NEWEST, BLOCK.

5. **Ringbuffer** — wire `RingbufferService` into bootstrap, routing, replication,
   migration, and config. Add wait-notify for blocking reads. Add partition ownership and
   backup behavior. Add state transfer for new backup members.

6. **IList** — implement as a real distributed service with `ListService`, partition-owned
   `ListContainer`, operations with backup, and migration replication.

7. **ISet** — implement as a real distributed service with `SetService`, partition-owned
   `SetContainer`, operations with backup, and migration replication.

8. **MultiMap** — implement as a real distributed service with `MultiMapService`,
   partition-owned containers, operations with backup, and migration replication.

9. **ReplicatedMap** — implement with `ReplicatedMapService` using anti-entropy
   replication to all members and repair behavior for stale replicas.

10. **ICache** — implement server-side cache service, operations, protocol handlers, and
    near-cache support as required by the targeted OSS baseline.

Add client protocol handlers for every operation of every structure.

**Why:** these are the core value of Hazelcast. The official client exposes all of them.
Local-only substitutes break in multi-node clusters and are incompatible with the
official client's expectations.

**Done when:** official-client suites for all structures pass against a multi-node cluster.

---

### Block G — Advanced Services

**Goal:** query, compute, transaction, and SQL services fully implemented.

**What to do:**

1. **Map query and processing** — complete predicate execution on partition owners with
   index support. Complete aggregations with paging. Complete entry processor execution
   with result merge. Implement query cache if in the targeted baseline.

2. **Executor service** — make executor operations truly remote and service-backed.
   Register member-local executor container service. Route tasks to partition owners or
   targeted members. Implement cancellation, timeout, shutdown, and task-lost semantics.
   Support worker-materializable task registration. Add multi-node integration tests.

3. **Scheduled executor** — already done (Phase 22). Maintain and extend protocol handlers
   as needed for the official client.

4. **Transactions** — implement a real transaction coordinator with transaction log,
   one-phase and two-phase commit flows, rollback, timeout, and recovery. Implement
   transactional proxies for map, queue, list, set, and multimap.

5. **SQL** — implement a real query engine with cursor lifecycle, result paging,
   cancellation, and failure semantics.

Add client protocol handlers for all advanced service operations.

**Why:** the official client exposes executor, transaction, and SQL APIs. Users expect
them to work. Hazelcast OSS includes all of these.

**Done when:** advanced official-client scenarios work with correct Hazelcast semantics.

---

### Block H — Utility Primitives

**Goal:** all OSS utility services that the official client exposes.

**What to do:**

- **CP subsystem** — implement the pieces required by the targeted baseline using a real
  consensus design, not AP approximations
- **PN counter** — implement with real CRDT merge/conflict model
- **Flake ID generator** — implement with proper ordering and uniqueness semantics
- **Cardinality estimator** — implement with proper HyperLogLog error-bound semantics
- any other OSS primitive exposed by the targeted client line

Add client protocol handlers for all utility operations.

**Why:** the official client has APIs for these. If they are missing, client code throws.

**Done when:** the official client can use all utility primitives without stubs or errors.

---

### Block I — Config And Defaults Alignment

**Goal:** Helios feels normal to use from the official client with minimal or no tuning.

**What to do:**

- audit every Hazelcast default from upstream source code (not just docs)
- align: cluster name (`dev`), default port (`5701`), connection timeout, cluster connect
  timeout, heartbeat interval/timeout, smart routing mode, invocation timeout, retry/redo
  policy, reconnect behavior, near-cache repair cadence, serialization number handling,
  socket options, TLS defaults, listener recovery defaults, transaction timeout, SQL
  cursor page size
- validate config strictly: accepted fields must work, unsupported fields must fail at
  startup with a clear error
- support server-side behavior for normal client config flows (discovery, routing, labels)

**Why:** if defaults are wrong, the official client misbehaves or times out even when
everything is technically implemented. Sane defaults are part of compatibility.

**Done when:** a minimally configured official client works correctly without Helios-
specific tuning.

---

### Block J — Observability And Hardening

**Goal:** production failures are diagnosable and the system survives real-world churn.

**What to do:**

- expose metrics for topology, connections, invocations, retries, timeouts, listeners,
  near cache, transactions, SQL, serialization, and executor services
- add structured logs for auth, topology changes, routing corrections, retries,
  disconnects, reconnects, listener recovery, and protocol errors
- test version negotiation and incompatibility behavior
- bound in-flight requests, listener queues, and reconnect storms
- prove shutdown drains cleanly without leaking connections or pending work
- add chaos, soak, rolling-restart, and migration-under-load tests

**Why:** without observability, production failures are black boxes. Without hardening,
the system breaks under real-world conditions that unit tests do not cover.

**Done when:** an operator can explain any client-visible failure from metrics and logs.

---

### Block K — Official Client Interop Proof

**Goal:** the official `hazelcast-client` npm package is the final judge of compatibility.

**What to do:**

- add a dedicated test workspace that installs the exact targeted `hazelcast-client`
- write acceptance suites using only the official client API:
  - happy-path: single-member, 3-node smart-client, full data structure coverage
  - correctness: owner routing, partition migration, listener recovery, near-cache repair,
    transactions, SQL cursors, serialization evolution
  - failure: wrong cluster, auth failure, TLS mismatch, member restart, rolling restart,
    network loss, overload, version mismatch
  - long-running: soak, topology churn, rolling restart under load
- compare key behaviors against a real Hazelcast cluster where useful
- make interop CI blocking for releases
- update docs and examples to show the official-client story

**Why:** testing Helios against itself only proves internal consistency. Testing against
the official client proves real compatibility. If the official client works, users can
adopt Helios without changing their application code.

**Done when:** Helios releases cannot go green unless official-client interop is green.

---

## 6. Execution Order

1. Block A — freeze the baseline
2. Block B — cluster runtime core
3. Block C — client protocol server
4. Block D — invocation lifecycle, listeners, near cache
5. Block E — serialization compatibility
6. Block F — all core data structures
7. Block G — advanced services
8. Block H — utility primitives
9. Block I — config and defaults
10. Block J — observability and hardening
11. Block K — official client interop proof

This order matters. Data structures depend on a correct cluster core. Advanced services
depend on correct data structures. Interop proof depends on everything else being done.

---

## 7. Done

The plan is complete when all of the following are true:

- the official `hazelcast-client` connects to a 3+ node Helios cluster and works
- every targeted OSS feature is implemented end to end with no stubs
- cluster core, protocol, serialization, routing, backups, and migrations are correct
- all data structures are real distributed services, not local-only containers
- transactions, SQL, executor, and utility services work with Hazelcast semantics
- defaults are audited and aligned
- TLS, metrics, and diagnostics are production-ready
- interop CI is green and blocking

Only then: "Helios fully implements the targeted Hazelcast OSS baseline and supports
the official Node.js Hazelcast client."

---

## 8. First Steps

1. Pin the exact Hazelcast OSS and `hazelcast-client` versions
2. Audit the upstream feature surface and defaults from source
3. Replace protocol handler shortcuts with clustered operation dispatch
4. Finish topology and partition metadata publication
5. Turn local-only structures into real distributed services
6. Set up the official-client interop test workspace
