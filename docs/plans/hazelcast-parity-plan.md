# Helios Hazelcast Parity Spec (Current + Delta)

**Version:** 2.0  
**Date:** 2026-03-10  
**Status:** Draft  
**Purpose:** authoritative current-state parity inventory with concrete deltas, not a phase roadmap

---

## 1. Scope

This document records, by topic, what Helios actually implements today, what is wired on the inter-member transport, what is exposed through the server-side client protocol, what is retained on the public `HeliosClient` contract, and which gaps remain before any Hazelcast parity claim is safe.

This document is intentionally conservative:

- no claim is made from names alone
- no claim is made from handler/opcode presence alone
- no claim is made for Java-only surfaces that Helios cannot expose as a TypeScript/Bun runtime
- no claim is made for remote-client parity unless the retained `HeliosClient` surface exposes it

Primary code anchors:

- `src/cluster/tcp/TcpClusterTransport.ts`
- `src/cluster/tcp/BinarySerializationStrategy.ts`
- `src/spi/impl/operationservice/OperationWireCodec.ts`
- `src/instance/impl/HeliosInstanceImpl.ts`
- `src/client/HeliosClient.ts`
- `src/server/clientprotocol/handlers/registerAllHandlers.ts`

---

## 2. Claim rules

### Status legend

- **Implemented** — present in runtime and backed by code/tests
- **Partial** — present, but narrower than Hazelcast or still missing critical parity pieces
- **Not retained** — implementation exists internally or at protocol level, but is intentionally not on the public `HeliosClient` contract
- **Out of scope** — intentionally not claimed as Hazelcast parity

### Surface legend

- **Member runtime** — embedded/member-side behavior
- **Inter-member wire** — cluster TCP protocol between members
- **Client protocol** — server-side Hazelcast-style client protocol handlers
- **Public client** — retained `HeliosClient` API
- **Official client interop** — proof from the official `hazelcast-client` npm package against a live Helios cluster
- **Service-local wire** — ad-hoc inter-member messages defined inside a service implementation, not in the canonical `ClusterMessage` + `BinarySerializationStrategy` table

---

## 3. Explicit exclusions and replacements

### 3.1 Do not claim

| Topic | Accurate statement |
|---|---|
| JCache / JSR-107 | Helios has a distributed cache service and JCache-inspired pieces, but no Java `javax.cache` interop claim is valid in this TypeScript/Bun runtime. |
| Hazelcast Jet | Do not claim Jet parity. Helios uses Blitz as its stream-processing/orchestration replacement. |
| Full remote client parity | Do not claim this. The retained `HeliosClient` surface is intentionally narrower than the server protocol handler surface. |
| Distributed CP parity | Do not claim Hazelcast CP parity. Current CP implementation is single-node embedded Raft-like behavior, not multi-member distributed CP consensus. |
| Hot restart / persistence parity | Not claimable from this audit. |
| WAN replication parity | Not claimable from this audit. |

### 3.2 Helios replacements

| Hazelcast concept | Helios reality |
|---|---|
| Jet | **Blitz** (`getJet()` currently returns the Blitz service handle) |
| Java JCache API | **Distributed cache service** with JCache-inspired concepts, but not Java API compatibility |
| Broad remote client surface | **Retained `HeliosClient` contract** enforced by retained-service gating, with additional excluded capabilities listed in `DEFERRED_CLIENT_FEATURES` |

---

## 4. Summary matrix

