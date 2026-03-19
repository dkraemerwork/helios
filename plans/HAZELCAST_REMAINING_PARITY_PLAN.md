# Hazelcast Remaining Parity Plan

**Version:** 1.1
**Date:** 2026-03-19
**Status:** COMPLETED
**Completed:** 2026-03-19 (WP18 — Full Parity Proof & Documentation)
**Reference:** Hazelcast Platform 5.7.0-SNAPSHOT (`/Users/zenystx/IdeaProjects/helios-1`)
**Target:** `hazelcast-client@5.6.0` / Hazelcast OSS 5.5.x wire compatibility
**Repo:** `/Users/zenystx/IdeaProjects/helios`

---

## Purpose

This plan captures **every remaining parity gap** between Helios and Hazelcast, organized into
prioritized executable work packages. It is the successor to `HAZELCAST_FULL_PARITY_MASTER_PLAN.md`
and is informed by the authoritative `docs/plans/hazelcast-parity-plan.md` (V3.0).

This plan is constrained by:
- The parity boundary defined in `docs/plans/hazelcast-parity-plan.md` Section 1
- The official `hazelcast-client@5.6.0` as the sole remote-client proof boundary
- Existing interop suites in `test/interop/suites/*.test.ts`

---

## Intentional Exclusions

The following are **deferred by design** and are NOT parity gaps:

| Area | Reason |
|------|--------|
| Vector Collections | Deferred — relatively new in HZ 5.5+, not in scope |
| User Code Deployment | Deferred — Java-specific class deployment, not applicable to TS/Bun |
| XA Transactions | Deferred — JTA/XA is Java-specific infrastructure |
| Jet Streaming Engine | Replaced by Blitz — Helios-native streaming, not a Jet port |
| JCache / JSR-107 API | Java-specific API — Helios has distributed cache without Java javax.cache surface |
| Java `DataSerializable` (non-identified) | Java interface — TypeScript uses IdentifiedDataSerializable |
| Java `Externalizable` | Java-specific serialization mechanism |
| Java enum serializers | Java-specific — TS has no Java enum wire format |

---

## Severity Scale

- **P0**: Blocks any honest "Hazelcast-compatible TS platform" claim
- **P1**: Major platform parity gap — required for feature completeness
- **P2**: Advanced/polish parity — required before a full-parity claim
- **P3**: Documentation, proof, and final audit closure

---

## Master Gap Inventory

| # | Area | Severity | Current Status | Key Gap |
|---|------|----------|----------------|---------|
| 1 | WAN Replication | P0 | **COMPLETE** | WanReplicationService, WanBatchPublisher, WanConsumer, WanSyncManager, MerkleTree all implemented |
| 2 | Split-Brain Protection + Merge (runtime) | P0 | **PARTIAL** | SplitBrainDetector, SplitBrainMergeHandler, 8 merge policies, SplitBrainProtectionServiceImpl complete; per-operation quorum enforcement hook not wired |
| 3 | Multi-Node CP Consensus (Raft) | P0 | **PARTIAL** | Full Raft §5.1–5.4 + PreVote in RaftNode; single-node proven; multi-node TCP wiring not interop-tested |
| 4 | Security Runtime Enforcement | P1 | **COMPLETE** | SecurityInterceptor wired before handler dispatch; 23 permission classes; SecurityContext per-session; TokenAuthenticator; AuthRateLimiter |
| 5 | IMap Client Codec Coverage | P1 | **COMPLETE** | 63 Map opcodes registered in MapServiceHandlers.ts |
| 6 | IMap Advanced Operations | P1 | **COMPLETE** | ExecuteOnKey/AllKeys/WithPredicate, Aggregate/WithPredicate, Project/WithPredicate, PagingPredicate, EventJournal, MapStore, QueryCache all implemented |
| 7 | Transactions — Coordinator Replication | P1 | **PARTIAL** | Full TX coordinator + backup + recovery; partition-replicated coordinator leader election not implemented |
| 8 | Durable Executor | P1 | **COMPLETE** | DurableExecutorService, DurableTaskRingbuffer, all 6 DurableExecutor protocol opcodes implemented |
| 9 | SQL Breadth | P1 | **PARTIAL** | SELECT/INSERT/UPDATE/DELETE/CREATE MAPPING/DROP MAPPING/GROUP BY/HAVING/DISTINCT/aggregates/expression engine complete; JOINs and index-aware planner missing |
| 10 | Near Cache Completeness | P1 | **COMPLETE** | Full preloader, invalidation suite (8 files), stats, eviction, OBJECT+BINARY formats |
| 11 | Listener/Event Breadth | P1 | **COMPLETE** | AddEntryListenerToKey/WithPredicate/ToKeyWithPredicate, item listeners, migration listener, partition lost listener all implemented |
| 12 | Serialization Remaining Gaps | P1 | **COMPLETE** | Global serializer, StreamSerializer, GenericRecord API, Compact, Portable (versioned), all primitive serializers implemented |
| 13 | Cache Completeness | P1 | **COMPLETE** | Bulk ops (GetAll/PutAll/RemoveAll), Invoke/InvokeAll, AddEntryListener, full expiry, near-cache invalidation all implemented |
| 14 | Persistence / Hot Restart Depth | P2 | **COMPLETE** | WAL, Checkpoint, HotBackupService, ClusterRestartCoordinator, EncryptedWAL, StructurePersistenceAdapter; tiered store excluded (enterprise) |
| 15 | Discovery SPI / Cloud Discovery | P2 | **PARTIAL** | All 4 cloud adapters (AWS/Azure/GCP/K8s) + static + auto-detection exist; actual runtime HTTP calls to cloud APIs not interop-proven |
| 16 | TLS/SSL | P2 | **COMPLETE** | TlsConfig.ts — one-way TLS and mTLS (cert/key/CA, requireClientCert) |
| 17 | Connection Load Balancing | P2 | **COMPLETE** | RoundRobinLoadBalancer and RandomLoadBalancer in LoadBalancer.ts |
| 18 | Token/Advanced Auth | P2 | **COMPLETE** | TokenAuthenticator, SimpleTokenCredentials, UsernamePasswordCredentials; Kerberos/LDAP excluded (enterprise) |
| 19 | Cluster State Management | P2 | **COMPLETE** | ClusterState enum + ClusterStateManager with ACTIVE/FROZEN/PASSIVE/CLUSTERDOWN |
| 20 | XML/YAML Config Loading | P2 | **COMPLETE** | XmlConfigLoader (full SAX-like parser) + YAML via Bun.YAML.parse() in ConfigLoader.ts |
| 21 | IQueue Missing Client Codecs | P2 | **COMPLETE** | All 21 Queue opcodes registered in QueueServiceHandlers.ts |
| 22 | MultiMap Missing Features | P2 | **COMPLETE** | Locking, entry listeners (AddEntryListener/ToKey/WithPredicate), PutAll, Delete — all 23 opcodes implemented |
| 23 | ReplicatedMap Missing Features | P2 | **PARTIAL** | 17 opcodes including entry listeners complete; TTL on put not enforced at replication wire level |
| 24 | Standard Topic Breadth | P2 | **COMPLETE** | Publish, PublishAll, AddMessageListener, RemoveMessageListener, LocalTopicStats all implemented |
| 25 | Reliable Topic Breadth | P2 | **COMPLETE** | ReliableTopicProxyImpl backed by Ringbuffer; loss tolerance; full stats |
| 26 | Scheduled Executor All-Members | P2 | **PARTIAL** | scheduleOnPartition + scheduleOnMember complete; scheduleOnAllMembers variants not present |
| 27 | Cardinality Estimator Client Proxy | P2 | **COMPLETE** | Add + Estimate opcodes; HyperLogLog dense+sparse encoders; HyperLogLogMergePolicy for split-brain |
| 28 | Query Cache Event-Driven Sync | P2 | **COMPLETE** | QueryCacheImpl + QueryCacheManager with real-time event-driven sync |
| 29 | Cache Event Journal | P2 | **PARTIAL** | IMap event journal complete; ICache event journal handler not yet registered |
| 30 | JMX / Observability Parity | P2 | **COMPLETE** | LocalMapStats, NearCacheStats, LocalTopicStats, LocalCacheStats, ScheduledExecutorStats, SlowOperationDetector, DiagnosticsService, REST API |
| 31 | PagingPredicate + PartitionPredicate | P2 | **COMPLETE** | KeySetWithPagingPredicate, ValuesWithPagingPredicate, EntriesWithPagingPredicate + PartitionPredicateImpl, MultiPartitionPredicateImpl |
| 32 | Entry Processor Client Codecs | P2 | **COMPLETE** | ExecuteOnKey/AllKeys/WithPredicate/OnKeys all registered with full codec |
| 33 | Projection Client Codecs | P2 | **COMPLETE** | Project + ProjectWithPredicate opcodes with SingleAttributeProjection, MultiAttributeProjection, IdentityProjection |
| 34 | Full Parity Proof & Documentation | P3 | **COMPLETE** | docs/PARITY_MATRIX.md generated; full audit performed (WP18 2026-03-19) |

