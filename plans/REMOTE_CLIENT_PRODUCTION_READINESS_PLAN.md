> **Status: historical archive** — superseded; Helios no longer ships a proprietary remote client.

## Helios Remote Client Production Readiness Plan

Goal: make the Helios remote client stack truly end-to-end production ready for multi-node clusters for the supported remote-client feature subset, with honest Hazelcast parity claims only where feature, semantics, correctness, and operational behavior are actually present.

Primary references:

- `/Users/zenystx/IdeaProjects/helios/src/client/**`
- `/Users/zenystx/IdeaProjects/helios/src/server/clientprotocol/**`
- `/Users/zenystx/IdeaProjects/helios/src/instance/impl/HeliosInstanceImpl.ts`
- `/Users/zenystx/IdeaProjects/helios-1/hazelcast/src/main/java/com/hazelcast/client/**`
- `/Users/zenystx/IdeaProjects/helios-1/hazelcast/src/main/java/com/hazelcast/client/impl/**`

This plan does not assume the current remote client is already production ready. It starts from the audited reality: the current stack is a usable narrow client foundation, but not yet a release-grade smart client for multi-node production use.

---

## 0. Non-Negotiable Honesty Rules

- No parity claim is allowed on the basis of API shape alone.
- No feature counts as delivered unless it is proven through the real remote socket path.
- No multi-node readiness claim is allowed while the remote client uses bootstrap-only topology assumptions.
- No near-cache readiness claim is allowed while remote invalidation and repair are partial or placeholder.
- No production readiness claim is allowed while unauthenticated protocol requests can reach data operations.
- No benchmark comparison against Hazelcast is valid until Helios uses a comparably real external-client topology.

Release gate definition:

- a separate Bun process can connect to a 3+ node cluster over the binary client protocol,
- authenticate correctly,
- discover the cluster,
- maintain correct topology and partition routing,
- survive disconnects and reconnects,
- preserve listener and near-cache correctness,
- execute supported distributed-object operations with correct cluster semantics,
- expose operational metrics,
- and pass real multi-node external-client acceptance suites.

---

## 1. Current Audit Summary

### 1.1 What is real today

- Remote client entrypoint, packaging, and basic lifecycle exist in `src/client/HeliosClient.ts`.
- Basic remote map, queue, and topic operations exist.
- Binary client protocol framing, authentication, and a minimal connection manager exist.
- Separate-process examples exist and pass narrow happy-path coverage.

### 1.2 What is not production ready

- The client is effectively single-connection bootstrap mode, not a smart multi-member client.
- Member discovery and partition ownership are bootstrap simplifications, not live cluster state.
- Invocation routing is not truly owner-aware in multi-node mode.
- Member-side map protocol handlers operate on local record stores directly instead of routing through authoritative clustered owner execution.
- Remote near-cache invalidation and repair are incomplete.
- Timeout/retry/disconnect semantics are incomplete.
- Observability is too thin for production operation.
- Feature parity is far below Hazelcast client parity.

### 1.3 Severity-ranked blockers

P0 blockers:

- unauthenticated request handling must be impossible on the client protocol path
- multi-node remote map correctness must be fixed
- real member/partition topology must replace bootstrap shortcuts

P1 blockers:

- reconnect, pending invocation, and listener recovery semantics
- remote near-cache invalidation correctness
- operational telemetry and failure visibility

P2 blockers:

- broader client feature parity
- benchmark parity harness over the real remote-client path

---

## 2. Production-Ready Target State

Production readiness here means correctness and operability for supported remote-client features. It does not imply full Hazelcast feature parity.

When this plan is complete, the remote client should operate as a production-safe multi-member client for the supported Helios feature subset:

- multiple member connections are possible and normal
- cluster member view is real and updated
- partition table is real and updated
- invocations route to the correct owner or target member
- unsupported features fail explicitly and immediately
- disconnects fail or retry invocations according to clear policy
- listeners re-register and recover deterministically
- near-cache invalidations are delivered and repaired correctly
- auth is enforced for every non-auth request
- metrics/logging make client behavior explainable in production
- stale-topology and wrong-target failures trigger bounded refresh-and-retry behavior where policy allows

This target state does not require full Hazelcast feature parity up front. It does require that every feature Helios claims for the remote client be correct and operationally safe.

---

## 3. Workstreams

### Workstream R0 - Security Hardening First

Goal: close any protocol-level security holes before expanding capability.

Problems to fix:

- authenticated session state exists, but dispatch enforcement must be guaranteed for every non-auth opcode
- unsupported or malformed requests must produce explicit rejection and session handling behavior
- auth failure paths must be observable and test-covered

Primary files:

