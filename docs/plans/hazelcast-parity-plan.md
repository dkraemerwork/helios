# Helios Hazelcast Parity Spec

**Version:** 3.0  
**Date:** 2026-03-10  
**Status:** Execution Ready (subject to existing repo test/interop harness conventions)  
**Purpose:** authoritative, implementation-backed Hazelcast parity spec with official `hazelcast-client` compatibility as the sole remote-client story, including required removal of `HeliosClient`

---

## 1. Product decision and scope

Helios is a **Hazelcast-compatible server/runtime in TypeScript on Bun**.

For remote access, the only supported client story in this spec is:

- **the official `hazelcast-client` npm package against a live Helios cluster**

This spec does **not** use `HeliosClient` as the parity boundary. `HeliosClient` is a currently exported public surface slated for removal and is not part of the parity target.

This document records, by topic:

- what Helios actually implements today
- what is carried on the inter-member wire
- what is exposed through the server-side client protocol
- what is proven by official-client interop suites
- what must be removed so `HeliosClient` is no longer a shipped parity surface
- what gaps remain before stronger Hazelcast parity claims are safe

This document is intentionally conservative:

- no claim is made from type names alone
- no claim is made from handler registration alone
- no claim is made from test placeholders or narrowing tests
- no claim is made for Java-only surfaces Helios cannot honestly expose
- no remote-client parity claim is made without official `hazelcast-client` proof or an explicit claim boundary

Primary code anchors:

- `src/instance/impl/HeliosInstanceImpl.ts`
- `src/server/clientprotocol/ClientProtocolServer.ts`
- `src/server/clientprotocol/handlers/registerAllHandlers.ts`
- `src/cluster/tcp/TcpClusterTransport.ts`
- `src/cluster/tcp/BinarySerializationStrategy.ts`
- `src/spi/impl/operationservice/OperationWireCodec.ts`
- `test/interop/suites/*.test.ts`

Execution conventions already present in the repository and assumed by this plan:

- official remote-client interop is pinned to `hazelcast-client@5.6.0` from `test/interop/package.json`; changing that version requires updating the pinned version, interop package, and this plan together
- interop suites live under `test/interop/suites/*.test.ts`
- interop suite execution uses `./test/interop/run-interop.sh`
- root verification commands use existing `package.json` scripts such as `bun test`, `bun run build`, and `bun run test:interop`

Interop proof must use the unmodified published `hazelcast-client@5.6.0` package. Repository-local forks, wrappers, monkeypatches, proxies, patched tarballs, or substituted packages do not satisfy official-client proof.

The repository's verification flow may be extended to add required suites, but it may not be weakened to exclude any mandatory suite, selector, or discovery path required by this plan.

---

## 2. Claim rules

### Status legend

- **Implemented** — present in runtime and backed by code/tests
- **Partial** — present, but still missing important parity proof or important Hazelcast semantics
- **Protocol-only** — server/client-protocol surface exists, but official-client interop proof is not yet established in this spec
- **Out of scope** — intentionally not claimed as Hazelcast parity

### Surface legend

- **Member runtime** — embedded/member-side behavior
- **Inter-member wire** — cluster TCP protocol between members
- **Client protocol** — server-side Hazelcast-compatible client protocol handlers
- **Official client interop** — proof from the official `hazelcast-client` npm package against a live Helios cluster
- **Service-local wire** — ad-hoc inter-member messages defined in a service implementation instead of the canonical shared `ClusterMessage` table

### Proof rule

For remote-client parity, the proof hierarchy is:

1. server runtime must exist
2. server client-protocol handling must exist
3. official `hazelcast-client` interop must pass against a live Helios cluster

Handler presence alone is necessary but not sufficient.

---

## 3. Explicit exclusions and replacements

### 3.1 Do not claim

| Topic | Accurate statement |
|---|---|
| JCache / JSR-107 | Helios has distributed cache functionality, but no Java `javax.cache` / JSR-107 compatibility claim is valid in this TypeScript/Bun runtime. |
| Hazelcast Jet | Do not claim Jet parity. Helios uses Blitz as its own replacement. |
| Distributed CP parity | Do not claim Hazelcast distributed CP parity. Current CP is single-node embedded behavior, not multi-member Raft consensus. |
| Hot restart / persistence parity | Not claimable from this audit. |
| WAN replication parity | Not claimable from this audit. |
| Full serialization parity | Not claimable from this audit. Serializer breadth and evolution semantics are not yet fully parity-audited. |

### 3.2 Helios replacements

| Hazelcast concept | Helios reality |
|---|---|
| Jet | **Blitz** |
| Java JCache API | **Distributed cache service** without Java API parity |

---

## 4. Remote architecture baseline

Helios owns:

- the member runtime
- the inter-member wire protocol
- the server-side client protocol

Helios does **not** need to own a proprietary remote client SDK to satisfy the Hazelcast-port goal.

The parity boundary for remote access is therefore:

- **Helios server/runtime + official `hazelcast-client` interop**

Adopting this parity boundary requires removing `HeliosClient` from the shipped product surface, exports, docs, examples, and parity-proof story.

This means:

- if an official-client interop suite passes against Helios, that remote feature is proven at the client boundary
- if only a handler exists, that feature is server/protocol-capable but not yet a completed remote parity claim

---

## 5. Summary matrix

| Topic | Member runtime | Inter-member wire | Client protocol | Official client interop | Honest status | Main gap |
|---|---|---|---|---|---|---|
| Transport / framing | Yes | Yes | N/A | Indirect via interop suites | Implemented | no protocol/version negotiation in `HELLO`; malformed-frame handling is too quiet |
| Membership / discovery | Yes | Yes | Partial | Partial | Partial | continuous topology-change publication still needs stronger proof |
| Serialization / data model | Yes | Yes | Yes | Yes | Implemented | broader Java-only serializer surfaces remain intentionally unclaimed beyond the retained proven families |
| Partition routing / invocation / backups / recovery | Yes | Yes | N/A | Indirect via interop suites | Partial | recovery support is selective; migration parity still needs targeted audit |
| IMap | Yes | Yes | Yes | Yes | Partial | official-client interop is strong, but full Hazelcast IMap breadth is still broader |
| Queue | Yes | Yes | Yes | Yes | Partial | official-client interop exists, but broader Hazelcast queue semantics still need stronger fault-mode proof |
| List | Yes | Yes | Yes | Yes | Implemented | no blocker for the audited interop surface; broader semantic parity still needs ongoing maintenance |
| Set | Yes | Yes | Yes | Yes | Implemented | no blocker for the audited interop surface; broader semantic parity still needs ongoing maintenance |
| MultiMap | Yes | Yes | Yes | Yes | Implemented | no blocker for the audited interop surface; broader semantic parity still needs ongoing maintenance |
| Topic | Yes | Yes | Yes | Not proven here | Partial | standard topic has server/runtime support, but official interop proof in this audit is for reliable topic, not standard topic |
| Reliable topic | Yes | Yes | Yes | Yes | Implemented | no blocker for the audited interop surface |
| Replicated map | Yes | Yes | Yes | Yes | Implemented | no blocker for the audited interop surface |
| Cache | Yes | service-local | Yes | Not proven here | Protocol-only | no official-client interop proof in this spec; no Java JCache claim |
| Ringbuffer | Yes | service-local | Yes | Not proven here | Protocol-only | no official-client interop proof in this spec; wire not unified into canonical shared message table |
| Executor | Yes | Yes | Yes | Not proven here | Partial | durable executor path remains skeletal |
| Scheduled executor | Yes | Yes (generic ops) | No active registered remote surface | Not proven here | Partial | `ScheduledExecutorMessageHandlers` exists, but no active registration path is established through `registerAllHandlers()` |
| Transactions | Yes | Yes | Yes | Not proven here | Protocol-only | no official-client interop proof in this spec; coordinator state remains member-local |
| CP atomics (AtomicLong / AtomicRef) | Yes | No | Yes | Yes | Partial | official interop proof exists, but CP remains single-node only |
| CP groups / Latch / Semaphore | Yes | No | Yes | Not proven here | Protocol-only | server/protocol support exists, but no official-client interop proof is established here; CP remains single-node only |
| PN Counter | Yes | not audited here | Yes | Yes | Implemented | no blocker for the audited interop surface |
| Flake ID | Yes | not audited here | Yes | Yes | Implemented | no blocker for the audited interop surface |
| Cardinality estimator | Yes | not audited here | Yes | Not proven here | Protocol-only | no official-client interop proof in this spec |
| SQL | Yes | N/A | Yes | Not proven here | Partial | current SQL is IMap-oriented and narrower than Hazelcast SQL |
| Blitz | Yes | Yes | N/A | N/A | Replacement, not parity | do not call this Jet parity |