---

## Work Packages

### WP1 — WAN Replication (P0)

**Java reference:** `hazelcast/src/main/java/com/hazelcast/wan/` (~39 files)

**Goal:** Implement WAN replication for cross-cluster data synchronization.

**Scope:**

WAN replication in Hazelcast OSS enables active-passive and active-active cluster data sync.
Helios has zero WAN files today.

**Tasks:**

1. **WAN Config** (`src/config/WanReplicationConfig.ts`)
   - `WanReplicationConfig` — top-level WAN config holder
   - `WanBatchPublisherConfig` — target cluster, endpoints, batch size, queue capacity, ack type, sync/async mode
   - `WanConsumerConfig` — consumer-side config (merge policy, persist WAN replicated events)
   - `WanSyncConfig` — consistency check config (full-sync, merkle tree)
   - Wire config into `HeliosConfig.ts` and `ConfigLoader.ts`

2. **WAN Publisher** (`src/wan/impl/WanPublisher.ts`)
   - `WanBatchPublisher` — batched event publisher to target cluster
     - accumulate IMap/ICache mutation events into `WanReplicationEvent` queue
     - batch drain at configurable interval or size threshold
     - serialize events using Hazelcast binary protocol
     - send over TCP to target cluster WAN consumer endpoint
     - handle ack mode: ACK_ON_RECEIPT vs ACK_ON_OPERATION_COMPLETE
   - `WanPublisherState` — REPLICATING, PAUSED, STOPPED
   - `WanReplicationEventQueue` — bounded concurrent queue with overflow policy (DISCARD_AFTER_MUTATION, THROW_EXCEPTION, THROW_EXCEPTION_ONLY_IF_REPLICATION_ACTIVE)

3. **WAN Consumer** (`src/wan/impl/WanConsumer.ts`)
   - `WanConsumerService` — accept inbound WAN events from source cluster
   - Apply received events through merge policy
   - Support configurable merge policies (same set as split-brain: PassThrough, PutIfAbsent, HigherHits, LatestUpdate, etc.)
   - Persist WAN replicated events flag for write-behind stores

4. **WAN Sync / Anti-Entropy** (`src/wan/impl/WanSyncManager.ts`)
   - `WanSyncManager` — full-sync and delta-sync coordination
   - `MerkleTreeNode` / `MerkleTree` — partition-level merkle tree for consistency checking
   - Periodic consistency check between source and target
   - Delta sync: only transfer entries whose merkle tree leaves differ
   - Full sync: transfer all partition data

5. **WAN Lifecycle** (`src/wan/impl/WanReplicationService.ts`)
   - Register per-map WAN replication references in MapConfig
   - Hook into map put/remove/evict/clear paths to generate WAN events
   - Pause/resume/stop WAN replication per publisher
   - Expose WAN state through REST API

6. **Inter-Member WAN Messages** (`src/cluster/tcp/ClusterMessage.ts`)
   - `WAN_SYNC_REQUEST` / `WAN_SYNC_RESPONSE`
   - `WAN_CONSISTENCY_CHECK_REQUEST` / `WAN_CONSISTENCY_CHECK_RESPONSE`
   - `WAN_REPLICATION_EVENT_BATCH`

7. **REST Endpoints**
   - `POST /hazelcast/rest/wan/sync` — trigger full sync
   - `POST /hazelcast/rest/wan/pause` — pause publisher
   - `POST /hazelcast/rest/wan/resume` — resume publisher
   - `GET /hazelcast/rest/wan/status` — publisher state and queue depth

**Tests:**
- Unit: merkle tree node operations, WAN event queue, batch publisher drain
- Integration: two-cluster WAN replication with map mutations flowing across
- Failure: source cluster member death during WAN sync, network partition between clusters
- Consistency: merkle tree delta sync detects and repairs drift

**Done gate:**
- WAN events flow from source to target cluster for IMap mutations
- Merkle tree consistency check detects and repairs divergence
- Pause/resume/stop lifecycle is functional
- Config loading accepts WAN replication configuration

**File count estimate:** ~15 new files

---

### WP2 — Split-Brain Protection + Merge Runtime (P0)

**Java reference:**
- `hazelcast/src/main/java/com/hazelcast/splitbrainprotection/` (~12 files)
- `hazelcast/src/main/java/com/hazelcast/internal/cluster/impl/SplitBrainHandler.java`

**Goal:** Upgrade from detection-only to full quorum enforcement + merge healing.

**Current state:** `SplitBrainDetector` exists with quorum-based detection. 8 merge policies exist.
`SplitBrainMergeHandler` exists. Missing: quorum enforcement on operations, configurable protection
per data structure, full partition/heal lifecycle.

**Tasks:**

1. **Split-Brain Protection Config** (`src/config/SplitBrainProtectionConfig.ts`)
   - `SplitBrainProtectionConfig` — name, minimum cluster size, function type (MEMBER_COUNT, PROBABILISTIC, RECENTLY_ACTIVE)
   - `ProbabilisticSplitBrainProtectionConfig` — phi accrual detector parameters
   - `RecentlyActiveSplitBrainProtectionConfig` — heartbeat-interval-based
   - Wire `splitBrainProtectionRef` into MapConfig, QueueConfig, CacheConfig, etc.