| Topic | Member runtime | Inter-member wire | Client protocol | Public client | Official client interop | Honest status | Main gap |
|---|---|---|---|---|---|---|---|
| Transport / framing | Yes | Yes | N/A | N/A | Indirect via interop suites | Implemented | No protocol negotiation in `HELLO`; malformed frame handling is too quiet |
| Membership / discovery | Yes | Yes | Partial | Partial | Partial | Partial | client topology publication is wired at startup, but continuous topology-change push is not wired |
| Serialization / data model | Yes | Yes | Yes | Yes | Indirect via interop suites | Partial | serializer breadth, evolution semantics, and legacy JSON compatibility paths are not yet parity-audited end to end |
| Partition routing / invocation / recovery | Yes | Yes | N/A | N/A | Indirect via interop suites | Partial | recovery support is selective; migration parity still needs targeted audit |
| IMap | Yes | Yes | Yes | Yes | Yes | Partial | retained client API is narrower than full broader server/interop map breadth |
| Queue | Yes | Yes | Yes | Yes | Yes | Partial | retained client API is narrower than the broader server/interop queue breadth |
| List | Yes | Yes | Yes | No | Yes | Implemented on server/client-protocol/interop surface; not retained on `HeliosClient` | no retained `HeliosClient` list proxy |
| Set | Yes | Yes | Yes | No | Yes | Implemented on server/client-protocol/interop surface; not retained on `HeliosClient` | no retained `HeliosClient` set proxy |
| MultiMap | Yes | Yes | Yes | No | Yes | Implemented on server/client-protocol/interop surface; not retained on `HeliosClient` | no retained `HeliosClient` multimap proxy |
| Topic | Yes | Yes | Yes | Yes | Yes | Partial | retained remote standard topic includes publish and listeners; reliable topic is outside retained `HeliosClient` |
| Reliable topic | Yes | Yes | No retained `HeliosClient` surface | No | Yes | Implemented on member/server/interop surface; not retained on `HeliosClient` | explicitly excluded from retained remote client |
| Replicated map | Yes | Yes | Yes | No | Yes | Implemented on server/client-protocol/interop surface; not retained on `HeliosClient` | no retained `HeliosClient` replicated-map proxy |
| Cache | Yes | service-local | Yes | No | Not proven in official interop here | Partial / not retained | no Java JCache claim; no retained client cache; partition recovery excludes cache |
| Ringbuffer | Yes | service-local | Yes | No | Not proven in official interop here | Partial / not retained | not on retained client; wire path is not unified into `ClusterMessage` |
| Executor | Yes | Yes | Yes | No | Not proven in official interop here | Partial / not retained | durable executor retrieval/dispose path is placeholder-only |
| Scheduled executor | Yes | Yes (generic ops) | No | No | Not proven in official interop here | Partial / not retained | no registered scheduled-executor client protocol handlers; not on retained client |
| Transactions | Yes | Yes | Yes | No | Not proven in official interop here | Partial / not retained | coordinator state is member-local; no retained remote API |
| CP / AtomicLong / AtomicRef / Latch / Semaphore | Yes | No | Yes | No | Partial | Partial / not retained | single-node CP implementation only; official interop proof in this audit is strongest for atomic long and atomic reference |
| PN Counter / Flake ID / Cardinality | Yes | not audited here | Yes | No | Partial | Partial / not retained | PN counter and flake ID have official interop proof; cardinality is not on retained public client |
| SQL | Yes | N/A | Yes | No | Not proven in official interop here | Partial / not retained | IMap-focused SQL, not full Hazelcast SQL surface |
| Blitz | Yes | Yes | N/A | via `getJet()` on member | N/A | Replacement, not parity | do not call this Jet parity |

---

## 5. Topic details

## 5.1 Transport, framing, and binary protocol

### What exists

- `TcpClusterTransport` defaults to `BinarySerializationStrategy`, not JSON.
- Framing is `[uint32 length][binary payload]`.
- Read path uses a stateful per-channel decoder with grow/compact behavior; no `Buffer.concat` hot-path framing remains.
- Outbound writes use `OutboundBatcher` with:
  - write-through when the channel is idle
  - microtask flush batching
  - 1ms idle flush backstop
- Scatter outbound encoding is integrated and can fall back to synchronous binary encoding while preserving accepted-send order.
- `WireBufferPool` is already active for binary encode/decode buffers.

### Code anchors

- `src/cluster/tcp/TcpClusterTransport.ts`
- `src/cluster/tcp/BinarySerializationStrategy.ts`
- `src/cluster/tcp/OutboundBatcher.ts`
- `src/cluster/tcp/ScatterOutboundEncoder.ts`
- `src/internal/util/WireBufferPool.ts`

### Validation evidence

- `test/cluster/tcp/BinarySerializationStrategy.test.ts`
- `test/cluster/tcp/OutboundBatcher.test.ts`
- `test/cluster/tcp/ScatterOutboundEncoder.test.ts`
- `test/cluster/tcp/TcpProtocolUpgradeTest.test.ts`

### Current gaps / non-claims

- `HELLO` currently carries only `nodeId`; there is no negotiated protocol/version metadata.
- Mixed-protocol or rolling-upgrade compatibility is **not claimable** from the current implementation.
- Decode failures in `_onData()` are currently swallowed rather than forcing an explicit close + reason path.
- Cache and ringbuffer inter-member messages are still service-local unions, not unified into the canonical `ClusterMessage` / `BinarySerializationStrategy` surface.

---

## 5.2 Cluster membership, discovery, and topology propagation

### What exists

- Member join flow uses `HELLO`, `JOIN_REQUEST`, `FINALIZE_JOIN`, `MEMBERS_UPDATE`, `PARTITION_STATE`, `FETCH_MEMBERS_VIEW`, and `MEMBERS_VIEW_RESPONSE`.
- TCP/IP and multicast-based discovery are present.
- `JOIN_REQUEST` and `WireMemberInfo` already carry REST endpoint data.
- Member transport wiring in `HeliosInstanceImpl` dispatches cluster-control messages through the cluster coordinator.
- Client topology publication exists at server startup through `TopologyPublisher`.

### Code anchors

