# Multi-Node Resilience Plan

## Purpose

This plan describes how Helios achieves multi-node resilience for all data structures,
including write-behind queue state. It follows Hazelcast's proven architecture: partition
replication protects pending write-behind entries by replicating them to backup nodes. If
the primary node crashes, a backup promotes and the write-behind queue continues flushing.

**No WAL. No single-node persistence. Multi-node replication is the sole durability mechanism — exactly like Hazelcast.**

**Repo:** `/Users/zenystx/IdeaProjects/helios/`
**Java reference:** `/Users/zenystx/IdeaProjects/helios-1/` (read-only)

---

## Hazelcast Architecture Reference

Everything in this plan is grounded in Hazelcast's proven semantics. Cross-references to
the Java source are provided throughout.

### Key Java Files

| File | Lines | Purpose |
|------|-------|---------|
| `ClusterServiceImpl.java` | 1,189 | Orchestrates 4 sub-managers; join finalization, member updates, cluster state |
| `MembershipManager.java` | 1,531 | Member list publishing, mastership claims, suspected members, split-brain merge |
| `ClusterHeartbeatManager.java` | 760 | Failure detection (Deadline or Phi-Accrual), ICMP ping, clock drift handling |
| `ClusterJoinManager.java` | 1,143 | Join protocol, authentication, ConfigCheck validation, split-brain merge decisions |
| `InternalPartitionServiceImpl.java` | 1,706 | Partition table lifecycle, membership-triggered rebalancing, state publishing |
| `PartitionStateManagerImpl.java` | 522 | Partition assignment, member group factory, state stamps, snapshots |
| `MigrationManagerImpl.java` | 1,100+ | Migration lifecycle (plan → execute → commit → finalize), pause/resume |
| `OperationServiceImpl.java` | ~800 | Operation routing (partition/target/master), invocation registry, backpressure |
| `Invocation.java` | 919 | Invocation lifecycle, retry on WrongTargetException/PartitionMigratingException |
| `OperationRunnerImpl.java` | 598 | Operation execution, migration guard, backup sending after primary execution |
| `OperationBackupHandler.java` | 363 | Backup sending: version increment, Backup wrapper creation, sync/async routing |
| `Backup.java` | 378 | Backup execution on backup node: ownership validation, version staleness check |
| `PartitionReplicaManager.java` | 666 | Replica version tracking, anti-entropy task scheduling, sync request management |
| `MapReplicationOperation.java` | 167 | Composes 3 state holders for full partition state transfer |
| `WriteBehindStateHolder.java` | 254 | Captures write-behind queue + flush sequences + txn reservations for replication |
| `MapReplicationStateHolder.java` | 480 | Captures record store data + indexes for replication |

---

## Audit Remediation Tracker

| # | Finding | Severity | Plan Block | Status |
|---|---------|----------|------------|--------|
| 1 | Pre-Join Operation Ordering | CRITICAL | A.1 (ClusterServiceImpl) | REMEDIATED IN PLAN |
| 2 | Infinite Commit Retry | CRITICAL | B.3 (MigrationManager) | REMEDIATED IN PLAN |
| 3 | Version +1 Extra Delta on Migration Failure | HIGH | B.3 (MigrationManager) | REMEDIATED IN PLAN |
| 4 | MapProxy Migration to OperationService | CRITICAL | C.4 (NEW) | REMEDIATED IN PLAN |
| 5 | Dual Write Path (Broadcast → Operation Routing) | CRITICAL | Phase C/D Transition (NEW) | REMEDIATED IN PLAN |
| 6 | Lock Contention = Distributed Deadlock Factory | CRITICAL | Phase C (M-1) | REMEDIATED IN PLAN |
| 7 | Master Crash During FinalizeJoinOp | CRITICAL | A.4 (ClusterJoinManager) | REMEDIATED IN PLAN |
| 8 | StoreWorker Auto-Start After applyState() | HIGH | F.2 (WriteBehindStateHolder) | REMEDIATED IN PLAN |
| 9 | Missing Method Signatures | HIGH | F.4 (Write-Behind Queue Serialization) | REMEDIATED IN PLAN |
| 10 | Staging Area Data Loss in asList() | HIGH | F.2 (WriteBehindStateHolder) | REMEDIATED IN PLAN |
| 11 | Phase B↔C Circular Dependency | HIGH | B.3 (MigrationManager) | REMEDIATED IN PLAN |
| 12 | Version Gap Rejection in applyCompletedMigrations | HIGH | B.3 (MigrationManager) | REMEDIATED IN PLAN |
| 13 | Partition State Stamp Validation | HIGH | A.1 (ClusterStateManager) | REMEDIATED IN PLAN |
| 14 | ProcessShutdownRequestsTask | HIGH | B.5 (Graceful Shutdown) | REMEDIATED IN PLAN |
| 15 | Backup Ack Timeout Performance | HIGH | C.2 (Invocation) | REMEDIATED IN PLAN |
| 16 | Anti-Entropy OOM Chunking | HIGH | E.3 (Replica Sync) | REMEDIATED IN PLAN |
| 17 | Test Infrastructure Unspecified | HIGH | A.0 (NEW) | REMEDIATED IN PLAN |
| 18 | Backward Compatibility for Existing Tests | HIGH | C.3 (OperationServiceImpl) | REMEDIATED IN PLAN |
| 19 | Remote Agreement Validation | MEDIUM | A.2 (MembershipManager) | REMEDIATED IN PLAN |
| 20 | Partition Table Repair for Returning Members | MEDIUM | A.2 (MembershipManager) | REMEDIATED IN PLAN |
| 21 | Per-Namespace Version Tracking | MEDIUM | E.1 (PartitionReplicaManager) | REMEDIATED IN PLAN |
| 22 | JSON Framing Performance Tests | MEDIUM | A.5 (TCP Protocol) | REMEDIATED IN PLAN |
| 23 | Cooperative Yield Refinement | MEDIUM | A.3 (HeartbeatManager) | REMEDIATED IN PLAN |
| 24 | Test Count Target | MEDIUM | Integration Test Plan | REMEDIATED IN PLAN |
| 25 | Async Backup Silent Loss | LOW | Scope Exclusions | DOCUMENTED |
| 26 | WaitSet Invalidation | LOW | Scope Exclusions | DOCUMENTED |

---

## Existing Helios State

### What exists (complete, tested):
- **Member data model**: `Member`, `MemberImpl`, `MemberInfo`, `MemberMap`, `MembersView`, `MembersViewMetadata`, `VectorClock`, `MemberSelectors`
- **Partition data model**: `InternalPartitionImpl`, `PartitionReplica`, `PartitionTableView`, `PartitionStampUtil`, `MigrationPlanner`, `MigrationQueue`, `MigrationInfo`
- **Operation framework**: `Operation`, `OperationService`, `OperationServiceImpl` (single-node), `InvocationFuture`
  - Note: The existing `Operation` base class already has `partitionId`, `replicaIndex`, and `serviceName` fields — no breaking changes needed to the base class for multi-node support
- **TCP transport**: `TcpClusterTransport` (naive broadcast), `ClusterMessage` protocol
- **Discovery**: `HeliosDiscovery` providers (AWS, Azure, GCP, K8s, static), `ClusterJoinManager` (address resolution only)
- **Write-behind subsystem**: `WriteBehindStore`, `WriteBehindProcessor`, `StoreWorker`, `CoalescedWriteBehindQueue`, `ArrayWriteBehindQueue`, `BoundedWriteBehindQueue`, staging area, retry logic with `addFirst()`/`addForcibly()`

### What is missing (this plan fills):

| Layer | Missing | Java Reference |
|-------|---------|----------------|
| Cluster runtime | `ClusterServiceImpl`, `MembershipManager`, `ClusterHeartbeatManager` | Full join protocol, member list publishing, failure detection |
| Partition runtime | `InternalPartitionServiceImpl`, `PartitionStateManager`, `MigrationManager` | Partition assignment, ownership tracking, migration execution |
| Operation routing | Remote invocation, `InvocationRegistry`, partition-based routing | Route ops to partition owner, retry on migration |
| Backup replication | `BackupAwareOperation`, `OperationBackupHandler`, `Backup` execution | Sync/async backup after primary, version tracking |
| Anti-entropy | `PartitionReplicaManager`, anti-entropy task, replica sync | Background verification, full state transfer for stale replicas |
| Map replication | `MapReplicationOperation`, `MapReplicationStateHolder`, `WriteBehindStateHolder` | Full partition state transfer including write-behind queues |

---

## Phase Structure

```
Phase A: Cluster Runtime
   ↓
Phase B (part 1): Partition Runtime (B.1, B.2, B.3a — local planning only)
   ↓
Phase C: Operation Routing (needs B.1, B.2 for partition table)
   ↓
Phase B (part 2): Migration Execution (B.3b — remote sends, needs C)
   ↓
Phase D: Backup Replication
   ↓
Phase E: Anti-Entropy
   ↓
Phase F: Map Replication
```

Each phase depends on the previous. Within each phase, blocks may be parallelizable where noted.

---

## Phase A — Cluster Runtime

### Block A.0 — Multi-Node Test Infrastructure

**Ref:** Finding 17 (HIGH) — test infrastructure unspecified.

The existing `TestClusterRegistry.ts` (112 lines) is a simple in-memory registry with no TCP, no heartbeats, no migration. Integration tests require actual TCP connections, heartbeats, failure detection, and migration.

**New files:**
- `test-support/TestClusterNode.ts` — starts a real `ClusterServiceImpl` + `TcpClusterTransport` on a random port
- `test-support/TestCluster.ts` — manages N nodes, provides utilities:
  - `startNode()` → starts a new node and joins the cluster
  - `killNode(nodeId)` → kills a node (simulates crash)
  - `isolateNode(nodeId)` → blocks all TCP to/from a node (simulates network partition)
  - `waitForStable()` → waits until all members agree on member list and no migrations are in progress
  - `getMember(nodeId)` → returns the member's HeliosInstance

**All integration tests use real TCP with loopback addresses.**

**Test plan (~5 tests):**
- TestCluster: start 3 nodes, all see each other
- TestCluster: killNode triggers member removal
- TestCluster: waitForStable resolves after rebalancing
- TestCluster: isolateNode causes suspicion
- TestCluster: node restart (same address, new UUID) handled

### Goal

Replace `LocalCluster` (41-line stub) with a real cluster service that manages membership,
failure detection, and master election — matching Hazelcast's `ClusterServiceImpl` and its
three sub-managers.

### Hazelcast Architecture (proven semantics to follow)

**ClusterServiceImpl** orchestrates four sub-managers through a shared `clusterServiceLock` (ReentrantLock):
1. **MembershipManager** — canonical member list (`MemberMap`), member list publishing, mastership claims
2. **ClusterHeartbeatManager** — periodic heartbeats, failure detection, suspicion triggering
3. **ClusterJoinManager** — join protocol, authentication, ConfigCheck validation
4. **ClusterStateManager** — ACTIVE/FROZEN/PASSIVE cluster state transitions

**Master election algorithm** (from `MembershipManager.shouldClaimMastership()`):
- Members are ordered in the member list
- When a member suspects the master, it checks if ALL members *before* it in the list are also suspected
- If yes → it claims mastership via `FetchMembersViewOp` to all non-suspected members
- Other nodes accept if all members before the candidate are suspected on their side too
- New master builds `MembersView` from highest-version responses

**Join protocol** (from `ClusterJoinManager.startJoin()`):
1. New node discovers members via `HeliosDiscovery`
2. Sends `JoinRequestOp` to the master
3. Master validates (ConfigCheck: cluster name, partition count) and authenticates
4. Master creates new `MembersView`, sends `FinalizeJoinOp` with: members view, cluster state, partition state
5. Joining node calls `finalizeJoin()`: validates master, updates member list, sets `joined = true`
6. Master sends `MembersUpdateOp` to existing members

**Heartbeat protocol** (from `ClusterHeartbeatManager.heartbeat()`):
- Periodic at `HEARTBEAT_INTERVAL_SECONDS` (default 5s)
- Failure detector: **Deadline** (simple timeout) or **Phi-Accrual** (probabilistic)
  - Deadline: member suspected if `now - lastHeartbeat > MAX_NO_HEARTBEAT_SECONDS` (default 60s)