2. **Split-Brain Protection Service** (`src/splitbrainprotection/impl/SplitBrainProtectionServiceImpl.ts`)
   - Maintain quorum state per named protection group
   - Re-evaluate quorum on every membership change event
   - Provide `ensureQuorum(operationType, protectionName)` check
   - Operation types: READ, WRITE, READ_WRITE

3. **Operation-Level Quorum Enforcement**
   - Hook quorum check into `OperationServiceImpl` before operation dispatch
   - `SplitBrainProtectionException` thrown when quorum not met
   - Per-data-structure quorum reference from config

4. **Merge Lifecycle Hardening** (`src/cluster/impl/SplitBrainMergeHandler.ts`)
   - Detect merge event when two sub-clusters reconnect
   - Coordinate which sub-cluster is the "winning" side (larger cluster size wins, then older master)
   - Losing side triggers merge: for each data structure, apply merge policy entry-by-entry
   - Merge sequence: close client connections → pause migrations → collect data → apply merge → resume

5. **Multi-Structure Merge Coordination**
   - Merge handler iterates all registered distributed services
   - Each service provides a `prepareMergeRunnable()` that collects its data as `MergingValue` entries
   - After collection, losing side clears its data and replays merged entries from winning side

**Tests:**
- Unit: quorum evaluation with member count, probabilistic, recently-active functions
- Integration: 3-node cluster, force partition into [2]+[1], verify quorum enforcement on minority
- Merge: reconnect sub-clusters, verify merge policy application (PassThrough, PutIfAbsent, LatestUpdate)
- Client: client operations fail with SplitBrainProtectionException when quorum lost

**Done gate:**
- Operations fail-closed when quorum is not satisfied
- Sub-cluster merge applies configured merge policy correctly
- Client connections on losing side are properly handled during merge

**File count estimate:** ~8 new files, ~5 modified files

---

### WP3 — Multi-Node CP Consensus (P0)

**Java reference:**
- `hazelcast/src/main/java/com/hazelcast/cp/` (~80 files)
- `hazelcast/src/main/java/com/hazelcast/cp/internal/raft/impl/` (full Raft implementation)

**Goal:** Prove distributed multi-member Raft consensus for CP primitives.

**Current state:** All 7 CP primitives implemented. `RaftNode.ts` implements full Raft paper
(Sections 5.1-5.4 + PreVote). `CpGroupManager`, `CpStateMachine`, `RaftTransportAdapter`,
`RaftMessageRouter`, `InMemoryRaftStateStore` all exist. Currently validated single-node only.

**Tasks:**

1. **Multi-Node Raft Bootstrap**
   - Wire `CpGroupManager` to create CP groups spanning multiple members
   - Implement CP member discovery: which members participate in CP subsystem
   - `CPSubsystemConfig.cpMemberCount` — number of CP members (default: all members)
   - Leader election across physical members using existing `RaftNode` infrastructure

2. **Raft Transport Integration**
   - Wire `RaftTransportAdapter` to use real `TcpClusterTransport` for inter-member Raft messages
   - Add cluster message types: `RAFT_VOTE_REQUEST`, `RAFT_VOTE_RESPONSE`, `RAFT_APPEND_ENTRIES`, `RAFT_APPEND_RESPONSE`, `RAFT_INSTALL_SNAPSHOT`
   - Ensure message routing reaches the correct RaftNode for the correct CP group

3. **CP Group Lifecycle**
   - `CPGroupManager.createGroup(name, memberList)` — create a new Raft group
   - `CPGroupManager.destroyGroup(name)` — destroy a Raft group and release resources
   - `CPGroupManager.forceDestroyGroup(name)` — force-destroy even if Raft quorum lost
   - Group availability tracking: minimum group size for CP operations

4. **CP Session Lifecycle (Multi-Node)**
   - Session creation/heartbeat/expiry across CP group members
   - Session-aware operations: FencedLock, Semaphore use sessions for failure detection
   - Session expiry triggers resource release (lock release, permit return)

5. **CP Membership Changes**
   - Member removal from CP groups on graceful shutdown
   - Member promotion when new members join
   - `CPSubsystemManagementService` — add/remove CP members, reset CP subsystem

6. **Linearizable Operation Routing**
   - CP operations route to the Raft leader of the target group
   - If the leader is not the local member, forward to the leader
   - Client protocol handlers already exist; wire them to multi-node group routing

**Tests:**
- 3-node CP group: leader election, log replication, commit
- Leader failure: verify new leader election and continued operations
- Network partition: minority CP group rejects operations (Raft quorum)
- Session expiry: FencedLock released when holding member dies
- Client interop: official `hazelcast-client` CP operations against multi-node Helios CP

**Done gate:**
- CP primitives operate correctly across 3+ physical Helios members
- Leader failure triggers re-election within bounded time
- Raft log replication is proven with multiple concurrent operations
- Client interop suites pass against multi-node CP cluster

**File count estimate:** ~5 new files, ~10 modified files

---

### WP4 — Security Runtime Enforcement (P1)

**Java reference:** `hazelcast/src/main/java/com/hazelcast/security/` (~40 files)

**Goal:** Activate runtime security enforcement using existing permission types.

**Current state:** 23 permission classes exist (MapPermission, QueuePermission, etc.).
`ActionConstants`, `WildcardPermissionMatcher`, `ClusterPermissionCollection` exist.
`AuthGuard` in client protocol exists. No runtime enforcement pipeline connecting
permissions to operations.

**Tasks:**

1. **Security Config** (`src/config/SecurityConfig.ts`)
   - `SecurityConfig` — enabled flag, client permissions map, member permissions
   - `PermissionConfig` — principal, type, name pattern, actions, endpoints
   - Wire into `HeliosConfig.ts`

2. **Security Context** (`src/security/impl/SecurityContext.ts`)
   - `SecurityContext` — holds authenticated principal + assigned permissions
   - Created during client authentication in `AuthGuard`
   - Attached to client connection / session

3. **Permission Checking Pipeline** (`src/security/impl/SecurityInterceptor.ts`)
   - `SecurityInterceptor.checkPermission(context, permission)` — throws `AccessControlException`
   - Integrate into `ClientMessageDispatcher` — check permission before handler dispatch
   - Per-opcode permission mapping: map operations → MapPermission, queue → QueuePermission, etc.
   - Wildcard matching: `*` matches all names, action subsets

4. **Token Authentication** (`src/security/impl/TokenAuthenticator.ts`)
   - Accept token credentials during client authentication
   - Validate against configured token store / static tokens
   - Map token to security context with assigned permissions

5. **TLS/SSL Runtime** (`src/server/clientprotocol/TlsRuntime.ts`)
   - Enable TLS on client protocol server socket
   - `TlsConfig` already exists — wire it into `ClientProtocolServer`
   - Support: keystore/truststore paths, mutual TLS option
   - Bun-native TLS using `Bun.serve({ tls: {...} })`

6. **Auth Failure Hardening**
   - Invalid credentials → connection close with structured error
   - Expired/revoked tokens → connection close
   - Rate limiting on auth failures per IP

