> **Status: historical archive** — superseded by post-parity-plan state documented in `docs/baseline/FEATURE_INVENTORY.md`.

# Helios Full Hazelcast Parity Master Plan

## Purpose

This plan captures the remaining work required before Helios can honestly claim to be a
full end-to-end TypeScript port of Hazelcast OSS rather than a strong Hazelcast-compatible
subset with selected parity closures.

This is a master gap-and-execution plan.

- It aggregates the remaining parity gaps discovered after the targeted client-protocol,
  transaction durability, and official `hazelcast-client` interop closures.
- It is intentionally broader than the already-completed targeted scope.
- It may reference existing detailed plans in `plans/`, but it is the top-level checklist for
  what still prevents a full Hazelcast parity claim.

## Repositories

- Helios repo: `/Users/zenystx/IdeaProjects/helios`
- Hazelcast reference repo: `/Users/zenystx/IdeaProjects/helios-1`

## Honest Current Status

Helios is already strong in these areas:

- core cluster/runtime, TCP transport, partitioning, replication, backup recovery foundations
- distributed map/queue/list/set/topic/multimap/replicated map/ringbuffer runtimes
- substantial client-protocol surface
- official `hazelcast-client@5.6.x` interop for major implemented surfaces
- transaction durability work in the targeted scope
- executor and scheduled-executor foundations
- SQL engine presence
- monitoring/REST/management-center foundations
- MapStore ecosystem and multiple persistence adapters
- Blitz as a real Helios-native Jet-like subsystem

However, Helios is **not yet** a full end-to-end Hazelcast TS port.

The biggest reasons are:

1. the public remote client contract is intentionally narrower than Hazelcast
2. several Hazelcast platform surfaces are partial or absent
3. some advanced distributed semantics are present only as simplified versions
4. several advanced Hazelcast product areas are not yet parity-audited or parity-proven

## Non-Negotiable Parity Rules

- Do not claim parity from package/file presence alone.
- Do not claim parity from protocol opcode coverage alone.
- Do not claim parity if the public product contract is still narrower than Hazelcast without an
  explicit `unsupported-by-design` decision recorded everywhere parity is claimed.
- Do not accept throw-stubs, deferred production behavior, or fake local-only fallbacks in any
  feature marked complete.
- Do not mark a phase complete until runtime wiring, config, lifecycle, client exposure,
  failure semantics, docs/examples, and production tests are all green.
- If a Hazelcast surface is intentionally not being implemented, Helios must narrow its marketing,
  docs, examples, and parity claims explicitly.

## Parity Severity Scale

- `P0`: blocks any honest “full Hazelcast TS port” claim
- `P1`: major platform parity gap
- `P2`: advanced parity gap; not foundational, but still required for full parity
- `P3`: polish / observability / documentation / proof closure required before final claim

## Master Gap Summary

| Area | Current Helios Status | Severity |
|------|-----------------------|----------|
| Remote public client surface | intentionally narrowed vs Hazelcast | P0 |
| CP subsystem full parity | partial / simplified / not fully proven | P0 |
| Cache / JCache parity | partial | P0 |
| SQL public remote parity | internal/member-side present, remote product surface incomplete | P0 |
| Split-brain protection + merge | incomplete | P0 |
| Query cache | missing | P1 |
| Event journal | missing | P1 |
| Durable executor parity | unclear/partial | P1 |
| Reliable topic remote parity | partial | P1 |
| Serialization parity proof | incomplete | P1 |
| Advanced query/projection/paging parity | partial | P1 |
| Listener/event parity breadth | partial | P1 |
| WAN replication | missing/partial | P2 |
| Persistence / hot restart / tiered store parity | missing/partial | P2 |
| Discovery SPI / cloud discovery parity | partial | P2 |
| Security / TLS / auth parity breadth | partial | P2 |
| Vector data structures | missing | P2 |
| XA transaction parity | missing | P2 |
| JMX / observability parity proof | partial | P2 |
| External data connections / user code deployment parity | missing/partial | P2 |
| Final full-surface parity proof and docs closure | not yet done | P3 |

## Existing Detailed Plans To Reuse

Where these plans already exist, they should be treated as implementation-detail companions to
this master plan rather than duplicated:

- `plans/CLIENT_E2E_PARITY_PLAN.md`
- `plans/CLIENT_E2E_PARITY_MATRIX.md`
- `plans/CLIENT_E2E_EXECUTION_BACKLOG.md`
- `plans/SCHEDULED_EXECUTOR_IMPLEMENTATION_PLAN.md`
- `plans/DISTRIBUTED_EXECUTOR_PLAN.md`
- `plans/TOPIC_RELIABLE_TOPIC_UNIFIED_PLAN.md`
- `plans/BACKUP_PARTITION_RECOVERY_PARITY_PLAN.md`
- `plans/MULTI_NODE_RESILIENCE_PLAN.md`
- `plans/SERIALIZATION_SERVICE_IMPL_PLAN.md`

If any detail plan conflicts with this file, this file wins for scope and completion criteria.

---

## Phase P0 — Product-Contract Closure

Goal: eliminate the biggest reasons Helios cannot yet claim full Hazelcast parity.

### Block P0.1 — Remote Client Full Surface Closure

Current reality:

- `src/client/HeliosClient.ts` explicitly narrows the remote product contract.
- Deferred remote features currently include:
  - cache
  - query-cache
  - transactions
  - sql
  - reliable-topic-client
  - executor
  - pn-counter
  - flake-id-generator
  - scheduled-executor
  - cardinality-estimator

Tasks:

- Expand `HeliosClient` until every Hazelcast-relevant server capability that exists in Helios is
  either remotely supported end to end or explicitly marked `unsupported-by-design` with all claims
  narrowed accordingly.
- Add real remote proxies, invocation flow, reconnect behavior, shutdown behavior, listener
  ownership, and config wiring for the currently deferred surfaces.
- Remove the permanent `DEFERRED_CLIENT_FEATURES` contract for any capability Helios intends to
  keep as Hazelcast-compatible.
- Add real-network client acceptance tests for every newly retained remote capability.
- Extend official-client interop coverage wherever the official Node client exposes the same area.

Done gate:

- Remote `HeliosClient` no longer exposes a materially narrower product contract than Hazelcast for
  implemented Helios server capabilities.

### Block P0.2 — CP Subsystem Full Parity Closure

Current reality:

- AtomicLong, AtomicReference, Semaphore, and CountDownLatch exist.
- Full Hazelcast-grade CP parity is not yet proven.
- `FencedLock` is not clearly implemented.
- CP group/session/fencing semantics are not yet fully parity-audited.

Tasks:

- Audit current CP implementation against Hazelcast OSS CP APIs and semantics.
- Implement missing primitives, especially `FencedLock`.
- Implement or harden CP session lifecycle, fencing, ownership transfer, and failover semantics.
- Validate group membership, session expiration, retry behavior, and linearizable semantics under
  member loss and concurrent contention.
- Add multi-member failure/recovery CP acceptance tests that reflect Hazelcast intent.

Done gate:

- Helios CP primitives and failure semantics are strong enough to defend a Hazelcast parity claim
  for the retained CP surface.

### Block P0.3 — Cache / JCache Completion

Current reality:

- Cache runtime exists, but parity is incomplete.
- Remote/public cache product surface is not yet honestly closed.

Tasks:

- Audit Helios cache runtime against Hazelcast cache/JCache surface.
- Complete runtime parity for cache operations, listeners, expiry, stats, and lifecycle.
- Implement honest remote cache client support if Helios intends Hazelcast-like cache parity.
- Verify near-cache integration and invalidation behavior for cache as a real distributed path.
- Add end-to-end cache protocol tests, remote tests, and interop-style coverage where possible.

Done gate:

- Cache is production-complete and no longer only “present but partial”.

### Block P0.4 — SQL Product Surface Closure

Current reality:

- SQL engine exists internally/member-side.
- Embedded/member `getSql()` exists.
- Remote public client parity is incomplete.

Tasks:

- Define the exact Hazelcast-compatible SQL scope Helios intends to support.
- Expose SQL through the public remote client where supported.
- Complete cursor/page/lifecycle/error/reconnect semantics.
- Compare SQL statement options and result behavior against Hazelcast OSS.
- Add end-to-end remote SQL acceptance and protocol coverage.

Done gate:

- SQL is a real supported Helios product surface, not just an internal/member capability.

### Block P0.5 — Split-Brain Protection + Merge Closure

Current reality:

- Current code explicitly notes that split-brain merge is deferred.