- `src/cluster/tcp/ClusterMessage.ts`
- `src/cluster/tcp/BinarySerializationStrategy.ts`
- `src/instance/impl/HeliosClusterCoordinator.ts`
- `src/instance/impl/HeliosInstanceImpl.ts`

### Validation evidence

- `test/cluster/tcp/TcpProtocolUpgradeTest.test.ts`
- `test/internal/cluster/impl/MembersView.test.ts`
- `test/instance/HeliosInstanceImplTest.ts`

### Current gaps / non-claims

- Client topology publication is currently wired at startup, but this audit did not find continuous topology-change publication wired into the runtime path.
- Duplicate connection resolution, node-id collision handling, and explicit incompatible-peer rejection need stronger rollout-grade verification.

---

## 5.3 Partition routing, invocation lifecycle, backup acks, and recovery

### What exists

- Member-to-member operation routing uses `OPERATION`, `OPERATION_RESPONSE`, `BACKUP`, and `BACKUP_ACK`.
- Operation payloads are serialized through `OperationWireCodec` with `IdentifiedDataSerializableRegistry`.
- `InvocationMonitor` handles:
  - timeouts
  - duplicate responses
  - late responses
  - late backup acks
  - backup-ack deadlines
  - member-left failure propagation
- Recovery messages are implemented for anti-entropy and sync transfer.
- Address-to-member lookup caching and serialized-key reuse in map hot paths are already implemented.

### Code anchors

- `src/spi/impl/operationservice/OperationWireCodec.ts`
- `src/instance/impl/InvocationMonitor.ts`
- `src/instance/impl/HeliosInstanceImpl.ts`
- `src/internal/partition/impl/InternalPartitionServiceImpl.ts`
- `src/map/impl/MapProxy.ts`

### Validation evidence

- `test/cluster/tcp/BackupAckParity.test.ts`
- `test/cluster/tcp/OwnerRoutedMapTest.test.ts`
- `test/instance/InvocationMonitor.test.ts`

### Current gaps / non-claims

- Recovery support is intentionally selective in the partition service. Current supported namespace replication wiring is `map`, `queue`, and `ringbuffer`.
- Cache, SQL, and transaction coordinator state are explicitly excluded from partition-state replication in `InternalPartitionServiceImpl`.
- Full migration parity should **not** be claimed without a fresh targeted audit of migration execution behavior.

---

## 5.4 Serialization and data model

### What exists

- Helios has shared serialization infrastructure for member runtime, inter-member transport, and remote-client protocol flows.
- Core building blocks already in use include:
  - `SerializationServiceImpl`
  - `HeapData` / `Data`
  - `ByteArrayObjectDataInput` / `ByteArrayObjectDataOutput`
  - `IdentifiedDataSerializableRegistry`
  - `DataWireCodec`
- Canonical operation payloads and most cluster transport payloads are binary.
- Public remote client flows also rely on the same general serialization foundations.

### Code anchors

- `src/internal/serialization/impl/SerializationServiceImpl.ts`
- `src/internal/serialization/impl/ByteArrayObjectDataInput.ts`
- `src/internal/serialization/impl/ByteArrayObjectDataOutput.ts`
- `src/internal/serialization/impl/HeapData.ts`
- `src/internal/serialization/IdentifiedDataSerializableRegistry.ts`
- `src/cluster/tcp/DataWireCodec.ts`

### Validation evidence

- `test/internal/serialization/impl/SerializationServiceImplTest.test.ts`
- `test/internal/serialization/impl/HeliosInstanceSerializationWiringTest.test.ts`
- `test/internal/serialization/impl/SerializerPrimitivesTest.test.ts`
- `test/internal/serialization/impl/DataSerializableSerializerTest.test.ts`
- `test/internal/serialization/impl/HeapDataTest.test.ts`
- `test/internal/serialization/impl/ByteArrayObjectDataInputTest.test.ts`
- `test/internal/serialization/impl/ByteArrayObjectDataOutputTest.test.ts`

### Current gaps / non-claims

- Do **not** claim full Hazelcast serialization parity from this document yet.
- Serializer breadth, schema-evolution behavior, and client/member serializer compatibility need a dedicated parity inventory before stronger claims are safe.
- Legacy compatibility messages that still carry `unknown` values (`MAP_PUT`, `MAP_REMOVE`, `MAP_CLEAR`, `INVALIDATE`) use JSON string payload embedding inside the binary envelope, so the entire system is not yet uniformly typed-binary.

---

## 5.5 Remote client contract vs broader server protocol surface

### What exists

- The server registers a broad client-protocol handler surface through `registerAllHandlers()`, including client-service/topology handlers, near-cache invalidation handlers, and service handlers for:
  - map
  - queue
  - topic
  - list
  - set
  - multimap
  - replicated map
  - ringbuffer
  - cache
  - transaction
  - SQL
  - executor
  - CP
  - flake ID
  - PN counter
  - cardinality estimator