- `src/server/clientprotocol/ClientProtocolServer.ts`
- `src/server/clientprotocol/ClientSession.ts`
- `src/server/clientprotocol/ClientMessageDispatcher.ts`
- `src/client/impl/protocol/codec/ClientAuthenticationCodec.ts`

Tasks:

- enforce auth guard in the central dispatch path before any non-auth handler executes
- reject and optionally close unauthenticated sessions on illegal message types
- fail closed on unknown or illegal opcodes with explicit error/close policy
- forbid re-auth on already-authenticated sessions unless the protocol explicitly supports it
- validate cluster identity on reconnect and fail loudly on mismatch
- add malformed-frame, unknown-opcode, and auth-bypass regression coverage
- add audit logging or structured counters for auth success/failure/rejection

Done gate:

- no map/queue/topic operation can execute before successful auth
- unknown-opcode, malformed-frame, pre-auth non-auth, and auth-bypass socket tests pass over real sockets

---

### Workstream R0.5 - Server Protocol Contract And Metadata Foundation

Goal: make server-side client protocol contracts explicit before building smart-client behavior on top of them.

Current gap:

- topology, partition metadata, and wrong-target recovery dependencies are currently implicit
- the client plan depends on member-side protocol surfaces that are not yet treated as a first-class release contract

Primary files:

- `src/server/clientprotocol/**`
- `src/instance/impl/HeliosInstanceImpl.ts`
- client-protocol codecs and tasks used for member/partition metadata

Tasks:

- define the authoritative protocol contract for member-list fetch/update
- define the authoritative protocol contract for partition-table fetch/update and versioning
- define wrong-target, target-not-member, and member-left error semantics
- define client refresh triggers for stale topology and partition ownership changes
- define mixed-version/client-server compatibility expectations for the protocol surface

Done gate:

- protocol docs/code define member-list, partition-table, and wrong-target semantics unambiguously
- topology metadata has a versioned contract with explicit refresh triggers and tests
- mixed-version incompatibility fails explicitly rather than degrading silently

---

### Workstream R1 - Smart Client Topology And Connections

Goal: replace single-bootstrap behavior with real client topology management.

Current gap:

- `ClientConnectionManager` connects to the first reachable member and stops
- no all-member discovery and no maintained connection set

Primary files:

- `src/client/connection/ClientConnectionManager.ts`
- `src/client/connection/ClientConnection.ts`
- `src/client/spi/ClientClusterService.ts`
- `src/client/spi/ClientPartitionService.ts`
- member-side client protocol handlers for cluster/partition metadata

Tasks:

- define smart-client connection policy: bootstrap, discover, connect-to-many, prune-dead
- add member-list fetch/update protocol and event handling
- add partition-table fetch/update protocol and event handling
- maintain active connections keyed by member UUID
- make reconnect restore the real connection set, not just one socket
- define client behavior for lite members, data members, and owner loss
- expose topology metrics and structured logs for member discovery, member loss, and connection-state transitions

Done gate:

- client connected to a 3-node cluster converges to the real member set within a bounded interval
- client maintains correct topology after member add/remove and exposes the transition in metrics/logs
- partition table version changes propagate monotonically to the client runtime

---

### Workstream R2 - Correct Invocation Routing And Cluster Semantics

Goal: make remote operations correct in multi-node clusters.

Current gap:

- client partition routing is bootstrap-simplified
- invocation routing ignores real ownership
- member-side map handlers do local-store access instead of authoritative clustered owner execution

Primary files:

- `src/client/invocation/ClientInvocationService.ts`
- `src/client/proxy/ClientProxy.ts`
- `src/client/proxy/ClientMapProxy.ts`
- `src/instance/impl/HeliosInstanceImpl.ts`
- relevant map operation / operation-service classes under `src/map/**` and `src/spi/**`

Tasks:

- route partition-bound requests using the real partition table
- add explicit target-member routing where needed
- implement wrong-target, target-not-member, and stale-owner refresh-and-retry behavior
- replace member-side local-record-store shortcuts with real clustered execution path usage
- ensure `MapSize`, `MapClear`, and related operations reflect cluster-wide semantics, not local-member semantics
- ensure queue/topic/client-protocol handlers follow the same rule: no member-local shortcut that changes semantics

Done gate:

- remote map operations on a 3-node cluster are correct regardless of which member the client is connected to
- member-side protocol handlers use the same authoritative clustered semantics as embedded/member calls
- multi-node correctness tests prove owner-routing, stale-routing correction, and migration safety during active requests

---

### Workstream R3 - Invocation Lifecycle, Timeouts, Retries, And Disconnect Semantics

Goal: make request execution operationally safe.

Current gap:

- timeout/retry settings are parsed but not fully enforced
- disconnect behavior for in-flight requests is incomplete
- retryability policy is not fully wired

Primary files:

- `src/client/invocation/ClientInvocation.ts`
- `src/client/invocation/ClientInvocationService.ts`
- `src/client/connection/ClientConnectionManager.ts`
- `src/client/config/ConnectionRetryConfig.ts`
- `src/client/config/ClientConnectionStrategyConfig.ts`

Tasks:

- add authoritative per-invocation deadlines
- fail pending invocations promptly on connection loss unless retry policy applies
- implement a retry matrix for read-only, mutating, blocking-with-timeout, listener add/remove, and lifecycle operations
- make unsupported or unhandled message types fail explicitly instead of hanging
- add backoff and reconnect interaction rules for pending work
- define idempotency rules for client retries
- add request-bounding and backpressure rules for in-flight requests and reconnect storms

Done gate:

- no pending invocation hangs past its configured deadline
- retryable and non-retryable failures are distinguishable and tested by operation class
- disconnect-under-load tests prove bounded recovery behavior and no unbounded in-flight growth

---

### Workstream R4 - Listener Service And Event Recovery

Goal: make listeners production-safe across reconnects and cluster changes.

Current gap:

- listener registration is best-effort
- reconnect re-registration is not robust enough
- failure paths are swallowed too easily

Primary files:

- `src/client/spi/ClientListenerService.ts`
- `src/client/proxy/ClientTopicProxy.ts`
- map listener paths under `src/client/**` and `src/server/clientprotocol/**`

Tasks:

- require authoritative server acknowledgement for listener registration success
- persist listener registration metadata for reconnect recovery
- add retry/backoff for listener re-registration
- fail loudly and observably if listener recovery cannot be completed
- add multi-listener, reconnect, and member-failover tests

Done gate:

- topic and retained listener types re-register with explicit success/failure outcome
- reconnect tests prove no unexpected duplicate delivery beyond the documented listener contract

---

### Workstream R5 - Remote Near Cache Correctness

Goal: make remote near-cache support honest and correct.

Current gap:

- invalidation listener re-registration is a no-op in the current client near-cache manager
- metadata fetch path is placeholder-level
- correctness is not proven in real multi-client, multi-node runs
- cache-path near-cache code still exists and must either be implemented honestly or explicitly deferred/removed from the supported surface

Primary files:

- `src/client/impl/nearcache/ClientNearCacheManager.ts`
- `src/client/map/impl/nearcache/NearCachedClientMapProxy.ts`
- `src/client/map/impl/nearcache/invalidation/ClientMapInvalidationMetaDataFetcher.ts`
- server-side invalidation and metadata tasks under `src/server/clientprotocol/**`

Tasks:

- wire real map invalidation listener registration for remote near-cache users
- implement real invalidation metadata fetch over the client protocol
- wire repairing task, anti-entropy, and reconnect recovery end to end
- prove invalidate-on-change correctness with multiple clients and writers
- remove or clearly block any near-cache option whose runtime semantics are not ready
- explicitly classify remote cache near-cache as supported, deferred, or removed from the public claim set

Done gate:

- remote map near-cache hit/miss/invalidation behavior is correct under concurrent writes, dropped invalidations, clear/destroy, and reconnects
- no README/example claims exceed what the real remote near-cache path guarantees

---

### Workstream R6 - Supported Surface Definition And Explicit Deferral

Goal: make the public remote-client surface honest and intentional.

Current gap:

- some features are explicitly deferred, which is good
- some docs/plans still overstate parity or imply broader readiness than exists

Primary files:

- `src/client/HeliosClient.ts`
- `src/index.ts`
- `README.md`
- `plans/CLIENT_E2E_PARITY_MATRIX.md`
- `plans/CLIENT_E2E_PARITY_PLAN.md`

Tasks:

- audit every public remote capability and classify as `implemented`, `blocked-by-server`, or `unsupported-by-design`
- remove or narrow any casted/shared-interface claim that implies methods the remote proxy does not really support
- ensure distributed-object lifecycle semantics are either real over protocol or explicitly not supported
- align docs/examples/tests with the true remote surface

Done gate:

- the documented remote surface matches reality exactly
- no public API implies parity that does not exist

---

### Workstream R7 - Production Observability And Diagnostics

Goal: make the remote client operable under real load and failure.

Current gap:

- too little visibility into connections, invocations, retries, listener recovery, near-cache repair, and topology state

Primary files:

- `src/client/**`
- `src/client/impl/statistics/**`
- relevant monitor/metrics interfaces under `src/internal/monitor/**`

Tasks:

- add client metrics for active connections, reconnect count, invocation count, timeout count, retry count, listener count, listener recovery count, near-cache invalidations, and repair events
- add structured debug logs for connect/auth/disconnect/reconnect/topology updates
- add topology version, wrong-target refresh, and backpressure visibility
- expose enough metrics for benchmark and production diagnosis

Done gate:

- connection, topology, retry, timeout, listener, and near-cache recovery behavior is visible through metrics/logging during failure tests

---

### Workstream R8 - External-Client Acceptance And Optional Comparative Benchmarking

Goal: make production-readiness claims provable.

Current gap:

- most remote client coverage is single-member or narrow happy-path
- current Helios-vs-Hazelcast benchmarking is not apples-to-apples because Helios remote-client path is not ready enough

Primary files:

- `test/client/e2e/**`
- `examples/native-app/src/client-*.ts`
- benchmark harness files under `examples/native-app/src/**`

Tasks:

- add external-client 3-node acceptance suites for map/queue/topic
- add member-leave, owner-migrate, reconnect-under-load, and multi-client tests
- add remote near-cache correctness tests across multiple clients
- build the external-client acceptance harness early and expand it incrementally as R0-R7 land
- only after R0-R7 are green, reintroduce true external-client benchmark mode and compare against Hazelcast with the same topology as a non-gating comparative step

Done gate:

- external-client multi-node acceptance suites are green for the supported surface

---

### Workstream R9 - Compatibility, Resource Safety, And Soak Readiness

Goal: make the remote client safe to run continuously under production load and upgrade conditions.

Current gap:

- the plan did not previously isolate mixed-version compatibility, bounded resource usage, or soak-level failure behavior as first-class requirements

Primary files:

- `src/client/**`
- `src/server/clientprotocol/**`
- acceptance and soak suites under `test/client/**`

Tasks:

- define and test client/server version negotiation and incompatibility behavior
- bound in-flight requests, listener queues, and reconnect storm amplification
- prove shutdown/drain behavior does not leak connections, listeners, or pending invocations
- add 3-node churn/soak coverage for long-lived external clients

Done gate:

- mixed-version incompatibility is explicit and tested
- client resource growth remains bounded under load, reconnect, and churn scenarios
- soak tests complete without leaked connections, runaway queues, or silent request loss

---

## 4. Delivery Order

Recommended execution order:

1. R0 - Security hardening
2. R0.5 - Server protocol contract and metadata foundation
3. R7 - Observability
4. R8 - External-client acceptance harness creation and incremental growth
5. R1 - Smart client topology and connections
6. R2 - Correct invocation routing and cluster semantics
7. R3 - Invocation lifecycle / retry / timeout / disconnect behavior
8. R4 - Listener recovery
9. R5 - Remote near-cache correctness
10. R6 - Supported surface definition and explicit deferral cleanup
11. R9 - Compatibility, resource safety, and soak readiness
12. optional comparative benchmarking after readiness gates are green

Reasoning:

- R0-R3 are mandatory correctness foundations.
- R0.5 makes hidden server-side dependencies explicit before client behavior is built on them.
- R7 and R8 need to start early so failures are visible and acceptance grows alongside implementation.
- R4-R5 are mandatory for evented and cached production workloads.
- R6 prevents future false parity claims.
- R9 closes the remaining production risks that are not just feature work.
- comparative benchmarking should happen last so it validates the real runtime rather than hiding semantic gaps.

---

## 5. Acceptance Checklist

The remote client stack is not production ready until all of these are true:

- auth is enforced for all non-auth protocol messages
- unknown-opcode, malformed-frame, and pre-auth negative-path socket tests are green
- client sees real member and partition topology in multi-node clusters
- stale-topology and wrong-target routing refresh behavior is correct and tested
- remote map operations are correct regardless of bootstrap member
- no pending invocation hangs past its configured deadline
- reconnect behavior is bounded, observable, and tested
- listener recovery is deterministic and tested
- remote near-cache invalidation and repair are real and tested
- docs and public APIs match actual support exactly
- mixed-version and incompatibility behavior is explicit and tested
- resource usage remains bounded under churn/load/reconnect scenarios
- external-client multi-node acceptance suites are green

Until then, the correct external statement is:

- Helios has a partial remote client implementation, not Hazelcast-equivalent production-ready client parity.

Separate non-gating follow-on:

- once the above readiness gates are green, Helios external-client benchmark mode should be restored and compared against Hazelcast using the same topology

---

## 6. Suggested Follow-Up Planning Files

This plan is the umbrella. Execution should likely be split into subordinate plans once work begins:

- `plans/REMOTE_CLIENT_SECURITY_HARDENING_PLAN.md`
- `plans/REMOTE_CLIENT_SERVER_PROTOCOL_FOUNDATION_PLAN.md`
- `plans/REMOTE_CLIENT_SMART_ROUTING_PLAN.md`
- `plans/REMOTE_CLIENT_NEARCACHE_CORRECTNESS_PLAN.md`
- `plans/REMOTE_CLIENT_EXTERNAL_BENCHMARK_PLAN.md`

Those subordinate plans may refine sequencing, but they must not weaken the release gates in this document.