Tasks:

- Implement split-brain protection semantics with explicit policy/config support.
- Implement split-brain healing and merge behavior for affected structures.
- Define merge-policy support and fail-closed behavior where merge cannot be honored.
- Add cluster partition/heal tests with real transport/process boundaries.

Done gate:

- Helios no longer relies on “lightweight detection only” where Hazelcast semantics require merge
  and split-brain behavior.

---

## Phase P1 — Major Platform Parity

Goal: close the biggest remaining Hazelcast feature buckets after the product-contract blockers.

### Block P1.1 — Query Cache

Tasks:

- Implement map query-cache runtime, config, listener/event delivery, invalidation, and lifecycle.
- Add remote client query-cache behavior where Hazelcast exposes it.
- Add correctness and reconnect tests.

Done gate:

- Query cache is end to end real or deliberately excluded everywhere parity is claimed.

### Block P1.2 — Event Journal

Tasks:

- Implement event journal storage, retention, read APIs, and config.
- Integrate with map/cache/ringbuffer/event sources as appropriate.
- Add replay, ordering, and durability tests.

Done gate:

- Event journal exists as a real production feature, not a missing Hazelcast gap.

### Block P1.3 — Durable Executor Parity

Tasks:

- Audit current executor vs Hazelcast `DurableExecutorService` semantics.
- Implement durable submission, retrieval, disposal, restart/failover semantics, and lifecycle.
- Expose the feature remotely where Hazelcast does.
- Add multi-member recovery tests.

Done gate:

- Durable executor behavior is real, durable, and parity-tested.

### Block P1.4 — Reliable Topic Remote Parity

Tasks:

- Finish reliable-topic remote client surface and lifecycle.
- Prove ringbuffer-backed reliable topic semantics across reconnect, retention, loss, and listener
  lifecycle.
- Align docs/examples with actual retained behavior.

Done gate:

- Reliable topic is parity-credible locally and remotely.

### Block P1.5 — Serialization Parity Closure

Current reality:

- Portable, Compact, and GenericRecord artifacts exist.
- Full Hazelcast serialization/config/runtime parity is not yet proven.

Tasks:

- Audit serialization config and runtime against Hazelcast OSS:
  - Portable
  - Compact
  - GenericRecord
  - custom serializers
  - global serializer
  - serializer registration/config semantics
- Validate client/server compatibility, schema handling, nullability, evolution, and error behavior.
- Add compatibility tests using real remote client paths and official-client interop where feasible.

Done gate:

- Serialization parity is proven by behavior, not inferred from type names or package structure.

### Block P1.6 — Advanced Query / Entry Processing Closure

Current reality:

- Entry processor support exists.
- Broader projection/paging/query parity still looks partial.

Tasks:

- Audit and complete projections, paging predicates, and advanced query result behavior.
- Verify entry processor distribution, backup behavior, and result semantics against Hazelcast
  intent.
- Add end-to-end map/query/index regression coverage.

Done gate:

- Query and entry-processing surfaces are no longer materially behind Hazelcast in the retained
  scope.

### Block P1.7 — Listener and Event Parity Breadth

Tasks:

- Inventory all Hazelcast listener/event families relevant to retained Helios surfaces.
- Implement missing listener types and missing event-loss/partition-lost/distributed-object/lifecycle
  breadth where parity is expected.
- Verify reconnect-safe listener recovery and deterministic removal semantics.

Done gate:

- Listener behavior breadth no longer undermines parity claims for implemented structures.

---

## Phase P2 — Advanced Platform Parity

Goal: close broader Hazelcast product areas that are not core data-grid basics but are still part of
full parity.

### Block P2.1 — WAN Replication

Tasks:

- Define OSS-relevant WAN scope to match.
- Implement WAN config, publisher/consumer behavior, reconciliation, and failure semantics.
- Add multi-cluster replication tests.

### Block P2.2 — Persistence / Hot Restart / Tiered Store

Tasks:

- Decide the exact persistence/hot-restart/tiered-store parity target Helios intends to claim.
- Implement or explicitly narrow unsupported areas.
- Add restart/recovery/durability tests across full process restarts.

### Block P2.3 — Discovery SPI / Cloud Discovery

Tasks:

- Audit current discovery support against Hazelcast:
  - multicast
  - autodetection
  - AWS
  - Azure
  - GCP
  - Kubernetes
  - Eureka
  - Discovery SPI / custom strategies