- The retained public `HeliosClient` surface exposes:
  - `connect()`
  - `getMap()`
  - `getQueue()`
  - `getTopic()`
  - `getDistributedObject()` for retained service names (`hz:impl:mapService`, `hz:impl:queueService`, `hz:impl:topicService`)
  - `getCluster()`
  - `getLifecycleService()`
  - `getConfig()`
  - `getName()`
  - `shutdown()`
- Additional exclusions are enforced by retained-service gating in `HeliosClient`, with explicit deferred capability names including `cache`, `query-cache`, `transactions`, `sql`, `reliable-topic-client`, `executor`, `pn-counter`, `flake-id-generator`, `scheduled-executor`, and `cardinality-estimator`.
- Separate from the retained `HeliosClient` contract, the member/server surface already has broader end-to-end proof through the official `hazelcast-client` npm package for connection/lifecycle, map, queue, list, set, multimap, reliable topic, replicated map, CP atomics, PN counter, and flake ID.

### Code anchors

- `src/server/clientprotocol/handlers/registerAllHandlers.ts`
- `src/client/HeliosClient.ts`

### Validation evidence

- `test/client/e2e/ClientStartupE2E.test.ts`
- `test/client/e2e/ClientProxyLifecycleE2E.test.ts`
- `test/client/e2e/ClientExternalBunAppE2E.test.ts`
- `test/client/Block20_4_ClientConnectionInvocationServices.test.ts`
- `test/client/Block20_5_ServerCapabilityClosure.test.ts`
- `test/client/Block20_6_ProxyManagerDistributedObjectProxies.test.ts`
- `test/client/ClientProtocolAdapterChunk1.test.ts`
- `test/client/ListProtocolAdapter.test.ts`
- `test/client/SetMultiMapProtocolAdapter.test.ts`
- `test/client/ReplicatedMapRingbufferProtocolAdapter.test.ts`
- `test/client/CacheProtocolAdapter.test.ts`
- `test/client/TransactionProtocolAdapter.test.ts`
- `test/client/SqlExecutorProtocolAdapter.test.ts`
- `test/client/CpProtocolAdapter.test.ts`

### Current gaps / non-claims

- Do **not** claim public remote-client parity beyond the retained `HeliosClient` contract.
- Presence of a server-side handler or protocol adapter test is not enough to claim a supported public remote feature.

---

## 5.6 IMap

### What exists

- Embedded/member-side map service is strong and is one of the best-covered surfaces in the codebase.
- Current audited implementation includes:
  - partition-routed CRUD operations
  - backup-aware operations
  - near-cache invalidation path
  - MapStore/MapLoader integration paths
  - map query/index-related code and tests
  - retained `HeliosClient` map proxy support for `put`, `get`, `remove`, `size`, `containsKey`, `clear`, `isEmpty`, `set`, and `delete`
  - broader official `hazelcast-client` interop coverage beyond the retained `HeliosClient` API

### Code anchors

- `src/map/impl/MapProxy.ts`
- `src/map/impl/operation/*`
- `src/server/clientprotocol/handlers/MapServiceHandlers.ts`
- `src/client/proxy/ClientMapProxy.ts`

### Validation evidence

- `test/cluster/tcp/OwnerRoutedMapTest.test.ts`
- `test/map/MapProxyOperationRoutingTest.test.ts`
- `test/map/MapProxyTest.test.ts`
- `test/map/impl/query/IndexedMapQueryTest.test.ts`
- `test/map/mapstore/MapStoreIntegration.test.ts`
- `test/client/e2e/ClientMapE2E.test.ts`
- `test/client/map/impl/nearcache/NearCachedClientMapProxy.test.ts`
- `test/interop/suites/map.test.ts`

### Current gaps / non-claims

- Do not claim full Hazelcast IMap breadth on the retained `HeliosClient` surface. The retained client proxy is intentionally narrower than the broader server/client-protocol surface.
- In particular, the retained `ClientMapProxy` does not expose the broader handler-backed surface for entry listeners, locks, bulk ops, iteration methods, or entry processors.
- Advanced map parity items still need topic-by-topic confirmation before claim, especially around entry processors, advanced listener filtering, and complete async API breadth.
- TTL/max-idle parity should remain conservative unless re-audited end-to-end.

---

## 5.7 Queue

### What exists

- Embedded/member queue service is implemented.
- Queue has dedicated inter-member messages:
  - `QUEUE_REQUEST`
  - `QUEUE_RESPONSE`
  - `QUEUE_STATE_SYNC`
  - `QUEUE_STATE_ACK`
  - `QUEUE_EVENT`
- Queue is retained on `HeliosClient`.
- The retained `ClientQueueProxy` supports `offer`, `poll`, `peek`, `size`, `isEmpty`, and `clear`.
- Official `hazelcast-client` interop also proves broader queue client behavior beyond the retained `HeliosClient` API.