**Tests:**
- Unit: permission matching with wildcards, action subsets
- Integration: client with read-only map permission cannot write
- TLS: client connects over TLS, plain-text connection rejected when TLS required
- Token: valid token authenticates, invalid token rejected
- Failure: auth failure rate limiting

**Done gate:**
- Configured permissions are enforced on client operations at runtime
- TLS is functional on client protocol port
- Token authentication works end to end

**File count estimate:** ~8 new files, ~6 modified files

---

### WP5 — IMap Client Codec + Advanced Operations (P1)

**Java reference:** `hazelcast/src/main/java/com/hazelcast/map/IMap.java` (full interface)

**Goal:** Close the ~25 missing IMap client codecs and expose server-side capabilities that already
exist but lack client protocol wiring.

**Current state:** Server-side IMap is deep (MapStore, near cache, query, aggregators, entry
processors, projections, event journal, interceptors, query cache all exist). Client protocol
coverage is partial — many operations have server implementations but no client codecs.

**Tasks:**

1. **Missing CRUD Codecs** (in `MapServiceHandlers.ts`)
   - `putIfAbsent` (0x010500)
   - `remove(key, value)` — conditional remove (0x010701)
   - `removeAll(predicate)` (0x011C00)
   - `replace(key, value)` (0x010C00)
   - `replaceIfSame(key, oldV, newV)` (0x010D00)
   - `putWithMaxIdle(key, value, ttl, maxIdle)` — TTL + maxIdle variant
   - `setWithMaxIdle(key, value, ttl, maxIdle)`
   - `tryPut(key, value, timeout)` (0x010E00)
   - `tryRemove(key, timeout)` (0x010F00)
   - `evict(key)` (0x011000)
   - `evictAll()` (0x011100)
   - `flush()` (0x011200)
   - `getEntryView(key)` (0x011300)

2. **Bulk Operation Codecs**
   - `getAll(keys)` — complete codec (0x011400)
   - `putAll(entries)` — complete codec (0x011500)
   - `keySet()` (0x011600)
   - `keySet(predicate)` (0x011700)
   - `values()` (0x011800)
   - `values(predicate)` (0x011801)
   - `entrySet()` (0x011900)
   - `entrySet(predicate)` (0x011901)

3. **Query / Predicate Codecs**
   - `addIndex(indexConfig)` (0x011A00)
   - `aggregate(aggregator)` (0x011B00)
   - `aggregate(aggregator, predicate)` (0x011B01)

4. **Entry Processor Codecs**
   - `executeOnKey(key, entryProcessor)` (0x012400)
   - `executeOnKeys(keys, entryProcessor)` (0x012500)
   - `executeOnEntries(entryProcessor)` (0x012600)
   - `executeOnEntries(entryProcessor, predicate)` (0x012601)
   - `submitToKey(key, entryProcessor)` (0x012700)

5. **Projection Codecs**
   - `project(projection)` (0x012800)
   - `project(projection, predicate)` (0x012801)

6. **Lock Codecs**
   - `lock(key)` (0x012000)
   - `lock(key, leaseTime)` (0x012001)
   - `tryLock(key, timeout)` (0x012100)
   - `unlock(key)` (0x012200)
   - `isLocked(key)` (0x012300)
   - `forceUnlock(key)` (0x012900)

7. **Listener Codecs**
   - `addEntryListener(listener, key)` — key-filtered (0x011902)
   - `addEntryListener(listener, predicate)` — predicate-filtered (0x011903)
   - `addPartitionLostListener` (0x012A00)
   - `removePartitionLostListener` (0x012A01)

8. **MapStore Codecs**
   - `loadAll(replaceExisting)` (0x012B00)

9. **Stats Codec**
   - `getLocalMapStats()` (0x012C00) — complete stats object

10. **PagingPredicate + PartitionPredicate Serialization**
    - Wire PagingPredicate through client protocol for paginated queries
    - Wire PartitionPredicate for partition-targeted queries

**Tests:**
- Add interop test coverage for each new codec where `hazelcast-client@5.6.0` exposes it
- Unit tests for each handler
- Integration: entry processor round-trip, projection round-trip, lock lifecycle

**Done gate:**
- All IMap operations that `hazelcast-client@5.6.0` exposes have working server-side codecs
- Entry processors, projections, and locks work through the client protocol
- Interop test suite expanded to cover new codecs

**File count estimate:** ~2 new files, ~3 heavily modified files

---

### WP6 — Transaction Coordinator Replication (P1)

**Java reference:**
- `hazelcast/src/main/java/com/hazelcast/transaction/impl/TransactionManagerServiceImpl.java`
- `hazelcast/src/main/java/com/hazelcast/transaction/impl/xa/`

**Goal:** Replicate transaction coordinator state for crash recovery.

**Current state:** ONE_PHASE and TWO_PHASE commit work. Transaction log with backup replication
exists. Transactional proxies for Map, Queue, List, Set, MultiMap exist. Coordinator is
member-local — crash loses in-flight transactions.

**Tasks:**

1. **Coordinator State Replication**
   - Replicate `TransactionLog` to backup member(s) before prepare
   - On coordinator crash, backup member can detect orphaned prepared transactions
   - Implement `TransactionRecoveryService` — scans for orphaned prepared TX on member join/leave
   - Auto-rollback orphaned transactions past timeout

2. **Transaction Timeout Enforcement**
   - Wire configurable timeout from `DEFAULT_TRANSACTION_TIMEOUT_MS` (120s)
   - Background sweep for timed-out transactions
   - Force rollback on timeout with proper cleanup

3. **Missing Transactional Proxies Completion**
   - `TransactionalQueueProxy` — verify offer/poll/peek/size transactional semantics
   - `TransactionalListProxy` — verify add/remove/size transactional semantics
   - `TransactionalSetProxy` — verify add/remove/contains transactional semantics
   - `TransactionalMultiMapProxy` — verify put/get/remove transactional semantics

4. **Transaction Client Codecs** (`TransactionServiceHandlers.ts`)
   - `createTransaction` (0x160100)
   - `commitTransaction` (0x160200)
   - `rollbackTransaction` (0x160300)
   - `getTransactionalMap` / queue / list / set / multimap proxy codecs

5. **Error Semantics**
   - `TransactionException` — generic transaction failure
   - `TransactionNotActiveException` — operation on completed/rolled-back TX
   - `TransactionTimedOutException` — timeout exceeded
   - Wire error codecs for client protocol responses

**Tests:**
- Unit: coordinator state serialization/deserialization
- Integration: commit + rollback lifecycle, timeout enforcement
- Failure: coordinator crash during prepare → backup recovers and rolls back
- Multi-structure: transaction spanning map + queue
- Client: protocol adapter tests for transaction codecs

**Done gate:**
- Transaction coordinator state survives single-member crash
- Orphaned prepared transactions are automatically rolled back after timeout
- All 5 transactional proxy types work correctly in transaction scope

**File count estimate:** ~3 new files, ~8 modified files

---

### WP7 — Durable Executor (P1)

**Java reference:**
- `hazelcast/src/main/java/com/hazelcast/durableexecutor/` (~15 files)
- `hazelcast/src/main/java/com/hazelcast/durableexecutor/impl/` (implementation)