---

## 6. Topic details

## 6.1 Transport, framing, and binary protocol

### What exists

- `TcpClusterTransport` uses binary serialization, not JSON, as the live path.
- Framing is `[uint32 length][binary payload]`.
- The read path is stateful and avoids `Buffer.concat` hot-path framing.
- `OutboundBatcher`, `ScatterOutboundEncoder`, and `WireBufferPool` are already integrated.

### Code anchors

- `src/cluster/tcp/TcpClusterTransport.ts`
- `src/cluster/tcp/BinarySerializationStrategy.ts`
- `src/cluster/tcp/OutboundBatcher.ts`
- `src/cluster/tcp/ScatterOutboundEncoder.ts`
- `src/internal/util/WireBufferPool.ts`

### Proof

- `test/cluster/tcp/BinarySerializationStrategy.test.ts`
- `test/cluster/tcp/OutboundBatcher.test.ts`
- `test/cluster/tcp/ScatterOutboundEncoder.test.ts`
- `test/cluster/tcp/TcpProtocolUpgradeTest.test.ts`

### Claim boundary

- `ClusterMessage.ts` still contains stale JSON-oriented commentary; executable truth is the binary transport code and tests.
- `HELLO` still lacks explicit protocol/version negotiation metadata.
- decode failures in `_onData()` are still swallowed instead of forcing an explicit close path.

---

## 6.2 Membership, discovery, and topology publication

### What exists

- Member join flow uses `HELLO`, `JOIN_REQUEST`, `FINALIZE_JOIN`, `MEMBERS_UPDATE`, `PARTITION_STATE`, `FETCH_MEMBERS_VIEW`, and `MEMBERS_VIEW_RESPONSE`.
- TCP/IP and multicast discovery exist.
- `JOIN_REQUEST` and `WireMemberInfo` already carry REST endpoint data.
- Member transport wiring dispatches cluster-control traffic through the coordinator.
- A client-protocol server is started by the member runtime and exposes a bound client port.

### Code anchors

- `src/instance/impl/HeliosInstanceImpl.ts`
- `src/instance/impl/HeliosClusterCoordinator.ts`
- `src/server/clientprotocol/ClientProtocolServer.ts`
- `src/cluster/tcp/BinarySerializationStrategy.ts`

### Proof

- `test/cluster/tcp/TcpProtocolUpgradeTest.test.ts`
- `test/internal/cluster/impl/MembersView.test.ts`
- `test/interop/suites/connection.test.ts`
- `test/interop/suites/lifecycle.test.ts`

### Claim boundary

- startup-time client connectivity is well proven
- continuous topology-change publication still needs stronger explicit proof in this spec
- duplicate connection resolution and incompatible-peer rejection still need stronger rollout-grade verification

---

## 6.3 Serialization and data model

### What exists

- Helios has shared serialization infrastructure for member runtime, cluster transport, and client protocol flows.
- Core building blocks include:
  - `HazelcastSerializationService`
  - `SerializationServiceImpl`
  - `HeapData` / `Data`
  - `ByteArrayObjectDataInput` / `ByteArrayObjectDataOutput`
  - `IdentifiedDataSerializableRegistry`
  - `PortableSerializer` / `PortableRegistry`
  - `CompactStreamSerializer` / `SchemaService`
  - `GenericRecord`
  - `DataWireCodec`
- Cluster transport and operation payloads are binary.

### Code anchors

- `src/internal/serialization/impl/SerializationServiceImpl.ts`
- `src/internal/serialization/HazelcastSerializationService.ts`
- `src/internal/serialization/impl/ByteArrayObjectDataInput.ts`
- `src/internal/serialization/impl/ByteArrayObjectDataOutput.ts`
- `src/internal/serialization/impl/HeapData.ts`
- `src/internal/serialization/IdentifiedDataSerializableRegistry.ts`
- `src/internal/serialization/portable/PortableSerializer.ts`
- `src/internal/serialization/compact/CompactSerializer.ts`
- `src/internal/serialization/GenericRecord.ts`
- `src/cluster/tcp/DataWireCodec.ts`

### Proof

- `test/internal/serialization/impl/SerializationServiceImplTest.test.ts`
- `test/internal/serialization/impl/HazelcastSerializationParityTest.test.ts`
- `test/internal/serialization/impl/HeliosInstanceSerializationWiringTest.test.ts`
- `test/internal/serialization/impl/SerializerPrimitivesTest.test.ts`
- `test/internal/serialization/impl/DataSerializableSerializerTest.test.ts`
- `test/internal/serialization/impl/HeapDataTest.test.ts`
- `test/internal/serialization/impl/ByteArrayObjectDataInputTest.test.ts`
- `test/internal/serialization/impl/ByteArrayObjectDataOutputTest.test.ts`
- `test/interop/suites/serialization.test.ts`

### Claim boundary

- retained serialization parity is now proven for primitives, primitive arrays, client-safe enum/list/set payloads, `IdentifiedDataSerializable`, `Portable`, `Compact`, `Compact GenericRecord`, custom serializers, and global serializer fallback behavior
- retained Compact evolution guarantees are explicit and proven: additive and subtractive field evolution succeed; renamed fields, incompatible field-kind changes, nullability mismatches, unknown type IDs, and serializer conflicts fail closed with automated proof
- broader Java-only collection/enum breadth outside the retained client-safe families remains intentionally unclaimed
- legacy compatibility message paths still exist for some older message families, but they are formally bounded outside the retained proven scope

---

## 6.4 Partition routing, invocation lifecycle, backup acks, and recovery

### What exists

- Member-to-member operation routing uses `OPERATION`, `OPERATION_RESPONSE`, `BACKUP`, and `BACKUP_ACK`.
- Operation payloads are encoded through `OperationWireCodec` and IDS registry wiring.
- `InvocationMonitor` handles timeout, duplicate response, late response, late backup ack, backup-ack deadline, and member-left failure flows.
- Recovery messages are implemented for anti-entropy and sync transfer.

### Code anchors

- `src/spi/impl/operationservice/OperationWireCodec.ts`
- `src/instance/impl/InvocationMonitor.ts`
- `src/internal/partition/impl/InternalPartitionServiceImpl.ts`

### Proof

- `test/cluster/tcp/BackupAckParity.test.ts`
- `test/cluster/tcp/OwnerRoutedMapTest.test.ts`
- `test/instance/InvocationMonitor.test.ts`

### Claim boundary

- supported partition-owned recovery namespaces are currently selective: `map`, `queue`, `ringbuffer`
- cache, SQL, and transaction coordinator state are explicitly excluded from partition-state replication
- full migration parity is not yet claimable

---

## 6.5 Remote server protocol and official-client boundary

### What exists

- Helios runs a server-side client protocol endpoint with authentication, framing, dispatch, and heartbeat cleanup.
- Handler registration is broad and includes map, queue, topic, list, set, multimap, replicated map, ringbuffer, cache, transaction, SQL, executor, CP, PN counter, flake ID, and cardinality estimator surfaces.

### Code anchors

- `src/server/clientprotocol/ClientProtocolServer.ts`
- `src/server/clientprotocol/ClientMessageDispatcher.ts`
- `src/server/clientprotocol/handlers/registerAllHandlers.ts`

### Proof

- `test/client/Block20_3_MemberSideClientProtocol.test.ts`
- `test/client/ListProtocolAdapter.test.ts`
- `test/client/SetMultiMapProtocolAdapter.test.ts`
- `test/client/ReplicatedMapRingbufferProtocolAdapter.test.ts`
- `test/client/CacheProtocolAdapter.test.ts`
- `test/client/TransactionProtocolAdapter.test.ts`
- `test/client/CpProtocolAdapter.test.ts`
- `test/client/FlakePnCardinalityProtocolAdapter.test.ts`

### Claim boundary

- this proves server/protocol capability
- it does **not** by itself prove official-client parity
- official-client parity must be stated only where live `hazelcast-client` interop suites exist

---

## 6.6 IMap