- Clock drift detection: if system clock jumped > 2 minutes, reset all heartbeat timestamps
- Master runs `heartbeatWhenMaster()` (suspects + sends); non-master runs `heartbeatWhenSlave()`
- On suspicion: `clusterService.suspectMember()` → master removes member OR non-master initiates mastership claim

### Block A.1 — ClusterServiceImpl + ClusterStateManager

**Ref:** `ClusterServiceImpl.java`, `ClusterStateManager.java`

**New files:**
- `src/internal/cluster/impl/ClusterServiceImpl.ts`
- `src/internal/cluster/impl/ClusterStateManager.ts`
- `src/internal/cluster/ClusterState.ts` (enum: ACTIVE, NO_MIGRATION, FROZEN, PASSIVE, IN_TRANSITION)

**ClusterServiceImpl fields** (matching Java):
```
node/nodeEngine, clusterClock, membershipManager, clusterJoinManager,
clusterHeartbeatManager, clusterStateManager, clusterServiceLock (async mutex),
joined (AtomicReference-equivalent), masterAddress, localMember, clusterId
```

**Key methods:**
- `init()` — schedules heartbeat manager, starts membership manager periodic publish
- `finalizeJoin(membersView, clusterState, clusterVersion, clusterId, masterTime)` — called on joining node when master sends `FinalizeJoinOp`; validates master, updates member list, sets `joined = true`
- `updateMembers(membersView, senderAddress)` — validates sender is master, version is newer, delegates to `MembershipManager.updateMembers()`
- `handleMastershipClaim(candidateAddress, candidateMembersView)` — validates all members before candidate are suspected, sets new master
- `suspectMember(member)` — if master: remove directly; otherwise: add to suspected set, attempt mastership claim
- `getLocalMember()`, `getMasterAddress()`, `getMembers()`, `getMember(address)`, `getMember(uuid)`, `isJoined()`, `isMaster()`

**Remediation — Finding 1 (CRITICAL): Pre-Join Operation Ordering**
The `finalizeJoin()` method MUST execute a `preJoinOp` before updating the member list. The correct ordering (matching `ClusterServiceImpl.java:421-424`) is:
1. Acquire lock
2. Validate master
3. **Run `preJoinOp.run()` — applies partition runtime state, service registrations**
4. Update member list via `updateMembers(membersView)`
5. Set `joined = true`

`FinalizeJoinOp` carries a `preJoinOp: Operation` parameter. Without this step, the joining node participates with incomplete state.
Add test: "FinalizeJoinOp: preJoinOp runs before updateMembers"

**ClusterStateManager** — tracks ACTIVE/FROZEN/PASSIVE transitions with partition state stamp validation (prevents state changes while partitions are migrating).

**Remediation — Finding 13 (HIGH): Partition State Stamp Validation**
Cluster state changes (ACTIVE→FROZEN→PASSIVE) require a distributed consensus gate:
1. Master sends `LockClusterStateOp` carrying the current `partitionStateStamp` to all members
2. Each member compares the stamp to its local stamp AND checks for ongoing migrations
3. If stamp mismatch OR migrations in progress → reject the lock → state change fails
4. Only when ALL members accept → state transition proceeds
Without this gate, a state change to FROZEN while migrations are in-flight could freeze a partition mid-migration, corrupting it permanently.
Ref: `ClusterStateManager.java:288-301` — `checkMigrationsAndPartitionStateStamp()`
Add test: "Cluster state change rejected during active migration"
Add test: "Cluster state change rejected on stamp mismatch"

**Test plan (~17 tests):**
- ClusterServiceImpl lifecycle (init, joined state, master state)
- Member lookup by address and UUID
- Cluster state transitions (ACTIVE → FROZEN → PASSIVE)
- State transition rejected during migration (stamp mismatch)
- *(Finding 1)* FinalizeJoinOp: preJoinOp runs before updateMembers
- *(Finding 13)* Cluster state change rejected during active migration
- *(Finding 13)* Cluster state change rejected on stamp mismatch

### Block A.2 — MembershipManager

**Ref:** `MembershipManager.java` (1,531 lines)

**New file:** `src/internal/cluster/impl/MembershipManager.ts`

**Fields:**
```
memberMapRef: MemberMap (the canonical member list — uses existing MemberMap class)
suspectedMembers: Set<string> (member UUIDs)
missingMembersRef: Map<string, MemberImpl> (keyed by UUID)
mastershipClaimInProgress: boolean
```

**Key methods:**

- `updateMembers(membersView: MembersView)` — the core member update:
  - **Step 0 (version gate): `shouldProcessMemberUpdate(incomingVersion)`** — reject the update
    immediately if `incomingVersion <= currentMemberMap.version`. This is a critical safety check
    that prevents stale or duplicate `MembersUpdateOp` messages from overwriting a newer member
    list. **Ref:** `ClusterServiceImpl.java:491-522`. Without this gate, out-of-order or
    retransmitted membership messages could roll back the member list to an earlier state.
  1. Compare current `MemberMap` to incoming `MembersView`
  2. For each member in view: if same address+UUID → keep; if address exists but UUID differs → member restarted (remove old, add new); new member → create, record heartbeat
  3. Create new `MemberMap` via `MemberMap.createNew(version, members)`
  4. For removed members: close connections, fire membership events
  5. For added members: fire membership events
  (Matches `MembershipManager.updateMembers()` in Java)