**Goal:** Implement real durable executor with submission records surviving member failure.

**Current state:** Executor service exists with partition/member targeting. Durable executor handlers
are skeletal/placeholder.

**Tasks:**

1. **Durable Executor Service** (`src/durableexecutor/impl/DurableExecutorService.ts`)
   - Partition-owned submission records stored in a ringbuffer-like structure
   - Each submission gets a durable sequence number
   - Submissions survive member crash via partition replication

2. **Durable Executor Proxy** (`src/durableexecutor/impl/DurableExecutorServiceProxy.ts`)
   - `submit(callable)` → returns `DurableExecutorServiceFuture` with durable sequence
   - `submitToKeyOwner(callable, key)` — partition-targeted
   - `retrieveResult(sequence)` — retrieve result by durable sequence
   - `dispose(sequence)` — dispose stored result
   - `retrieveAndDispose(sequence)` — atomic retrieve + dispose
   - `shutdown()` — shutdown lifecycle
   - `isShutdown()` — state check

3. **Durable Task Storage** (`src/durableexecutor/impl/DurableTaskRingbuffer.ts`)
   - Fixed-capacity ringbuffer per partition for durable task records
   - Each record: sequence, callable reference, result (null until complete), completed flag
   - Configurable capacity and durability (backup count)

4. **Client Protocol Handlers** (`src/server/clientprotocol/handlers/DurableExecutorServiceHandlers.ts`)
   - `submitToPartition` (0x170100)
   - `shutdownPartitions` (0x170200)
   - `isShutdown` (0x170300)
   - `retrieveResult` (0x170400)
   - `disposeResult` (0x170500)
   - `retrieveAndDisposeResult` (0x170600)

5. **Backup Replication**
   - Durable submission records replicated to backup partition owners
   - On ownership change, new owner can serve result retrieval

**Tests:**
- Unit: ringbuffer-based task storage
- Integration: submit → retrieve by sequence → dispose
- Failure: member crash → new partition owner serves stored results
- Lifecycle: shutdown prevents new submissions, existing results remain retrievable

**Done gate:**
- Submitted tasks survive single-member failure
- Results are retrievable by durable sequence number after task completion
- Backup replication keeps results available on ownership change

**File count estimate:** ~8 new files

---

### WP8 — SQL Breadth Expansion (P1)

**Java reference:**
- `hazelcast/src/main/java/com/hazelcast/sql/` (~30 files)
- `hazelcast-sql/src/main/java/com/hazelcast/jet/sql/` (~700 files)

**Goal:** Expand SQL beyond IMap-only CRUD toward practical Hazelcast SQL parity.

**Current state:** SELECT/INSERT/UPDATE/DELETE over IMap with cursor handling. No query planner,
no JOINs, no CREATE/DROP MAPPING, no streaming queries.

**Tasks:**

1. **CREATE/DROP MAPPING Support**
   - `CREATE MAPPING mapName TYPE IMap OPTIONS (...)` — register IMap as queryable
   - `DROP MAPPING mapName` — deregister
   - Mapping registry stored in cluster metadata
   - Column type inference from Compact/Portable schema or explicit column definitions

2. **Extended SELECT Capabilities**
   - `ORDER BY` clause with sort execution
   - `LIMIT` / `OFFSET` for result paging
   - `COUNT(*)`, `SUM()`, `AVG()`, `MIN()`, `MAX()` — aggregate functions (leverage existing aggregators)
   - `GROUP BY` clause with hash aggregation
   - `HAVING` clause for filtered aggregation
   - `DISTINCT` keyword
   - `IS NULL` / `IS NOT NULL` predicates
   - `CAST()` expressions
   - `CASE WHEN` expressions

3. **Expression Engine** (`src/sql/impl/expression/`)
   - `ColumnExpression` — column reference
   - `LiteralExpression` — constant value
   - `ArithmeticExpression` — +, -, *, /, %
   - `ComparisonExpression` — =, <>, <, >, <=, >=
   - `LogicalExpression` — AND, OR, NOT
   - `CastExpression` — type conversion
   - `CaseExpression` — CASE WHEN THEN ELSE END
   - `FunctionExpression` — built-in functions (UPPER, LOWER, TRIM, LENGTH, ABS, etc.)

4. **SQL Type System Completion**
   - Map SQL types to Hazelcast types: VARCHAR, INTEGER, BIGINT, DECIMAL, REAL, DOUBLE, BOOLEAN, DATE, TIME, TIMESTAMP, TIMESTAMP_WITH_TIME_ZONE, OBJECT, JSON, NULL
   - Type coercion rules matching Hazelcast
   - Error on unsupported types

5. **Enhanced Error Reporting**
   - `SqlError` with Hazelcast-compatible error codes
   - Syntax errors with position information
   - Type mismatch errors with expected/actual types

**Non-goals (intentionally out of scope):**
- Full Apache Calcite query planner
- JOIN between multiple IMaps (deferred to future)
- Streaming SQL queries
- Kafka/file source connectors

**Tests:**
- Unit: expression evaluation, type coercion
- Integration: CREATE MAPPING → SELECT with WHERE/ORDER BY/LIMIT → DROP MAPPING
- Aggregation: GROUP BY + aggregate functions
- Interop: official client SQL queries with expanded syntax
- Error: malformed SQL, type mismatches, unknown mappings

**Done gate:**
- CREATE/DROP MAPPING works
- SELECT supports WHERE, ORDER BY, LIMIT, GROUP BY, HAVING, aggregate functions
- SQL type system matches Hazelcast for common types
- Interop tests prove expanded SQL surface

**File count estimate:** ~12 new files, ~4 modified files

---

### WP9 — Near Cache Completion (P1)

**Current state:** 34 files in near cache with deep implementation. Missing: preloader, incomplete
stats, some config options not enforced.

**Tasks:**

1. **Near Cache Preloader** (`src/internal/nearcache/impl/NearCachePreloader.ts`)
   - Persist near cache keys to local storage on shutdown
   - Reload persisted keys on startup (pre-populate near cache)
   - `NearCachePreloaderConfig` already exists — wire it

2. **Stats Completion**
   - `NearCacheStats` — hits, misses, evictions, expirations, owned entry count, owned entry memory cost
   - Wire stats into `HazelcastMetrics` near cache section
   - Expose via REST `/hazelcast/rest/nearcache/stats`

3. **Config Enforcement**
   - `maxIdleSeconds` enforcement on near cache records
   - `timeToLiveSeconds` enforcement on near cache records
   - `invalidateOnChange` flag behavior
   - `inMemoryFormat` (BINARY vs OBJECT) enforcement

4. **Cache Near Cache Integration**
   - Wire near cache into ICache proxy (not just IMap)
   - Invalidation events for cache mutations

**Tests:**
- Unit: preloader save/restore cycle
- Integration: near cache preload after restart
- Stats: verify hit/miss counters
- TTL: near cache entries expire correctly

**Done gate:**
- Near cache preloader saves and restores
- All near cache config options are enforced at runtime
- Stats are accurate and exposed through metrics

**File count estimate:** ~3 new files, ~5 modified files

---

### WP10 — Listener/Event Breadth (P1)

**Goal:** Complete missing listener types for Hazelcast compatibility.