### Code anchors

- `src/collection/impl/queue/DistributedQueueService.ts`
- `src/server/clientprotocol/handlers/QueueServiceHandlers.ts`
- `src/client/proxy/ClientQueueProxy.ts`

### Validation evidence

- `test/collection/queue/QueueTest.test.ts`
- `test/client/e2e/ClientQueueE2E.test.ts`
- `test/interop/suites/queue.test.ts`

### Current gaps / non-claims

- The retained `ClientQueueProxy` does not expose the broader queue handler surface for item listeners, blocking operations, or other non-retained APIs.
- Queue parity should still be claimed conservatively around failover/idempotence/order edge cases until a stronger cluster fault-injection matrix is written into this spec.
- Replication is state-sync based, not a claim of Hazelcast-identical internals.

---

## 5.8 List, Set, and MultiMap

### What exists

- Embedded/member services exist for list, set, and multimap.
- Inter-member binary messages exist for all three families.
- Server-side client protocol handlers exist for all three families.

### Code anchors

- `src/collection/impl/list/DistributedListService.ts`
- `src/collection/impl/set/DistributedSetService.ts`
- `src/multimap/impl/DistributedMultiMapService.ts`
- corresponding client protocol handlers in `src/server/clientprotocol/handlers/*`

### Validation evidence

- `test/collection/list/ListTest.test.ts`
- `test/collection/set/SetTest.test.ts`
- `test/multimap/MultiMapTest.test.ts`
- `test/client/ListProtocolAdapter.test.ts`
- `test/client/SetMultiMapProtocolAdapter.test.ts`
- `test/interop/suites/collections.test.ts`
- `test/interop/suites/multimap.test.ts`

### Current gaps / non-claims

- These topics are **not retained** on the public `HeliosClient` contract.
- End-to-end server/client-protocol support exists here, including official `hazelcast-client` interop proof, but that is separate from the retained `HeliosClient` contract.
- Do not claim retained `HeliosClient` parity for list, set, or multimap until public proxies are part of the retained contract.
- Replication behavior is implemented, but exact Hazelcast semantic equivalence is not yet claimable from this audit.

---

## 5.9 Topic and reliable topic

### What exists

- Standard distributed topic is implemented member-side and retained on `HeliosClient`.
- Retained remote topic support includes `publish()`, `publishAsync()`, `addMessageListener()`, and `removeMessageListener()`.
- Reliable topic is implemented member-side with dedicated inter-member messages:
  - `RELIABLE_TOPIC_PUBLISH_REQUEST`
  - `RELIABLE_TOPIC_PUBLISH_ACK`
  - `RELIABLE_TOPIC_MESSAGE`
  - `RELIABLE_TOPIC_BACKUP`
  - `RELIABLE_TOPIC_BACKUP_ACK`
  - `RELIABLE_TOPIC_DESTROY`
- Normal topic messages are also present on the binary transport.
- Official `hazelcast-client` interop currently proves reliable-topic end-to-end behavior on the broader server surface.

### Code anchors

- `src/topic/impl/DistributedTopicService.ts`
- `src/topic/impl/reliable/ReliableTopicService.ts`
- `src/server/clientprotocol/handlers/TopicServiceHandlers.ts`
- `src/client/proxy/ClientTopicProxy.ts`

### Validation evidence

- `test/client/e2e/ClientTopicE2E.test.ts`
- `test/client/e2e/ClientReconnectListenerRecoveryE2E.test.ts`
- `test/topic/ReliableTopicService.test.ts`
- `test/topic/ReliableTopicServiceBacked.test.ts`
- `test/topic/ReliableTopicPublishCompletion.test.ts`
- `test/interop/suites/topic.test.ts`

### Current gaps / non-claims

- Retained `HeliosClient` support is limited to standard topic.
- Reliable topic is explicitly **not retained** on the public remote-client contract.
- `test/client/e2e/ClientReliableTopicE2E.test.ts` exists specifically to prove the feature is narrowed out of `HeliosClient`, not to disprove broader server/client-protocol support.

---

## 5.10 Replicated map and ringbuffer

### What exists

- Replicated map has embedded runtime support, binary message coverage, and server-side protocol handlers.
- Ringbuffer has embedded distributed service support and server-side protocol handlers.
- Ringbuffer inter-member wire uses a service-local message family:
  - `RINGBUFFER_REQUEST`
  - `RINGBUFFER_RESPONSE`
  - `RINGBUFFER_BACKUP`
  - `RINGBUFFER_BACKUP_ACK`

### Code anchors

- `src/replicatedmap/impl/DistributedReplicatedMapService.ts`
- `src/ringbuffer/impl/DistributedRingbufferService.ts`
- `src/server/clientprotocol/handlers/ReplicatedMapServiceHandlers.ts`
- `src/server/clientprotocol/handlers/RingbufferServiceHandlers.ts`