### What exists

- Member-side IMap runtime is well-developed.
- It includes partition-routed CRUD, backup-aware flows, near-cache invalidation, MapStore integration, and query/index-related behavior.

### Code anchors

- `src/map/impl/MapProxy.ts`
- `src/map/impl/operation/*`
- `src/server/clientprotocol/handlers/MapServiceHandlers.ts`

### Official-client interop proof

- `test/interop/suites/map.test.ts`

### Additional proof

- `test/map/MapProxyTest.test.ts`
- `test/map/MapProxyOperationRoutingTest.test.ts`
- `test/map/impl/query/IndexedMapQueryTest.test.ts`
- `test/map/mapstore/MapStoreIntegration.test.ts`

### Claim boundary

- official-client interop is strong for a substantial map surface
- full Hazelcast IMap breadth is still larger than what this spec currently proves end to end

---

## 6.7 Queue

### What exists

- Embedded/member queue service is implemented.
- Queue has dedicated inter-member messages: `QUEUE_REQUEST`, `QUEUE_RESPONSE`, `QUEUE_STATE_SYNC`, `QUEUE_STATE_ACK`, `QUEUE_EVENT`.

### Code anchors

- `src/collection/impl/queue/DistributedQueueService.ts`
- `src/server/clientprotocol/handlers/QueueServiceHandlers.ts`

### Official-client interop proof

- `test/interop/suites/queue.test.ts`

### Additional proof

- `test/collection/queue/QueueTest.test.ts`

### Claim boundary

- official-client interop is proven for the audited queue surface
- stronger fault-mode proof is still needed before stronger semantic claims under failover/load

---

## 6.8 List, Set, and MultiMap

### What exists

- Embedded/member services exist for list, set, and multimap.
- Inter-member binary message coverage exists for all three families.
- Server-side client protocol handlers exist for all three families.

### Code anchors

- `src/collection/impl/list/DistributedListService.ts`
- `src/collection/impl/set/DistributedSetService.ts`
- `src/multimap/impl/DistributedMultiMapService.ts`

### Official-client interop proof

- `test/interop/suites/collections.test.ts`
- `test/interop/suites/multimap.test.ts`

### Additional proof

- `test/client/ListProtocolAdapter.test.ts`
- `test/client/SetMultiMapProtocolAdapter.test.ts`
- `test/collection/list/ListTest.test.ts`
- `test/collection/set/SetTest.test.ts`
- `test/multimap/MultiMapTest.test.ts`

### Claim boundary

- official-client interop is real and end to end for the audited list/set/multimap surface
- broader semantic parity still needs ongoing maintenance and regression coverage

---

## 6.9 Topic and reliable topic

### What exists

- Standard topic and reliable topic are both implemented member-side.
- Dedicated inter-member reliable-topic messages exist.

### Code anchors

- `src/topic/impl/DistributedTopicService.ts`
- `src/topic/impl/reliable/ReliableTopicService.ts`
- `src/server/clientprotocol/handlers/TopicServiceHandlers.ts`

### Official-client interop proof

- `test/interop/suites/topic.test.ts`

### Additional proof

- `test/topic/ReliableTopicService.test.ts`
- `test/topic/ReliableTopicServiceBacked.test.ts`
- `test/topic/ReliableTopicPublishCompletion.test.ts`

### Claim boundary

- the official interop suite in this audit proves **reliable topic** via `hazelcast-client.getReliableTopic(...)`
- it does **not** by itself prove standard topic parity through the official client
- standard topic remains implemented server-side, but should be described as partial until official-client proof is added or the claim is narrowed

---

## 6.10 Replicated map and ringbuffer

### What exists

- Replicated map has embedded runtime support, shared binary message coverage, and client-protocol handlers.
- Ringbuffer has embedded runtime support and client-protocol handlers.
- Ringbuffer inter-member wire remains service-local: `RINGBUFFER_REQUEST`, `RINGBUFFER_RESPONSE`, `RINGBUFFER_BACKUP`, `RINGBUFFER_BACKUP_ACK`.

### Code anchors

- `src/replicatedmap/impl/DistributedReplicatedMapService.ts`
- `src/ringbuffer/impl/DistributedRingbufferService.ts`
- `src/server/clientprotocol/handlers/ReplicatedMapServiceHandlers.ts`
- `src/server/clientprotocol/handlers/RingbufferServiceHandlers.ts`

### Official-client interop proof

- `test/interop/suites/replicatedmap.test.ts`

### Additional proof

- `test/client/ReplicatedMapRingbufferProtocolAdapter.test.ts`
- `test/ringbuffer/impl/ArrayRingbuffer.test.ts`
- `test/ringbuffer/impl/RingbufferContainer.test.ts`

### Claim boundary

- replicated map has end-to-end official-client interop proof
- ringbuffer is server/protocol-capable in this audit, but not yet officially proven through `hazelcast-client` interop
- ringbuffer wire remains outside the canonical shared cluster message table

---

## 6.11 Cache and JCache-related surface

### What exists

- Helios has a distributed cache service with service-local inter-member messages: `CACHE_REQUEST`, `CACHE_RESPONSE`, `CACHE_STATE_SYNC`, `CACHE_STATE_ACK`.
- Server-side client protocol cache handlers exist.

### Code anchors

- `src/cache/impl/DistributedCacheService.ts`
- `src/server/clientprotocol/handlers/CacheServiceHandlers.ts`
- `src/cache/impl/JCacheDetector.ts`

### Proof

- `test/client/CacheProtocolAdapter.test.ts`
- `test/cache/recordstore/CacheRecordStoreTest.test.ts`

### Claim boundary

- this is server/protocol proof, not official-client parity proof
- do **not** claim Java JCache / JSR-107 compatibility
- cache is not in the supported partition-owned recovery namespace sync set

---

## 6.12 Executor and scheduled executor

### What exists

- Executor service exists member-side.
- Executor operation payloads use the generic operation-routing path.
- Executor-related client-protocol handlers exist, including durable-executor opcodes.
- Scheduled executor exists member-side, but an active registered remote client-protocol path is not established in this spec.

### Code anchors

- `src/executor/impl/*`
- `src/server/clientprotocol/handlers/ExecutorServiceHandlers.ts`
- `src/server/clientprotocol/ScheduledExecutorMessageHandlers.ts`
- `src/scheduledexecutor/impl/*`

### Proof

- `test/executor/impl/ExecutorE2EAcceptanceTest.test.ts`
- `test/executor/impl/ExecutorMultiNodeIntegrationTest.test.ts`
- `test/client/SqlExecutorProtocolAdapter.test.ts`
- `test/scheduledexecutor/impl/ScheduledExecutorOperationsTest.test.ts`
- `test/scheduledexecutor/ScheduledExecutorAcceptanceTest.test.ts`

### Claim boundary

- durable executor is still skeletal / placeholder-backed and not parity-claimable
- scheduled executor is not yet established as an active official-client remote surface in this spec

---

## 6.13 Transactions

### What exists

- Member-side transaction runtime exists.
- Client protocol handlers exist for transaction operations.
- Inter-member transaction backup replication messages are in the canonical binary cluster-message set.

### Code anchors

- `src/transaction/impl/TransactionManagerServiceImpl.ts`
- `src/server/clientprotocol/handlers/TransactionServiceHandlers.ts`
- `src/cluster/tcp/ClusterMessage.ts`

### Proof

- `test/transaction/impl/TransactionClusterDurabilityTest.test.ts`
- `test/transaction/impl/TransactionImpl_TwoPhaseTest.test.ts`
- `test/client/TransactionProtocolAdapter.test.ts`

### Claim boundary

- this is protocol/server proof, not official-client parity proof in this audit
- transaction coordinator state remains member-local, not partition-replicated

---

## 6.14 CP atomics (AtomicLong / AtomicReference)

### What exists

- CP-related services and handlers exist for atomic long and atomic reference.

### Code anchors

- `src/cp/impl/CpSubsystemService.ts`
- `src/server/clientprotocol/handlers/CpServiceHandlers.ts`

### Official-client interop proof

- `test/interop/suites/atomics.test.ts`

### Additional proof

- `test/client/CpProtocolAdapter.test.ts`

### Claim boundary

- official-client proof in this audit exists for **AtomicLong** and **AtomicReference**
- CP remains explicitly single-node embedded behavior, not multi-member distributed CP parity