**Tasks:**

1. **Key-Filtered Entry Listener** (IMap)
   - `map.addEntryListener(listener, key)` — events only for specific key
   - Client codec: key-filtered listener registration
   - Server: filter events by key before dispatching

2. **Predicate-Filtered Entry Listener** (IMap)
   - `map.addEntryListener(listener, predicate, includeValue)` — events matching predicate
   - Client codec: predicate-filtered listener registration
   - Server: evaluate predicate on events before dispatching

3. **DistributedObjectListener**
   - `instance.addDistributedObjectListener(listener)` — CREATED/DESTROYED events for any proxy
   - Fire on `getMap()/getQueue()/etc.` first access and `destroy()` calls
   - Client codec: distributed object listener registration

4. **MigrationListener**
   - `partitionService.addMigrationListener(listener)` — STARTED/COMPLETED/FAILED migration events
   - Fire from `MigrationManager` during partition migration
   - Client codec: migration listener registration

5. **MultiMap Entry Listener**
   - `multiMap.addEntryListener(listener)` — ADDED/REMOVED events
   - `multiMap.addEntryListener(listener, key)` — key-filtered
   - Client codec: multimap entry listener registration

6. **ReplicatedMap Entry Listener**
   - `replicatedMap.addEntryListener(listener)` — ADDED/UPDATED/REMOVED/EVICTED events
   - `replicatedMap.addEntryListener(listener, key)` — key-filtered
   - Client codec: replicated map entry listener registration

7. **MembershipListener Completion**
   - Ensure `memberAdded`, `memberRemoved` fire correctly on topology changes
   - Add `memberAttributeChanged` event support

**Tests:**
- Unit: event filtering logic
- Integration: key-filtered listener receives only matching key events
- Integration: predicate-filtered listener receives only matching events
- Integration: DistributedObjectListener fires on proxy creation/destruction
- Interop: official client listener registration round-trip

**Done gate:**
- All Hazelcast listener types that `hazelcast-client@5.6.0` supports work through client protocol
- Event filtering is correct and efficient

**File count estimate:** ~5 new files, ~10 modified files

---

### WP11 — Serialization Remaining Gaps (P1)

**Goal:** Close remaining serialization gaps for full wire compatibility.

**Current state:** Primitives, IdentifiedDataSerializable, Portable, Compact, custom serializers
are all implemented. Missing: global serializer registration, StreamSerializer, GenericRecord public
API, versioned portable.

**Tasks:**

1. **Global Serializer**
   - `SerializationConfig.globalSerializer` — fallback for unknown types
   - If no specific serializer matches, delegate to global serializer
   - This already partially exists — verify and complete the fallback chain

2. **StreamSerializer Interface**
   - `StreamSerializer<T>` — read/write with ObjectDataInput/ObjectDataOutput
   - Registration via `SerializationConfig.addStreamSerializer(typeId, serializer)`
   - Wire into serializer lookup chain

3. **GenericRecord Public API**
   - `GenericRecord.newBuilder(schema)` — create from schema
   - `GenericRecord.newBuilderWithClone(record)` — clone and modify
   - Field accessors: `getInt32`, `getString`, `getArrayOfInt32`, etc.
   - Expose through `HazelcastSerializationService`

4. **Versioned Portable**
   - Support multiple versions of the same Portable class ID
   - During deserialization, use the writer's version to pick correct field set
   - `PortableSerializer` already has version tracking — verify multi-version round-trip

5. **JSON Serialization Completion**
   - `HazelcastJsonValue` wrapper — already partially exists
   - Ensure JSON values survive client→server→client round-trip without mutation
   - JSON querying support: extract fields for predicate evaluation

**Tests:**
- Unit: global serializer fallback, StreamSerializer round-trip
- Parity: GenericRecord field accessor coverage
- Versioned: Portable v1 writes, v2 reads (additive evolution)
- JSON: round-trip through client protocol, predicate on JSON fields
- Interop: serialization interop suite expanded

**Done gate:**
- All serializer families functional and tested
- GenericRecord API usable for schema-agnostic data access
- Versioned portable evolution works across versions

**File count estimate:** ~4 new files, ~6 modified files

---

### WP12 — Cache Completeness (P1)

**Goal:** Complete distributed cache operations beyond basic CRUD.

**Current state:** Cache put/get/remove/clear/containsKey exist as PARTIAL. Missing: bulk
operations, entry processors, listeners, full expiry, stats.

**Tasks:**

1. **Bulk Operations**
   - `putAll(map)` — bulk cache put
   - `getAll(keys)` — bulk cache get
   - `removeAll(keys)` — bulk cache remove

2. **Conditional Operations**
   - `putIfAbsent(key, value)` — insert only if key absent
   - `replace(key, value)` — replace only if key present
   - `replace(key, oldValue, newValue)` — CAS replace
   - `getAndPut(key, value)` — get old, set new
   - `getAndRemove(key)` — get and remove atomically
   - `getAndReplace(key, value)` — get old, replace

3. **Cache Entry Processor**
   - `invoke(key, entryProcessor, ...args)` — execute processor on single entry
   - `invokeAll(keys, entryProcessor, ...args)` — execute on multiple entries

4. **Cache Event Listeners**
   - `CacheEntryCreatedListener` — on new entry
   - `CacheEntryUpdatedListener` — on value change
   - `CacheEntryRemovedListener` — on removal
   - `CacheEntryExpiredListener` — on expiry
   - Registration via `CacheEntryListenerConfiguration`
   - Delivery through client protocol

5. **Expiry Policy Completion**
   - `CreatedExpiryPolicy` — expire after creation
   - `AccessedExpiryPolicy` — expire after last access
   - `ModifiedExpiryPolicy` — expire after last modification
   - `EternalExpiryPolicy` — never expire
   - Custom `ExpiryPolicy` with `expiryForCreation`, `expiryForAccess`, `expiryForUpdate`

6. **Cache Statistics**
   - `CacheStatistics` — hits, misses, puts, removals, evictions, averageGetTime, averagePutTime
   - Wire into metrics system

7. **Cache Client Codecs** (0x150x00 series)
   - Wire all cache operations through client protocol handlers

**Tests:**
- Unit: each operation type
- Integration: bulk operations, entry processor execution
- Listener: event delivery for create/update/remove/expire
- Expiry: configured policies enforce TTL correctly
- Stats: counters increment correctly

**Done gate:**
- Cache is feature-complete for Hazelcast OSS cache operations
- All operations work through client protocol
- Event listeners deliver correctly

**File count estimate:** ~6 new files, ~4 modified files

---

### WP13 — Persistence Depth (P2)

**Goal:** Expand persistence beyond map-only WAL+checkpoint.

**Tasks:**

1. **Multi-Structure Persistence**
   - Extend WAL to cover Queue, Cache, Ringbuffer state
   - Per-structure persistence config: enabled/disabled per data structure

2. **Encryption at Rest**
   - Optional encryption of WAL and checkpoint files
   - AES-256 with configurable key management
   - `PersistenceConfig.encryptionAtRest` option