### Validation evidence

- `test/client/ReplicatedMapRingbufferProtocolAdapter.test.ts`
- `test/ringbuffer/impl/ArrayRingbuffer.test.ts`
- `test/ringbuffer/impl/RingbufferContainer.test.ts`
- `test/interop/suites/replicatedmap.test.ts`

### Current gaps / non-claims

- Replicated map has real end-to-end official `hazelcast-client` interop proof, but it is not retained on the public `HeliosClient` surface.
- Ringbuffer has member/runtime and protocol-adapter proof in this audit, but not a retained `HeliosClient` surface.
- Ringbuffer wire format is not yet unified into canonical `ClusterMessage` / `BinarySerializationStrategy` coverage.
- Do not claim retained remote-client parity here.

---

## 5.11 Cache and JCache-related surface

### What exists

- Helios has a distributed cache service with service-local inter-member messages:
  - `CACHE_REQUEST`
  - `CACHE_RESPONSE`
  - `CACHE_STATE_SYNC`
  - `CACHE_STATE_ACK`
- Server-side client protocol cache handlers exist.
- Client-side near-cache helper code exists for cache protocol flows.

### Code anchors

- `src/cache/impl/DistributedCacheService.ts`
- `src/server/clientprotocol/handlers/CacheServiceHandlers.ts`
- `src/cache/impl/JCacheDetector.ts`
- `src/client/cache/impl/nearcache/NearCachedClientCacheProxy.ts`

### Validation evidence

- `test/client/CacheProtocolAdapter.test.ts`
- `test/cache/recordstore/CacheRecordStoreTest.test.ts`
- `test/client/cache/impl/nearcache/NearCachedClientCacheProxy.test.ts`

### Current gaps / non-claims

- Do **not** claim Java JCache / JSR-107 parity or `javax.cache` interop.
- `HeliosClient` does not retain cache on its public contract.
- `InternalPartitionServiceImpl` explicitly excludes cache from supported partition-owned recovery namespace replication.
- The cache wire family is service-local, not part of the canonical shared cluster message inventory.

---

## 5.12 Executor and scheduled executor

### What exists

- Executor service exists member-side.
- Executor operation payloads are part of `OperationWireCodec` and use generic operation routing.
- Server-side client protocol handlers exist for executor and durable executor opcodes.
- Scheduled executor also exists member-side, uses generic operation routing, and has substantial test coverage.
- A standalone `ScheduledExecutorMessageHandlers.ts` exists, but it is not registered through `registerAllHandlers()`.

### Code anchors

- `src/executor/impl/*`
- `src/server/clientprotocol/handlers/ExecutorServiceHandlers.ts`
- `src/server/clientprotocol/ScheduledExecutorMessageHandlers.ts`
- `src/scheduledexecutor/impl/*`

### Validation evidence

- `test/executor/impl/ExecutorE2EAcceptanceTest.test.ts`
- `test/executor/impl/ExecutorMultiNodeIntegrationTest.test.ts`
- `test/client/SqlExecutorProtocolAdapter.test.ts`
- `test/scheduledexecutor/impl/ScheduledExecutorOperationsTest.test.ts`
- `test/scheduledexecutor/ScheduledExecutorAcceptanceTest.test.ts`

### Current gaps / non-claims

- `HeliosClient` explicitly excludes executor and scheduled executor from the retained public contract.
- Scheduled executor has no registered server-side client protocol surface in the active handler registry.
- Durable executor handlers are skeletal / placeholder-backed: submit returns a synthetic sequence, retrieve paths return `null`, and dispose is effectively a no-op; durable executor parity is **not claimable**.

---

## 5.13 Transactions

### What exists

- Member-side transaction runtime exists.
- Client protocol handlers exist for transaction operations.
- Inter-member transaction backup replication messages are part of the canonical binary cluster message surface:
  - `TXN_BACKUP_REPLICATION`
  - `TXN_BACKUP_REPLICATION_ACK`

### Code anchors

- `src/transaction/impl/TransactionManagerServiceImpl.ts`
- `src/server/clientprotocol/handlers/TransactionServiceHandlers.ts`
- `src/cluster/tcp/ClusterMessage.ts`
- `src/instance/impl/HeliosInstanceImpl.ts`

### Validation evidence

- `test/transaction/impl/TransactionClusterDurabilityTest.test.ts`
- `test/transaction/impl/TransactionImpl_TwoPhaseTest.test.ts`
- `test/client/TransactionProtocolAdapter.test.ts`

### Current gaps / non-claims

- `HeliosClient` explicitly excludes transactions from the retained remote contract.
- `InternalPartitionServiceImpl` explicitly states that transaction coordinator state is member-local and not partition-replicated.
- Do not claim full Hazelcast remote transaction parity.

---

## 5.14 CP subsystem and linearizable primitives

### What exists