---

## 6.15 CP groups, count down latch, and semaphore

### What exists

- CP-related services and handlers exist for CP groups, count down latch, and semaphore.

### Code anchors

- `src/cp/impl/CpSubsystemService.ts`
- `src/server/clientprotocol/handlers/CpServiceHandlers.ts`

### Proof

- `test/client/CpProtocolAdapter.test.ts`

### Claim boundary

- this is protocol/server proof, not official-client parity proof in this audit
- CP remains explicitly single-node embedded behavior, not multi-member distributed CP parity

---

## 6.16 PN counter, flake ID, and cardinality estimator

### What exists

- Server-side handlers and member-side services exist for PN counter, flake ID, and cardinality estimator.

### Code anchors

- `src/server/clientprotocol/handlers/PnCounterServiceHandlers.ts`
- `src/server/clientprotocol/handlers/FlakeIdServiceHandlers.ts`
- `src/server/clientprotocol/handlers/CardinalityServiceHandlers.ts`
- `src/crdt/impl/PNCounterService.ts`
- `src/flakeid/impl/FlakeIdGeneratorService.ts`
- `src/cardinality/impl/DistributedCardinalityEstimatorService.ts`

### Official-client interop proof

- `test/interop/suites/pncounter.test.ts`
- `test/interop/suites/flakeid.test.ts`

### Additional proof

- `test/client/FlakePnCardinalityProtocolAdapter.test.ts`

### Claim boundary

- PN counter and flake ID have official-client interop proof in this audit
- cardinality estimator is protocol/server-capable here, but not yet officially proven via `hazelcast-client` interop in this spec

---

## 6.17 SQL

### What exists

- Helios has a SQL service centered on IMap-backed data.
- Current SQL support is centered on `SELECT`, `INSERT`, `UPDATE`, and `DELETE` over IMap data with cursor handling and cancellation.

### Code anchors

- `src/sql/impl/SqlService.ts`
- `src/server/clientprotocol/handlers/SqlServiceHandlers.ts`

### Proof

- `test/client/SqlExecutorProtocolAdapter.test.ts`

### Claim boundary

- current SQL is materially narrower than Hazelcast SQL
- this is not yet an official-client interop parity claim in this spec

---

## 6.18 Blitz as the Jet replacement

### What exists

- Blitz integration is real and deeply wired into the member runtime.
- Dedicated cluster messages exist for Blitz topology and registration.

### Code anchors

- `src/instance/impl/HeliosInstanceImpl.ts`
- `src/cluster/tcp/ClusterMessage.ts`

### Proof

- `test/blitz/BlitzServiceStandaloneJobExecution.test.ts`
- `test/blitz/job/BlitzJobSupervisionE2ETest.test.ts`
- `test/blitz/job/BlitzJobExecutorTest.test.ts`

### Claim boundary

- Blitz is a Helios replacement, not a Jet parity claim

---

## 7. Official-client proof inventory

The current remote proof inventory from the official `hazelcast-client` is:

- connection: `test/interop/suites/connection.test.ts`
- lifecycle: `test/interop/suites/lifecycle.test.ts`
- map: `test/interop/suites/map.test.ts`
- queue: `test/interop/suites/queue.test.ts`
- list + set: `test/interop/suites/collections.test.ts`
- multimap: `test/interop/suites/multimap.test.ts`
- reliable topic: `test/interop/suites/topic.test.ts`
- replicated map: `test/interop/suites/replicatedmap.test.ts`
- CP atomics (AtomicLong / AtomicReference): `test/interop/suites/atomics.test.ts`
- PN counter: `test/interop/suites/pncounter.test.ts`
- flake ID: `test/interop/suites/flakeid.test.ts`

Important truth boundaries:

- the topic interop suite proves **reliable topic**, not standard topic
- there is no official-client interop proof in this spec yet for cache, ringbuffer, transactions, SQL, scheduled executor, executor, or cardinality estimator
- CP interop here is single-member client/server proof, not distributed CP parity

---

## 8. Required HeliosClient removal plan

`HeliosClient` is not part of the parity target and its removal is part of this spec, not a separate optional cleanup.

### 8.1 Removal goal

After removal:

- Helios ships no proprietary remote client SDK
- the sole remote-client story is official `hazelcast-client` compatibility
- parity documentation talks about server/protocol + interop, not a Helios-owned client wrapper

### 8.2 Removal scope

The following categories require cleanup:

1. **Source and exports**
   - `src/client/HeliosClient.ts`
   - `src/client/index.ts`
   - root exports in `src/index.ts`
   - exported `DEFERRED_CLIENT_FEATURES`
   - `package.json` exports for `./client` and `./client/config`

2. **Tests**
   - `test/client/e2e/*.test.ts`
   - `test/client/Block20_*.test.ts`
   - other `HeliosClient`-specific product-contract tests

3. **Docs and examples**
   - `README.md`
   - examples that import `@zenystx/helios-core/client`
   - any plan/spec text that uses retained-client framing

4. **Shared contract wording**
   - `src/core/HeliosInstance.ts` currently describes a shared member/remote contract and must be rewritten once `HeliosClient` is removed
   - `HeliosInstance.ts` comments and related docs must stop referring to `HeliosClient` as part of the core contract

### 8.3 Removal sequence

1. **Deprecate and freeze**
   - add explicit deprecation markers to `HeliosClient` exports and docs
   - stop extending `HeliosClient`
   - stop adding parity claims that depend on it

2. **Promote official-client proof as the sole remote proof**
   - every remote claim in this spec must rely on official-client interop or be marked protocol-only/partial

3. **Replace docs/examples**
   - rewrite README and examples to use `hazelcast-client`

4. **Delete client package surface**
   - remove `src/client/**` exports and package subpath exports

5. **Delete narrowing/deferred-client contract tests**
   - remove `DEFERRED_CLIENT_FEATURES` contract tests and retained-client closure tests
   - remove `DEFERRED_CLIENT_FEATURES` from public exports

6. **Clean shared-type assumptions**
   - remove “shared remote/member contract” wording from `HeliosInstance`

### 8.4 Done gate

HeliosClient removal is complete only when:

- no runtime/docs/examples depend on `HeliosClient`
- no package exports publish `./client` or `./client/config`
- no root exports publish `HeliosClient`, `ClientConfig`, or `DEFERRED_CLIENT_FEATURES`
- `HeliosInstance.ts` comments no longer describe a shared member/remote contract with `HeliosClient`
- no parity claim references a Helios-owned remote client
- every claimed remote topic is backed by official-client interop or marked partial/protocol-only/out-of-scope

---

## 9. Current claim blockers

These are the present blockers that still constrain stronger parity claims:

1. **Handshake compatibility posture**
   - `HELLO` has no explicit protocol/version negotiation metadata.

2. **Malformed frame handling**
   - decode failures are still silently dropped instead of becoming explicit close + reason + metrics/logging events.

3. **Continuous topology publication proof**
   - startup-time client connectivity is proven, but continuous topology-change publication still needs stronger proof.

4. **Selective recovery scope**
   - partition-owned recovery parity is currently limited to supported namespaces (`map`, `queue`, `ringbuffer`).

5. **Durable executor**
   - durable executor handlers remain skeletal / placeholder-backed.

6. **Cache boundary**
   - cache remains distributed cache support, not Java JCache parity, and remains outside supported partition recovery namespace sync.

7. **Single-node CP**
   - CP remains single-node embedded behavior, not distributed multi-member CP parity.

8. **Scheduled executor remote path**
   - scheduled executor member runtime exists, but `ScheduledExecutorMessageHandlers` is not established as an active registered path through `registerAllHandlers()` in this spec.

9. **Serialization beyond retained scope**
   - retained serializer families, schema evolution rules, and client/member compatibility are now audited and proven, but broader Java-only serializer breadth remains intentionally unclaimed outside that retained scope.

10. **Missing official-client proof areas**
    - cache, ringbuffer, transactions, SQL, executor, scheduled executor, and cardinality estimator still need official-client interop proof before stronger remote parity claims.

---

## 10. Execution requirements before final parity claims

The following items convert the current partial / protocol-only status into release gates. A final Hazelcast parity claim is allowed for each topic only when both the implementation gate and the proof gate are satisfied.

For every topic in sections `10.0` through `10.14`, **retained scope** means the exact subset of Hazelcast behavior this plan intends to ship and claim as complete. Behavior outside the retained scope does not block completion, but it must either:

- fail closed with automated proof, or
- remain absent from docs, examples, exports, and parity wording so it is not implied

Topics listed in sections `10.0` through `10.14` are **mandatory completion topics**. They may not be reclassified to `Out of scope`, `unsupported`, `member-only`, or any equivalent narrower status to force the plan to pass.

Retained scope may be narrowed only within the concrete behavior already named in the topic section. It may not be reduced to a trivial or no-op subset simply to satisfy local tests.

### 10.0 Already-proven remote surfaces that still block final completion

These topics are already server/protocol-capable and already have official-client proof in this audit, but they still remain part of the final completion set and may not regress or remain partially claimed at release.

#### 10.0.1 IMap

- **Current status:** Partial
- **Minimum retained scope:** remote IMap must cover the concrete behaviors already claimed in section `6.6`, including partition-routed CRUD, backup-aware behavior, the retained query/predicate surface already proven in official-client suites, and any MapStore or near-cache behavior that remains advertised in final docs/examples
- **Implementation gate:**
  - close any remaining gap between the final retained IMap claim and the actual shipped remote behavior
  - if a behavior remains advertised in docs/examples/exports, it must be fully implemented and tested end to end
- **Proof gate:**
  - keep official-client IMap interop green for the retained scope
  - add multi-member and failure/recovery tests for every retained distributed IMap behavior that still lacks final proof
- **Parity claim rule:**
  - final completion is blocked while IMap remains `Partial`

#### 10.0.2 Queue

- **Current status:** Partial
- **Minimum retained scope:** remote queue must cover the concrete behaviors already claimed in section `6.7`, including offer/poll/peek/size/isEmpty/clear, ordering semantics, and the retained distributed/failure behavior used by the final parity wording
- **Implementation gate:**
  - close any remaining gap between the final retained queue claim and the actual shipped remote behavior
  - if additional queue semantics remain advertised, they must be implemented or removed from the claim
- **Proof gate:**
  - keep official-client queue interop green for the retained scope
  - add multi-member and failure-mode proof for every retained distributed queue behavior still missing final evidence
- **Parity claim rule:**
  - final completion is blocked while Queue remains `Partial`

#### 10.0.3 Already-proven implemented remote surfaces that must not regress

- **Topics:** `List`, `Set`, `MultiMap`, `Reliable topic`, `Replicated map`, `PN Counter`, `Flake ID`
- **Minimum retained scope:**
  - `List` — retain the list behaviors already exercised in `test/interop/suites/collections.test.ts`, including add/get/removeAt/remove(value)/size/contains/clear and insertion-order behavior
  - `Set` — retain the set behaviors already exercised in `test/interop/suites/collections.test.ts`, including add/remove/contains/size/clear and duplicate-elision semantics
  - `MultiMap` — retain the multimap behaviors already exercised in `test/interop/suites/multimap.test.ts`, including put/get/remove/removeAll/containsKey/size/keySet/values
  - `Reliable topic` — retain the reliable-topic behaviors already exercised in `test/interop/suites/topic.test.ts`, including publish, listener registration/removal, multi-listener fanout, ordered delivery of published messages, and message-object payload delivery
  - `Replicated map` — retain the replicated-map behaviors already exercised in `test/interop/suites/replicatedmap.test.ts`, including put/get/remove/size/containsKey/containsValue and overwrite-return semantics
  - `PN Counter` — retain the PN-counter behaviors already exercised in `test/interop/suites/pncounter.test.ts`, including get/addAndGet/subtractAndGet/getAndAdd/getAndSubtract and negative-result behavior
  - `Flake ID` — retain the flake-id behaviors already exercised in `test/interop/suites/flakeid.test.ts`, including non-null generation, uniqueness, positivity, and repeated generation behavior
- **Required rule:** these topics are mandatory completion topics even though they are already marked `Implemented` in section `5`
- **Owning work package:** `WP8`
- **Regression gate:** any loss of official-client proof, any claim mismatch, or any runtime/protocol regression on these topics immediately reopens `WP8` and blocks completion

#### 10.0.4 CP atomics (AtomicLong / AtomicReference)

- **Current status:** Partial
- **Minimum retained scope:** remote CP atomics must cover AtomicLong and AtomicReference behavior already claimed in section `6.14`, including get/set/update operations, compare-and-set behavior, null handling for AtomicReference, and explicit single-node CP scope
- **Implementation gate:**
  - close any remaining gap between the final retained CP-atomics claim and the actual shipped remote behavior
  - keep the claim explicitly embedded single-node unless distributed CP is separately implemented and proven
- **Proof gate:**
  - keep official-client CP atomics interop green for AtomicLong and AtomicReference
  - add any missing failure-mode or reconnect proof required by the final retained CP-atomics claim
- **Parity claim rule:**
  - final completion is blocked while CP atomics remain `Partial`

### 10.1 Standard topic

- **Current status:** Partial
- **Implementation gate:**
  - make standard topic a first-class remote surface, not just a server-side capability beside reliable topic
  - implement and verify publish, subscription, listener registration/removal, ordering, local-vs-remote delivery, and disconnect/reconnect listener lifecycle semantics to match the retained Hazelcast topic scope
  - make loss/overflow semantics explicit so standard topic is not accidentally relying on reliable-topic behavior
- **Proof gate:**
  - add official-client interop coverage using `hazelcast-client.getTopic(...)`
  - prove publish/receive, multiple listeners, remove-listener, member-to-client fanout, and reconnect behavior against a live Helios cluster
  - retain member-side regression tests for topic ordering and listener cleanup under member leave and client disconnect
- **Parity claim rule:**
  - do not promote standard topic beyond partial until official-client standard-topic suites pass

### 10.2 Cache

- **Current status:** Protocol-only
- **Minimum retained scope:** remote distributed cache must cover create/get/put/remove/replace/getAll/putAll/clear/destroy, listener delivery, expiry behavior, invalidation behavior, and explicit recovery semantics for the claimed durability scope
- **Implementation gate:**
  - define the honest retained scope as distributed cache behavior, not Java JCache API parity
  - complete remote cache operations, expiry policies, cache entry/listener events, stats, destroy/close lifecycle, and invalidation behavior
  - decide and document whether near-cache behavior is supported; if yes, implement invalidation correctness and stale-read boundaries
  - either add cache to supported recovery/state-sync scope or explicitly fence parity claims to non-recovered cache state
- **Proof gate:**
  - add official-client interop suites for create/get/put/remove/replace/getAll/putAll/clear/destroy and listener delivery
  - add expiry and invalidation acceptance coverage with a live client and multi-member cluster
  - add recovery tests covering restart or ownership transfer for whatever cache durability scope is claimed
- **Parity claim rule:**
  - final parity language may cover distributed cache only after remote interop and the claimed recovery/expiry semantics are proven; never call this JCache / JSR-107 parity

### 10.3 Ringbuffer

- **Current status:** Protocol-only
- **Implementation gate:**
  - harden ringbuffer capacity, overflow policy, sequence semantics, batch reads, head/tail advancement, and item loss behavior
  - decide whether the service-local wire remains acceptable or must be unified into the canonical cluster message table for the final parity claim
  - verify backup/state-sync behavior and recovery semantics for retained ringbuffer durability scope
- **Proof gate:**
  - add official-client interop suites for add/readOne/readMany/addAll/capacity/size/headSequence/tailSequence/remainingCapacity
  - add multi-member tests for sequence continuity, overflow behavior, and ownership transfer/recovery
  - add reconnect tests to prove client-visible sequence/error semantics match the retained Hazelcast scope
- **Parity claim rule:**
  - ringbuffer cannot move beyond protocol-only until official-client ringbuffer interop passes and retained durability semantics are explicitly tested

### 10.4 Transactions

- **Current status:** Protocol-only
- **Minimum retained scope:** remote transactions must cover begin/commit/rollback, timeout behavior, map + queue participation, duplicate-retry handling, and explicit member-loss outcome semantics for the claimed transaction mode
- **Implementation gate:**
  - define the retained transaction scope precisely: supported transaction types, timeout behavior, supported data structures, and isolation/locking expectations
  - harden begin/prepare/commit/rollback flows, timeout cleanup, retry/idempotency rules, and member-leave failure handling
  - either replicate coordinator state to the extent required by the claim or explicitly narrow the parity statement to member-local coordinator semantics
  - document non-goals such as XA if not implemented