3. **Coordinated Cluster Restart**
   - On full cluster restart, all members coordinate to determine cluster state
   - Validation that all partitions are recovered before accepting operations
   - `HotRestartPersistenceConfig.clusterDataRecoveryPolicy` — FULL_RECOVERY_ONLY, PARTIAL_RECOVERY_MOST_RECENT, PARTIAL_RECOVERY_MOST_COMPLETE

4. **Backup File Management**
   - Hot backup API: `instance.getCluster().getHotRestartService().backup()`
   - Incremental backup support
   - Backup metadata and validation

**Tests:**
- Integration: full process restart with data recovery
- Multi-structure: queue + map data survives restart
- Encryption: encrypted WAL is unreadable without key
- Cluster: coordinated 3-node restart

**Done gate:**
- Persistence covers map + queue + cache data
- Process restart recovers data correctly
- Encryption at rest option functional

**File count estimate:** ~6 new files, ~4 modified files

---

### WP14 — Discovery SPI / Cloud Discovery (P2)

**Goal:** Implement runtime discovery for cloud environments.

**Tasks:**

1. **Discovery SPI** (`src/discovery/spi/DiscoverySPI.ts`)
   - `DiscoveryStrategy` interface — `start()`, `discoverNodes()`, `destroy()`
   - `DiscoveryStrategyFactory` — create strategies from config
   - Plugin mechanism for custom strategies

2. **AWS Discovery** (`src/discovery/aws/AwsDiscoveryStrategy.ts`)
   - EC2 instance discovery via AWS API
   - IAM role / access key authentication
   - Tag-based filtering
   - Uses `AwsConfig` (already exists)

3. **Kubernetes Discovery** (`src/discovery/kubernetes/KubernetesDiscoveryStrategy.ts`)
   - Pod discovery via Kubernetes API
   - Service DNS discovery
   - Namespace + label selector filtering
   - Uses `KubernetesConfig` (already exists)

4. **GCP Discovery** (`src/discovery/gcp/GcpDiscoveryStrategy.ts`)
   - GCE instance discovery via GCP API
   - Label-based filtering
   - Uses `GcpConfig` (already exists)

5. **Azure Discovery** (`src/discovery/azure/AzureDiscoveryStrategy.ts`)
   - Azure VM discovery via Azure API
   - Tag-based filtering
   - Uses `AzureConfig` (already exists)

6. **Auto-Detection** (`src/discovery/AutoDetectionService.ts`)
   - Detect cloud environment automatically
   - Select appropriate discovery strategy
   - Uses `AutoDetectionConfig` (already exists)

**Tests:**
- Unit: mock cloud API responses, verify member list parsing
- Integration: Kubernetes discovery with local k8s cluster (optional)
- Auto-detection: verify correct strategy selection per environment

**Done gate:**
- At least Kubernetes and AWS discovery work at runtime
- Auto-detection selects correct strategy
- Discovery SPI allows custom plugins

**File count estimate:** ~10 new files, ~3 modified files

---

### WP15 — Connection & Config Polish (P2)

**Goal:** Close remaining connection management and configuration gaps.

**Tasks:**

1. **Connection Load Balancing**
   - Round-robin connection selection across members
   - Random connection selection
   - `LoadBalancer` interface with configurable strategy
   - Wire into client protocol connection routing

2. **XML/YAML Config Loading** (`src/config/XmlConfigLoader.ts`, `src/config/YamlConfigLoader.ts`)
   - Parse `hazelcast.xml` / `hazelcast.yaml` configuration files
   - Map XML/YAML elements to existing config classes
   - Support `HAZELCAST_CONFIG` environment variable for config file path
   - Schema validation against supported config elements

3. **Cluster State Management**
   - `ClusterState` enum: ACTIVE, NO_MIGRATION, FROZEN, PASSIVE
   - `cluster.changeState(newState)` — transition cluster state
   - FROZEN: reject mutating operations
   - PASSIVE: reject all operations except reads
   - NO_MIGRATION: accept operations but don't rebalance partitions

4. **System Property Overrides**
   - `HAZELCAST_CONFIG` — config file path
   - `hazelcast.cluster.name` — cluster name override
   - `hazelcast.port` — member port override
   - Map all `hazelcast.*` system properties to config

**Tests:**
- Unit: XML/YAML parsing
- Integration: load balancer distributes connections
- State: cluster state transitions block/allow operations correctly
- Config: system property overrides take precedence

**Done gate:**
- Config can be loaded from XML/YAML files
- Cluster state transitions work correctly
- Load balancing distributes client connections

**File count estimate:** ~6 new files, ~5 modified files

---

### WP16 — Remaining Data Structure Gaps (P2)

**Goal:** Close remaining gaps in Queue, MultiMap, ReplicatedMap, Topic, Scheduled Executor.

**Tasks:**

1. **IQueue Missing Client Codecs** (in `QueueServiceHandlers.ts`)
   - `put(element)` — blocking enqueue
   - `take()` — blocking dequeue
   - `element()` — head, throws if empty
   - `remove(element)` — remove specific
   - `contains(element)` / `containsAll(c)`
   - `isEmpty()` / `toArray()` / `iterator()` / `drainTo()` / `addAll()` / `removeAll()` / `retainAll()`
   - `remainingCapacity()`
   - `addItemListener()` / `removeItemListener()`

2. **MultiMap Locking + Listeners**
   - `lock(key)` / `tryLock(key)` / `unlock(key)` / `forceUnlock(key)` — distributed key locking
   - `addEntryListener(listener)` / `removeEntryListener(id)` — entry event listeners
   - `getLocalMultiMapStats()` — local statistics
   - Client codecs for all above

3. **ReplicatedMap Missing Features**
   - `put(key, value, ttl)` — put with TTL
   - `addEntryListener(listener)` / `removeEntryListener(id)` — entry listeners
   - `getLocalReplicatedMapStats()` — stats
   - Client codecs for all above

4. **Standard Topic Completion**
   - `publishAll(messages)` — batch publish
   - `getLocalTopicStats()` — complete stats
   - Keep standard topic member-side only (no official-client API)

5. **Reliable Topic Completion**
   - `publishAll(messages)` — batch publish via ringbuffer addAll
   - Loss tolerance mode: DISCARD_OLDEST, DISCARD_NEWEST
   - `getLocalTopicStats()` — complete stats

6. **Scheduled Executor All-Members Variants**
   - `scheduleOnAllMembers(task, delay)`
   - `scheduleOnAllMembersAtFixedRate(task, delay, period)`

7. **Cardinality Estimator Distributed Proxy**
   - `ICardinalityEstimator` distributed proxy wrapping existing HLL internal
   - `add(value)` — add to estimator
   - `estimate()` — return cardinality estimate
   - `aggregate(estimators...)` — merge multiple estimators (HLL union)
   - Client codecs

**Tests:**
- Per-feature unit + integration tests
- Interop where official-client exposes the feature

**Done gate:**
- All data structure operations that exist in server runtime are accessible through client protocol
- Missing features are implemented

**File count estimate:** ~8 new files, ~12 modified files

---

### WP17 — Observability / Management Parity (P2)

**Goal:** Complete metrics, stats, and management surface.

**Tasks:**