- CP-related services and server-side handlers exist for:
  - CP group creation/destruction
  - atomic long
  - atomic reference
  - count down latch
  - semaphore

### Code anchors

- `src/cp/impl/CpSubsystemService.ts`
- `src/server/clientprotocol/handlers/CpServiceHandlers.ts`

### Validation evidence

- `test/client/CpProtocolAdapter.test.ts`
- `test/interop/suites/atomics.test.ts`

### Current gaps / non-claims

- Current `CpSubsystemService` is explicitly a **single-node embedded implementation**.
- Do not claim Hazelcast distributed CP / multi-member Raft parity.
- None of these are retained on the public `HeliosClient` contract today.
- In this audit, official interop proof is strongest for atomic long and atomic reference; the broader CP primitive surface still relies on direct protocol-adapter proof.

---

## 5.15 PN counter, flake ID, and cardinality estimator

### What exists

- Server-side client protocol handlers exist for PN counter, flake ID generator, and cardinality estimator.
- Member-side services exist for each of these utility primitives.

### Code anchors

- `src/server/clientprotocol/handlers/PnCounterServiceHandlers.ts`
- `src/server/clientprotocol/handlers/FlakeIdServiceHandlers.ts`
- `src/server/clientprotocol/handlers/CardinalityServiceHandlers.ts`
- `src/crdt/impl/PNCounterService.ts`
- `src/flakeid/impl/FlakeIdGeneratorService.ts`
- `src/cardinality/impl/DistributedCardinalityEstimatorService.ts`

### Validation evidence

- `test/client/FlakePnCardinalityProtocolAdapter.test.ts`
- `test/interop/suites/pncounter.test.ts`
- `test/interop/suites/flakeid.test.ts`

### Current gaps / non-claims

- None of these are retained on the public `HeliosClient` contract today.
- Official interop proof exists in this audit for PN counter and flake ID; cardinality estimator remains outside the retained `HeliosClient` surface and does not yet have the same level of interop proof in this document.

---

## 5.16 SQL

### What exists

- Helios has a SQL service over IMap-backed data.
- Current SQL support is centered on `SELECT`, `INSERT`, `UPDATE`, and `DELETE` over IMap data with cursor handling and cancellation.
- Server-side SQL client protocol handlers exist.

### Code anchors

- `src/sql/impl/SqlService.ts`
- `src/server/clientprotocol/handlers/SqlServiceHandlers.ts`

### Validation evidence

- `test/client/SqlExecutorProtocolAdapter.test.ts`

### Current gaps / non-claims

- Do **not** claim full Hazelcast SQL parity.
- Current SQL is IMap-oriented and materially narrower than Hazelcast SQL.
- `HeliosClient` explicitly excludes SQL from the retained public contract.

---

## 5.17 Blitz as the Jet replacement

### What exists

- Blitz integration is real and deeply wired into `HeliosInstanceImpl`.
- `getJet()` currently returns the Blitz service handle.
- Dedicated cluster messages exist for Blitz topology and registration:
  - `BLITZ_NODE_REGISTER`
  - `BLITZ_NODE_REMOVE`
  - `BLITZ_TOPOLOGY_REQUEST`
  - `BLITZ_TOPOLOGY_RESPONSE`
  - `BLITZ_TOPOLOGY_ANNOUNCE`

### Code anchors

- `src/instance/impl/HeliosInstanceImpl.ts`
- `src/cluster/tcp/ClusterMessage.ts`

### Validation evidence

- `test/blitz/BlitzServiceStandaloneJobExecution.test.ts`
- `test/blitz/job/BlitzJobSupervisionE2ETest.test.ts`
- `test/blitz/job/BlitzJobExecutorTest.test.ts`

### Current gaps / non-claims

- Do **not** claim Hazelcast Jet parity.
- Blitz is a Helios replacement, not a statement of Jet compatibility or equivalent runtime architecture.

---

## 6. Canonical inter-member message coverage

The canonical binary transport currently covers these shared message families inside `BinarySerializationStrategy`:

- connection and cluster control
- operation routing and responses
- backup and backup ack
- recovery sync and anti-entropy
- queue
- topic and reliable topic
- Blitz
- list
- set
- multimap
- replicated map
- transaction backup replication

The message id table currently runs from `1` through `60` in `BinarySerializationStrategy`.

Important current truth:

- `OPERATION_RESPONSE` carries `backupAcks` and `backupMemberIds`
- `BACKUP` carries `senderId`, `callerId`, `sync`, and `replicaVersions`
- `JOIN_REQUEST` carries `joinerRestEndpoint`
- `WireMemberInfo` carries `restEndpoint`
- list/set/multimap/replicated-map/transaction-backup message families are already part of the canonical binary table

Service-local, not yet canonicalized into the shared message table:

- cache wire family, defined inside `src/cache/impl/DistributedCacheService.ts`
- ringbuffer wire family, defined inside `src/ringbuffer/impl/DistributedRingbufferService.ts`

---

## 7. Validation anchors by topic

This spec should treat the following as the minimum proof set already in place:

- binary transport round trips: `test/cluster/tcp/BinarySerializationStrategy.test.ts`
- frame decoder / batching / scatter ordering: `test/cluster/tcp/TcpProtocolUpgradeTest.test.ts`, `test/cluster/tcp/OutboundBatcher.test.ts`, `test/cluster/tcp/ScatterOutboundEncoder.test.ts`
- invocation / backup ack semantics: `test/instance/InvocationMonitor.test.ts`, `test/cluster/tcp/BackupAckParity.test.ts`
- owner-routed map flow: `test/cluster/tcp/OwnerRoutedMapTest.test.ts`
- retained `HeliosClient` e2e: `test/client/e2e/ClientStartupE2E.test.ts`, `test/client/e2e/ClientProxyLifecycleE2E.test.ts`, `test/client/e2e/ClientMapE2E.test.ts`, `test/client/e2e/ClientQueueE2E.test.ts`, `test/client/e2e/ClientTopicE2E.test.ts`, `test/client/e2e/ClientReconnectListenerRecoveryE2E.test.ts`, `test/client/e2e/ClientExternalBunAppE2E.test.ts`
- retained `HeliosClient` contract and proxy-closure tests: `test/client/Block20_4_ClientConnectionInvocationServices.test.ts`, `test/client/Block20_5_ServerCapabilityClosure.test.ts`, `test/client/Block20_6_ProxyManagerDistributedObjectProxies.test.ts`, `test/client/Block20_7_NearCacheAdvancedFeatureClosure.test.ts`
- remote protocol adapters: `test/client/CacheProtocolAdapter.test.ts`, `test/client/CpProtocolAdapter.test.ts`, `test/client/ListProtocolAdapter.test.ts`, `test/client/ReplicatedMapRingbufferProtocolAdapter.test.ts`, `test/client/SetMultiMapProtocolAdapter.test.ts`, `test/client/SqlExecutorProtocolAdapter.test.ts`, `test/client/TransactionProtocolAdapter.test.ts`, `test/client/ClientProtocolAdapterChunk1.test.ts`, `test/client/FlakePnCardinalityProtocolAdapter.test.ts`
- official `hazelcast-client` interop: `test/interop/suites/connection.test.ts`, `test/interop/suites/lifecycle.test.ts`, `test/interop/suites/map.test.ts`, `test/interop/suites/queue.test.ts`, `test/interop/suites/collections.test.ts`, `test/interop/suites/multimap.test.ts`, `test/interop/suites/topic.test.ts`, `test/interop/suites/replicatedmap.test.ts`, `test/interop/suites/atomics.test.ts`, `test/interop/suites/pncounter.test.ts`, `test/interop/suites/flakeid.test.ts`

---

## 8. Current claim blockers

These are the present-state blockers that still constrain stronger parity claims:

1. **Transport compatibility posture**
   - `HELLO` has no protocol/version negotiation metadata.
   - The currently safe documented posture is homogeneous binary clusters unless negotiation is added.

2. **Malformed frame / incompatible peer handling**
   - decode failures are still silently dropped instead of becoming explicit close + reason + metric/logging events.

3. **Client topology update wiring**
   - `TopologyPublisher` is wired for startup publication, but continuous topology-change push is not yet wired into the current runtime path.

4. **Recovery / migration claim boundary**
   - recovery parity is currently limited to the supported partition-owned services (`map`, `queue`, `ringbuffer`).

5. **Remote client claim boundary**
   - retained `HeliosClient` parity claims must stay aligned to the retained public client contract, while broader official `hazelcast-client` interop claims must be stated separately and backed by interop suites.

6. **Durable executor**
   - durable executor handlers remain skeletal / placeholder-backed.

7. **Cache claim boundary**
   - cache remains distributed cache support, not Java JCache parity, and remains outside supported partition recovery namespace sync.

8. **CP claim boundary**
   - CP remains a single-node embedded implementation, not distributed multi-member CP.

9. **Scheduled executor remote surface**
   - scheduled executor has member-side runtime support, but no registered active client-protocol surface and no retained public client exposure.

10. **Serialization parity breadth**
   - serializer breadth, evolution semantics, and the remaining legacy JSON fallback paths are not yet fully parity-audited.

---

## 9. Non-goals for this document

- no speculative performance roadmap
- no ns/op projection table
- no phased implementation story
- no marketing language about full Hazelcast parity
- no Java-only claims Helios cannot satisfy

---

## 10. Maintenance rules

- update this document when a parity-relevant behavior changes
- do not promote a topic from partial/not-retained/out-of-scope without code and test evidence
- keep exclusions explicit rather than leaving deferred features implied