- **Proof gate:**
  - add official-client interop suites for begin/commit/rollback with map and queue operations through live `hazelcast-client` paths
  - add failure tests for member loss during active transaction, prepare/commit interruption, timeout expiry, and duplicate client retry behavior
  - keep durability tests proving exactly what survives restart/failover and what fails closed
- **Parity claim rule:**
  - do not claim transaction parity beyond the explicitly tested retained scope, and do not imply distributed coordinator failover unless it is implemented and proven

### 10.5 Executor

- **Current status:** Partial
- **Minimum retained scope:** plain executor remote scope must cover submit/execute/result/cancel, partition/member targeting, shutdown behavior, and explicit member-loss/retry boundaries; durable executor is excluded unless separately implemented and proven
- **Implementation gate:**
  - separate plain executor parity from durable executor parity; the latter stays unclaimable until it is truly durable
  - harden task submission, partition/member targeting, result retrieval, cancellation, callback/completion behavior, and shutdown lifecycle for the plain executor surface
  - for durable executor, implement durable submission records, result retrieval, dispose semantics, restart/failover behavior, and cleanup lifecycle
- **Proof gate:**
  - add official-client interop suites for plain executor submit/execute/result/cancel against a live cluster if that remote scope is claimed
  - add multi-member execution tests for routing, cancellation, member loss, and retry boundaries
  - add restart/failover recovery tests for durable executor before any durable-executor parity claim
- **Parity claim rule:**
  - the `Executor` topic may be promoted only for the retained plain-executor scope once official-client interop passes for that scope
  - durable executor does not stop completion only if it remains explicitly excluded from docs/parity wording and any durable-only remote surface is inactive/unreachable end to end or fail-closed with automated tests

### 10.6 Scheduled executor

- **Current status:** Partial
- **Implementation gate:**
  - register `ScheduledExecutorMessageHandlers` through the live handler registration path and prove the remote path is active
  - implement one-shot and repeated scheduling, named task lifecycle, cancellation, result retrieval, shutdown/destroy behavior, and partition/member targeting semantics
  - define and implement retained behavior for missed executions, duplicate prevention, and restart/failover handling
- **Proof gate:**
  - add official-client interop suites for schedule, scheduleAtFixedRate, cancel, dispose/destroy, and result retrieval using a live cluster
  - add timing-tolerant acceptance tests for repeated execution, cancellation races, and member leave/restart scenarios
  - add registration-path tests proving the handlers are actually reachable through `registerAllHandlers()`
- **Parity claim rule:**
  - no scheduled executor parity claim is allowed while the remote path is only present in code but not proven active end to end

### 10.7 SQL

- **Current status:** Partial
- **Minimum retained scope:** remote SQL must cover the claimed `execute` path, paging/cursor lifecycle, close/cancel behavior, parameter binding, supported DML/SELECT subset, and explicit unsupported-syntax/error handling
- **Implementation gate:**
  - define the exact retained SQL scope Helios intends to claim, including statement classes, options, supported data sources, and known exclusions from Hazelcast SQL breadth
  - expose the supported SQL surface as a real remote feature with stable cursor paging, close/cancel lifecycle, parameter binding, and error mapping
  - harden reconnect/failure semantics so cursor invalidation, retry, and cancellation behavior are explicit and consistent
- **Proof gate:**
  - add official-client interop suites for `execute`, paging, cursor exhaustion, close, cancel, parameterized statements, and supported DML/SELECT behavior against live Helios members
  - add negative tests for unsupported syntax/options so the narrowed SQL scope is executable and documented
  - add cluster-failure tests for cursor loss, member restart, and cancellation races
- **Parity claim rule:**
  - final parity language must name the retained SQL scope and cannot imply full Hazelcast SQL breadth unless that broader scope is both implemented and proven

### 10.8 Cardinality estimator

- **Current status:** Protocol-only
- **Minimum retained scope:** remote estimator scope must cover add/addHash/estimate, destroy lifecycle, accuracy-tolerance behavior, and explicit ownership/durability semantics for the claimed mode
- **Implementation gate:**
  - verify and harden estimator creation, add/addHash, merge semantics if retained, precision/config behavior, and reset/destroy lifecycle
  - define whether estimator state is partition-owned, replicated, or best-effort only, and align implementation to that claim
- **Proof gate:**
  - add official-client interop suites for add/addHash/estimate and lifecycle behavior through live `hazelcast-client` use
  - add accuracy-tolerance tests and multi-member ownership/restart tests for the retained durability scope
  - add negative tests for invalid input and destroyed-object access behavior
- **Parity claim rule:**
  - do not claim cardinality-estimator parity until remote interop exists and the estimator's durability/accuracy contract is explicitly tested

### 10.9 CP groups, count down latch, and semaphore

- **Current status:** Protocol-only
- **Minimum retained scope:** explicit embedded single-node CP scope for group access, latch init/countDown/await, semaphore acquire/release, timeout handling, destroy lifecycle, contention behavior, and reconnect/session-expiry outcomes
- **Implementation gate:**
  - keep the claim boundary honest: either remain single-node CP only, or implement real multi-member CP semantics before broadening claims
  - for the retained scope, harden group creation/lookup, session ownership, permit/count accounting, timeout behavior, destruction, and retry/idempotency rules
  - make failure behavior explicit for member loss, client reconnect, and session expiration; do not imply Raft-grade distributed CP without actually implementing it
- **Proof gate:**
  - add official-client interop suites for `getCountDownLatch`, `getSemaphore`, and CP group interactions through a live cluster
  - add tests for acquire/release, init/countDown/await, timeout, destroy, concurrent contention, and reconnect behavior
  - if any broader distributed CP claim is made, add multi-member consensus/failover tests; otherwise keep tests and wording explicitly single-member/single-node
- **Parity claim rule:**
  - this topic may be promoted only for explicit embedded single-node CP scope
  - multi-member distributed CP does not block completion unless the claim is widened to include it
  - no document may imply distributed multi-member CP parity without consensus-grade implementation and tests

### 10.10 Topology publication

- **Current status:** Partial
- **Implementation gate:**
  - ensure topology changes are continuously published to connected clients, not just available at startup
  - harden member-add, member-remove, endpoint-update, duplicate-connection resolution, and incompatible-peer rejection flows
  - verify that client-visible membership views converge after rolling join/leave scenarios
- **Proof gate:**
  - add live-client topology tests that observe membership updates after post-start joins, graceful leaves, crashes, and endpoint changes
  - add multi-member acceptance tests for duplicate-connection resolution and incompatible-peer rejection
  - prove `hazelcast-client` cluster view updates without requiring reconnect for the retained scenarios
- **Parity claim rule:**
  - transport/membership parity cannot be elevated while topology publication is only proven for initial connect

### 10.11 Handshake and version negotiation

- **Current status:** Partial
- **Implementation gate:**
  - extend `HELLO` to carry explicit protocol identity and version/capability negotiation metadata
  - implement fail-closed behavior for incompatible protocol versions or required-capability mismatches
  - make compatibility policy explicit for older/newer peer combinations and rolling upgrades
- **Proof gate:**
  - add transport tests for compatible handshake success, incompatible-version rejection, unknown-capability rejection, and downgrade/upgrade behavior where supported
  - add rolling-upgrade style cluster tests proving mixed-version behavior is either supported and correct or rejected deterministically
  - emit and assert structured close reasons / metrics for handshake rejection paths
- **Parity claim rule:**
  - no final transport parity claim is allowed while handshake compatibility is implicit rather than negotiated and explicitly tested

### 10.12 Malformed frame handling

- **Current status:** Partial
- **Implementation gate:**
  - convert decode failures from silent drop behavior into explicit connection close, reason capture, and observable metrics/logging
  - differentiate malformed-length, truncated-frame, unknown-message, and deserialization-failure handling where the protocol contract requires different outcomes
  - guarantee that malformed traffic cannot leave the connection half-open or leak resources
- **Proof gate:**
  - add raw-socket tests for malformed length prefixes, truncated payloads, invalid message bodies, oversized frames, and repeated bad-frame attacks
  - assert explicit close behavior, connection cleanup, and structured metrics/log output for each malformed path
  - add regression tests ensuring one bad connection does not destabilize unrelated peers