1. **Per-Structure Stats Objects**
   - `LocalMapStats` — puts, gets, removes, hits, entry count, heap cost, near cache stats
   - `LocalQueueStats` — offers, polls, events, min/max/avg age
   - `LocalTopicStats` — publish count, receive count
   - `LocalMultiMapStats`, `LocalReplicatedMapStats`, `LocalCacheStats`
   - Wire all stats into existing `HazelcastMetrics`

2. **REST Management Endpoints Completion**
   - `GET /hazelcast/rest/maps/{name}/stats` — per-map stats
   - `GET /hazelcast/rest/queues/{name}/stats` — per-queue stats
   - `POST /hazelcast/rest/cluster/state` — change cluster state
   - `GET /hazelcast/rest/cluster/members` — member list with details
   - `GET /hazelcast/rest/cluster/version` — cluster version

3. **Diagnostics**
   - `DiagnosticsService` — periodic health snapshot
   - Slow operation detection and logging
   - Connection count / pending invocation count / event queue depth

4. **Management Center Compatibility** (best-effort)
   - Metrics endpoint format compatible with MC expectations
   - Member info endpoint with expected fields

**Tests:**
- Unit: stats accumulation
- Integration: REST endpoint responses match expected format
- Metrics: Prometheus scrape returns valid exposition format

**Done gate:**
- Per-structure stats are accurate and accessible
- REST management surface is complete
- Diagnostics service runs

**File count estimate:** ~8 new files, ~6 modified files

---

### WP18 — Full Parity Proof & Documentation (P3)

**Goal:** Replace "strongly compatible subset" with evidence-backed parity claim.

**Tasks:**

1. **Living Parity Matrix**
   - Machine-readable capability matrix: Hazelcast feature → Helios status → evidence → test link
   - Auto-generate from test results and code inventory
   - Publish as part of CI output

2. **Full-Surface Audit**
   - Repo-wide scan for `not implemented`, `TODO`, `FIXME`, deferred behavior
   - Resolve every hit: implement, remove from public surface, or document exclusion
   - Verify no orphan codecs, orphan proxies, or dead handler registrations

3. **Interop Suite Expansion**
   - Add interop tests for every feature `hazelcast-client@5.6.0` exposes
   - Multi-member interop: connect to 3-node cluster, verify partition routing
   - Failover interop: member leave during client operations, verify recovery

4. **Documentation Alignment**
   - README: accurate feature table with supported/unsupported status
   - API docs: every public export documented
   - Examples: working examples for all major features using official client
   - Remove all wording that implies unsupported parity

5. **HeliosClient Removal Completion** (per parity plan Section 8)
   - Remove `src/client/HeliosClient.ts` and all exports
   - Remove `DEFERRED_CLIENT_FEATURES`
   - Rewrite `HeliosInstance.ts` — no "shared member/remote contract" wording
   - Update package.json exports: no `./client` subpath

**Tests:**
- CI: parity matrix generation validates no regressions
- Audit: zero `not implemented` in retained public surface
- Interop: complete suite passes

**Done gate:**
- Parity matrix shows no unexplained gaps
- Documentation matches runtime reality
- HeliosClient fully removed
- A new user gets an accurate understanding of Helios capabilities

**File count estimate:** ~0 new source files, many modified files

---

## Execution Order

### Phase 1 — Foundation (P0)

| Order | Work Package | Est. Effort | Dependencies |
|-------|-------------|-------------|--------------|
| 1 | WP2 — Split-Brain Protection + Merge | Medium | None |
| 2 | WP3 — Multi-Node CP Consensus | Large | None |
| 3 | WP1 — WAN Replication | Large | None |

### Phase 2 — Core Completeness (P1)

| Order | Work Package | Est. Effort | Dependencies |
|-------|-------------|-------------|--------------|
| 4 | WP5 — IMap Client Codecs + Advanced Ops | Large | None |
| 5 | WP10 — Listener/Event Breadth | Medium | WP5 (map listeners) |
| 6 | WP4 — Security Runtime Enforcement | Medium | None |
| 7 | WP6 — Transaction Coordinator Replication | Medium | None |
| 8 | WP11 — Serialization Remaining Gaps | Medium | None |
| 9 | WP8 — SQL Breadth Expansion | Large | None |
| 10 | WP7 — Durable Executor | Medium | None |
| 11 | WP9 — Near Cache Completion | Small | None |
| 12 | WP12 — Cache Completeness | Medium | None |

### Phase 3 — Polish (P2)

| Order | Work Package | Est. Effort | Dependencies |
|-------|-------------|-------------|--------------|
| 13 | WP16 — Remaining Data Structure Gaps | Medium | WP5 (codec patterns) |
| 14 | WP15 — Connection & Config Polish | Medium | None |
| 15 | WP14 — Discovery SPI / Cloud Discovery | Medium | None |
| 16 | WP13 — Persistence Depth | Medium | None |
| 17 | WP17 — Observability / Management Parity | Medium | WP16 (stats) |

### Phase 4 — Final Closure (P3)

| Order | Work Package | Est. Effort | Dependencies |
|-------|-------------|-------------|--------------|
| 18 | WP18 — Full Parity Proof & Documentation | Large | All above |

---

## Estimated Total New Files

| Category | New Files | Modified Files |
|----------|-----------|----------------|
| WAN Replication | ~15 | ~3 |
| Split-Brain | ~8 | ~5 |
| Multi-Node CP | ~5 | ~10 |
| Security | ~8 | ~6 |
| IMap Codecs | ~2 | ~3 |
| Transactions | ~3 | ~8 |
| Durable Executor | ~8 | ~0 |
| SQL Expansion | ~12 | ~4 |
| Near Cache | ~3 | ~5 |
| Listeners | ~5 | ~10 |
| Serialization | ~4 | ~6 |
| Cache | ~6 | ~4 |
| Persistence | ~6 | ~4 |
| Discovery | ~10 | ~3 |
| Config/Connection | ~6 | ~5 |
| Data Structures | ~8 | ~12 |
| Observability | ~8 | ~6 |
| Documentation | ~0 | many |
| **Total** | **~117** | **~94** |

---

## Verification Requirements

Each work package must satisfy before marking complete:

1. **Unit tests** — per-function / per-class correctness
2. **Integration tests** — multi-component interaction, real distributed behavior
3. **Failure tests** — member death, network partition, timeout, duplicate message handling
4. **Interop tests** — where `hazelcast-client@5.6.0` exposes the feature, prove round-trip
5. **No regressions** — `bun test` and `bun run test:interop` remain green
6. **No orphans** — no dead code, no unused exports, no unregistered handlers

---

## Done Definition

Helios may claim full Hazelcast-compatible TypeScript platform status only when:

- All P0 work packages are complete
- All P1 work packages are complete
- All P2 work packages are complete or explicitly excluded with documented rationale
- WP18 (P3) audit confirms no remaining unexplained gaps
- `hazelcast-client@5.6.0` interop suite covers every feature the client exposes
- No production `not implemented` or deferred behavior in retained public surface
- Parity matrix is published and accurate
- HeliosClient is fully removed

Until then, Helios should be described as **"a Hazelcast-compatible TypeScript/Bun distributed
platform with substantial but incomplete parity"**.