- `sendMemberListToOthers()` — master-only periodic publishing via `MembersUpdateOp` to all non-local members (matches Java's `MEMBER_LIST_PUBLISH_INTERVAL_SECONDS`)

- `suspectMember(member)` — adds to `suspectedMembers`, calls `tryStartMastershipClaim()` if not master

- `tryStartMastershipClaim()` — checks `shouldClaimMastership()` (all members before this node in member list are suspected), sets `mastershipClaimInProgress`, calls `pauseMigration()` (specifically here, during the mastership claim window — after `mastershipClaimInProgress` is set, before the new master publishes its member list; it is NOT called during a normal join), executes `DecideNewMembersViewTask`. **Ref:** `MembershipManager.java:672-693`

- `shouldClaimMastership()` — iterates member list: all members before local member must be in `suspectedMembers` set

**Remediation — Finding 19 (MEDIUM): Remote Agreement Validation**
`FetchMembersViewOp` receivers MUST validate independently: check that all members before the candidate in the receiver's own member list are suspected. If not, respond with rejection. Without this, a node with stale suspicion state could accept a spurious mastership claim.
Add test: "FetchMembersViewOp: receiver rejects if it doesn't suspect all prior members"

- `DecideNewMembersViewTask` logic:
   1. Send `FetchMembersViewOp` to all non-suspected members
   2. Wait for responses (with timeout from `MASTERSHIP_CLAIM_TIMEOUT_SECONDS`)
   3. Take highest-version `MembersView` from responses
   4. Build new view keeping only members that responded
   5. Call `updateMembers()` with new view
   6. Publish to all via `MembersUpdateOp`

**Remediation — Finding 20 (MEDIUM): Partition Table Repair for Returning Members**
When `updateMembers()` detects a UUID change (member restart: same address, new UUID), call `repairPartitionTableIfReturningMember(member)` to update partition replicas referencing the old member identity to the new one. Without this, the partition table has stale references.
Ref: `MembershipManager.java:342`
Add test: "updateMembers: UUID change triggers partition table repair"

**Test plan (~20 tests):**
- `updateMembers()`: adds new members, removes departed, handles UUID change (restart)
- `suspectMember()`: adds to suspected set, triggers mastership claim when appropriate
- `shouldClaimMastership()`: correct only when all prior members suspected
- Mastership claim: new master publishes correct member list
- Member list versioning: rejects older or same-version updates
- *(Finding 19)* FetchMembersViewOp: receiver rejects if it doesn't suspect all prior members
- *(Finding 20)* updateMembers: UUID change triggers partition table repair

### Block A.3 — ClusterHeartbeatManager

**Ref:** `ClusterHeartbeatManager.java` (760 lines)

**New file:** `src/internal/cluster/impl/ClusterHeartbeatManager.ts`

**Constants (matching Java):**
```
CLOCK_JUMP_THRESHOLD = 120_000 (2 minutes)
HEART_BEAT_INTERVAL_FACTOR = 10 (warning threshold = 10x interval)
```

**Config-driven (from properties):**
```
heartbeatIntervalMillis: from HEARTBEAT_INTERVAL_SECONDS (default 5s, min 1s)
maxNoHeartbeatMillis: from MAX_NO_HEARTBEAT_SECONDS (default 60s)
```

**Failure detection:** Start with `DeadlineClusterFailureDetector` (simple timeout: member is alive if `now - lastHeartbeat < maxNoHeartbeatMillis`). Phi-Accrual is deferred to v2.

**Key methods:**

- `init()` — schedules `heartbeat()` at `heartbeatIntervalMillis` interval via `setInterval`

- `heartbeat()` — the core periodic task (matching Java's `heartbeat()`):
  1. If not joined: return
  2. `checkClockDrift()` — detect system clock jumps > CLOCK_JUMP_THRESHOLD; if jump >= `maxNoHeartbeatMillis / 2`, reset all heartbeat timestamps (prevents false positives from clock adjustments)
  3. If master: `heartbeatWhenMaster()` — for each non-local member: check suspicion, send `HeartbeatOp`
  4. If non-master: `heartbeatWhenSlave()` — same per-member loop but no partial disconnection check

- `suspectMemberIfNotHeartBeating(member, now)` — queries failure detector `isAlive(member, now)`, calls `clusterService.suspectMember()` if not alive

- `onHeartbeat(member, timestamp)` — records heartbeat in failure detector, clears member suspicion, validates sender is known member with matching UUID

- `handleHeartbeat(senderMember, timestamp, suspectedMembers)` — validates sender, calls `onHeartbeat()`, passes suspected members to membership manager

**Test plan (~16 tests):**
- Heartbeat received → failure detector records, member not suspected
- Heartbeat timeout → member suspected
- Clock drift detection → heartbeat timestamps reset
- HeartbeatOp received from unknown member → rejected
- Master heartbeat cycle → all members receive heartbeat
- Cooperative yielding: heartbeat fires during long migration transfer (≤100ms delay)
- Cooperative yielding: heartbeat fires during large backup serialization
- Yield interval respected: no yield when CPU work < 100ms
- *(Finding 23)* Heartbeat jitter measured during 10MB migration transfer

#### ⚠ Architectural Constraint: Event Loop Blocking

Hazelcast runs heartbeats on a dedicated executor thread, entirely isolated from migration (`ASYNC_EXECUTOR`) and partition I/O threads. **Bun has no such isolation** — everything runs on a single event loop thread.

**The problem:** A large migration transfer (e.g. serializing 10 MB of partition data) is synchronous CPU work. While it runs, `setInterval`-based heartbeats (see `init()` above) cannot fire. Peers see no heartbeat → suspect the node → trigger member removal → destabilize the cluster.

**Mandatory mitigation — cooperative yielding:** Every long-running synchronous operation (migration serialization, backup batch sending, anti-entropy state transfer) **must** yield to the event loop periodically:

```typescript
// Every 100ms of CPU work, yield to let heartbeats and other I/O fire
if (Date.now() - lastYield > 100) {
    await new Promise(r => setImmediate(r));
    lastYield = Date.now();
}
```

**Remediation — Finding 23 (MEDIUM): Cooperative Yield Refinement**
- Use `setTimeout(r, 0)` instead of `setImmediate(r)` — more predictable in Bun's event loop model.
- Alternatively, use `Bun.sleep(0)` which is Bun-specific and yields to I/O.
- Add integration test: measure heartbeat jitter during a 10MB migration transfer.
- The 100ms threshold is a starting heuristic — tune based on actual heartbeat jitter measurements.
- Beware: large `Promise.all()` batches fill the microtask queue; `setImmediate` resolves only after microtasks drain.

**Secondary mitigation:** Consider offloading migration data serialization to a Bun `Worker` thread so the main event loop is never blocked by large partition transfers.

**Scope:** This constraint applies to **all phases**:
- Phase B — migration data serialization (`MigrationManager`)
- Phase D — backup batch sending (`OperationBackupHandler`)
- Phase E — anti-entropy full state transfer (`PartitionReplicaManager`)

All implementations in those phases must include cooperative yield checkpoints at ≤100ms CPU-work intervals.

### Block A.3.1 — Split-Brain Detection (Safety Mechanism)

> **This is NOT the same as split-brain merge (which is deferred to v2).** Split-brain merge
> requires sophisticated conflict-resolution policies. Split-brain detection is a lightweight
> safety gate that prevents silent data divergence.

**Why this is required:** Without detection, a network partition can create two independent
masters both accepting writes simultaneously. Data diverges silently and there is no merge
path — making the situation unrecoverable without detection to prevent it.

**New file:** `src/internal/cluster/impl/SplitBrainDetector.ts`

**Fields:**
```
quorumSize: number        // ⌊N/2⌋ + 1, recalculated on membership change
reachableMembers: Set<string>  // UUIDs of currently reachable members
readOnlyMode: boolean     // true when reachable < quorum
```

**Key methods:**

- `checkQuorum()` — called after any member reachability change:
  1. If `reachableMembers.size >= quorumSize` → exit read-only mode (if in it), log recovery
  2. If `reachableMembers.size < quorumSize` → enter read-only mode, log split-brain risk warning
  3. Quorum formula: `quorumSize = Math.floor(totalKnownMembers / 2) + 1`

- `isReadOnly()` — returns `readOnlyMode`; queried by `OperationRunnerImpl` before executing
  any mutating operation — throws `NodeIdleException` (or equivalent) if true

- `onMemberReachable(member: string)` — adds UUID to `reachableMembers`, calls `checkQuorum()`

- `onMemberUnreachable(member: string)` — removes UUID from `reachableMembers`, calls `checkQuorum()`

**Integration points:**
- `ClusterHeartbeatManager.onHeartbeat()` → calls `splitBrainDetector.onMemberReachable()`
- `ClusterHeartbeatManager.suspectMemberIfNotHeartBeating()` → on suspicion, calls `splitBrainDetector.onMemberUnreachable()`
- `MembershipManager.updateMembers()` → recalculates `quorumSize` when member list changes

**Test plan (~6 tests):**
- Quorum maintained: 3 reachable of 3 total → not read-only
- Quorum lost: 1 reachable of 3 total → read-only mode entered, warning logged
- Quorum regained: member recovers → read-only mode cleared
- Single-node cluster: quorum = 1, always satisfies quorum (node is reachable to itself)
- Membership change: adding a member raises quorum size; losing 2 of 4 triggers read-only
- Mutating operation rejected while in read-only mode

---

### Block A.4 — ClusterJoinManager (Enhanced)

**Ref:** `ClusterJoinManager.java` (1,143 lines)

The existing `ClusterJoinManager.ts` (107 lines) only resolves member addresses. Enhance it with the actual join protocol.

**Modify:** `src/internal/cluster/ClusterJoinManager.ts`

**New operations:**
- `JoinRequestOp` — sent by joining node to master
- `FinalizeJoinOp` — sent by master to joining node (carries: MembersView, cluster state, partition state, cluster ID)
- `MembersUpdateOp` — sent by master to existing members after join
- `HeartbeatOp` — periodic heartbeat message
- `FetchMembersViewOp` — sent during mastership claim

**Join protocol flow** (matching Java's `startJoin()`):
1. New node discovers members via existing `HeliosDiscovery`
2. Sends `JoinRequestOp` to master candidate
3. Master validates: `ConfigCheck` (cluster name, partition count), authentication (if configured)
4. Master creates new `MembersView` (clone + add joining members)
5. Master captures `PartitionRuntimeState` snapshot
6. Master sends `FinalizeJoinOp` to joining node(s) with: new members view, cluster state, cluster ID, partition state
7. Master sends `MembersUpdateOp` to existing members with new view + partition state
8. Joining node calls `ClusterServiceImpl.finalizeJoin()` — validates master, updates member list, sets `joined = true`

**Master self-election** (matching Java's `setThisMemberAsMaster()`):
- First node in cluster: sets self as master, generates cluster UUID, sets `joined = true`
- Sets cluster start time, member list version to 1

**Remediation — Finding 7 (CRITICAL): Master Crash During FinalizeJoinOp**
If the master crashes after sending `FinalizeJoinOp` to the joiner (step 6) but before sending `MembersUpdateOp` to existing members (step 7), the cluster splits: the joiner thinks it joined, but no other node knows about it.

**Recovery path:** The mastership claim protocol (Block A.2, `DecideNewMembersViewTask`) IS the recovery. The new master sends `FetchMembersViewOp` to all reachable members — if the partially-joined node responds, it's included in the new view; if not, it's excluded.

**Required test:** "Master crashes between FinalizeJoinOp and MembersUpdateOp — new master includes joiner if reachable"

**ConfigCheck** (from `ConfigCheck.java`):
- Validates cluster name match
- Validates partition count match
- Rejects lite member join if cluster doesn't support it

**Test plan (~16 tests):**
- Join protocol: new node successfully joins, receives member list and partition state
- Join rejected: wrong cluster name, wrong partition count
- Master self-election: first node becomes master
- Multiple joins: sequential join of 3+ nodes
- Join during migration: paused until migration completes
- *(Finding 7)* Master crashes between FinalizeJoinOp and MembersUpdateOp — new master includes joiner if reachable

### Block A.5 — TCP Protocol Upgrade

**Ref:** Custom Helios protocol (not a direct Java port — Hazelcast uses its own binary protocol)

**Modify:** `src/cluster/tcp/TcpClusterTransport.ts`, `src/cluster/tcp/ClusterMessage.ts`

Upgrade the existing naive broadcast TCP transport to support the cluster operations defined above. Add message types:

```typescript
// Extended ClusterMessage types
type ClusterMessage =
  | HelloMsg              // existing
  | MapPutMsg             // existing
  | MapRemoveMsg          // existing
  | MapClearMsg           // existing
  | InvalidateMsg         // existing
  | JoinRequestMsg        // NEW: join protocol
  | FinalizeJoinMsg       // NEW: join finalization
  | MembersUpdateMsg      // NEW: member list publish
  | HeartbeatMsg          // NEW: periodic heartbeat
  | FetchMembersViewMsg   // NEW: mastership claim
  | MembersViewResponseMsg // NEW: mastership claim response
  | OperationMsg          // NEW: generic operation routing (Phase C)
  | OperationResponseMsg  // NEW: operation response (Phase C)
  | BackupMsg             // NEW: backup operation (Phase D)
  | BackupAckMsg          // NEW: sync backup ack (Phase D)
```

Connection management: upgrade from `connectToPeer()` (manual) to membership-driven connection management. When a member joins → connect; when removed → disconnect.

**Test plan (~13 tests):**
- Hello handshake, member identification
- JoinRequest → FinalizeJoin round-trip
- HeartbeatMsg delivery and parsing
- MembersUpdate broadcast
- Connection auto-close on member removal
- JsonSerializationStrategy: serialize/deserialize round-trip for each message type
- SerializationStrategy interface: swapping strategy produces identical logical output
- *(Finding 22)* Throughput benchmark: JSON vs reference MessagePack encoding for 1000 BackupMsg messages
- *(Finding 22)* Memory test: serialize + send 1000 BackupMsg, verify peak memory < 2x expected
- *(Finding 22)* Strategy swap test: switch SerializationStrategy mid-test, verify in-flight messages not corrupted

#### ⚠ Protocol Performance: JSON Serialization Overhead

The plan uses JSON framing for all TCP messages. Hazelcast uses a custom binary protocol (`IdentifiedDataSerializable`), which is far more compact.

**The numbers at scale:**
- Backup operation with 100 entries: JSON ≈ 200–300 KB vs binary ≈ 100 KB
- At 500 backup ops/sec: ~100 MB/s extra bandwidth and ~5 ms JSON parsing overhead per op
- At high throughput, JSON becomes a measurable bottleneck in both CPU and network

**Recommendation:** Use MessagePack or CBOR for production. Keep JSON as a debug/development mode (human-readable, no tooling required).

**At minimum**, document JSON as a known performance bottleneck and define a `SerializationStrategy` interface so the encoding can be swapped without touching transport logic:

```typescript
interface SerializationStrategy {
    serialize(message: ClusterMessage): Buffer;
    deserialize(buffer: Buffer): ClusterMessage;
}
```

- **v1 (default):** `JsonSerializationStrategy` — wire-compatible, human-readable, suitable for development and testing
- **v2 (future):** `MessagePackSerializationStrategy` or `CborSerializationStrategy` — compact binary, production-grade throughput

`TcpClusterTransport` should accept a `SerializationStrategy` at construction time, defaulting to `JsonSerializationStrategy`. This keeps v1 behavior unchanged while leaving an explicit migration path to binary.

---

## Phase B — Partition Runtime

### Goal

Replace the minimal `PartitionService` interface (currently `src/spi/PartitionService.ts` with
`getPartitionCount()`; test support uses `TestPartitionService.ts`) with a real partition
service that assigns partitions to nodes, triggers rebalancing on membership changes, and
executes migrations. (Note: the name `SingleNodePartitionService` does not exist as a file in
the codebase.)

### Hazelcast Architecture (proven semantics to follow)

**InternalPartitionServiceImpl** manages the partition table lifecycle:
- `firstArrangement()` — initial partition assignment on master (uses `PartitionStateGenerator`)
- `memberAdded()` / `memberRemoved()` — trigger `MigrationManager.triggerControlTask()`
- `applyPartitionRuntimeState()` — non-master applies state received from master (per-partition version comparison)
- `publishPartitionState()` — master periodically sends state to all members

**PartitionStateManager** owns the partition table:
- `InternalPartitionImpl[]` — the actual partition array
- `initializePartitionAssignments()` — creates initial assignment using `PartitionStateGenerator`
- `repartition()` — computes new assignment after membership changes
- `stateStamp` — hash of all partition versions for quick staleness detection

**MigrationManager** handles the migration lifecycle:
1. `triggerControlTask()` → `ControlTask` → `RedoPartitioningTask`
2. `partitionStateManager.repartition()` computes new replica arrays
3. `MigrationPlanner.planMigrations()` produces per-partition migration decisions (COPY, SHIFT_UP, SHIFT_DOWN, MOVE)
4. `MigrationRequestOperation` sent to destination (data transfer)
5. `MigrationCommitOperation` sent to destination
6. `FinalizeMigrationOperation` on both source and destination
7. `PublishCompletedMigrationsOperation` to all members

### Block B.1 — PartitionStateManager

**Ref:** `PartitionStateManagerImpl.java` (522 lines)

**New file:** `src/internal/partition/impl/PartitionStateManager.ts`

**Fields:**
```
partitions: InternalPartitionImpl[]  (reuse existing class)
partitionCount: number (from config, default 271)
initialized: boolean
stateStamp: bigint (from PartitionStampUtil — reuse existing)
```

**Key methods:**

- `initializePartitionAssignments(members: Member[])` — round-robin assignment of partition owners across data members (matching `PartitionStateGeneratorImpl.arrange()`). For each partition, sets replica[0] (owner). Backup replicas assigned to different members up to `backupCount`.

- `repartition(currentMembers: Member[], excludedMembers: Member[])` — computes new partition assignment after membership change. Returns `PartitionReplica[][]` (new assignment per partition).

- `updateStamp()` — recalculates `stateStamp` from all partition versions via `PartitionStampUtil`

- `getPartitionOwner(partitionId)` — returns owner `PartitionReplica` (or null if unassigned)

- `getPartitionId(key: Data)` — `hash(key) % partitionCount` (matching Hazelcast's deterministic partitioning)

- `toPartitionTableView()` — creates immutable `PartitionTableView` snapshot (reuse existing class)

**Test plan (~12 tests):**
- Initial assignment: all partitions assigned, owners distributed across members
- Backup assignment: backups on different members than owner
- Repartition: member added → partitions redistributed; member removed → orphaned partitions reassigned
- `getPartitionId()`: deterministic, same key always maps to same partition
- State stamp: changes when partition versions change

### Block B.2 — InternalPartitionServiceImpl

**Ref:** `InternalPartitionServiceImpl.java` (1,706 lines)

**New file:** `src/internal/partition/impl/InternalPartitionServiceImpl.ts`

**Interface:** Implement full `PartitionService` interface (extend current minimal interface)

**Fields:**
```
partitionStateManager: PartitionStateManager
migrationManager: MigrationManager (Block B.3)
replicaManager: PartitionReplicaManager (Phase E)
partitionCount: number
partitionServiceLock: AsyncMutex
latestMaster: Address
initialized: boolean
```

**Key methods:**

- `init()` — schedules periodic partition state publishing (matching `PARTITION_TABLE_SEND_INTERVAL`), starts migration manager

- `firstArrangement()` — master-only: calls `partitionStateManager.initializePartitionAssignments()`, publishes state to cluster. Non-master: sends `AssignPartitionsOp` to master.

- `memberAdded(member)` — triggers `migrationManager.triggerControlTask()` to rebalance

- `memberRemoved(member)` — triggers migration to redistribute orphaned partitions

- `applyPartitionRuntimeState(state, sender)` — non-master applies state from master:
  1. Validates sender is master
  2. Per-partition version comparison (skip if new < current; accept if new > current)
  3. Sets initialized

- `getPartition(partitionId)` — returns `InternalPartition`
- `getPartitionOwner(partitionId)` — returns owner address
- `getPartitionId(key: Data)` — delegates to state manager
- `getMemberPartitions(member)` — returns partition IDs owned by member

**Test plan (~15 tests):**
- `firstArrangement()`: partitions assigned on master, published to non-master
- `memberAdded()`: triggers rebalancing
- `memberRemoved()`: orphaned partitions reassigned
- `applyPartitionRuntimeState()`: applies newer versions, rejects older
- `getPartitionOwner()`: returns correct owner after assignment

### Block B.3 — MigrationManager

**Ref:** `MigrationManagerImpl.java` (1,100+ lines)

**New file:** `src/internal/partition/impl/MigrationManagerImpl.ts`

**Fields:**
```
migrationQueue: MigrationQueue (reuse existing class)
activeMigrations: Map<number, MigrationInfo> (keyed by partitionId)
completedMigrations: Set<MigrationInfo>
migrationPlanner: MigrationPlanner (reuse existing class)
migrationTasksAllowed: boolean (pause/resume)
maxParallelMigrations: number (from PARTITION_MAX_PARALLEL_MIGRATIONS, default 10)
```

**Remediation — Finding 11 (HIGH): Phase B↔C Circular Dependency**
Block B.3 sends `MigrationRequestOperation` to remote nodes, but remote operation dispatch requires Phase C. Split Block B.3:

- **Block B.3a** — Migration planning, local state management, migration queue (no remote sends). Includes: `triggerControlTask()`, `ControlTask`, `RedoPartitioningTask`, `MigrationPlanner` invocation, `pauseMigration()`/`resumeMigration()`.
- **Block B.3b** — Migration execution (remote sends, requires Phase C). Includes: `MigrationRequestOperation` send, `commitMigrationToDestination()`, `FinalizeMigrationOperation`, `PublishCompletedMigrationsOp`.

Phase dependency:
```
B.3a (local planning) → C (operation routing) → B.3b (remote migration execution)
```

This eliminates the circular dependency while keeping the migration logic logically grouped.

**Migration lifecycle** (matching Java):

1. **`triggerControlTask()`** — clears queue, adds `ControlTask`

2. **ControlTask → RedoPartitioningTask:**
   - Calls `partitionStateManager.repartition()` → new `PartitionReplica[][]`
   - For each partition: `MigrationPlanner.planMigrations()` (reuse existing) → migration decisions
   - Prioritize COPY and SHIFT_UP operations
   - Schedule migrations via `MigrationPlanTask`

3. **MigrationPlanTask → per-partition migrations:**
   - Send `MigrationRequestOperation` to destination
   - Destination collects state via `MapReplicationOperation` (Phase F)
   - On success: `commitMigrationToDestination()` → `MigrationCommitOperation`
   - On both nodes: `FinalizeMigrationOperation` → update partition table, clear migrating flag

4. **`pauseMigration()` / `resumeMigration()`** — `boolean` toggle with delayed resume (3s, matching `MIGRATION_PAUSE_DURATION_SECONDS_ON_MIGRATION_FAILURE`)

5. **`commitMigrationToDestination()`** — commit phase:
   - `MigrationCommitOperation` sent to destination
   - **Remediation — Finding 2 (CRITICAL): Infinite Commit Retry**
     `MigrationCommitOperation` MUST use infinite retry (`tryCount = Number.MAX_SAFE_INTEGER`) with heartbeat-based timeout (not wall-clock timeout). A commit that succeeds on the destination but whose response is lost would corrupt the partition table if the master assumes failure.
     Ref: `MigrationManagerImpl.java:413-482` — `commitMigrationToDestinationAsync()` sets `tryCount=Integer.MAX_VALUE` and recursively retries on `OperationTimeoutException`.
     The +1 version delta (Finding 3) is the safety net for when this infinite retry eventually gives up.

   - **Remediation — Finding 3 (HIGH): Version +1 Extra Delta on Migration Failure**
     When a migration fails or a commit fails, increment the partition version by `replicaCount + 1` (not just `replicaCount`). The extra +1 prevents a stale in-flight `MigrationCommitOperation` (that the master assumed failed) from being applied later.
     Ref: `MigrationManagerImpl.java:1519-1521, 1603-1605`
     Add test: "Migration failure: version increment includes +1 extra delta"
     Add test: "Stale commit after failure: rejected due to version mismatch"

6. **`PublishCompletedMigrationsOp` — notifying all members (H-7):**
   - After each migration finalizes, master sends `PublishCompletedMigrationsOp` to all members
   - **Ref:** `PublishCompletedMigrationsOperation.java:42-96`
   - Operation carries `Collection<MigrationInfo>`; receivers call `applyCompletedMigrations()` to update their local partition tables immediately
   - Without this step, non-master nodes only learn about ownership changes via the periodic `publishPartitionState()` broadcast (default interval: 15 s), creating a 15-second window where operations are routed to stale owners and silently fail or are retried unnecessarily
   - `completedMigrations` field accumulates these until the next full partition-state publish, at which point it is cleared

   **Remediation — Finding 12 (HIGH): Version Gap Rejection in applyCompletedMigrations**
   `applyCompletedMigrations()` MUST check that each migration's `initialPartitionVersion` equals the current partition version. If there's a gap (migration was missed), reject the entire batch and request full partition state from master.
   Ref: `InternalPartitionServiceImpl.java:860` — `if (initialPartitionVersion != currentVersion) → break, return false`
   Add test: "applyCompletedMigrations: version gap causes full state request"

6. **Migration rollback protocol (H-8):**
   - **Ref:** `FinalizeMigrationOperation.java:97, 181-205`
   - Timeout on `MigrationRequestOperation` response (or source node death detected)
   - On timeout / source death: master sends `FinalizeMigrationOperation(success=false)` to destination
   - Destination calls `rollbackMigration()` on all registered services → each service clears any partially-applied state from `PartitionContainer` (Block B.4)
   - Master marks migration as failed, calls `pauseMigration()` briefly, then replans using remaining healthy replicas
   - Rollback ensures no partial state is ever observable; partition ownership reverts to the pre-migration assignment

**Test plan (~25 tests):**
- Migration planning: member added → correct migration decisions
- Migration execution: data transferred to destination
- Migration commit: partition table updated on both nodes
- Pause/resume: migrations blocked during pause
- Parallel migration limit: respects `maxParallelMigrations`
- `PublishCompletedMigrationsOp`: non-master nodes update partition table immediately after migration, not after 15 s interval
- `PublishCompletedMigrationsOp`: members apply only migrations newer than their current view (idempotent)
- `PublishCompletedMigrationsOp`: `completedMigrations` cleared after full partition-state publish
- `PublishCompletedMigrationsOp`: operation carries correct `MigrationInfo` collection
- Rollback on timeout: destination clears partial state, ownership reverts
- Rollback on source death: destination clears partial state, master replans
- Rollback idempotency: calling rollback twice leaves clean state
- Rollback with replan: subsequent migration attempt uses surviving replicas
- *(Finding 2)* Migration failure: version increment includes +1 extra delta
- *(Finding 2)* Stale commit after failure: rejected due to version mismatch
- *(Finding 3)* Infinite retry on MigrationCommitOperation with heartbeat-based timeout
- *(Finding 12)* applyCompletedMigrations: version gap causes full state request

### Block B.4 — PartitionContainer (H-5)

**Ref:** `PartitionContainerImpl.java:46-263`

**New file:** `src/internal/partition/impl/PartitionContainer.ts`

**Purpose:** One `PartitionContainer` instance exists per partition. It is the single authoritative store for all service data belonging to that partition — forming the partition → service namespace → record store hierarchy that both migration (Block B.3) and replication (Phase F) depend on.

**Fields:**
```
partitionId: number
recordStores: Map<string, RecordStore>   // map name → RecordStore
```

**Key methods:**

- `getRecordStore(mapName: string): RecordStore` — returns (or lazily creates) the `RecordStore` for a named map within this partition
- `getAllNamespaces(): string[]` — enumerates all service namespaces present (used by migration to collect what must be transferred)
- `cleanUpOnMigration()` — called by rollback or post-migration cleanup; destroys all record stores in this partition container and resets state to empty

**Relationship to other blocks:**
- `MigrationManager` (Block B.3) calls `container.getAllNamespaces()` when building `MigrationRequestOperation` payload
- `FinalizeMigrationOperation` rollback calls `container.cleanUpOnMigration()` on destination
- `MigrationAwareService` (Block B.6) receives a `PartitionContainer` reference via `prepareReplicationOperation()`
- Phase F (`MapReplicationOperation`) reads from / writes to `RecordStore` instances obtained through `PartitionContainer`

**Test plan (~6 tests):**
- `getRecordStore()`: returns same instance on repeated calls for same map name (lazy singleton per partition)
- `getRecordStore()`: returns distinct instances for different map names within the same partition
- `getAllNamespaces()`: reflects all map names for which stores have been created
- `cleanUpOnMigration()`: all record stores destroyed; subsequent `getRecordStore()` returns fresh empty store
- Multiple partitions: containers are independent; clearing one does not affect another
- Integration with MigrationManager: namespaces collected correctly during migration planning

### Block B.5 — Graceful Shutdown Protocol (H-1)

**Ref:** `ShutdownRequestOperation.java:48-70`, `InternalPartitionServiceImpl.java:990-1029`

**Purpose:** Allow a node to leave the cluster without triggering crash-recovery paths. Today there is no shutdown handshake — a departing node looks identical to a crashed node, forcing full recovery. This block adds an explicit protocol so partitions are migrated off the node before it exits, resulting in zero data loss and zero post-departure recovery work.

**Protocol steps:**

1. Departing node sends `ShutdownRequestOp` to master
2. Master marks the node's address in `shutdownRequestedMembers: Set<Address>`
3. Master immediately triggers `migrationManager.triggerControlTask()` — the control task treats `shutdownRequestedMembers` as excluded members when calling `partitionStateManager.repartition()`, so the new assignment contains no partitions for the departing node
4. Normal migration pipeline (Block B.3) executes: data is moved to surviving replicas
5. Departing node awaits an acknowledgement from master (with configurable timeout, default 30 s) confirming all its partitions have been migrated away
6. If timeout expires before all partitions are migrated, node logs a warning and exits anyway (best-effort, no hang)
7. Node exits cleanly — no `memberRemoved()` crash-recovery path needed for data; membership manager still fires `memberRemoved()` but `MigrationManager` detects the node was already in `shutdownRequestedMembers` and skips redundant replanning

**Invariants:**
- A node in `shutdownRequestedMembers` is never assigned new partitions during any concurrent repartition
- `ShutdownRequestOp` is idempotent (repeated sends are safe)
- Graceful shutdown does not block indefinitely; timeout ensures the cluster is never held hostage by a slow migration

**New operations:**
- `ShutdownRequestOp` — sent from departing node to master; master replies with `ACK` once all partitions migrated
- No new operation needed for the ack path; master sends a direct response on the same operation future

**Remediation — Finding 14 (HIGH): ProcessShutdownRequestsTask**
The plan omits the mechanism by which the master knows when to send the shutdown ack. Add:

**New periodic task on master: `ProcessShutdownRequestsTask`**
- Runs periodically (every 5s, same interval as heartbeat)
- For each member in `shutdownRequestedMembers`:
  1. Check if the member owns zero partitions (`getMemberPartitions(member).length === 0`)
  2. If zero partitions remain → send `ShutdownResponseOp` to the departing member
  3. Remove member from `shutdownRequestedMembers`
- Without this periodic check, the departing node's await will never resolve.

Ref: `MigrationManagerImpl.java:621-635, 2030`
Add test: "ProcessShutdownRequestsTask sends response when partitions are migrated away"

**Test plan (~9 tests):**
- Graceful shutdown: all partitions migrated off departing node before it exits
- Graceful shutdown: departing node not assigned any new partitions during shutdown window
- Graceful shutdown: `memberRemoved()` after graceful shutdown does not trigger redundant replanning
- Graceful shutdown: zero data loss — all records accessible on surviving nodes post-departure
- Graceful shutdown timeout: node exits after timeout even if migrations incomplete
- `ShutdownRequestOp` idempotency: duplicate sends handled without error
- Concurrent shutdown: two nodes shutting down simultaneously — both are excluded from repartition
- Shutdown vs crash comparison: graceful shutdown leaves no orphaned partitions; crash does (existing recovery path)
- *(Finding 14)* ProcessShutdownRequestsTask sends response when partitions are migrated away

### Block B.6 — MigrationAwareService Interface (H-6)

**Ref:** `FragmentedMigrationAwareService.java:45-82`

**Purpose:** Today Phase F hard-codes `MapReplicationOperation` as the sole way to transfer service state during migration. This block introduces the `MigrationAwareService` interface so that any future service (Queue, MultiMap, Set, etc.) can plug into the migration pipeline without modifying `MigrationManager`. Phase F becomes the first — not the only — implementation.

**New interfaces:**

```typescript
// src/internal/partition/MigrationAwareService.ts

export interface ServiceNamespace {
  /** Service-unique name for this namespace (e.g. map name, queue name) */
  name: string;
}

export interface MigrationAwareService {
  /**
   * Called by MigrationManager during MigrationRequestOperation processing.
   * Returns an Operation that, when executed on the destination, applies this
   * service's state for the given partition and namespaces.
   *
   * @param event      - describes source, destination, partitionId, migration type
   * @param namespaces - the ServiceNamespace instances to include (subset of getAllNamespaces())
   * @returns an Operation to send to the destination, or null if nothing to migrate
   */
  prepareReplicationOperation(
    event: PartitionMigrationEvent,
    namespaces: ServiceNamespace[]
  ): Operation | null;
}
```

**Registration:**
- `InternalPartitionServiceImpl` maintains `migrationAwareServices: Map<string, MigrationAwareService>`
- Services register themselves during `init()` via `partitionService.registerMigrationAwareService(serviceName, impl)`
- `MigrationManager` iterates registered services when building `MigrationRequestOperation`, collecting one replication operation per service per partition

**Phase F relationship:**
- `MapReplicationOperation` (Phase F) is the first concrete implementation of `MigrationAwareService`
- Phase F docs should note: "`MapReplicationOperation` implements `MigrationAwareService.prepareReplicationOperation()`"
- Future services (Queue, MultiMap) follow the same pattern without touching migration core

**New files:**
- `src/internal/partition/MigrationAwareService.ts` — interface definitions above
- `src/internal/partition/PartitionMigrationEvent.ts` — value object: `{ partitionId, source, destination, migrationType: 'COPY' | 'MOVE' | 'SHIFT_UP' | 'SHIFT_DOWN' }`

**Test plan (~5 tests):**
- Interface contract: a mock `MigrationAwareService` registered for a service name is called during migration
- `prepareReplicationOperation()` returning `null` is handled gracefully (no-op for that service)
- Multiple services registered: all are iterated; each contributes its replication operation independently
- Phase F integration: `MapReplicationOperation` correctly satisfies the interface for a partition with data
- Future-proofing: registering a second service alongside MapService does not break existing migration flow

---

## Phase C — Operation Routing

### Goal

Upgrade `OperationServiceImpl` from local-only dispatch to partition-aware routing — operations
go to the partition owner, retry on migration, support remote invocation.

### Hazelcast Architecture (proven semantics to follow)

**Three routing modes** (from `OperationServiceImpl`):
1. **Partition-based** (`invokeOnPartition`): target = `partitionService.getPartition(id).getReplica(replicaIndex)`
2. **Target-based** (`invokeOnTarget`): caller specifies exact address
3. **Master-based** (`invokeOnMaster`): target = current master

**Invocation lifecycle** (from `Invocation.java`):
1. Resolve target from partition table
2. Register in `InvocationRegistry` (gets callId, backpressure check)
3. If local: execute directly; if remote: serialize and send over TCP
4. On completion: deregister, release callId permit, resolve future
5. On error: retry if `RetryableException` (WrongTargetException, PartitionMigratingException)

**Migration guards** (from `OperationRunnerImpl.ensureNoPartitionProblems()`):
- If `partition.isMigrating()` → throw `PartitionMigratingException` (retryable)
- If wrong owner → throw `WrongTargetException` (retryable)
- Both cause the `Invocation` to re-resolve the partition table and retry

**Retry protocol** (from `Invocation.handleRetry()`):
- First 5 retries: immediate
- Later: exponential backoff `min(2^(invokeCount-5), tryPauseMillis)`
- Max retries from `INVOCATION_MAX_RETRY_COUNT` (default 250)

### ⚠ Critical Section Rule — async/await vs Java `synchronized` (M-1)

**Finding:** Java's `synchronized` blocks are non-interruptible — once a thread enters the block,
no other thread executes until it exits. Bun's `async/await` creates **voluntary preemption
points**: any `await` inside a critical section allows other tasks to interleave before the
awaited expression resolves.

**Rule:** Any method that reads-modifies-writes shared state across an `await` boundary **MUST**
hold the cluster service lock (the async mutex introduced in Phase A) for the entire
read–compute–write sequence.

**Correct pattern:**
```typescript
// CORRECT: Hold lock across await
await clusterServiceLock.acquire();
try {
  const state = readState();
  const newState = await computeNewState(state);
  writeState(newState);
} finally {
  clusterServiceLock.release();
}
```

**Incorrect pattern:**
```typescript
// INCORRECT: Lock released before await
await clusterServiceLock.acquire();
const state = readState();
clusterServiceLock.release();
const newState = await computeNewState(state); // INTERLEAVING POINT!
writeState(newState); // State may have changed between the two lines!
```

**Remediation — Finding 6 (CRITICAL): Lock Contention = Distributed Deadlock Factory**

In Bun's single-threaded model, a single `clusterServiceLock` guarding `finalizeJoin`, `updateMembers`, `heartbeat`, `suspectMember`, `triggerControlTask`, and every migration step creates a contention bottleneck. If a lock holder performs I/O (TCP send, migration data transfer) while holding the lock, all other critical sections queue up. A heartbeat blocked behind a migration lock will stall, causing false suspicions.

**Mandatory audit rules for lock usage:**
1. **No TCP sends or awaits for remote responses while holding the lock.** The lock guards only atomic in-memory state transitions.
2. **Pattern:** Lock → snapshot-read → release lock → I/O outside lock → re-acquire lock → compare-and-swap validation.
3. **Consider separate locks** for membership, migration, and heartbeat instead of one global lock. At minimum:
   - `membershipLock` — guards MemberMap and suspected set
   - `migrationLock` — guards migration queue and active migrations
   - Heartbeat reads (checking failure detector) should be lock-free
4. Each `async` method in `Invocation`, `InvocationRegistry`, and `OperationServiceImpl` that touches shared maps MUST be audited against these rules before implementation.

Add test: "Heartbeat fires within 200ms during a 5-second migration transfer"
Add test: "Lock holder does not perform TCP send while holding clusterServiceLock"

**Scope:** This is a **fundamental constraint** that applies to all phases. It is documented here
because Phase C is the first phase with heavy async interaction between partition routing,
invocation lifecycle, and TCP send/receive. Every `async` method in `Invocation`,
`InvocationRegistry`, and `OperationServiceImpl` that touches shared maps or counters must be
audited against this rule before implementation.

---

### Block C.1 — InvocationRegistry

**Ref:** `InvocationRegistry.java`

**New file:** `src/spi/impl/operationservice/InvocationRegistry.ts`

**Core structure:**
```typescript
invocations: Map<bigint, Invocation>  // callId → Invocation
callIdSequence: bigint                // monotonic counter
maxConcurrentInvocations: number      // backpressure limit
alive: boolean
```

**Key methods:**
- `register(invocation)` — assigns callId, stores in map, enforces backpressure limit
- `deregister(invocation)` — removes from map, releases permit
- `get(callId)` — lookup for response correlation
- `reset(cause)` — notifies all invocations with `MemberLeftException` (on shutdown or member departure)

### Block C.2 — Invocation + PartitionInvocation

**Ref:** `Invocation.java` (919 lines), `PartitionInvocation.java`

**New files:**
- `src/spi/impl/operationservice/Invocation.ts`
- `src/spi/impl/operationservice/PartitionInvocation.ts`
- `src/spi/impl/operationservice/TargetInvocation.ts`

**Invocation fields:**
```
op: Operation, future: InvocationFuture, invokeCount: number,
tryCount: number (from INVOCATION_MAX_RETRY_COUNT, default 250),
tryPauseMillis: number (from INVOCATION_RETRY_PAUSE, default 500),
callTimeoutMillis: number, targetAddress: Address, targetMember: Member,
backupsAcksReceived: number, backupsAcksExpected: number, pendingResponse: unknown
```

**Key methods:**

- `invoke()` → `doInvoke()`:
  1. Increment `invokeCount`
  2. `initInvocationTarget()` — for PartitionInvocation: re-reads partition table each retry
  3. Register with `InvocationRegistry`
  4. If local: execute on operation executor; if remote: serialize and send via TCP

- `notifyNormalResponse(value, backupAcks)`:
  - If `backupAcks > 0`: store as `pendingResponse`, wait for backup acks
  - If `backupAcks == 0`: complete future immediately

- `notifyBackupComplete()`:
  - Increment `backupsAcksReceived`
  - If all acks received: complete future with `pendingResponse`

- `notifyError(cause)`:
  - If `RetryableException` and `invokeCount < tryCount`: retry with backoff
  - Otherwise: complete future exceptionally

- `handleRetry()`:
  - First 5 retries (`MAX_FAST_INVOCATION_COUNT`): immediate
  - Later: exponential backoff `min(2^(invokeCount-5), tryPauseMillis)` via `setTimeout`

**Critical safety: `resetAndReInvoke()`** (from `Invocation.shouldCompleteWithoutBackups()`):
- When waiting for backup acks and the primary target dies
- Re-invokes the entire operation from scratch (prevents data loss from unbacked-up primary responses)

#### ⚠ Finding H-2 — InvocationFuture Missing Backup Ack Support

**Ref:** `src/spi/impl/operationservice/InvocationFuture.ts:37-149`

The existing `InvocationFuture` exposes: `complete()`, `completeExceptionally()`, `cancel()`,
`get()`, `join()`, `whenComplete()`, `thenApply()`. It has **no concept of backup ack waiting,
pending responses, or backup timeout**. The methods `notifyNormalResponse(value, backupAcks)` and
`notifyBackupComplete()` required by this plan do not exist on it.

**Decision:** Add backup ack tracking fields directly to the `Invocation` class rather than
modifying `InvocationFuture`. This keeps the future interface clean and generic while
centralising all backup coordination logic where it belongs.

**New fields on `Invocation`:**
```
backupsAcksExpected: number       // set from NormalResponse.backupAcks
backupsAcksReceived: number       // incremented by each BackupAck received
pendingResponse: unknown          // stored when backupsAcksExpected > 0
backupAckTimeoutMillis: number    // from OPERATION_BACKUP_TIMEOUT_MILLIS (default 5000)
```

**Interface contract:**
- `notifyNormalResponse(value, backupAcks)`: if `backupAcks > 0`, stores value as
  `pendingResponse` and arms the backup-ack timeout timer; otherwise resolves the future
  immediately.
- `notifyBackupComplete()`: increments `backupsAcksReceived`; when equal to
  `backupsAcksExpected`, resolves the future with `pendingResponse`.
- The backup-ack timeout fires `resetAndReInvoke()` if the primary target is gone, or resolves
  immediately if the primary is still alive (matching Hazelcast's
  `Invocation.shouldCompleteWithoutBackups()` logic).

**Impact on tests:** All existing tests that mock or stub `InvocationFuture` do **not** need to
change — the future interface is unchanged. Tests that exercise the full invocation lifecycle
(backup ack path) must interact with the `Invocation` instance directly.

**Additional tests (~4):**
- Backup ack tracking: `backupsAcksReceived` increments correctly on each `notifyBackupComplete()`
- Future resolves only after all expected backup acks arrive
- Backup ack timeout fires `resetAndReInvoke()` when primary has left
- Backup ack timeout resolves immediately when primary is still alive

**Remediation — Finding 15 (HIGH): Backup Ack Timeout Performance**
1. Specify the timeout detection mechanism: an **invocation monitor** running as a periodic `setInterval` (every 1000ms, matching Java's `InvocationMonitor.run()`)
2. Document the 5-second latency spike as known behavior when a backup ack is lost and primary is alive
3. Consider a shorter default timeout (2000ms) for Bun since re-invocation is cheaper in single-threaded model
4. The invocation monitor iterates all pending invocations and fires `resetAndReInvoke()` or resolves immediately based on primary liveness

Add test: "Invocation monitor detects and resolves backup ack timeout within configured window"

### Block C.3 — OperationServiceImpl Upgrade

**Ref:** `OperationServiceImpl.java`

**Modify:** `src/spi/impl/operationservice/impl/OperationServiceImpl.ts`

Upgrade from local-only to routing-aware:

**New fields:**
```
invocationRegistry: InvocationRegistry
backupHandler: OperationBackupHandler (Phase D)
outboundHandler: OutboundOperationHandler (serializes + sends via TCP)
```

**Enhanced methods:**

- `invokeOnPartition(serviceName, op, partitionId)` — creates `PartitionInvocation`, calls `invoke()`

- `invokeOnTarget(serviceName, op, target)` — creates `TargetInvocation` with explicit address

- `run(op)` / `execute(op)` — enhanced with migration guards (matching `OperationRunnerImpl.ensureNoPartitionProblems()`):
  1. If `partitionId >= 0`: check `partition.isMigrating()` → `PartitionMigratingException`
  2. Check owner matches local node → `WrongTargetException` if not
  3. Execute operation
  4. If `BackupAwareOperation` and `shouldBackup()`: send backups via `backupHandler`
  5. Send response (embed backup ack count in `NormalResponse`)

**RetryableException types:**
- `WrongTargetException` — this node doesn't own the partition
- `PartitionMigratingException` — partition is actively migrating
- `TargetNotMemberException` — target address is not a cluster member
- `MemberLeftException` — target member left cluster

**Test plan (~26 tests):**
- Partition routing: operation reaches partition owner
- Remote invocation: operation sent to correct node, response received
- Retry on migration: operation retried after PartitionMigratingException
- Retry on wrong target: operation retried after WrongTargetException
- Invocation registry: callId correlation, backpressure enforcement
- Timeout: invocation times out after callTimeout
- *(H-2)* Backup ack tracking: `backupsAcksReceived` increments on each `notifyBackupComplete()`
- *(H-2)* Future resolves only after all expected backup acks arrive
- *(H-2)* Backup ack timeout fires `resetAndReInvoke()` when primary has left
- *(H-2)* Backup ack timeout resolves immediately when primary is still alive
- *(Finding 15)* Invocation monitor detects and resolves backup ack timeout within configured window

**Remediation — Finding 18 (HIGH): Backward Compatibility for Existing Tests**
~2,500+ existing tests assume single-node `OperationServiceImpl` (target ignored, all operations local). After Phase C upgrades to routing-aware:

**Option chosen: `localMode` flag**
Add a `localMode: boolean` constructor parameter to `OperationServiceImpl`:
- `localMode = true` (default in tests): skip routing, migration guards, ownership checks. Matches current behavior.
- `localMode = false` (production): full routing, migration guards, remote dispatch.

`TestPartitionService` must be upgraded to support owner lookups for multi-node tests (return real owner from partition table, not always `true`).

This ensures zero regressions in existing tests while enabling full multi-node behavior in production.

### Block C.4 — MapProxy Migration to OperationService (Finding 4 Remediation)

**Severity: CRITICAL** — Without this block, Phases C–F are non-functional for the primary data structure.

**Problem:** `MapProxy` (488 lines) calls `RecordStore` directly — it never goes through `OperationService`. All map operations bypass partition routing, migration guards, backup sending, and retry logic.

**Evidence:** `MapProxy.ts:107-122` — `put()` calls `this._store.put(kd, vd, -1, -1)` directly. No `invokeOnPartition` anywhere.

**Required changes:**
1. Rewrite `MapProxy.put/get/remove/containsKey/etc.` to call `OperationService.invokeOnPartition(serviceName, op, partitionId)` instead of calling RecordStore directly
2. Each map operation becomes an `Operation` subclass (PutOperation, GetOperation, etc.) executed through OperationService
3. `NetworkedMapProxy` must be either retired or refactored to use OperationService — the old TCP broadcast path is obsolete

**Test plan (~10 tests):**
- MapProxy.put routes through OperationService
- MapProxy.get routes through OperationService
- Operation rejected when partition is migrating (PartitionMigratingException)
- Operation retried after WrongTargetException
- Multi-node: put on node A, readable on node B via partition routing

---

### ⚠ Critical Transition: Broadcast → Operation Routing (Finding 5)

**Severity: CRITICAL** — Dual write paths cause double-application of every mutation.

The existing `TcpClusterTransport` broadcasts `MAP_PUT`, `MAP_REMOVE`, `MAP_CLEAR` messages to all peers. The new partition-based operation routing sends operations to the partition owner, which then sends backups. If both paths coexist, every write is applied twice.

**Transition plan (mandatory, enforced in Block C.4):**
1. After Block C.4 completes, `MapProxy` MUST stop using the broadcast path
2. The old `MAP_PUT`/`MAP_REMOVE`/`MAP_CLEAR` message types in `ClusterMessage.ts` are deprecated
3. `NetworkedMapProxy` is either retired or refactored to use OperationService exclusively
4. Remove broadcast message handlers from `TcpClusterTransport` message processing

**Without this transition, the system produces data corruption from double-application.**

Add test: "After C.4, map writes do NOT trigger broadcast messages"
Add test: "Old broadcast message types are not processed after transition"

---

## Phase D — Backup Replication

### Goal

Implement backup operations so that writes are replicated to backup nodes after the primary
executes. This is the core durability mechanism.

### Hazelcast Architecture (proven semantics to follow)

**Backup flow** (from `OperationBackupHandler.sendBackups()` + `Backup.java`):

1. Primary executes `BackupAwareOperation`
2. If `shouldBackup()`: increment replica versions, get backup operation via `getBackupOperation()`
3. Create `Backup` wrapper with: backup op, original caller, replica versions, sync flag
4. Send to each replica[1..totalBackups]
5. Sync backups: ack sent back to caller; caller waits for all acks before completing future
6. Async backups: no ack; future completes immediately

**Backup execution on backup node** (from `Backup.run()`):
1. Validate this node is the correct replica (ownership check)
2. Check version staleness (reject if backup versions are older than local)
3. Execute backup operation
4. Update replica versions
5. If sync: send `BackupAck` to original caller

**Version tracking** (from `PartitionReplicaManager`):
- Primary increments versions on each backup-sending write
- Backup updates versions on each successful backup application
- Version mismatch → triggers anti-entropy sync (Phase E)

### Block D.1 — BackupAwareOperation Interface

**Ref:** `BackupAwareOperation.java`

**New file:** `src/spi/impl/operationservice/BackupAwareOperation.ts`

```typescript
export interface BackupAwareOperation {
  shouldBackup(): boolean;
  getSyncBackupCount(): number;    // 0-6
  getAsyncBackupCount(): number;   // 0-6
  getBackupOperation(): Operation;
}
```

Total sync + async must be ≤ `MAX_BACKUP_COUNT` (6) — matches `IPartition.MAX_BACKUP_COUNT`.

### Block D.2 — OperationBackupHandler

**Ref:** `OperationBackupHandler.java` (363 lines)

**New file:** `src/spi/impl/operationservice/OperationBackupHandler.ts`

**Key method — `sendBackups(op: Operation)`:**
1. Check `BackupAwareOperation` and `shouldBackup()`
2. Get requested sync/async counts
3. Increment replica versions: `replicaManager.incrementPartitionReplicaVersions(partitionId, totalBackups)` → returns `bigint[]` version array
4. Cap actual counts by cluster size - 1
5. Get backup operation via `op.getBackupOperation()`
6. For each `replicaIndex` from 1 to totalBackups:
   - `target = partition.getReplica(replicaIndex)`
   - Skip if target null or not a valid member
   - `isSyncBackup = replicaIndex <= syncBackups`
   - Create `Backup` wrapper, send via TCP to target
7. Return sync backup count (embedded in `NormalResponse` for caller)

**Single backup optimization** (matching Java line 200): if totalBackups==1, don't serialize backup op to Data; send Operation object directly.

### Block D.3 — Backup Execution

**Ref:** `Backup.java` (378 lines)

**New file:** `src/spi/impl/operationservice/operations/Backup.ts`

**Fields:**
```
originalCaller: Address, replicaVersions: bigint[], sync: boolean,
backupOp: Operation, partitionId: number, replicaIndex: number
```

**Execution flow:**

- `beforeRun()`:
  1. Validate this node is the correct replica: `partition.getReplica(replicaIndex).isIdentical(localMember)`
  2. Version staleness check: `replicaManager.isPartitionReplicaVersionStale(partitionId, replicaVersions, replicaIndex)` — if stale, skip execution

- `run()`:
  1. If validation failed → skip
  2. Execute backup operation via `OperationRunner.runDirect(backupOp)`
  3. Update replica versions: `replicaManager.updatePartitionReplicaVersions(partitionId, replicaVersions, replicaIndex)`

- `afterRun()`:
  1. If sync: send `BackupAck` to `originalCaller` with `callId`
  2. If local (originalCaller is this node): directly call `invocation.notifyBackupComplete()`
  3. If remote: send `BackupAckMsg` over TCP

**Critical:** `Backup.returnsResponse()` returns `false` — backups never send regular responses. Acks go through a separate channel.

#### ⚠ Finding H-11 — Old Backup Replica `migrating` Flag Edge Case

**Ref:** `FinalizeMigrationOperation.java:80-88`

During partition migration the `migrating` flag is set on:
- The **primary** (source) node
- The **destination** node

It is **NOT set** on old backup replicas. This creates an edge case: while a migration is in
progress, the primary may still dispatch `Backup` operations to old backup replicas (replica
indices that will be discarded once the migration completes). Those old replicas will accept and
execute the backup operation normally — they are unaware the migration is happening.

**Divergence from primary/destination handling:**
- Primary and destination both check `isMigrating()` in `ensureNoPartitionProblems()` and throw
  `PartitionMigratingException` for primary-targeted operations.
- `FinalizeMigrationOperation` clears the flag on both primary and destination and removes the
  old replica from the partition table.
- Old backup replicas receive `FinalizeMigrationOperation` as well but follow a different code
  path (lines 80-88) that only removes their local replica version state — they do not need to
  clear a `migrating` flag they never held.

**Implementation note for `Backup.beforeRun()`:** The replica ownership check
(`partition.getReplica(replicaIndex).isIdentical(localMember)`) is still the correct guard. If
`FinalizeMigrationOperation` has already removed the old replica from the table by the time a
late backup arrives, the ownership check fails and the backup is silently discarded — matching
Hazelcast's behaviour. No additional `migrating` flag check is needed on the backup path.

**Additional tests (~3):**
- Operation backup sent to old backup replica during migration executes successfully
- Late backup arrives after `FinalizeMigrationOperation` removes old replica → silently discarded
- `migrating` flag is NOT set on old backup replica at any point during migration lifecycle

### Block D.4 — Map Operations as BackupAwareOperations

Upgrade existing map operations to implement `BackupAwareOperation`:

- `PutOperation` → `shouldBackup() = true`, `getBackupOperation()` returns `PutBackupOperation`
- `RemoveOperation` → `shouldBackup() = true`, `getBackupOperation()` returns `RemoveBackupOperation`
- `SetOperation`, `DeleteOperation`, `PutIfAbsentOperation`, `ReplaceOperation` — same pattern

Each backup operation simply applies the mutation to the backup's `RecordStore`.

**Test plan (~23 tests):**
- Backup sending: primary sends backup after write
- Sync backup: caller waits for ack before future completes
- Async backup: caller completes immediately
- Backup validation: rejected if wrong replica or stale version
- Map put: backup applied on backup node, data readable
- Map remove: backup removes entry on backup node
- Backup failure: silent (no error to caller), anti-entropy fixes later
- *(H-11)* Backup sent to old backup replica during migration executes successfully
- *(H-11)* Late backup after `FinalizeMigrationOperation` removes old replica → silently discarded
- *(H-11)* `migrating` flag is never set on old backup replicas during migration lifecycle

---

## Phase E — Anti-Entropy

### Goal

Background process that detects and repairs stale replicas. This is the safety net —
even if a backup operation is lost, anti-entropy will eventually synchronize the replica.

### Hazelcast Architecture (proven semantics to follow)

**PartitionReplicaManager** (666 lines) tracks per-partition per-namespace versions:
- `incrementPartitionReplicaVersions()` — called on primary after write
- `updatePartitionReplicaVersions()` — called on backup after backup execution
- `isPartitionReplicaVersionStale()` — called during backup validation
- `triggerPartitionReplicaSync()` — initiates full state transfer when version mismatch detected

**AntiEntropyTask** (periodic, on primary):
- Scheduled at `PARTITION_BACKUP_SYNC_INTERVAL` seconds
- For each local (primary) partition: send `PartitionBackupReplicaAntiEntropyOp` to each backup
- The op carries the primary's version vector per namespace

**PartitionBackupReplicaAntiEntropyOperation** (on backup):
- Compares primary versions to local versions
- If mismatch: `triggerPartitionReplicaSync()` → sends `PartitionReplicaSyncRequest` to primary
- Primary responds with `PartitionReplicaSyncResponse` containing full state

**Bounded parallelism:** `replicaSyncSemaphore` limits concurrent sync operations (from `PARTITION_MAX_PARALLEL_REPLICATIONS`).

### Block E.1 — PartitionReplicaManager

**Ref:** `PartitionReplicaManager.java` (666 lines)

**New file:** `src/internal/partition/impl/PartitionReplicaManager.ts`

**Constants:**
```
REQUIRES_SYNC = -1n  // sentinel version meaning "needs full sync"
```

**Core data structure:**
```
replicaVersions: Map<number, bigint[]>  // partitionId → version array per replica index
replicaSyncRequests: Set<string>         // in-flight sync request IDs (dedup)
maxParallelReplications: number          // from PARTITION_MAX_PARALLEL_REPLICATIONS
activeSyncs: number                      // bounded parallelism counter
```

**Key methods:**
- `incrementPartitionReplicaVersions(partitionId, backupCount)` — increments and returns version array
- `updatePartitionReplicaVersions(partitionId, versions, replicaIndex)` — called by Backup; if update fails (dirty/behind) → triggers sync
- `isPartitionReplicaVersionStale(partitionId, versions, replicaIndex)` — returns true if incoming is older
- `triggerPartitionReplicaSync(partitionId, replicaIndex)` — sends `PartitionReplicaSyncRequest` to primary (bounded by `maxParallelReplications`)
- `finalizeReplicaSync(partitionId, replicaIndex, versions)` — clears and sets versions after successful sync

**Remediation — Finding 21 (MEDIUM): Per-Namespace Version Tracking**
Helios v1 only has MapService. Simplify to partition-level versions (not per-namespace).
**Document the limitation:** "Version tracking is per-partition, not per-namespace. When a second service (e.g., CacheService) adds replication support, version tracking must be retrofitted to per-namespace. This is a known v1 limitation."

### Block E.2 — Anti-Entropy Task

**Ref:** `PartitionReplicaManager.AntiEntropyTask`, `PartitionPrimaryReplicaAntiEntropyTask.java`, `PartitionBackupReplicaAntiEntropyOperation.java`

**New files:**
- `src/internal/partition/impl/AntiEntropyTask.ts`
- `src/internal/partition/operation/PartitionBackupReplicaAntiEntropyOp.ts`

**AntiEntropyTask** — scheduled periodically on primary:
1. Iterate all locally-owned partitions
2. For each partition, for each replica index 1..backupCount:
   - Send `PartitionBackupReplicaAntiEntropyOp` carrying the primary's version vector

**PartitionBackupReplicaAntiEntropyOp** — executes on backup:
1. Compare primary versions to local versions
2. If match: all good, no action
3. If mismatch: `replicaManager.triggerPartitionReplicaSync()`

### Block E.3 — Replica Sync (Full State Transfer)

**Ref:** `PartitionReplicaSyncRequest.java`, `PartitionReplicaSyncResponse.java`

**New files:**
- `src/internal/partition/operation/PartitionReplicaSyncRequest.ts`
- `src/internal/partition/operation/PartitionReplicaSyncResponse.ts`

**PartitionReplicaSyncRequest** (sent from backup to primary):
1. Primary collects replication operations (via `MapReplicationOperation` — Phase F)
2. Primary sends `PartitionReplicaSyncResponse` back to backup

**PartitionReplicaSyncResponse** (sent from primary to backup):
1. Execute each contained replication operation (applies full state)
2. Finalize versions: `replicaManager.finalizeReplicaSync()`

#### ⚠ Memory Safety — H-9 · OOM Risk During Full-State Anti-Entropy Sync

Full state transfer as a single message risks OOM for large partitions.

**Problem:** For a large partition (100K entries × 100 bytes avg = 10MB), the entire state is
serialized into one `PartitionReplicaSyncResponse`. Under memory pressure, this causes OOM.

**Reference:** Plan line 1019 defers chunked migration. Hazelcast addresses this via
`chunkedMigrationEnabled` and `maxTotalChunkedDataInBytes` in `MigrationRequestOperation.java`.

**Remediation — Finding 16 (HIGH): Anti-Entropy Chunking Protocol**
The plan says "queue the sync and process in chunks" without defining the protocol. Define a minimal chunking protocol:

**Per-namespace chunking (practical middle ground):**
1. Instead of sending all namespaces in one response, process one `RecordStore` (namespace) at a time
2. Each `PartitionReplicaSyncResponse` carries state for exactly ONE namespace
3. Backup processes responses sequentially, applying each namespace independently
4. If a single namespace exceeds `maxSingleSyncSizeBytes` (50MB), log a warning and proceed (the alternative is OOM, which is worse)
5. This provides natural chunks without a complex multi-message reassembly protocol

**Contradiction resolution:** The plan defers chunked migration to "Scope Exclusions" while requiring chunked anti-entropy. These are now decoupled: anti-entropy uses per-namespace chunking (simpler), migration remains full-state (deferred).

**Configuration:** Add `maxSingleSyncSizeBytes` (default 50MB).

**Test plan (~18 tests = 15 core + 3 OOM prevention):**
- Version tracking: increments on write, updates on backup
- Staleness detection: older version rejected
- Anti-entropy: detects version mismatch, triggers sync
- Full state transfer: backup receives complete partition state
- Bounded parallelism: sync requests capped at `maxParallelReplications`
- Large partition sync: verify size check triggers chunked fallback before OOM
- Chunked fallback: state applied correctly across multiple chunks
- Threshold configuration: `maxSingleSyncSizeBytes` respected at runtime
- *(Finding 16)* Per-namespace chunking: each PartitionReplicaSyncResponse carries one namespace
- *(Finding 16)* Namespace exceeds maxSingleSyncSizeBytes: warning logged, sync proceeds

---

## Phase F — Map Replication (Including Write-Behind State)

### Goal

Implement the composition of state holders that transfer complete IMap state — including
write-behind queue entries — during partition replication.

### Hazelcast Architecture (proven semantics to follow)

**MapReplicationOperation** composes three state holders:
1. `MapReplicationStateHolder` — record store data + indexes
2. `WriteBehindStateHolder` — write-behind queue + flush sequences + txn reservations
3. `MapNearCacheStateHolder` — near cache metadata (primary only)

**WriteBehindStateHolder.prepare()** (from `WriteBehindStateHolder.java` line 77):
- For each map namespace in the partition:
  1. Checks `backupCount >= replicaIndex` (only replicate if this replica should have backups)
  2. Captures `writeBehindQueue.asList()` → all queued delayed entries
  3. Captures `mapDataStore.getFlushSequences()` → per-map flush sequence tracking
  4. Captures `txnReservedCapacityCounter.getReservedCapacityCountPerTxnId()` → transaction reservations

**WriteBehindStateHolder.applyState()** (from `WriteBehindStateHolder.java` line 100):
1. For each map: puts all `(txnId → count)` into destination's capacity counter
2. For each map: resets `WriteBehindStore`, sets flush sequences, forcibly adds each delayed entry via `addForcibly()` (bypasses capacity checks — matches existing Helios `BoundedWriteBehindQueue.addForcibly()`)
3. Updates sequence counter to max of replicated entries

### Block F.1 — MapReplicationStateHolder

**Ref:** `MapReplicationStateHolder.java` (480 lines)

**New file:** `src/map/impl/operation/MapReplicationStateHolder.ts`

**`prepare(container, partitionId, replicaIndex)`:**
1. For each map's `RecordStore` in the partition:
   - Capture all `(key: Data, record: Record)` pairs
   - Capture `loaded` status
   - Capture index configurations

**`applyState(nodeEngine)`:**
1. Create indexes on destination
2. For each map's data:
   - Reset record store (unless incremental)
   - Apply records via `recordStore.putOrUpdateReplicatedRecord()`
3. Apply record store stats

> **Note — L-1 · putOrUpdateReplicatedRecord Does Not Interact With WriteBehindStore:**
> `DefaultRecordStore.putOrUpdateReplicatedRecord()` only updates the record store — it does NOT
> trigger write-behind. This is correct behavior: write-behind state is restored separately via
> `WriteBehindStateHolder.applyState()`. This separation is intentional; do not modify
> `putOrUpdateReplicatedRecord()` to also enqueue write-behind entries.

### Block F.2 — WriteBehindStateHolder

**Ref:** `WriteBehindStateHolder.java` (254 lines)

**New file:** `src/map/impl/operation/WriteBehindStateHolder.ts`

**Fields:**
```
delayedEntries: Map<string, DelayedEntry<unknown, unknown>[]>  // per-map
flushSequences: Map<string, { sequence: number; isFullFlush: boolean }[]>  // per-map
```

**`prepare(container, partitionId, replicaIndex)`:**
1. For each map with write-behind enabled:
   - Check `backupCount >= replicaIndex`
   - `writeBehindQueue.asList()` → capture all queued entries (uses existing Helios queue methods)
   - Capture flush sequences from `WriteBehindStore`

#### ⚠ Data Loss Window — H-4 · asList() Race Condition During Migration

During migration, the primary's write-behind queue is captured via `asList()`. In Hazelcast,
this is called under a `synchronized` lock on `SynchronizedWriteBehindQueue`.

**The window:** Entries added AFTER `asList()` captures the snapshot but BEFORE the migration
commits are lost — they exist on the old primary but are not in the migrated state.

**Reference:** `CyclicWriteBehindQueue.java:153-155` — `asList()` returns `List.copyOf(deque)`
(snapshot). New writes go to the same deque after the snapshot is taken.

**Bun single-threaded note:** In Bun's single-threaded model, `asList()` itself will not have
concurrent modifications during the call. However, writes arriving between `asList()` and the
migration commit are still lost if an `await` yields between them.

**Decision:** This is accepted behavior — it matches Hazelcast's semantics. The data loss window
is bounded by the migration duration. An alternative mitigation is a migration lock on the
write-behind queue that buffers writes during the migration window and replays them after commit;
this is deferred.

**At minimum:** The data loss window is by design. Future maintainers must not "fix" this without
understanding the tradeoff.

**Test plan (~2 additional tests):**
- Verify entries written after `asList()` snapshot but before commit are not present on the
  migration destination (documents the accepted behavior)
- Verify entries written before `asList()` snapshot ARE present on the destination

**`applyState(nodeEngine)`:**
1. For each map:
   - Reset `WriteBehindStore` (stop worker, clear queue)
   - Set flush sequences
   - For each delayed entry: `writeBehindQueue.addForcibly(entry)` — bypasses capacity checks (existing method on `BoundedWriteBehindQueue`)
   - Update sequence counter
   - Restart worker

**Remediation — Finding 8 (HIGH): StoreWorker Auto-Start After applyState()**
`applyState()` MUST explicitly call `worker.start()` after the `addForcibly()` loop. The existing `StoreWorker` has `start()` (creates setInterval) and `stop()` (clears interval) but no `restart()`. After `reset()` stops the worker, `start()` must be called.
Additionally, entries with `storeTime <= now` (overdue on the old primary) must be flushed on the first tick — the worker's `drainTo(now)` handles this if entries retain their original `storeTime`.
Add test: "applyState: worker starts after addForcibly loop; overdue entries flush on first tick"

**Remediation — Finding 9 (HIGH): Missing Method Signatures**
Block F.4 must specify explicit method signatures before implementation:

```typescript
// WriteBehindQueue additions:
asList(): DelayedEntry<K, V>[]    // Returns a SNAPSHOT copy (not live reference)

// WriteBehindStore additions:
reset(): void                       // Stops worker, clears queue AND staging area
getFlushSequences(): Map<string, number>   // keyed by map name
setFlushSequences(sequences: Map<string, number>): void
```

Add these to the `WriteBehindQueue` interface definition in the plan.

**Remediation — Finding 10 (HIGH): Staging Area Data Loss**
`asList()` MUST capture queue + staging area entries (not queue alone). During a flush cycle, entries are moved from queue to staging area. If the node crashes mid-flush, those entries exist only in the staging area — `asList()` reading only the queue would lose them.

**Implementation:** `asList()` returns `[...this._stagingArea.values(), ...this._queue]`

This is the simplest fix matching the intent. Alternative: replicate staging area separately (more complex, deferred).
Add test: "asList: includes entries currently in staging area during flush"

#### ⚠ Staging Area Semantics — M-3 · Staging Area Replication Semantics

The staging area is NOT directly replicated.

**How `applyState()` handles it:** `reset()` clears the staging area, then `addForcibly()`
repopulates the queue from the replicated entries. The original staging area state on the old
primary is lost.

**After failover:** Entries that were in the staging area on the old primary are reconstructed
from the replicated queue entries. Any partially-flushed state that existed only in the staging
area is not recoverable.

**Read-your-write caveat:** After failover, a read-your-write guarantee may fail if an entry was
evicted from the record store (e.g., due to eviction policy) but was still present only in the
staging area on the old primary. The new primary's record store will not have it.

**Reference:** `WriteBehindStore.java:99-123, 234`

**Decision:** This is accepted behavior — it matches Hazelcast's semantics.

### Block F.3 — MapReplicationOperation

**Ref:** `MapReplicationOperation.java` (167 lines)

**New file:** `src/map/impl/operation/MapReplicationOperation.ts`

**Composes:**
```
mapReplicationStateHolder: MapReplicationStateHolder
writeBehindStateHolder: WriteBehindStateHolder
mapNearCacheStateHolder: MapNearCacheStateHolder (reuse existing from Block 4.4)
```

**Constructor:** `MapReplicationOperation(partitionId, replicaIndex)` — calls `prepare()` on each state holder

**`run()`:**
1. `mapReplicationStateHolder.applyState()` — applies records + indexes
2. `writeBehindStateHolder.applyState()` — applies write-behind queues
3. `mapNearCacheStateHolder.applyState()` — only if `replicaIndex == 0` (primary)

### Block F.4 — Write-Behind Queue Serialization Support

Add methods to the existing write-behind classes to support state capture:

**Modify `WriteBehindQueue.ts`:**
- Add `asList(): DelayedEntry<K, V>[]` — returns snapshot of all entries (used by `WriteBehindStateHolder.prepare()`)

**Modify `WriteBehindStore.ts`:**
- Add `getFlushSequences()` — returns current flush sequences
- Add `setFlushSequences(sequences)` — sets flush sequences during replication apply
- Add `reset()` — stops worker, clears queue (called during replication before re-populating)

**Test plan (~25 tests = 20 core + 2 data loss window + 3 remediation):**
- MapReplicationStateHolder: capture and apply records correctly
- WriteBehindStateHolder: captures all queued entries, applies via `addForcibly()`
- WriteBehindStateHolder: flush sequences captured and restored
- MapReplicationOperation: composes all three holders, `run()` applies in order
- End-to-end: write-behind entries survive node failure via backup replication
  - Node A (primary) has pending write-behind entries
  - Entries replicated to Node B (backup) via MapReplicationOperation
  - Node A crashes
  - Node B promotes to primary
  - Write-behind entries are present in Node B's queue and eventually flushed to MapStore
- Data loss window (H-4): entries written after `asList()` snapshot are absent on destination
- Data loss window (H-4): entries written before `asList()` snapshot are present on destination
- *(Finding 8)* applyState: worker starts after addForcibly loop; overdue entries flush on first tick
- *(Finding 9)* WriteBehindQueue.asList returns snapshot copy (not live reference)
- *(Finding 9)* WriteBehindStore.reset clears queue AND staging area
- *(Finding 9)* WriteBehindStore getFlushSequences/setFlushSequences round-trip correctly
- *(Finding 10)* asList: includes entries currently in staging area during flush

---

## Integration Test Plan

**Remediation — Finding 24 (MEDIUM): Test Count Target**
~130 tests across 6 phases is dangerously low for a distributed systems layer. Target:
- **Minimum: 300 tests** across all multi-node resilience phases
- Add ~50 failure-scenario tests: node crash during each migration phase, concurrent joins during migration, heartbeat timeout during state transfer, operations during cluster state transitions
- Add a chaos test harness (`test-support/ChaosRunner.ts`) that randomly kills/isolates nodes during a continuous workload
- 3 integration tests → expand to 10+ covering: 2-node, 3-node, 5-node, rolling restart, split-brain detection

### Multi-node write-behind resilience test

This is the ultimate validation that the entire stack works:

1. Start 3-node cluster (A, B, C) with `backupCount = 1`
2. Configure map with write-behind (delay = 5s), backed by a mock `MapStore`
3. Put 100 entries on Node A's map
4. Verify entries queued in write-behind (not yet flushed to store)
5. Verify write-behind state replicated to backup node
6. Kill Node A
7. Verify partition ownership transfers to backup
8. Wait for write-behind flush
9. Verify all 100 entries flushed to mock `MapStore` by the new primary
10. Verify no data loss

### Multi-node basic replication test

1. Start 2-node cluster with `backupCount = 1`
2. Put entries on Node A
3. Verify entries readable on Node B (after backup)
4. Kill Node A
5. Verify entries still readable on Node B (promoted to primary)

### Anti-entropy test

1. Start 2-node cluster
2. Put entries on primary
3. Artificially corrupt backup versions (set to older)
4. Wait for anti-entropy cycle
5. Verify backup re-synchronized to correct state

---

## Configuration

New configuration properties (matching Hazelcast equivalents):

| Property | Default | Java Equivalent |
|----------|---------|-----------------|
| `heartbeatIntervalSeconds` | 5 | `HEARTBEAT_INTERVAL_SECONDS` |
| `maxNoHeartbeatSeconds` | 60 | `MAX_NO_HEARTBEAT_SECONDS` |
| `partitionCount` | 271 | `PARTITION_COUNT` |
| `maxParallelMigrations` | 10 | `PARTITION_MAX_PARALLEL_MIGRATIONS` |
| `maxParallelReplications` | 5 | `PARTITION_MAX_PARALLEL_REPLICATIONS` |
| `partitionTableSendIntervalSeconds` | 15 | `PARTITION_TABLE_SEND_INTERVAL` |
| `backupSyncIntervalSeconds` | 30 | `PARTITION_BACKUP_SYNC_INTERVAL` |
| `invocationMaxRetryCount` | 250 | `INVOCATION_MAX_RETRY_COUNT` |
| `invocationRetryPauseMillis` | 500 | `INVOCATION_RETRY_PAUSE` |
| `mastershipClaimTimeoutSeconds` | 60 | `MASTERSHIP_CLAIM_TIMEOUT_SECONDS` |
| `backupAckTimeoutMillis` | 5000 | `OPERATION_BACKUP_TIMEOUT_MILLIS` |
| `shutdownCheckIntervalSeconds` | 5 | ProcessShutdownRequestsTask interval |

---

## Scope Exclusions (Deferred)

| Feature | Why Deferred |
|---------|--------------|
| Phi-Accrual failure detector | Start with Deadline (simple, proven); Phi-Accrual is a v2 enhancement |
| ICMP ping backup | TCP heartbeat is sufficient for v1 |
| Partial disconnection detection | Complex, requires master aggregation; defer to v2 |
| Split-brain **merge** (only) | Requires sophisticated merge policies; defer to v2. Split-brain **detection** (quorum check → read-only mode) is NOT deferred — see Block A.3.1 |
| Chunked migration | Start with full-state migration; chunked is a performance optimization |
| Merkle-tree differential sync | Start with full state transfer; differential is a performance optimization |
| Backpressure regulator (async→sync promotion) | Start without; add when observed under load. **Known limitation (Finding 25):** Under high write throughput with `asyncBackupCount > 0`, data durability may be lower than configured backup count due to silently dropped async backups. |
| WaitSet invalidation for parked operations | Helios v1 has no blocking operations (e.g., queue poll with timeout in distributed mode). If added later, `WaitSet.invalidateAll(partitionId)` must be called during migration finalization to wake parked operations with `PartitionMigratingException`. **(Finding 26)** |
| WAN replication | Explicitly dropped (see TYPESCRIPT_PORT_PLAN.md) |
| CP subsystem (Raft) | Explicitly deferred to v2 |

---

## Success Criteria

1. **No data loss on single node failure** — with `backupCount >= 1`, all data survives one node crash
2. **Write-behind entries survive node failure** — pending write-behind entries are replicated to backups and flushed after promotion
3. **Automatic rebalancing** — partition ownership redistributes on member join/leave
4. **Retry on migration** — operations retry transparently when partitions are migrating
5. **Anti-entropy convergence** — stale replicas are detected and repaired within one sync interval
6. **All existing tests pass** — zero regressions from multi-node additions
7. **Pre-join state applied** — joining nodes have partition state before participating (Finding 1)
8. **Split-brain detection** — minority partition enters read-only mode (Block A.3.1)
9. **Migration commit reliability** — infinite retry with version safety (Finding 2, 3)
10. **No dual write paths** — broadcast path fully retired after Phase C (Finding 5)