- **Parity claim rule:**
  - framing parity remains partial until malformed input handling is explicit, observable, and fail-closed

### 10.13 Recovery scope

- **Current status:** Partial
- **Implementation gate:**
  - replace the current selective-recovery statement with a named supported matrix for each retained service
  - either extend partition-owned recovery/state-sync beyond `map`, `queue`, and `ringbuffer`, or narrow every parity claim to the actually recovered namespaces
  - make service-specific restart/ownership-transfer behavior explicit for cache, transactions, SQL cursors, executor tasks, and estimator state
- **Proof gate:**
  - add recovery suites that kill members during load and verify data/task/state outcomes for every service included in the parity claim
  - add ownership-migration tests for primary/backup transfer and anti-entropy repair on the retained surfaces
  - add negative tests proving excluded services fail closed or restart empty exactly as documented
- **Parity claim rule:**
  - no final parity claim may use generic recovery language; it must match the executed recovery matrix and tests exactly

### 10.14 Serialization breadth

- **Current status:** Implemented
- **Retained families now proven:** primitives, primitive arrays, client-safe enum/list/set payloads, `IdentifiedDataSerializable`, `Portable`, `Compact`, `Compact GenericRecord`, custom serializers, and global serializer fallback behavior
- **Retained evolution and failure guarantees now proven:** additive and subtractive Compact schema evolution succeed; renamed fields, incompatible field-kind changes, nullability mismatches, unknown type IDs, and serializer conflicts fail closed with automated proof
- **Implementation gate:**
  - audit and close retained serialization coverage for primitives, primitive arrays, client-safe enum/list/set payloads, `IdentifiedDataSerializable`, `Portable`, `Compact`, `Compact GenericRecord`, custom serializers, and global serializer behavior
  - define schema evolution rules, nullability behavior, registration/config precedence, and client/member compatibility guarantees
  - remove or formally justify legacy compatibility message paths that would weaken a clean parity statement
- **Proof gate:**
  - add official-client interop and member/client compatibility suites covering round-trip serialization for every retained serializer family
  - add schema-evolution tests for added/removed/renamed fields where that evolution is claimed to work
  - add negative tests for unknown type IDs, serializer conflicts, nullability mismatches, and incompatible schema evolution
- **Parity claim rule:**
  - no final parity claim may describe serialization generically; it must list the retained serializer families and evolution guarantees that are actually proven

---

### 10.15 Autonomous implementation workflow

This plan is intended to be executable by an implementation agent under the instruction:

> Implement this plan and do not stop until it is done.

The workflow below is mandatory.

#### 10.15.1 Execution order

1. **Establish the claim boundary first**
   - confirm the target topic is in scope
   - restate the retained claim exactly as allowed by this plan
   - preserve explicit exclusions before changing code

2. **Implement runtime behavior**
   - close member/runtime or inter-member gaps first
   - do not treat handler presence alone as completion

3. **Activate the remote path**
   - wire or verify the live client-protocol registration path
   - treat code that exists but is not reachable end to end as incomplete

4. **Add or update proof**
   - add automated tests for the exact retained scope
   - use official `hazelcast-client` interop for every remote parity claim
   - add multi-member or failure-mode tests for every distributed claim

5. **Update plan wording last**
   - only promote status after implementation and proof are both green
   - keep wording narrowed to what is actually implemented and tested

#### 10.15.2 Ordered work packages

The implementation agent must execute these work packages in order. A work package may move to `PASS` only when its dependencies are `PASS`, its implementation gate is satisfied, its proof gate is green, and the document wording matches the proven scope.

##### WP0 — Scope lock and harness baseline

- **Depends on:** none
- **Covers:** all sections `10.0` through `10.14`
- **Required outcome:** the minimal shared scaffolding needed by later proof gates exists and is runnable; every in-scope topic has a retained claim boundary, a named proof strategy, a named owning acceptance suite, and a verified runnable harness for official-client, multi-member, restart/recovery, and malformed-input testing where required by that topic's claim
- **Harness verification requirement:** `WP0` is `PASS` only if the harness self-test is checked into the repository, runs in CI, starts a live three-member Helios cluster, executes at least one official-client assertion, executes at least one raw-socket malformed-input assertion, kills and restarts a member, and proves the harness can observe reconnect, recovery, and failure behavior as required by later work packages
- **Harness location rule:**
  - the `WP0` harness self-test must be checked in under `test/interop/suites/`
  - all new official-client interop suites required by this plan must be checked in under `test/interop/suites/*.test.ts`
  - malformed-input and raw-socket protocol suites required by this plan must be checked in under `test/cluster/tcp/*.test.ts` or `test/client/*.test.ts`
  - if a required harness or suite does not yet exist in the repository, that work package remains `FAIL` until the file is created, checked in, and green

##### WP1 — Transport and topology foundation

- **Depends on:** `WP0`
- **Covers:** `10.10 Topology publication`, `10.11 Handshake and version negotiation`, `10.12 Malformed frame handling`
- **Required outcome:** topology changes are continuously client-visible; handshake compatibility is explicit and fail-closed; malformed traffic closes connections deterministically with observable reasons

##### WP2 — Recovery and serialization foundation

- **Depends on:** `WP1`
- **Covers:** `10.0.1 IMap`, `10.0.2 Queue`, `10.0.4 CP atomics`, `10.13 Recovery scope`, `10.14 Serialization breadth`
- **Required outcome:** IMap, Queue, and CP atomics no longer remain partially claimed; the supported recovery matrix is explicit per service; retained serializer families and evolution guarantees are implemented and documented

##### WP3 — Messaging surfaces

- **Depends on:** `WP2`
- **Covers:** `10.1 Standard topic`, `10.3 Ringbuffer`
- **Required outcome:** standard topic and ringbuffer both work as active remote surfaces with retained ordering, overflow, reconnect, lifecycle, and ownership semantics

##### WP4 — Cache and estimator surfaces

- **Depends on:** `WP2`
- **Covers:** `10.2 Cache`, `10.8 Cardinality estimator`
- **Required outcome:** cache scope remains distributed-cache-only and never JCache; retained expiry, invalidation, listener, lifecycle, estimator accuracy, and durability behavior are implemented and explicit

##### WP5 — Transactional and CP surfaces

- **Depends on:** `WP2`
- **Covers:** `10.4 Transactions`, `10.9 CP groups, count down latch, and semaphore`
- **Required outcome:** retained transaction scope and retained CP scope are explicit; unsupported distributed semantics fail closed instead of being implied; timeout, retry, cleanup, and reconnect behavior match the claim

##### WP6 — Compute surfaces

- **Depends on:** `WP2`
- **Covers:** `10.5 Executor`, `10.6 Scheduled executor`
- **Required outcome:** plain executor parity is separated from durable executor parity; scheduled executor handlers are proven active through the real registration path; lifecycle, targeting, cancellation, result, and restart semantics are implemented for the retained scope

##### WP7 — SQL surface

- **Depends on:** `WP2`
- **Covers:** `10.7 SQL`
- **Required outcome:** retained SQL scope is explicit; remote cursor paging, close/cancel lifecycle, parameter binding, reconnect behavior, and error mapping are stable for that exact scope

##### WP8 — HeliosClient removal and parity closure

- **Depends on:** `WP1` AND `WP2` AND `WP3` AND `WP4` AND `WP5` AND `WP6` AND `WP7` (all must be `PASS`)
- **Covers:** section `8` and section `11`
- **Required outcome:** no in-scope topic remains `Partial` or `Protocol-only`; every retained remote claim is proven with official `hazelcast-client`; `HeliosClient` removal gates are satisfied; docs/examples/exports match the completed implementation exactly

#### 10.15.3 Parallelism rule

- default path is strict serial execution: `WP0 -> WP1 -> WP2 -> WP3 -> WP4 -> WP5 -> WP6 -> WP7 -> WP8`
- after `WP2` is `PASS`, implementation and test work for `WP3` through `WP7` may run in parallel, but status promotion and edits to this document must remain serialized
- no two parallel work packages may land overlapping claim-wording changes to this document at the same time
- `WP8` may not start until every prior work package is `PASS`

#### 10.15.4 Rework loop when proof or completion gates fail

- on any red test, immediately mark the current work package `REOPENED`
- on any acceptance-gate failure in section `11` that is not itself a red test (docs/examples/exports/removal/claim mismatch), immediately mark the current or owning work package `REOPENED`
- classify the failure as one of:
  - implementation gap
  - proof gap
  - harness defect
  - claim mismatch
  - completion-gate mismatch