- Implement or explicitly reject each accepted config surface.

### Block P2.4 — Security Parity Breadth

Tasks:

- Audit current auth, permission, token, TLS/SSL, and interceptor behavior.
- Implement missing runtime behavior for supported security config.
- Add end-to-end client/server TLS and auth failure tests.

### Block P2.5 — Vector Data Structures

Tasks:

- Audit Hazelcast vector surface and decide whether Helios intends parity.
- Implement or mark unsupported-by-design with all parity claims narrowed.

### Block P2.6 — XA Transactions

Tasks:

- Audit Hazelcast XA transaction surface.
- Implement or explicitly narrow it out of Helios parity claims.

### Block P2.7 — External Data Connections / User Code Deployment

Tasks:

- Audit Hazelcast external data connection and user code deployment surfaces.
- Decide whether Helios will implement, replace with Helios-native equivalents, or exclude.
- Reflect the decision consistently in docs and parity claims.

### Block P2.8 — JMX / Observability Parity Proof

Tasks:

- Audit management, metrics, diagnostics, REST, and JMX surfaces against Hazelcast intent.
- Close missing runtime/metric/stat semantics for claimed surfaces.
- Add proof for management/monitoring behaviors currently assumed but not parity-tested.

Done gate for Phase P2:

- Helios has either implemented or explicitly and honestly excluded the major advanced Hazelcast
  platform buckets that remain today.

---

## Phase P3 — Final Full-Parity Proof

Goal: replace “strongly compatible subset” language with an evidence-backed full-parity claim.

### Block P3.1 — Full Hazelcast Capability Matrix

Tasks:

- Build a living parity matrix: Hazelcast feature -> Helios equivalent -> status -> evidence ->
  tests -> decision.
- Require every retained public feature to have at least one end-to-end proof reference.

### Block P3.2 — Full-Surface Audit For Deferred/Stubs/Orphans

Tasks:

- Run repo-wide production audits for `not implemented`, deferred runtime behavior, orphan codecs,
  orphan proxies, and package-public internals.
- Resolve every remaining production hit or narrow the corresponding claim.

### Block P3.3 — Final End-to-End Compatibility Sweep

Tasks:

- Expand official-client interop suites to every Helios surface that the official Node client can
  judge.
- Add separate-app acceptance suites for every retained Helios remote feature.
- Add multi-member failover/restart/partition-heal verification for all critical distributed
  structures.

### Block P3.4 — Docs / Examples / Marketing Honesty Closure

Tasks:

- Audit README, examples, package exports, docs, and plan files.
- Remove any wording that implies unsupported or only-partial Hazelcast parity.
- Add explicit support tables for any still-intentional exclusions.

Done gate:

- A new user can read the repo and get an accurate understanding of exactly what Helios matches and
  what it does not.

---

## Recommended Execution Order

1. `P0.1` Remote client full surface closure
2. `P0.2` CP subsystem full parity
3. `P0.3` Cache / JCache completion
4. `P0.4` SQL product surface closure
5. `P0.5` Split-brain protection + merge closure
6. `P1.1` Query cache
7. `P1.2` Event journal
8. `P1.3` Durable executor parity
9. `P1.4` Reliable topic remote parity
10. `P1.5` Serialization parity closure
11. `P1.6` Advanced query / entry processing closure
12. `P1.7` Listener and event parity breadth
13. `P2.*` Advanced platform parity blocks
14. `P3.*` Final full-parity proof and documentation closure

## Definition Of Done For “Full Hazelcast TS Port”

Helios may honestly use that label only when all of the following are true:

- no P0 or P1 parity blockers remain open
- every remaining unimplemented Hazelcast OSS surface is explicitly excluded everywhere parity is
  claimed
- remote client product contract matches the intended Hazelcast-compatible scope end to end
- CP, cache, SQL, advanced query, serialization, listener, and resilience semantics are proven by
  runtime tests rather than inferred
- no production `not implemented`, deferred runtime behavior, or orphan public surfaces remain in
  retained scope
- docs/examples/exports accurately match runtime reality

## Immediate Next Step

Start with `P0.1` and convert the current remote-client narrowing from an explicit deferred list into
an executable parity backlog with one row per missing public client feature, linked to the existing
client parity plans.