- false-`PASS` detection in a downstream work package also reopens the earliest upstream owning work package whose contract was actually violated
- reopen the earliest work package whose contract was actually violated
- rerun in this order:
  1. failing test subset
  2. package-local acceptance suite
  3. dependency regression suites
  4. full parity suite for any reopened dependency chain
- narrow the claim only within the section-specific retained scope already defined in this plan; if a required behavior named in sections `10.0` through `10.14` would be dropped, the work package remains `FAIL` or `REOPENED` instead of passing by subtraction
- a work package returns to `PASS` only when implementation, proof, and wording are green again

#### 10.15.5 Completion discipline

- do not claim completion while any in-scope topic remains `Partial` or `Protocol-only`
- do not claim completion from type names, handler registration, placeholders, or doc updates alone
- do not claim remote parity without official `hazelcast-client` proof against a live Helios cluster
- do not claim distributed parity from single-node proof
- do not mark work done until code, tests, and document wording all match the same retained scope

For this section, **green** means:

- all named required tests for the current scope pass
- no required test for the claimed scope is skipped, quarantined, placeholder-backed, or replaced by manual verification
- proof exists as checked-in automated tests in the repository and is runnable in CI

**Live Helios cluster** means:

- at least one real Helios member process for purely single-node retained claims
- at least three real Helios member processes for any distributed claim involving membership changes, replication, failover, ownership transfer, recovery, or multi-member semantics

#### 10.15.6 Exclusion handling

- exclusions are hard guardrails, not backlog items
- `Retained-scope exclusion`:
  - behavior outside a topic's retained scope does not block completion
  - do not widen the claim to absorb unimplemented Hazelcast behavior
  - excluded behavior must either fail closed with automated proof or remain absent from docs, examples, exports, and parity wording so it is not implied
- `JCache / JSR-107`:
  - cache work may improve Helios distributed cache behavior only
  - never describe cache work as Java `javax.cache`, `JCache`, or `JSR-107` parity
- `Jet -> Blitz`:
  - Blitz work counts only as Helios-native replacement work
  - never count Blitz implementation as Hazelcast Jet parity credit
- `Distributed CP exclusion`:
  - CP work in this plan may finish at explicit embedded single-node scope
  - never imply Raft-grade or multi-member distributed CP unless it is actually implemented and proven
- if a change would cross an exclusion boundary, narrow the claim instead of widening the wording

---

## 11. Strict acceptance-gate model

### 11.1 Binary completion rule

Final Hazelcast parity is **Complete** only if every required gate below is **PASS**.

If any gate is **FAIL**, the outcome is **Not complete**.

The following never count as completion:

- partial status
- protocol-only status
- handler presence without active end-to-end registration
- single-node proof for a distributed claim
- manual, skipped, placeholder, or doc-only proof

For section `11`, **in-scope topics** means the mandatory completion topics in sections `10.0` through `10.14`.

A proof gate is satisfied only by checked-in automated tests that run in CI. Manual verification, temporary scripts, local-only harnesses, or narrowed ad hoc test subsets never satisfy proof gates.

If a required proof artifact named by this plan does not exist yet, the corresponding topic or work package is automatically `FAIL` until that artifact is added and green.

### 11.2 Per-topic proof gates

Each in-scope topic is **PASS** only when all four conditions are true:

- shipped runtime behavior exists for the claimed scope
- the active remote/client-protocol path exists for the claimed scope
- automated proof passes against a live Helios cluster
- document wording matches exactly what is implemented and proven

Per-topic completion requires these additional proof gates:

- `Transport / framing` — handshake/version behavior and malformed-frame fail-closed behavior are explicitly tested
- `Membership / discovery / topology` — multi-member join/leave/reconnect and continuous topology publication are proven
- `Serialization / data model` — every claimed serializer family and claimed evolution rule is proven member-to-member and client-to-member
- `Partition routing / invocation / backups / recovery` — routing, backup visibility, and every claimed recovery namespace are proven in multi-member failure tests
- `IMap`, `Queue`, `List`, `Set`, `MultiMap`, `Reliable topic`, `Replicated map`, `PN Counter`, `Flake ID` — every claimed remote feature passes official `hazelcast-client` interop
- `Topic` — standard topic has its own official-client proof; reliable-topic proof does not satisfy this gate
- `Cache`, `Ringbuffer`, `Transactions`, `Executor`, `Scheduled executor`, `Cardinality estimator`, `SQL`, `CP groups / Latch / Semaphore` — final parity credit is allowed only after official `hazelcast-client` interop passes for the exact claimed scope
- `CP atomics (AtomicLong / AtomicRef)` and `CP groups / Latch / Semaphore` — any retained claim must explicitly stay scoped to embedded single-node CP unless real distributed CP exists and is proven

### 11.3 Global parity gates

Final Hazelcast parity is **PASS** only when all of the following are true:

- every in-scope topic gate in `11.2` is **PASS**
- no in-scope topic remains `Partial` or `Protocol-only`
- every remote parity claim is proven with the official `hazelcast-client` against a live Helios cluster
- every distributed claim is proven by automated multi-member tests
- all required acceptance suites are green in the repository's normal automated verification flow using existing scripts (`bun test`, `bun run build`, `bun run test:interop`) with no skipped or placeholder coverage for claimed scope
- no script, selector, CI filter, or suite-discovery rule has been weakened to exclude any mandatory suite required by this plan
- docs, README, examples, exports, and the summary matrix match the shipped implementation exactly
- no open blocker remains for any in-scope claimed topic
- a final unconditional full-run verification passes across all claimed official-client interop suites, all claimed multi-member/failure/recovery suites, and all HeliosClient-removal/reference checks

### 11.4 HeliosClient removal gates

`HeliosClient` removal is **PASS** only when all of the following are true:

- `src/client/HeliosClient.ts`, `src/client/index.ts`, and the shipped `src/client/**` remote-client implementation are deleted and are not retained under any renamed, relocated, or dormant proprietary replacement path in the repository
- `package.json` no longer exports `./client` or `./client/config`
- root exports no longer publish `HeliosClient`, `ClientConfig`, or `DEFERRED_CLIENT_FEATURES`
- no active docs, examples, tests, or parity claims depend on `HeliosClient`
- `src/core/HeliosInstance.ts` and related docs no longer describe a shared member/remote contract with `HeliosClient`
- the sole supported remote-client proof story is official `hazelcast-client` interop against Helios
- a repository-wide banned-reference scan finds no maintained references to `HeliosClient`, `ClientConfig`, `DEFERRED_CLIENT_FEATURES`, `@zenystx/helios-core/client`, `./client`, or `./client/config`
- the banned-reference scan may use the repository's existing grep/search tooling, but it must check the exact token list above across `src/`, `test/`, `docs/`, `examples/`, `README.md`, `package.json`, and exported entrypoints; the only allowed exception is this parity plan file itself while it documents the removal requirement

### 11.5 Explicit exclusion gates

These exclusions are mandatory. Violating any one makes the outcome **Not complete**.

- `Retained-scope exclusion` — behavior outside a topic's named retained scope does not block completion, but any docs, examples, exports, handlers, or parity wording that imply excluded behavior is supported are an automatic fail
- `JCache / JSR-107 exclusion` — cache may be claimed only as Helios distributed cache support; any Java `javax.cache`, `JCache`, or `JSR-107` parity claim is an automatic fail
- `Jet -> Blitz exclusion` — Blitz may be described only as a Helios-native replacement; any claim that Blitz work counts as Hazelcast Jet parity or Jet completion credit is an automatic fail
- `Distributed CP exclusion` — CP atomics, CP groups, latch, and semaphore may be claimed only at explicit embedded single-node scope unless real multi-member consensus semantics are implemented and proven; any wording that implies distributed CP parity is an automatic fail

---

## 12. Non-goals

- no proprietary Helios remote client roadmap
- no speculative performance roadmap in this document
- no marketing “full parity” language without proof
- no Java-only claims Helios cannot satisfy

---

## 13. Maintenance rules

- update this document only from code and tests
- do not promote a topic to stronger parity status without official-client interop proof or clearly stated boundaries
- keep replacements and exclusions explicit
- keep protocol-only topics separate from official-client parity topics
