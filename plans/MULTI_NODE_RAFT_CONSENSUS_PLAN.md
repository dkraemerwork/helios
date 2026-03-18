# Multi-Node Raft Consensus Implementation Plan

**Project**: Helios CP Subsystem — Full Multi-Node Raft  
**Status**: Strategic Plan  
**Date**: 2026-03-18  
**Estimated Phases**: 8  
**Estimated Total Effort**: ~4,500 LOC new, ~1,200 LOC modified

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Phase 1: Foundation Types & Configuration](#phase-1-foundation-types--configuration)
3. [Phase 2: Raft State Store & Persistence](#phase-2-raft-state-store--persistence)
4. [Phase 3: Core Raft Algorithm](#phase-3-core-raft-algorithm)
5. [Phase 4: Network Transport Layer](#phase-4-network-transport-layer)
6. [Phase 5: CP Group Lifecycle & METADATA Group](#phase-5-cp-group-lifecycle--metadata-group)
7. [Phase 6: State Machine & Data Structure Migration](#phase-6-state-machine--data-structure-migration)
8. [Phase 7: Snapshot & Log Compaction](#phase-7-snapshot--log-compaction)
9. [Phase 8: CpSubsystemService Rewrite & Integration](#phase-8-cpsubsystemservice-rewrite--integration)
10. [Cross-Cutting Concerns](#cross-cutting-concerns)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   HeliosConfig                       │
│  ┌─────────────────┐  ┌──────────────────────┐      │
│  │ CPSubsystemConfig│  │ RaftAlgorithmConfig   │      │
│  └─────────────────┘  └──────────────────────┘      │
└─────────────────────────────────────────────────────┘
                         │
┌─────────────────────────────────────────────────────┐
│              CpSubsystemService (rewritten)          │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐    │
│  │ METADATA │ │ DEFAULT  │ │ custom@groupName │    │
│  │ RaftNode │ │ RaftNode │ │ RaftNode         │    │
│  └──────────┘ └──────────┘ └──────────────────┘    │
│       ▲            ▲              ▲                  │
│       └────────────┴──────────────┘                  │
│                    │                                  │
│         ┌──────────────────────┐                     │
│         │  RaftStateMachine    │                     │
│         │  (per-group)         │                     │
│         └──────────────────────┘                     │
└─────────────────────────────────────────────────────┘
                         │
┌─────────────────────────────────────────────────────┐
│             RaftMessageHandler                        │
│  (receives from TcpClusterTransport.onMessage)       │
│  Routes: PreVote, Vote, Append, InstallSnapshot      │
└─────────────────────────────────────────────────────┘
                         │
┌─────────────────────────────────────────────────────┐
│             TcpClusterTransport                      │
│  (existing — extended with Raft message types)       │
└─────────────────────────────────────────────────────┘
```

**Key Design Decisions:**

1. **RaftNode is exported and per-group** — each CP group gets its own RaftNode instance with independent term, log, and state machine.
2. **Deterministic state machine** — all service state is derived from applying committed log entries. No separate `applyStateMutation()` calls from service code.
3. **Single-node backward compatibility** — when `cpMemberCount < 3`, the system operates in the current single-node immediate-commit mode. This preserves all 5,400+ existing tests.
4. **Clean separation** — RaftNode owns the algorithm, RaftStateMachine owns apply logic, RaftStateStore owns persistence, CpSubsystemService owns orchestration.

---

## Phase 1: Foundation Types & Configuration

**Goal**: Define all shared types, interfaces, error classes, and configuration that every subsequent phase depends on.

**Dependencies**: None (foundational)

### Files to Create

#### 1.1 `src/cp/raft/types.ts` — Core Raft Types

```typescript
/** Unique identifier for a CP group. */
export interface RaftGroupId {
  readonly name: string;
  /** Random seed for hash distribution. */
  readonly seed: bigint;
  /** Monotonic group instance ID (incremented on re-creation). */
  readonly id: bigint;
}

/** Identity of a CP member within a Raft group. */
export interface RaftEndpoint {
  /** UUID of the cluster member. */
  readonly uuid: string;
  readonly address: { readonly host: string; readonly port: number };
}

/** A single entry in the Raft log. */
export interface RaftLogEntry {
  readonly term: number;
  readonly index: number;
  readonly command: RaftCommand;
}

/**
 * Typed command that the state machine interprets.
 * The `type` field is a discriminant used by RaftStateMachine.apply().
 */
export interface RaftCommand {
  /** Discriminant: e.g. 'ATOMIC_LONG_ADD', 'SEM_ACQUIRE', 'SESSION_CREATE', 'MEMBERSHIP_CHANGE', 'NOP' */
  readonly type: string;
  /** Which CP group this command targets. */
  readonly groupId: string;
  /** State machine key (service-specific). */
  readonly key: string;
  /** Serialized payload (service-specific). */
  readonly payload: unknown;
  /** Optional session ID for session-aware commands. */
  readonly sessionId?: string;
  /** Invocation UUID for idempotency. */
  readonly invocationUid?: string;
}

/** Snapshot of a Raft group's state machine at a given log index. */
export interface SnapshotEntry {
  readonly term: number;
  readonly index: number;
  /** Serialized state machine snapshot. */
  readonly data: Uint8Array;
  /** Group members at the time of the snapshot. */
  readonly groupMembers: RaftEndpoint[];
  /** Log index of the last membership change included in this snapshot. */
  readonly groupMembersLogIndex: number;
}

/** Raft node role in the consensus protocol. */
export type RaftRole = 'FOLLOWER' | 'CANDIDATE' | 'LEADER';

/** Result of a Raft proposal. */
export interface RaftProposalResult<T = unknown> {
  readonly commitIndex: number;
  readonly result: T;
}

/**
 * Pending proposal: a command awaiting majority commit.
 * The leader creates these; they resolve/reject when committed or the leader steps down.
 */
export interface PendingProposal {
  readonly entry: RaftLogEntry;
  readonly resolve: (result: RaftProposalResult) => void;
  readonly reject: (error: Error) => void;
}
```

#### 1.2 `src/cp/raft/errors.ts` — CP Exception Hierarchy

```typescript
/**
 * Thrown when a non-leader receives a client request.
 * Contains the leader hint so the client can redirect.
 */
export class NotLeaderException extends Error {
  readonly name = 'NotLeaderException';
  constructor(
    readonly leaderEndpoint: import('./types.js').RaftEndpoint | null,
    readonly groupId: string,
  ) {
    super(
      leaderEndpoint
        ? `Not the leader. Leader is ${leaderEndpoint.uuid} at ${leaderEndpoint.address.host}:${leaderEndpoint.address.port}`
        : `Not the leader. Leader is unknown for group '${groupId}'`,
    );
  }
}

/**
 * Thrown when the leader cannot replicate due to back-pressure.
 * The client should retry after a delay.
 */
export class CannotReplicateException extends Error {
  readonly name = 'CannotReplicateException';
  constructor(readonly groupId: string) {
    super(`Cannot replicate: too many uncommitted entries for group '${groupId}'`);
  }
}

/**
 * Thrown when a leader discovers its entry was truncated by a new leader.
 * The outcome of the original operation is indeterminate.
 */
export class LeaderDemotedException extends Error {
  readonly name = 'LeaderDemotedException';
  constructor(readonly groupId: string, readonly term: number) {
    super(`Leader demoted in group '${groupId}' at term ${term}`);
  }
}

/**
 * Thrown by a follower receiving an AppendRequest with a stale term.
 */
export class StaleAppendRequestException extends Error {
  readonly name = 'StaleAppendRequestException';
  constructor(readonly expectedTerm: number, readonly actualTerm: number) {
    super(`Stale append request: expected term ${expectedTerm}, got ${actualTerm}`);
  }
}

/**
 * Thrown when operating on a destroyed CP group.
 */
export class CPGroupDestroyedException extends Error {
  readonly name = 'CPGroupDestroyedException';
  constructor(readonly groupId: string) {
    super(`CP group '${groupId}' has been destroyed`);
  }
}
```

#### 1.3 `src/config/CPSubsystemConfig.ts` — CP Subsystem Configuration

```typescript
import { RaftAlgorithmConfig } from './RaftAlgorithmConfig.js';

export class CPSubsystemConfig {
  /** Minimum 3 to enable multi-node Raft. 0 or 1 = single-node mode. */
  private _cpMemberCount = 0;
  /** Number of members per CP group (must be odd, 3-7). Defaults to cpMemberCount. */
  private _groupSize = 0;
  /** Session TTL in seconds. Default 300 (5 min). */
  private _sessionTimeToLiveSeconds = 300;
  /** Session heartbeat interval in seconds. Default 5. */
  private _sessionHeartbeatIntervalSeconds = 5;
  /** Missing CP member auto-removal timeout in seconds. 0 = disabled. */
  private _missingCpMemberAutoRemovalSeconds = 14400; // 4 hours
  /** If true, CP members are discovered from the cluster member list. */
  private _cpMemberPriority = false;
  /** Raft algorithm tuning. */
  private _raftAlgorithmConfig = new RaftAlgorithmConfig();

  // -- Getters/Setters --

  getCpMemberCount(): number { return this._cpMemberCount; }
  setCpMemberCount(count: number): this {
    if (count !== 0 && count < 3) throw new Error('cpMemberCount must be 0 (disabled) or >= 3');
    this._cpMemberCount = count;
    return this;
  }

  getGroupSize(): number { return this._groupSize || this._cpMemberCount; }
  setGroupSize(size: number): this {
    if (size !== 0 && (size < 3 || size % 2 === 0)) throw new Error('groupSize must be 0 (default to cpMemberCount) or an odd number >= 3');
    if (size > 7) throw new Error('groupSize must be <= 7');
    this._groupSize = size;
    return this;
  }

  getSessionTimeToLiveSeconds(): number { return this._sessionTimeToLiveSeconds; }
  setSessionTimeToLiveSeconds(seconds: number): this { this._sessionTimeToLiveSeconds = seconds; return this; }

  getSessionHeartbeatIntervalSeconds(): number { return this._sessionHeartbeatIntervalSeconds; }
  setSessionHeartbeatIntervalSeconds(seconds: number): this { this._sessionHeartbeatIntervalSeconds = seconds; return this; }

  getMissingCpMemberAutoRemovalSeconds(): number { return this._missingCpMemberAutoRemovalSeconds; }
  setMissingCpMemberAutoRemovalSeconds(seconds: number): this { this._missingCpMemberAutoRemovalSeconds = seconds; return this; }

  getRaftAlgorithmConfig(): RaftAlgorithmConfig { return this._raftAlgorithmConfig; }
  setRaftAlgorithmConfig(config: RaftAlgorithmConfig): this { this._raftAlgorithmConfig = config; return this; }

  isEnabled(): boolean { return this._cpMemberCount >= 3; }
}
```

#### 1.4 `src/config/RaftAlgorithmConfig.ts` — Raft Algorithm Tuning

```typescript
export class RaftAlgorithmConfig {
  private _leaderElectionTimeoutInMillis = 2000;
  private _leaderHeartbeatPeriodInMillis = 5000;
  private _maxMissedLeaderHeartbeatCount = 5;
  private _appendRequestMaxEntryCount = 100;
  private _commitIndexAdvanceCountToSnapshot = 10000;
  private _uncommittedEntryCountToRejectNewAppends = 100;

  getLeaderElectionTimeoutInMillis(): number { return this._leaderElectionTimeoutInMillis; }
  setLeaderElectionTimeoutInMillis(ms: number): this { this._leaderElectionTimeoutInMillis = ms; return this; }

  getLeaderHeartbeatPeriodInMillis(): number { return this._leaderHeartbeatPeriodInMillis; }
  setLeaderHeartbeatPeriodInMillis(ms: number): this { this._leaderHeartbeatPeriodInMillis = ms; return this; }

  getMaxMissedLeaderHeartbeatCount(): number { return this._maxMissedLeaderHeartbeatCount; }
  setMaxMissedLeaderHeartbeatCount(count: number): this { this._maxMissedLeaderHeartbeatCount = count; return this; }

  getAppendRequestMaxEntryCount(): number { return this._appendRequestMaxEntryCount; }
  setAppendRequestMaxEntryCount(count: number): this { this._appendRequestMaxEntryCount = count; return this; }

  getCommitIndexAdvanceCountToSnapshot(): number { return this._commitIndexAdvanceCountToSnapshot; }
  setCommitIndexAdvanceCountToSnapshot(count: number): this { this._commitIndexAdvanceCountToSnapshot = count; return this; }

  getUncommittedEntryCountToRejectNewAppends(): number { return this._uncommittedEntryCountToRejectNewAppends; }
  setUncommittedEntryCountToRejectNewAppends(count: number): this { this._uncommittedEntryCountToRejectNewAppends = count; return this; }

  /** Computed: follower timeout = heartbeatPeriod * maxMissedHeartbeats */
  getFollowerTimeoutMillis(): number {
    return this._leaderHeartbeatPeriodInMillis * this._maxMissedLeaderHeartbeatCount;
  }
}
```

### Files to Modify

#### 1.5 `src/config/HeliosConfig.ts` — Add CP config accessor

Add a `_cpSubsystemConfig` field and `getCpSubsystemConfig()` / `setCpSubsystemConfig()` methods following the existing pattern (e.g., `_persistenceConfig`).

**Specific change**: Add after line 41 (`private _configOrigin`):
```typescript
private _cpSubsystemConfig = new CPSubsystemConfig();
```

Add methods after `setPersistenceConfig()`:
```typescript
getCpSubsystemConfig(): CPSubsystemConfig { return this._cpSubsystemConfig; }
setCpSubsystemConfig(config: CPSubsystemConfig): this { this._cpSubsystemConfig = config; return this; }
```

Add import:
```typescript
import { CPSubsystemConfig } from '@zenystx/helios-core/config/CPSubsystemConfig.js';
```

### Testing Strategy

- Unit tests for `CPSubsystemConfig` validation (groupSize odd, cpMemberCount >= 3, etc.)
- Unit tests for `RaftAlgorithmConfig` defaults and computed values
- Unit tests for error class instantiation and message formatting
- Verify `HeliosConfig.getCpSubsystemConfig()` returns defaults
- **Zero existing test breakage**: no behavioral changes yet

### Risks

- **Low**: Pure additive. No existing code modified except adding a field to `HeliosConfig`.

---

## Phase 2: Raft State Store & Persistence

**Goal**: Define the persistence interface and provide an in-memory implementation. File-based persistence is deferred to a later enhancement.

**Dependencies**: Phase 1 (types)

### Files to Create

#### 2.1 `src/cp/raft/RaftStateStore.ts` — Persistence Interface

```typescript
import type { RaftLogEntry, SnapshotEntry } from './types.js';

/**
 * Durable state store for a single Raft group.
 * Implementations must guarantee that writes are durable (fsync) before returning.
 */
export interface RaftStateStore {
  // -- Hard state (must survive restarts) --

  /** Persist the current term and the candidate voted for (or null). */
  persistTermAndVote(term: number, votedFor: string | null): Promise<void>;

  /** Read persisted term and vote. Returns {term: 0, votedFor: null} if none. */
  readTermAndVote(): Promise<{ term: number; votedFor: string | null }>;

  // -- Log entries --

  /** Append entries to the durable log. Entries must have sequential indices. */
  appendEntries(entries: readonly RaftLogEntry[]): Promise<void>;

  /**
   * Read log entries in range [fromIndex, toIndex] inclusive.
   * Returns empty array if range is out of bounds.
   */
  readEntries(fromIndex: number, toIndex: number): Promise<RaftLogEntry[]>;

  /**
   * Read a single entry by index. Returns null if not found.
   */
  readEntry(index: number): Promise<RaftLogEntry | null>;

  /**
   * Truncate the log: remove all entries with index > afterIndex.
   * Used when a new leader overwrites conflicting entries.
   */
  truncateAfter(afterIndex: number): Promise<void>;

  /** The index of the last entry in the log, or -1 if empty. */
  lastLogIndex(): number;

  /** The term of the last entry in the log, or 0 if empty. */
  lastLogTerm(): number;

  /** The term of the entry at the given index, or 0 if not found. */
  termAt(index: number): number;

  // -- Snapshots --

  /** Persist a snapshot. This truncates the log up to snapshot.index. */
  persistSnapshot(snapshot: SnapshotEntry): Promise<void>;

  /** Read the latest snapshot, or null if none. */
  readSnapshot(): Promise<SnapshotEntry | null>;

  // -- Lifecycle --

  /** Flush all pending writes. */
  flush(): Promise<void>;

  /** Close resources. */
  close(): Promise<void>;
}
```

#### 2.2 `src/cp/raft/InMemoryRaftStateStore.ts` — In-Memory Implementation

```typescript
import type { RaftLogEntry, SnapshotEntry } from './types.js';
import type { RaftStateStore } from './RaftStateStore.js';

/**
 * Non-durable in-memory implementation of RaftStateStore.
 * Used for single-node mode and testing.
 */
export class InMemoryRaftStateStore implements RaftStateStore {
  private _term = 0;
  private _votedFor: string | null = null;
  private _log: RaftLogEntry[] = [];
  private _snapshot: SnapshotEntry | null = null;
  /**
   * The lowest valid log index. After a snapshot at index N,
   * _logBaseIndex = N + 1 and entries before that are discarded.
   */
  private _logBaseIndex = 0;

  async persistTermAndVote(term: number, votedFor: string | null): Promise<void> {
    this._term = term;
    this._votedFor = votedFor;
  }

  async readTermAndVote(): Promise<{ term: number; votedFor: string | null }> {
    return { term: this._term, votedFor: this._votedFor };
  }

  async appendEntries(entries: readonly RaftLogEntry[]): Promise<void> {
    for (const entry of entries) {
      const offset = entry.index - this._logBaseIndex;
      if (offset < 0) continue; // already compacted
      if (offset < this._log.length) {
        this._log[offset] = entry; // overwrite conflicting
      } else {
        this._log.push(entry);
      }
    }
  }

  async readEntries(fromIndex: number, toIndex: number): Promise<RaftLogEntry[]> {
    const result: RaftLogEntry[] = [];
    for (let i = fromIndex; i <= toIndex; i++) {
      const offset = i - this._logBaseIndex;
      if (offset >= 0 && offset < this._log.length) {
        result.push(this._log[offset]!);
      }
    }
    return result;
  }

  async readEntry(index: number): Promise<RaftLogEntry | null> {
    const offset = index - this._logBaseIndex;
    if (offset < 0 || offset >= this._log.length) return null;
    return this._log[offset] ?? null;
  }

  async truncateAfter(afterIndex: number): Promise<void> {
    const offset = afterIndex - this._logBaseIndex + 1;
    if (offset >= 0 && offset < this._log.length) {
      this._log.length = offset;
    }
  }

  lastLogIndex(): number {
    if (this._log.length === 0) {
      return this._snapshot ? this._snapshot.index : -1;
    }
    return this._logBaseIndex + this._log.length - 1;
  }

  lastLogTerm(): number {
    if (this._log.length === 0) {
      return this._snapshot ? this._snapshot.term : 0;
    }
    return this._log[this._log.length - 1]!.term;
  }

  termAt(index: number): number {
    if (this._snapshot && index === this._snapshot.index) return this._snapshot.term;
    const offset = index - this._logBaseIndex;
    if (offset < 0 || offset >= this._log.length) return 0;
    return this._log[offset]!.term;
  }

  async persistSnapshot(snapshot: SnapshotEntry): Promise<void> {
    this._snapshot = snapshot;
    // Discard log entries up to and including snapshot.index
    const discardCount = snapshot.index - this._logBaseIndex + 1;
    if (discardCount > 0) {
      this._log.splice(0, discardCount);
      this._logBaseIndex = snapshot.index + 1;
    }
  }

  async readSnapshot(): Promise<SnapshotEntry | null> {
    return this._snapshot;
  }

  async flush(): Promise<void> { /* no-op for in-memory */ }
  async close(): Promise<void> { /* no-op */ }
}
```

### Testing Strategy

- Unit test `InMemoryRaftStateStore`: append, read, truncate, snapshot compaction
- Test edge cases: truncate beyond log, read empty log, persist term/vote roundtrip
- Test that after `persistSnapshot()`, entries up to snapshot index are discarded
- Test that `lastLogIndex()` / `lastLogTerm()` correctly reflect snapshot state

### Risks

- **Low**: No integration points yet. Pure data structure tests.

---

## Phase 3: Core Raft Algorithm

**Goal**: Implement the full Raft consensus algorithm as an exported `RaftNode` class — leader election, pre-vote protocol, log replication, commit tracking, and leadership management.

**Dependencies**: Phase 1 (types, errors), Phase 2 (state store)

**CRITICAL**: This is the largest and most complex phase. It implements the Raft paper Sections 5.1–5.4 plus the pre-vote extension.

### Files to Create

#### 3.1 `src/cp/raft/RaftNode.ts` — The Core Algorithm (~800 LOC)

This is the heart of the implementation. Key design:
- The `RaftNode` class is **network-agnostic**: it does not send messages directly. Instead it returns or emits message objects that the transport layer sends.
- All timer-driven actions (election timeout, heartbeat) are managed internally via `setTimeout`/`setInterval`.
- The node is **single-threaded** (Bun event loop). All mutations happen synchronously within an async function that awaits only I/O (state store writes).

```typescript
import type { RaftEndpoint, RaftLogEntry, RaftCommand, RaftRole, PendingProposal, SnapshotEntry } from './types.js';
import type { RaftStateStore } from './RaftStateStore.js';
import type { RaftAlgorithmConfig } from '../../config/RaftAlgorithmConfig.js';
import type { RaftStateMachine } from './RaftStateMachine.js';
import type {
  RaftMessage,
  PreVoteRequest, PreVoteResponse,
  VoteRequest, VoteResponse,
  AppendRequest, AppendSuccessResponse, AppendFailureResponse,
  InstallSnapshotRequest, InstallSnapshotResponse,
} from './messages.js';
import { NotLeaderException, CannotReplicateException, LeaderDemotedException } from './errors.js';

export interface RaftNodeConfig {
  readonly groupId: string;
  readonly localEndpoint: RaftEndpoint;
  readonly initialMembers: readonly RaftEndpoint[];
  readonly config: RaftAlgorithmConfig;
  readonly stateStore: RaftStateStore;
  readonly stateMachine: RaftStateMachine;
}

export interface RaftMessageSender {
  sendRaftMessage(target: RaftEndpoint, message: RaftMessage): void;
}

export class RaftNode {
  // -- Identity --
  readonly groupId: string;
  readonly localEndpoint: RaftEndpoint;

  // -- Volatile state (all nodes) --
  private _role: RaftRole = 'FOLLOWER';
  private _leader: RaftEndpoint | null = null;
  private _members: RaftEndpoint[];
  private _commitIndex = -1;
  private _lastApplied = -1;

  // -- Volatile state (leader only) --
  /** For each follower: index of next entry to send. */
  private _nextIndex = new Map<string, number>();
  /** For each follower: highest index known to be replicated. */
  private _matchIndex = new Map<string, number>();

  // -- Pre-vote state --
  private _preVoteGranted = new Set<string>();

  // -- Election state --
  private _votesGranted = new Set<string>();

  // -- Pending proposals (leader only) --
  private _pendingProposals = new Map<number, PendingProposal>(); // index -> proposal

  // -- Timers --
  private _electionTimer: ReturnType<typeof setTimeout> | null = null;
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // -- Dependencies --
  private readonly _store: RaftStateStore;
  private readonly _stateMachine: RaftStateMachine;
  private readonly _config: RaftAlgorithmConfig;
  private _sender: RaftMessageSender | null = null;
  private _destroyed = false;

  constructor(config: RaftNodeConfig) { /* initialize from config */ }

  // -- Lifecycle --
  async start(): Promise<void>;    // Load persisted state, start election timer
  shutdown(): void;                 // Clear timers, reject pending proposals

  // -- External API --
  setSender(sender: RaftMessageSender): void;
  getRole(): RaftRole;
  getLeader(): RaftEndpoint | null;
  getTerm(): number;                // Read from store (cached)
  getCommitIndex(): number;
  getMembers(): readonly RaftEndpoint[];
  isLeader(): boolean;

  /**
   * Propose a command to the Raft cluster.
   * Only callable on the leader. Throws NotLeaderException otherwise.
   * Throws CannotReplicateException if too many uncommitted entries.
   * Returns a promise that resolves when the entry is committed and applied.
   */
  async propose(command: RaftCommand): Promise<unknown>;

  /**
   * Perform a linearizable read.
   * The leader sends a round of heartbeats and confirms it's still leader
   * before reading from the state machine.
   */
  async linearizableRead(key: string): Promise<unknown>;

  // -- Message Handlers (called by transport layer) --
  async handlePreVoteRequest(msg: PreVoteRequest): Promise<PreVoteResponse>;
  async handlePreVoteResponse(msg: PreVoteResponse): Promise<void>;
  async handleVoteRequest(msg: VoteRequest): Promise<VoteResponse>;
  async handleVoteResponse(msg: VoteResponse): Promise<void>;
  async handleAppendRequest(msg: AppendRequest): Promise<AppendSuccessResponse | AppendFailureResponse>;
  async handleAppendResponse(msg: AppendSuccessResponse | AppendFailureResponse): Promise<void>;
  async handleInstallSnapshot(msg: InstallSnapshotRequest): Promise<InstallSnapshotResponse>;
  async handleInstallSnapshotResponse(msg: InstallSnapshotResponse): Promise<void>;
  async handleTriggerLeaderElection(): Promise<void>;

  // -- Internal: Election --
  private _resetElectionTimer(): void;
  private _onElectionTimeout(): Promise<void>;
  private _startPreVote(): Promise<void>;          // Phase 1: pre-vote
  private _startElection(): Promise<void>;          // Phase 2: actual election
  private _becomeLeader(): void;
  private _becomeFollower(term: number, leader: RaftEndpoint | null): Promise<void>;

  // -- Internal: Log Replication --
  private _sendAppendEntries(target: RaftEndpoint): Promise<void>;
  private _broadcastAppendEntries(): void;          // Heartbeat or new entry
  private _advanceCommitIndex(): void;              // Check majority matchIndex
  private _applyCommitted(): Promise<void>;         // Apply entries up to commitIndex

  // -- Internal: Snapshot --
  private _sendInstallSnapshot(target: RaftEndpoint): Promise<void>;
  private _shouldTakeSnapshot(): boolean;
  private _takeSnapshot(): Promise<void>;

  // -- Internal: Helpers --
  private _quorumSize(): number;                    // Math.floor(members.length / 2) + 1
  private _isLogUpToDate(lastLogTerm: number, lastLogIndex: number): boolean;
  private _rejectPendingProposals(error: Error): void;
}
```

**Key Algorithm Details:**

**Election with Pre-Vote:**
1. On election timeout, node starts pre-vote: sends `PreVoteRequest` with `nextTerm = currentTerm + 1` but does NOT increment term.
2. Pre-vote responder grants if: (a) it has no leader or its leader has timed out, AND (b) the candidate's log is at least as up-to-date.
3. If pre-vote gets majority, node starts real election: increments term, votes for self, sends `VoteRequest`.
4. This prevents a partitioned node from incrementing its term and disrupting the cluster when it rejoins.

**AppendEntries:**
1. Leader maintains `nextIndex[follower]` and `matchIndex[follower]`.
2. On new proposal or heartbeat timer, leader sends `AppendRequest` with entries from `nextIndex[follower]` onward, up to `appendRequestMaxEntryCount`.
3. On `AppendSuccessResponse`: update `nextIndex` and `matchIndex`, call `_advanceCommitIndex()`.
4. On `AppendFailureResponse`: decrement `nextIndex[follower]` and retry. If follower is too far behind, send `InstallSnapshot`.
5. `_advanceCommitIndex()`: find the median `matchIndex` value — if it's higher than `commitIndex` and the entry at that index has the current term, advance `commitIndex` and apply entries.

**Back-pressure:**
- If `lastLogIndex - commitIndex >= uncommittedEntryCountToRejectNewAppends`, reject new proposals with `CannotReplicateException`.

#### 3.2 `src/cp/raft/messages.ts` — Raft Protocol Messages

```typescript
import type { RaftEndpoint, RaftLogEntry, SnapshotEntry } from './types.js';

// -- Pre-Vote (prevents disruptive elections) --

export interface PreVoteRequest {
  readonly type: 'RAFT_PRE_VOTE_REQUEST';
  readonly groupId: string;
  readonly candidateId: string;
  readonly nextTerm: number;         // term the candidate WOULD use, not yet incremented
  readonly lastLogTerm: number;
  readonly lastLogIndex: number;
}

export interface PreVoteResponse {
  readonly type: 'RAFT_PRE_VOTE_RESPONSE';
  readonly groupId: string;
  readonly term: number;
  readonly granted: boolean;
}

// -- Vote (standard RequestVote) --

export interface VoteRequest {
  readonly type: 'RAFT_VOTE_REQUEST';
  readonly groupId: string;
  readonly term: number;
  readonly candidateId: string;
  readonly lastLogTerm: number;
  readonly lastLogIndex: number;
}

export interface VoteResponse {
  readonly type: 'RAFT_VOTE_RESPONSE';
  readonly groupId: string;
  readonly term: number;
  readonly voteGranted: boolean;
}

// -- AppendEntries (log replication + heartbeats) --

export interface AppendRequest {
  readonly type: 'RAFT_APPEND_REQUEST';
  readonly groupId: string;
  readonly term: number;
  readonly leaderId: string;
  readonly prevLogIndex: number;
  readonly prevLogTerm: number;
  readonly entries: readonly RaftLogEntry[];
  readonly leaderCommit: number;
}

export interface AppendSuccessResponse {
  readonly type: 'RAFT_APPEND_SUCCESS';
  readonly groupId: string;
  readonly term: number;
  readonly followerId: string;
  readonly lastLogIndex: number;     // follower's last log index after append
}

export interface AppendFailureResponse {
  readonly type: 'RAFT_APPEND_FAILURE';
  readonly groupId: string;
  readonly term: number;
  readonly followerId: string;
  /** Hint: the follower's last log index, to allow rapid nextIndex backtrack. */
  readonly lastLogIndex: number;
}

// -- InstallSnapshot (for lagging followers) --

export interface InstallSnapshotRequest {
  readonly type: 'RAFT_INSTALL_SNAPSHOT';
  readonly groupId: string;
  readonly term: number;
  readonly leaderId: string;
  readonly snapshot: SnapshotEntry;
}

export interface InstallSnapshotResponse {
  readonly type: 'RAFT_INSTALL_SNAPSHOT_RESPONSE';
  readonly groupId: string;
  readonly term: number;
  readonly followerId: string;
  readonly success: boolean;
  readonly lastLogIndex: number;     // follower's last log index after installing
}

// -- Trigger Election (force an election, e.g. for testing) --

export interface TriggerLeaderElection {
  readonly type: 'RAFT_TRIGGER_ELECTION';
  readonly groupId: string;
}

// -- Membership change --

export interface UpdateRaftGroupMembersCommand {
  readonly type: 'RAFT_UPDATE_MEMBERS';
  readonly groupId: string;
  readonly members: readonly RaftEndpoint[];
  /** The member being added (null if removing). */
  readonly addedMember: RaftEndpoint | null;
  /** The member being removed (null if adding). */
  readonly removedMember: RaftEndpoint | null;
}

export type RaftMessage =
  | PreVoteRequest | PreVoteResponse
  | VoteRequest | VoteResponse
  | AppendRequest | AppendSuccessResponse | AppendFailureResponse
  | InstallSnapshotRequest | InstallSnapshotResponse
  | TriggerLeaderElection;
```

#### 3.3 `src/cp/raft/RaftStateMachine.ts` — State Machine Interface

```typescript
import type { RaftCommand, SnapshotEntry, RaftEndpoint } from './types.js';

/**
 * The deterministic state machine that Raft log entries are applied to.
 * Each CP group has one state machine instance.
 *
 * CRITICAL: apply() must be deterministic. Given the same sequence of commands,
 * every node must produce the exact same state.
 */
export interface RaftStateMachine {
  /**
   * Apply a committed command to the state machine.
   * Returns the result value that the proposer receives.
   * Must be deterministic — no external I/O, no random numbers, no Date.now().
   */
  apply(command: RaftCommand): unknown;

  /**
   * Take a snapshot of the current state machine state.
   * Returns serialized data that can be used to restore the state machine.
   */
  takeSnapshot(): Uint8Array;

  /**
   * Restore the state machine from a snapshot.
   * After this call, the state machine must be in the exact same state
   * as when the snapshot was taken.
   */
  restoreFromSnapshot(data: Uint8Array): void;

  /**
   * Called when the group membership changes (via a committed membership change command).
   */
  onGroupMembersChanged(members: readonly RaftEndpoint[]): void;
}
```

### Testing Strategy

This phase requires the most extensive testing. Implement in layers:

1. **Unit tests for RaftNode in isolation** (~200 test cases):
   - Create a `MockRaftMessageSender` that captures all outbound messages
   - Create a `MockRaftStateMachine` that records applied commands
   - Test election: single node auto-elects, 3-node election with vote splitting
   - Test pre-vote: partitioned node doesn't disrupt cluster on rejoin
   - Test log replication: leader sends entries, follower appends, commit advances
   - Test log conflict: new leader truncates conflicting entries
   - Test back-pressure: exceed uncommitted limit, get CannotReplicateException
   - Test leadership transfer on term bump
   - Test that propose() rejects on non-leader with NotLeaderException

2. **Multi-node simulation tests** (~50 test cases):
   - Create 3 or 5 `RaftNode` instances with in-memory transport (direct message passing)
   - Simulate network partitions by dropping messages between specific nodes
   - Verify election safety: at most one leader per term
   - Verify log matching: if two logs contain an entry with the same index and term, the logs are identical in all entries through that index
   - Verify leader completeness: committed entries survive leader changes

### Risks

- **HIGH**: This is the most complex component. Subtle bugs in term management, log truncation, or commit index advancement can cause safety violations.
- **Mitigation**: Extensive property-based testing. Implement Raft invariant checks that run after every state transition in test mode.
- **MEDIUM**: Timer-based testing can be flaky. Use `Bun.sleep()` stubs or manual timer advancement in tests.

---

## Phase 4: Network Transport Layer

**Goal**: Add Raft-specific message types to `ClusterMessage` and create a `RaftMessageHandler` that routes incoming Raft messages to the correct `RaftNode` instance.

**Dependencies**: Phase 1 (types), Phase 3 (messages)

### Files to Modify

#### 4.1 `src/cluster/tcp/ClusterMessage.ts` — Add Raft Message Types

Add after the existing `TransactionBackupReplicationAckMsg` interface (line ~642), BEFORE the `ClusterMessage` union type:

```typescript
// ── Raft consensus protocol messages ─────────────────────────────────

export interface RaftPreVoteRequestMsg {
  readonly type: 'RAFT_PRE_VOTE_REQUEST';
  readonly groupId: string;
  readonly candidateId: string;
  readonly nextTerm: number;
  readonly lastLogTerm: number;
  readonly lastLogIndex: number;
}

export interface RaftPreVoteResponseMsg {
  readonly type: 'RAFT_PRE_VOTE_RESPONSE';
  readonly groupId: string;
  readonly term: number;
  readonly granted: boolean;
}

export interface RaftVoteRequestMsg {
  readonly type: 'RAFT_VOTE_REQUEST';
  readonly groupId: string;
  readonly term: number;
  readonly candidateId: string;
  readonly lastLogTerm: number;
  readonly lastLogIndex: number;
}

export interface RaftVoteResponseMsg {
  readonly type: 'RAFT_VOTE_RESPONSE';
  readonly groupId: string;
  readonly term: number;
  readonly voteGranted: boolean;
}

export interface RaftAppendRequestMsg {
  readonly type: 'RAFT_APPEND_REQUEST';
  readonly groupId: string;
  readonly term: number;
  readonly leaderId: string;
  readonly prevLogIndex: number;
  readonly prevLogTerm: number;
  readonly entries: readonly import('../../../cp/raft/types.js').RaftLogEntry[];
  readonly leaderCommit: number;
}

export interface RaftAppendSuccessMsg {
  readonly type: 'RAFT_APPEND_SUCCESS';
  readonly groupId: string;
  readonly term: number;
  readonly followerId: string;
  readonly lastLogIndex: number;
}

export interface RaftAppendFailureMsg {
  readonly type: 'RAFT_APPEND_FAILURE';
  readonly groupId: string;
  readonly term: number;
  readonly followerId: string;
  readonly lastLogIndex: number;
}

export interface RaftInstallSnapshotMsg {
  readonly type: 'RAFT_INSTALL_SNAPSHOT';
  readonly groupId: string;
  readonly term: number;
  readonly leaderId: string;
  readonly snapshot: import('../../../cp/raft/types.js').SnapshotEntry;
}

export interface RaftInstallSnapshotResponseMsg {
  readonly type: 'RAFT_INSTALL_SNAPSHOT_RESPONSE';
  readonly groupId: string;
  readonly term: number;
  readonly followerId: string;
  readonly success: boolean;
  readonly lastLogIndex: number;
}

export interface RaftTriggerElectionMsg {
  readonly type: 'RAFT_TRIGGER_ELECTION';
  readonly groupId: string;
}
```

Add all 9 new types to the `ClusterMessage` union (after `MigrationAckMsg`):
```typescript
  | RaftPreVoteRequestMsg
  | RaftPreVoteResponseMsg
  | RaftVoteRequestMsg
  | RaftVoteResponseMsg
  | RaftAppendRequestMsg
  | RaftAppendSuccessMsg
  | RaftAppendFailureMsg
  | RaftInstallSnapshotMsg
  | RaftInstallSnapshotResponseMsg
  | RaftTriggerElectionMsg;
```

### Files to Create

#### 4.2 `src/cp/raft/RaftTransportAdapter.ts` — Bridge RaftNode to TcpClusterTransport

```typescript
import type { RaftEndpoint } from './types.js';
import type { RaftMessage } from './messages.js';
import type { RaftMessageSender } from './RaftNode.js';
import type { TcpClusterTransport } from '../../cluster/tcp/TcpClusterTransport.js';
import type { ClusterMessage } from '../../cluster/tcp/ClusterMessage.js';

/**
 * Adapts RaftNode's message-sending interface to TcpClusterTransport.
 * Converts RaftMessage objects to ClusterMessage objects and sends via transport.
 */
export class RaftTransportAdapter implements RaftMessageSender {
  constructor(private readonly _transport: TcpClusterTransport) {}

  sendRaftMessage(target: RaftEndpoint, message: RaftMessage): void {
    // RaftMessage types directly match ClusterMessage types (same shape)
    // so we can cast directly — the type discriminant is identical.
    this._transport.send(target.uuid, message as unknown as ClusterMessage);
  }
}
```

#### 4.3 `src/cp/raft/RaftMessageRouter.ts` — Routes Incoming Messages to RaftNodes

```typescript
import type { ClusterMessage } from '../../cluster/tcp/ClusterMessage.js';
import type { RaftNode } from './RaftNode.js';

/**
 * Routes incoming Raft-type ClusterMessages to the appropriate RaftNode
 * based on the groupId field.
 *
 * This is registered as a handler on TcpClusterTransport.onMessage.
 */
export class RaftMessageRouter {
  private readonly _nodes = new Map<string, RaftNode>();

  registerNode(groupId: string, node: RaftNode): void {
    this._nodes.set(groupId, node);
  }

  unregisterNode(groupId: string): void {
    this._nodes.delete(groupId);
  }

  /**
   * Handle an incoming cluster message. Returns true if the message was
   * a Raft message and was routed, false otherwise.
   */
  async handleMessage(msg: ClusterMessage): Promise<boolean> {
    switch (msg.type) {
      case 'RAFT_PRE_VOTE_REQUEST': {
        const node = this._nodes.get(msg.groupId);
        if (!node) return false;
        const response = await node.handlePreVoteRequest(msg);
        // Response is sent by the node via its sender
        return true;
      }
      case 'RAFT_PRE_VOTE_RESPONSE': {
        const node = this._nodes.get(msg.groupId);
        if (!node) return false;
        await node.handlePreVoteResponse(msg);
        return true;
      }
      case 'RAFT_VOTE_REQUEST': {
        const node = this._nodes.get(msg.groupId);
        if (!node) return false;
        const response = await node.handleVoteRequest(msg);
        // Response is sent by the node via its sender
        return true;
      }
      case 'RAFT_VOTE_RESPONSE': {
        const node = this._nodes.get(msg.groupId);
        if (!node) return false;
        await node.handleVoteResponse(msg);
        return true;
      }
      case 'RAFT_APPEND_REQUEST': {
        const node = this._nodes.get(msg.groupId);
        if (!node) return false;
        const response = await node.handleAppendRequest(msg);
        // Response is sent by the node via its sender
        return true;
      }
      case 'RAFT_APPEND_SUCCESS':
      case 'RAFT_APPEND_FAILURE': {
        const node = this._nodes.get(msg.groupId);
        if (!node) return false;
        await node.handleAppendResponse(msg);
        return true;
      }
      case 'RAFT_INSTALL_SNAPSHOT': {
        const node = this._nodes.get(msg.groupId);
        if (!node) return false;
        const response = await node.handleInstallSnapshot(msg);
        // Response is sent by the node via its sender
        return true;
      }
      case 'RAFT_INSTALL_SNAPSHOT_RESPONSE': {
        const node = this._nodes.get(msg.groupId);
        if (!node) return false;
        await node.handleInstallSnapshotResponse(msg);
        return true;
      }
      case 'RAFT_TRIGGER_ELECTION': {
        const node = this._nodes.get(msg.groupId);
        if (!node) return false;
        await node.handleTriggerLeaderElection();
        return true;
      }
      default:
        return false;
    }
  }
}
```

### Testing Strategy

- Test that `RaftTransportAdapter` correctly translates `RaftMessage` to `ClusterMessage` and calls `transport.send()`.
- Test that `RaftMessageRouter` correctly routes messages by groupId.
- Test that unknown groupId messages are silently dropped (returns false).
- Integration test: wire up 3 `RaftNode` instances via in-process `TcpClusterTransport` channels and verify election completes.

### Risks

- **MEDIUM**: Extending `ClusterMessage` union type could theoretically affect binary serialization. The `BinarySerializationStrategy` must handle new message types.
  - **Mitigation**: Verify that the serialization strategy handles unknown types gracefully (it uses JSON or structured clone, not fixed schemas). Add explicit tests.

---

## Phase 5: CP Group Lifecycle & METADATA Group

**Goal**: Implement the METADATA group that manages CP group creation, destruction, and membership. Implement the `@groupName` naming convention.

**Dependencies**: Phase 3 (RaftNode), Phase 4 (transport)

### Files to Create

#### 5.1 `src/cp/raft/CpGroupManager.ts` — CP Group Lifecycle Manager

```typescript
import type { RaftGroupId, RaftEndpoint } from './types.js';
import { RaftNode, type RaftNodeConfig, type RaftMessageSender } from './RaftNode.js';
import { InMemoryRaftStateStore } from './InMemoryRaftStateStore.js';
import type { RaftAlgorithmConfig } from '../../config/RaftAlgorithmConfig.js';
import type { CPSubsystemConfig } from '../../config/CPSubsystemConfig.js';
import { CpStateMachine } from './CpStateMachine.js';
import { RaftMessageRouter } from './RaftMessageRouter.js';

export interface CpGroupInfo {
  readonly groupId: RaftGroupId;
  readonly members: readonly RaftEndpoint[];
  readonly raftNode: RaftNode;
  readonly stateMachine: CpStateMachine;
  readonly status: 'ACTIVE' | 'DESTROYING' | 'DESTROYED';
}

/**
 * Manages the lifecycle of CP groups.
 *
 * The METADATA group is a special Raft group that stores:
 * - List of all CP groups and their members
 * - CP member registry
 * - Group creation/destruction history
 *
 * When a client requests a CP data structure on a group that doesn't exist,
 * the METADATA group creates it via a committed Raft entry.
 */
export class CpGroupManager {
  static readonly METADATA_GROUP = 'METADATA';
  static readonly DEFAULT_GROUP = 'default';

  private readonly _groups = new Map<string, CpGroupInfo>();
  private readonly _router: RaftMessageRouter;
  private _metadataNode: RaftNode | null = null;
  private _nextGroupId = 1n;

  constructor(
    private readonly _localEndpoint: RaftEndpoint,
    private readonly _cpMembers: readonly RaftEndpoint[],
    private readonly _cpConfig: CPSubsystemConfig,
    private readonly _messageSender: RaftMessageSender,
    router: RaftMessageRouter,
  ) {
    this._router = router;
  }

  /**
   * Initialize the CP subsystem. Creates the METADATA group on all CP members.
   * Must be called after all CP members have joined the cluster.
   */
  async initialize(): Promise<void>;

  /**
   * Get or create a CP group by name. If the group doesn't exist,
   * proposes a CREATE_GROUP command to the METADATA group.
   * Returns when the group is confirmed created on majority.
   *
   * Handles @groupName syntax: "myLock@customGroup" -> group="customGroup", name="myLock"
   */
  async getOrCreateGroup(groupName: string): Promise<CpGroupInfo>;

  /**
   * Destroy a CP group. Proposes a DESTROY_GROUP command to METADATA.
   * All RaftNode instances for the group are shut down.
   */
  async destroyGroup(groupId: string): Promise<void>;

  /** Get an existing group without creating. Returns null if not found. */
  getGroup(groupId: string): CpGroupInfo | null;

  /** List all active group IDs. */
  listGroups(): string[];

  /** Select members for a new group (round-robin or least-loaded). */
  private _selectGroupMembers(): RaftEndpoint[];

  /** Create a RaftNode for a group and register it with the router. */
  private _createGroupNode(groupId: RaftGroupId, members: readonly RaftEndpoint[]): CpGroupInfo;

  /** Shutdown all groups and the METADATA node. */
  shutdown(): void;
}
```

#### 5.2 `src/cp/raft/CpStateMachine.ts` — Unified CP State Machine

```typescript
import type { RaftCommand, RaftEndpoint } from './types.js';
import type { RaftStateMachine } from './RaftStateMachine.js';

/**
 * The CP subsystem state machine that handles all CP data structure commands.
 *
 * This is a UNIFIED state machine that replaces the per-service apply patterns.
 * All 6 CP data structures' logic is encoded here as deterministic apply functions.
 *
 * State layout (single Map<string, unknown>):
 *   "atomiclong:<name>"   -> string (BigInt serialized)
 *   "atomicref:<name>"    -> string (JSON serialized)
 *   "sem:<name>"          -> SemaphoreState
 *   "cdl:<name>"          -> CountDownLatchState
 *   "flock:<group>:<name>"-> FencedLockState
 *   "cpmap:<name>"        -> Map<string, string>
 *   "session:<id>"        -> CpSessionState
 */
export class CpStateMachine implements RaftStateMachine {
  private readonly _state = new Map<string, unknown>();

  /**
   * Apply a committed command. MUST be deterministic.
   * Returns the result to the proposer.
   */
  apply(command: RaftCommand): unknown {
    switch (command.type) {
      // -- AtomicLong --
      case 'ATOMIC_LONG_SET':     return this._atomicLongSet(command);
      case 'ATOMIC_LONG_ADD':     return this._atomicLongAdd(command);
      case 'ATOMIC_LONG_CAS':     return this._atomicLongCas(command);
      case 'ATOMIC_LONG_GET':     return this._atomicLongGet(command);

      // -- AtomicReference --
      case 'ATOMIC_REF_SET':      return this._atomicRefSet(command);
      case 'ATOMIC_REF_CAS':      return this._atomicRefCas(command);
      case 'ATOMIC_REF_GET':      return this._atomicRefGet(command);

      // -- Semaphore --
      case 'SEM_INIT':            return this._semInit(command);
      case 'SEM_ACQUIRE':         return this._semAcquire(command);
      case 'SEM_RELEASE':         return this._semRelease(command);
      case 'SEM_DRAIN':           return this._semDrain(command);
      case 'SEM_CHANGE':          return this._semChange(command);

      // -- CountDownLatch --
      case 'CDL_TRY_SET_COUNT':   return this._cdlTrySetCount(command);
      case 'CDL_COUNT_DOWN':      return this._cdlCountDown(command);
      case 'CDL_GET_COUNT':       return this._cdlGetCount(command);

      // -- FencedLock --
      case 'FLOCK_LOCK':          return this._flockLock(command);
      case 'FLOCK_TRY_LOCK':      return this._flockTryLock(command);
      case 'FLOCK_UNLOCK':        return this._flockUnlock(command);

      // -- CPMap --
      case 'CPMAP_PUT':           return this._cpmapPut(command);
      case 'CPMAP_SET':           return this._cpmapSet(command);
      case 'CPMAP_REMOVE':        return this._cpmapRemove(command);
      case 'CPMAP_DELETE':        return this._cpmapDelete(command);
      case 'CPMAP_PUT_IF_ABSENT': return this._cpmapPutIfAbsent(command);
      case 'CPMAP_COMPARE_AND_SET': return this._cpmapCompareAndSet(command);

      // -- Session management --
      case 'SESSION_CREATE':      return this._sessionCreate(command);
      case 'SESSION_HEARTBEAT':   return this._sessionHeartbeat(command);
      case 'SESSION_CLOSE':       return this._sessionClose(command);

      // -- Membership --
      case 'RAFT_UPDATE_MEMBERS': return this._updateMembers(command);

      // -- No-op (used for ReadIndex) --
      case 'NOP':                 return null;

      default:
        throw new Error(`Unknown command type: ${command.type}`);
    }
  }

  takeSnapshot(): Uint8Array {
    // Serialize the entire _state map to a binary format.
    // Use JSON for simplicity (the map values are already JSON-friendly).
    const obj: Record<string, unknown> = {};
    for (const [k, v] of this._state) {
      obj[k] = v;
    }
    return new TextEncoder().encode(JSON.stringify(obj));
  }

  restoreFromSnapshot(data: Uint8Array): void {
    const obj = JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>;
    this._state.clear();
    for (const [k, v] of Object.entries(obj)) {
      this._state.set(k, v);
    }
  }

  onGroupMembersChanged(_members: readonly RaftEndpoint[]): void {
    // Update membership-aware state (session management, lock ownership, etc.)
  }

  /** Direct read from state (for linearizable reads). */
  getState(key: string): unknown {
    return this._state.get(key);
  }

  // -- Each apply function: pure, deterministic, returns result --
  // (Method stubs shown; full implementations in Phase 6)
  private _atomicLongSet(cmd: RaftCommand): unknown { /* ... */ }
  private _atomicLongAdd(cmd: RaftCommand): unknown { /* ... */ }
  private _atomicLongCas(cmd: RaftCommand): unknown { /* ... */ }
  private _atomicLongGet(cmd: RaftCommand): unknown { /* ... */ }
  private _atomicRefSet(cmd: RaftCommand): unknown { /* ... */ }
  private _atomicRefCas(cmd: RaftCommand): unknown { /* ... */ }
  private _atomicRefGet(cmd: RaftCommand): unknown { /* ... */ }
  private _semInit(cmd: RaftCommand): unknown { /* ... */ }
  private _semAcquire(cmd: RaftCommand): unknown { /* ... */ }
  private _semRelease(cmd: RaftCommand): unknown { /* ... */ }
  private _semDrain(cmd: RaftCommand): unknown { /* ... */ }
  private _semChange(cmd: RaftCommand): unknown { /* ... */ }
  private _cdlTrySetCount(cmd: RaftCommand): unknown { /* ... */ }
  private _cdlCountDown(cmd: RaftCommand): unknown { /* ... */ }
  private _cdlGetCount(cmd: RaftCommand): unknown { /* ... */ }
  private _flockLock(cmd: RaftCommand): unknown { /* ... */ }
  private _flockTryLock(cmd: RaftCommand): unknown { /* ... */ }
  private _flockUnlock(cmd: RaftCommand): unknown { /* ... */ }
  private _cpmapPut(cmd: RaftCommand): unknown { /* ... */ }
  private _cpmapSet(cmd: RaftCommand): unknown { /* ... */ }
  private _cpmapRemove(cmd: RaftCommand): unknown { /* ... */ }
  private _cpmapDelete(cmd: RaftCommand): unknown { /* ... */ }
  private _cpmapPutIfAbsent(cmd: RaftCommand): unknown { /* ... */ }
  private _cpmapCompareAndSet(cmd: RaftCommand): unknown { /* ... */ }
  private _sessionCreate(cmd: RaftCommand): unknown { /* ... */ }
  private _sessionHeartbeat(cmd: RaftCommand): unknown { /* ... */ }
  private _sessionClose(cmd: RaftCommand): unknown { /* ... */ }
  private _updateMembers(cmd: RaftCommand): unknown { /* ... */ }
}
```

### Testing Strategy

- Test `CpGroupManager` in single-node mode: create group, get group, destroy group
- Test METADATA group creation with 3 in-memory nodes
- Test `@groupName` parsing: `"lock@myGroup"` -> group=`myGroup`, name=`lock`
- Test group member selection (round-robin among CP members)
- Test destroy propagation: destroying a group stops the RaftNode and removes from router

### Risks

- **MEDIUM**: METADATA group bootstrapping is a chicken-and-egg problem — the METADATA group itself needs Raft consensus to create other groups. Solution: METADATA group is pre-configured with all CP members at startup, not dynamically created.

---

## Phase 6: State Machine & Data Structure Migration

**Goal**: Rewrite all 6 CP data structure services to be thin wrappers that propose commands through `RaftNode.propose()` and have their logic encoded in the deterministic `CpStateMachine.apply()`. This is the critical migration from the current non-atomic patterns.

**Dependencies**: Phase 3 (RaftNode), Phase 5 (CpStateMachine, CpGroupManager)

### Key Architectural Change

**Before (current):**
```
Service.method() -> readState() -> compute -> propose() -> applyStateMutation()
                    ↑ separate read                        ↑ separate write
                    (non-atomic in multi-node)
```

**After (new):**
```
Service.method() -> raftNode.propose(command) -> [Raft commits] -> StateMachine.apply(command)
                    ↑ command encodes intent      ↑ replicated       ↑ deterministic; returns result
```

The key insight: **the service layer no longer computes anything**. It only constructs command objects and sends them to Raft. All computation happens inside `CpStateMachine.apply()`, which runs identically on all nodes.

### Files to Modify

#### 6.1 `src/cp/impl/AtomicLongService.ts` — Complete Rewrite

```typescript
import type { CpSubsystemService } from './CpSubsystemService.js';

export class AtomicLongService {
  static readonly SERVICE_NAME = 'hz:impl:atomicLongService';

  constructor(private readonly _cp: CpSubsystemService) {}

  async get(name: string): Promise<bigint> {
    const result = await this._cp.executeRaftCommand(name, {
      type: 'ATOMIC_LONG_GET',
      groupId: this._cp.resolveGroupId(name),
      key: `atomiclong:${this._cp.resolveObjectName(name)}`,
      payload: null,
    });
    return result !== undefined && result !== null ? BigInt(result as string) : 0n;
  }

  async set(name: string, newValue: bigint): Promise<void> {
    await this._cp.executeRaftCommand(name, {
      type: 'ATOMIC_LONG_SET',
      groupId: this._cp.resolveGroupId(name),
      key: `atomiclong:${this._cp.resolveObjectName(name)}`,
      payload: { newValue: String(newValue) },
    });
  }

  async getAndSet(name: string, newValue: bigint): Promise<bigint> {
    const result = await this._cp.executeRaftCommand(name, {
      type: 'ATOMIC_LONG_SET',
      groupId: this._cp.resolveGroupId(name),
      key: `atomiclong:${this._cp.resolveObjectName(name)}`,
      payload: { newValue: String(newValue), returnOld: true },
    });
    return result !== undefined && result !== null ? BigInt(result as string) : 0n;
  }

  async addAndGet(name: string, delta: bigint): Promise<bigint> {
    const result = await this._cp.executeRaftCommand(name, {
      type: 'ATOMIC_LONG_ADD',
      groupId: this._cp.resolveGroupId(name),
      key: `atomiclong:${this._cp.resolveObjectName(name)}`,
      payload: { delta: String(delta), returnNew: true },
    });
    return BigInt(result as string);
  }

  async getAndAdd(name: string, delta: bigint): Promise<bigint> {
    const result = await this._cp.executeRaftCommand(name, {
      type: 'ATOMIC_LONG_ADD',
      groupId: this._cp.resolveGroupId(name),
      key: `atomiclong:${this._cp.resolveObjectName(name)}`,
      payload: { delta: String(delta), returnOld: true },
    });
    return BigInt(result as string);
  }

  async compareAndSet(name: string, expect: bigint, update: bigint): Promise<boolean> {
    const result = await this._cp.executeRaftCommand(name, {
      type: 'ATOMIC_LONG_CAS',
      groupId: this._cp.resolveGroupId(name),
      key: `atomiclong:${this._cp.resolveObjectName(name)}`,
      payload: { expect: String(expect), update: String(update) },
    });
    return result as boolean;
  }

  // incrementAndGet, decrementAndGet, etc. delegate to addAndGet/getAndAdd
  async incrementAndGet(name: string): Promise<bigint> { return this.addAndGet(name, 1n); }
  async getAndIncrement(name: string): Promise<bigint> { return this.getAndAdd(name, 1n); }
  async decrementAndGet(name: string): Promise<bigint> { return this.addAndGet(name, -1n); }
  async getAndDecrement(name: string): Promise<bigint> { return this.getAndAdd(name, -1n); }

  // alter/apply methods still need function execution — but deterministic
  // In multi-node, functions CANNOT be arbitrary lambdas. They must be
  // serialized data operations. For now, alter is implemented as get+set
  // but atomically within a single Raft command.
  async alter(name: string, fn: (value: bigint) => bigint): Promise<void> {
    // This is problematic in multi-node — fn is not serializable.
    // For client protocol compatibility, the Data function is executed on the leader
    // and the SET result is proposed.
    const current = await this.get(name);
    const newValue = fn(current);
    await this.set(name, newValue);
  }

  // ... remaining alter methods follow same pattern
}
```

**CRITICAL DESIGN NOTE on `alter()` / `apply()`**: In Hazelcast Java, these methods receive serialized `IFunction` objects that are replicated in the Raft log and applied deterministically on all nodes. In Helios (TypeScript), we cannot serialize arbitrary closures. Two options:

1. **Option A (simpler, chosen)**: Execute the function on the leader and propose a SET with the computed result. This is safe because only the leader executes `propose()`, and the SET is the replicated command. The trade-off is that alter is not truly linearizable if the leader changes between get and propose — but this matches the current single-node behavior.

2. **Option B (future)**: Implement a serializable function registry where well-known functions (add, multiply, etc.) are registered by name and can be replicated.

#### 6.2 `src/cp/impl/AtomicReferenceService.ts` — Rewrite

Same pattern as AtomicLong. Replace read-compute-propose with single command proposal.

```typescript
// All methods become: construct command -> _cp.executeRaftCommand() -> return result
// CpStateMachine.apply() handles the logic deterministically
```

#### 6.3 `src/cp/impl/FencedLockService.ts` — Major Rewrite

This is the most significant change because the current implementation completely bypasses Raft.

```typescript
import type { CpSubsystemService } from './CpSubsystemService.js';

export const INVALID_FENCE = -1n;

export class FencedLockService {
  static readonly SERVICE_NAME = 'hz:impl:fencedLockService';

  constructor(private readonly _cp: CpSubsystemService) {
    this._cp.onSessionClosed((sessionId) => {
      // Session close is itself a Raft command, so lock release happens
      // deterministically in the state machine when the SESSION_CLOSE is applied.
      // No additional action needed here.
    });
  }

  async lock(
    groupName: string,
    lockName: string,
    sessionId: bigint,
    threadId: bigint,
    invocationUid: string,
  ): Promise<bigint> {
    const result = await this._cp.executeRaftCommand(`${lockName}@${groupName}`, {
      type: 'FLOCK_LOCK',
      groupId: groupName,
      key: `flock:${groupName}:${lockName}`,
      payload: { sessionId: String(sessionId), threadId: String(threadId) },
      sessionId: String(sessionId),
      invocationUid,
    });

    // Result is the fence value, or a "WAIT" indicator if lock is held
    const fenceResult = result as { fence: bigint } | { wait: true };
    if ('wait' in fenceResult) {
      // The state machine queued us. In Hazelcast, this is handled by
      // the WaitKey mechanism. We need a completion callback.
      return this._cp.awaitWaitKey(groupName, lockName, sessionId, threadId, invocationUid);
    }
    return fenceResult.fence;
  }

  async tryLock(
    groupName: string,
    lockName: string,
    sessionId: bigint,
    threadId: bigint,
    invocationUid: string,
    timeoutMs: bigint,
  ): Promise<bigint> {
    const result = await this._cp.executeRaftCommand(`${lockName}@${groupName}`, {
      type: 'FLOCK_TRY_LOCK',
      groupId: groupName,
      key: `flock:${groupName}:${lockName}`,
      payload: {
        sessionId: String(sessionId),
        threadId: String(threadId),
        timeoutMs: String(timeoutMs),
      },
      sessionId: String(sessionId),
      invocationUid,
    });

    const fenceResult = result as { fence: bigint } | { wait: true } | { timeout: true };
    if ('timeout' in fenceResult) return INVALID_FENCE;
    if ('wait' in fenceResult) {
      return this._cp.awaitWaitKeyWithTimeout(
        groupName, lockName, sessionId, threadId, invocationUid, Number(timeoutMs),
      );
    }
    return fenceResult.fence;
  }

  async unlock(
    groupName: string,
    lockName: string,
    sessionId: bigint,
    threadId: bigint,
    invocationUid: string,
  ): Promise<boolean> {
    const result = await this._cp.executeRaftCommand(`${lockName}@${groupName}`, {
      type: 'FLOCK_UNLOCK',
      groupId: groupName,
      key: `flock:${groupName}:${lockName}`,
      payload: { sessionId: String(sessionId), threadId: String(threadId) },
      sessionId: String(sessionId),
      invocationUid,
    });
    return result as boolean;
  }

  getLockOwnership(
    groupName: string,
    lockName: string,
  ): { fence: bigint; lockCount: number; sessionId: bigint; threadId: bigint } {
    // This is a read operation — use linearizable read
    const state = this._cp.linearizableRead(
      groupName,
      `flock:${groupName}:${lockName}`,
    ) as { fence: bigint; lockCount: number; sessionId: bigint; threadId: bigint } | undefined;

    if (!state) {
      return { fence: 0n, lockCount: 0, sessionId: -1n, threadId: -1n };
    }
    return state;
  }
}
```

#### 6.4 `src/cp/impl/SemaphoreService.ts` — Rewrite

Convert all methods to command proposals. Move the waiter queue logic into the state machine (using WaitKey pattern). The state machine's `_semAcquire()` either grants immediately or returns a "wait" indicator.

#### 6.5 `src/cp/impl/CountDownLatchService.ts` — Rewrite

Convert to command proposals. Move waiter resolution into the state machine's `_cdlCountDown()` when count reaches zero.

#### 6.6 `src/cp/impl/CPMapService.ts` — Rewrite

Convert to command proposals. Remove the separate `_maps` state — all state lives in `CpStateMachine`.

### WaitKey Mechanism

For blocking operations (lock, semaphore acquire, latch await), we need a mechanism for the state machine to signal that a pending request should wait:

```typescript
// In CpSubsystemService (Phase 8):

/** Pending wait keys: resolve when the state machine grants the resource. */
private readonly _waitKeys = new Map<string, {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
}>();

/**
 * Called by services when the state machine returns a "wait" indicator.
 * The state machine will later call completeWaitKey() when the resource is available.
 */
async awaitWaitKey(
  groupName: string, resourceName: string,
  sessionId: bigint, threadId: bigint, invocationUid: string,
): Promise<bigint> {
  return new Promise((resolve, reject) => {
    const key = `${groupName}:${resourceName}:${sessionId}:${threadId}:${invocationUid}`;
    this._waitKeys.set(key, { resolve: (r) => resolve(r as bigint), reject });
  });
}

/**
 * Called by the state machine (via callback) when a waited resource becomes available.
 */
completeWaitKey(key: string, result: unknown): void {
  const waiter = this._waitKeys.get(key);
  if (waiter) {
    this._waitKeys.delete(key);
    waiter.resolve(result);
  }
}
```

### Testing Strategy

- **Per-service unit tests**: Test each service in single-node mode to verify backward compatibility with existing tests.
- **Atomicity tests**: For AtomicLong, verify that concurrent `getAndAdd` from multiple nodes produces correct results (no lost updates).
- **Lock tests**: Verify that FencedLock correctly blocks, reentrant behavior works, and session expiry releases locks.
- **End-to-end**: Run existing `cp.test.ts` interop tests — they must continue to pass.

### Risks

- **HIGH**: This is the highest-risk phase because it modifies existing working services.
- **Mitigation**: 
  1. Implement the new services alongside the old ones initially.
  2. Use a feature flag in `CPSubsystemConfig.isEnabled()` to switch between old (single-node) and new (multi-node) code paths.
  3. When `isEnabled() === false` (cpMemberCount < 3), use the exact current behavior.
  4. Only switch to new code paths when `isEnabled() === true`.

---

## Phase 7: Snapshot & Log Compaction

**Goal**: Implement snapshotting for log compaction and follower catch-up via `InstallSnapshot` RPC.

**Dependencies**: Phase 3 (RaftNode), Phase 5 (CpStateMachine)

### Implementation in Existing Files

#### 7.1 In `RaftNode.ts` — Snapshot Logic

The snapshot logic is triggered when `commitIndex - lastSnapshotIndex >= commitIndexAdvanceCountToSnapshot`:

```typescript
// In _applyCommitted():
private async _applyCommitted(): Promise<void> {
  while (this._lastApplied < this._commitIndex) {
    this._lastApplied++;
    const entry = await this._store.readEntry(this._lastApplied);
    if (entry) {
      this._stateMachine.apply(entry.command);
    }
  }

  // Check if snapshot is needed
  if (this._shouldTakeSnapshot()) {
    await this._takeSnapshot();
  }
}

private _shouldTakeSnapshot(): boolean {
  const lastSnapshot = this._store.readSnapshot();  // cached in memory
  const lastSnapshotIndex = lastSnapshot ? lastSnapshot.index : -1;
  return this._commitIndex - lastSnapshotIndex >= this._config.getCommitIndexAdvanceCountToSnapshot();
}

private async _takeSnapshot(): Promise<void> {
  const data = this._stateMachine.takeSnapshot();
  const snapshot: SnapshotEntry = {
    term: this._store.termAt(this._commitIndex),
    index: this._commitIndex,
    data,
    groupMembers: [...this._members],
    groupMembersLogIndex: this._commitIndex, // simplified
  };
  await this._store.persistSnapshot(snapshot);
  // Log entries before the snapshot index are now compacted in the store
}
```

#### 7.2 In `RaftNode.ts` — InstallSnapshot for Lagging Followers

```typescript
// In _sendAppendEntries(), when nextIndex[follower] is behind the snapshot:
private async _sendAppendEntries(target: RaftEndpoint): Promise<void> {
  const nextIdx = this._nextIndex.get(target.uuid) ?? 0;
  const snapshot = await this._store.readSnapshot();

  // If the follower is behind our snapshot, send InstallSnapshot instead
  if (snapshot && nextIdx <= snapshot.index) {
    await this._sendInstallSnapshot(target);
    return;
  }

  // Normal AppendEntries...
}

private async _sendInstallSnapshot(target: RaftEndpoint): Promise<void> {
  const snapshot = await this._store.readSnapshot();
  if (!snapshot) return;

  this._sender?.sendRaftMessage(target, {
    type: 'RAFT_INSTALL_SNAPSHOT',
    groupId: this.groupId,
    term: await this._currentTerm(),
    leaderId: this.localEndpoint.uuid,
    snapshot,
  });
}
```

#### 7.3 In `CpStateMachine.ts` — Snapshot Serialization

The `takeSnapshot()` and `restoreFromSnapshot()` methods handle all CP state:

```typescript
takeSnapshot(): Uint8Array {
  // Serialize all state including:
  // - All data structure states (atomiclong, atomicref, semaphore, cdl, lock, cpmap)
  // - Session registry
  // - Group membership
  const snapshot: Record<string, unknown> = {};
  for (const [key, value] of this._state) {
    snapshot[key] = this._serializeValue(key, value);
  }
  return new TextEncoder().encode(JSON.stringify(snapshot));
}

restoreFromSnapshot(data: Uint8Array): void {
  const snapshot = JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>;
  this._state.clear();
  for (const [key, value] of Object.entries(snapshot)) {
    this._state.set(key, this._deserializeValue(key, value));
  }
}
```

**Special handling for FencedLock**: The lock waiter queue contains Promises that cannot be serialized. Solution: waiter queues are NOT part of the snapshot. On snapshot restore, any pending waiters on the restoring node are rejected with `StaleAppendRequestException`. The client retries and gets the current state.

### Testing Strategy

- Test snapshot creation after N commits
- Test snapshot restore: create state, snapshot, clear, restore, verify state matches
- Test follower catch-up via InstallSnapshot: lag a follower, verify it receives snapshot and can participate after restore
- Test that log entries before snapshot index are properly compacted
- Test that FencedLock waiters are correctly handled across snapshot boundaries

### Risks

- **MEDIUM**: Snapshot serialization of complex state (especially FencedLock with waiters and Semaphore with queued acquires).
- **Mitigation**: Waiters are local-only state, not replicated. The snapshot only contains the ownership state, not the wait queues.

---

## Phase 8: CpSubsystemService Rewrite & Integration

**Goal**: Rewrite `CpSubsystemService` to orchestrate the full multi-node CP subsystem while maintaining backward compatibility for single-node mode.

**Dependencies**: All previous phases

### Files to Modify

#### 8.1 `src/cp/impl/CpSubsystemService.ts` — Complete Rewrite

The old private `RaftNode` class is removed entirely. The service becomes an orchestrator:

```typescript
import type { CPSubsystemConfig } from '../../config/CPSubsystemConfig.js';
import type { RaftEndpoint, RaftCommand } from '../raft/types.js';
import { CpGroupManager } from '../raft/CpGroupManager.js';
import { RaftMessageRouter } from '../raft/RaftMessageRouter.js';
import { RaftTransportAdapter } from '../raft/RaftTransportAdapter.js';
import type { TcpClusterTransport } from '../../cluster/tcp/TcpClusterTransport.js';
import { NotLeaderException } from '../raft/errors.js';

// Re-export for backward compat
export type { RaftLogEntry, CpCommand } from '../raft/types.js';
export type { CpGroupState, CpSession } from './types.js'; // Extract to separate file

export class CpSubsystemService {
  static readonly SERVICE_NAME = 'hz:impl:cpSubsystemService';

  private readonly _config: CPSubsystemConfig;
  private readonly _localEndpoint: RaftEndpoint;
  private readonly _multiNodeEnabled: boolean;

  // -- Multi-node components (null when single-node) --
  private _groupManager: CpGroupManager | null = null;
  private _messageRouter: RaftMessageRouter | null = null;
  private _transportAdapter: RaftTransportAdapter | null = null;

  // -- Single-node fallback (preserves existing behavior) --
  private readonly _singleNodeGroups = new Map<string, SingleNodeRaftGroup>();

  // -- Session management (replicated via Raft in multi-node) --
  private readonly _sessions = new Map<string, CpSession>();
  private readonly _sessionCloseListeners: Array<(sessionId: string) => void> = [];
  private _sessionHeartbeatHandle: ReturnType<typeof setInterval> | null = null;
  private _nextSessionId = 1n;
  private _nextThreadId = 1n;

  // -- WaitKey mechanism for blocking operations --
  private readonly _waitKeys = new Map<string, { resolve: (r: unknown) => void; reject: (e: Error) => void; timeoutId?: ReturnType<typeof setTimeout> }>();

  constructor(
    localMemberId: string,
    config: CPSubsystemConfig,
    transport?: TcpClusterTransport,
    cpMembers?: readonly RaftEndpoint[],
  ) {
    this._config = config;
    this._localEndpoint = { uuid: localMemberId, address: { host: '127.0.0.1', port: 0 } };
    this._multiNodeEnabled = config.isEnabled();

    if (this._multiNodeEnabled && transport && cpMembers) {
      this._messageRouter = new RaftMessageRouter();
      this._transportAdapter = new RaftTransportAdapter(transport);
      this._groupManager = new CpGroupManager(
        this._localEndpoint,
        cpMembers,
        config,
        this._transportAdapter,
        this._messageRouter,
      );

      // Wire incoming Raft messages from transport
      const originalOnMessage = transport.onMessage;
      transport.onMessage = async (msg) => {
        const handled = await this._messageRouter!.handleMessage(msg);
        if (!handled) {
          originalOnMessage(msg);
        }
      };
    }

    this._startSessionHeartbeat();
  }

  // -- New unified API for services --

  /**
   * Execute a command through Raft consensus on the appropriate group.
   * In single-node mode, immediately applies. In multi-node, proposes to leader.
   */
  async executeRaftCommand(proxyName: string, command: RaftCommand): Promise<unknown> {
    if (!this._multiNodeEnabled) {
      return this._executeSingleNode(command);
    }

    const groupId = this.resolveGroupId(proxyName);
    const groupInfo = await this._groupManager!.getOrCreateGroup(groupId);
    const node = groupInfo.raftNode;

    if (!node.isLeader()) {
      throw new NotLeaderException(node.getLeader(), groupId);
    }

    const result = await node.propose(command);
    return result;
  }

  /**
   * Perform a linearizable read on the given group and key.
   */
  linearizableRead(groupId: string, key: string): unknown {
    if (!this._multiNodeEnabled) {
      return this._singleNodeRead(groupId, key);
    }

    const groupInfo = this._groupManager!.getGroup(groupId);
    if (!groupInfo) return undefined;
    return groupInfo.stateMachine.getState(key);
  }

  /** Parse "objectName@groupName" -> groupName, or "default" */
  resolveGroupId(proxyName: string): string {
    const idx = proxyName.indexOf('@');
    return idx >= 0 ? proxyName.slice(idx + 1) : 'default';
  }

  /** Parse "objectName@groupName" -> objectName */
  resolveObjectName(proxyName: string): string {
    const idx = proxyName.indexOf('@');
    return idx >= 0 ? proxyName.slice(0, idx) : proxyName;
  }

  // -- Backward-compatible API (delegates to new internals) --

  getOrCreateGroup(groupId: string, members?: string[]): CpGroupState { /* ... */ }
  destroyGroup(groupId: string): void { /* ... */ }
  getGroup(groupId: string): CpGroupState | null { /* ... */ }
  listGroups(): string[] { /* ... */ }
  async executeCommand(command: CpCommand): Promise<unknown> { /* delegate to executeRaftCommand */ }
  readState(groupId: string, key: string): unknown { /* delegate to linearizableRead */ }
  applyStateMutation(groupId: string, key: string, value: unknown): void { /* no-op in multi-node; single-node compat */ }

  // -- Session management --
  createSession(memberId: string): CpSession { /* ... */ }
  heartbeatSession(sessionId: string): boolean { /* ... */ }
  closeSession(sessionId: string): boolean { /* ... */ }
  // ... (same API as current, but in multi-node mode, session ops go through Raft)

  // -- WaitKey support --
  async awaitWaitKey(groupName: string, resourceName: string, sessionId: bigint, threadId: bigint, invocationUid: string): Promise<bigint> { /* ... */ }
  async awaitWaitKeyWithTimeout(groupName: string, resourceName: string, sessionId: bigint, threadId: bigint, invocationUid: string, timeoutMs: number): Promise<bigint> { /* ... */ }
  completeWaitKey(key: string, result: unknown): void { /* ... */ }

  // -- Lifecycle --
  async initialize(): Promise<void> {
    if (this._groupManager) {
      await this._groupManager.initialize();
    }
  }

  shutdown(): void {
    if (this._sessionHeartbeatHandle) clearInterval(this._sessionHeartbeatHandle);
    this._groupManager?.shutdown();
    this._singleNodeGroups.clear();
    this._sessions.clear();
  }

  // -- Single-node fallback (preserves all 5400+ existing tests) --
  private _executeSingleNode(command: RaftCommand): unknown { /* current behavior */ }
  private _singleNodeRead(groupId: string, key: string): unknown { /* current behavior */ }
}
```

**CRITICAL BACKWARD COMPATIBILITY**: When `CPSubsystemConfig.isEnabled() === false` (the default), `CpSubsystemService` operates in exactly the same single-node immediate-commit mode as today. The `_executeSingleNode()` method replicates the current `RaftNode` behavior line-for-line.

### Files to Create

#### 8.2 `src/cp/impl/SingleNodeRaftGroup.ts` — Extracted Single-Node Fallback

Extract the current private `RaftNode` class from `CpSubsystemService.ts` into its own file so it can be used as the single-node fallback:

```typescript
/**
 * Single-node Raft group — immediate commit, no replication.
 * Used when CPSubsystemConfig is not enabled (cpMemberCount < 3).
 * This preserves exact backward compatibility with the current implementation.
 */
export class SingleNodeRaftGroup {
  private _term = 0;
  private _leader: string | null = null;
  private _log: RaftLogEntry[] = [];
  private _commitIndex = -1;
  private _stateMachine: Map<string, unknown> = new Map();
  private _applyListeners: Array<(entry: RaftLogEntry) => void> = [];

  constructor(localMemberId: string, groupMembers: string[]) {
    if (groupMembers.length === 1 || groupMembers[0] === localMemberId) {
      this._leader = localMemberId;
      this._term = 1;
    }
  }

  // ... exact same methods as the current private RaftNode class
}
```

### Integration with HeliosInstanceImpl

The main instance class needs to:
1. Read `CPSubsystemConfig` from `HeliosConfig`
2. Pass it to `CpSubsystemService` constructor
3. Call `cpSubsystemService.initialize()` after cluster formation completes
4. Wire the transport's `onMessage` handler

### Testing Strategy

- **Regression**: Run ALL 5,400+ existing tests. Zero failures allowed.
- **Single-node mode**: Verify that `cpMemberCount=0` (default) produces identical behavior.
- **Multi-node integration**: 3-node cluster with real TCP transport:
  - AtomicLong: concurrent `addAndGet` from 3 nodes, verify final value
  - FencedLock: lock on node A, verify node B blocks, release on A, verify B acquires
  - Semaphore: init(2), acquire on A, acquire on B, third acquire blocks
  - CountDownLatch: set count 3, count down from 3 nodes, verify waiter resolves
  - AtomicReference: CAS from two nodes concurrently, exactly one succeeds
  - CPMap: put/get/remove across nodes
- **Failure tests**: Kill the leader mid-operation, verify new leader elected and uncommitted entries are correctly handled
- **Official client interop**: Run `test/interop/suites/cp.test.ts` against 3-node cluster

### Risks

- **HIGH**: Integration complexity. Many components must work together correctly.
- **Mitigation**: Phase the integration. First get 3-node election working. Then add a single data structure (AtomicLong). Then add the rest one at a time.
- **HIGH**: WaitKey mechanism for blocking operations (locks, semaphores) is complex in multi-node.
- **Mitigation**: Implement non-blocking operations first (AtomicLong, AtomicRef, CPMap). Add blocking operations (Lock, Semaphore, Latch) in a sub-phase.

---

## Cross-Cutting Concerns

### Directory Structure (final)

```
src/cp/
  CPMap.ts                     (unchanged — interface)
  impl/
    CpSubsystemService.ts     (rewritten — orchestrator)
    SingleNodeRaftGroup.ts     (new — extracted from old RaftNode)
    AtomicLongService.ts       (rewritten — thin Raft wrapper)
    AtomicReferenceService.ts  (rewritten — thin Raft wrapper)
    FencedLockService.ts       (rewritten — thin Raft wrapper)
    SemaphoreService.ts        (rewritten — thin Raft wrapper)
    CountDownLatchService.ts   (rewritten — thin Raft wrapper)
    CPMapService.ts            (rewritten — thin Raft wrapper)
    cpmap/                     (unchanged — empty)
  raft/
    types.ts                   (new — core Raft types)
    errors.ts                  (new — CP exception hierarchy)
    messages.ts                (new — Raft protocol messages)
    RaftNode.ts                (new — core Raft algorithm)
    RaftStateMachine.ts        (new — state machine interface)
    RaftStateStore.ts          (new — persistence interface)
    InMemoryRaftStateStore.ts  (new — in-memory implementation)
    CpStateMachine.ts          (new — unified CP state machine)
    CpGroupManager.ts          (new — CP group lifecycle)
    RaftTransportAdapter.ts    (new — bridge to TcpClusterTransport)
    RaftMessageRouter.ts       (new — incoming message router)
src/config/
    CPSubsystemConfig.ts       (new)
    RaftAlgorithmConfig.ts     (new)
    HeliosConfig.ts            (modified — add CP config)
src/cluster/tcp/
    ClusterMessage.ts          (modified — add Raft message types)
```

### Execution Order & Dependencies

```
Phase 1: Types & Config           [no dependencies]
    ↓
Phase 2: State Store              [depends on Phase 1]
    ↓
Phase 3: Core Raft Algorithm      [depends on Phase 1, 2]
    ↓
Phase 4: Network Transport        [depends on Phase 1, 3]
    ↓
Phase 5: Group Lifecycle          [depends on Phase 3, 4]
    ↓
Phase 6: Data Structure Migration [depends on Phase 3, 5]
    ↓
Phase 7: Snapshots                [depends on Phase 3, 5]
    ↓
Phase 8: Integration              [depends on ALL]
```

Phases 6 and 7 can be developed in parallel since they have the same dependencies.

### Implementation Priority Within Phase 6

Migrate data structures in this order (simplest to most complex):
1. **CPMap** — pure key-value, no sessions, no blocking
2. **AtomicLong** — simple typed operations, no blocking
3. **AtomicReference** — similar to AtomicLong
4. **CountDownLatch** — has waiting but simple state
5. **Semaphore** — session-aware, queued waiters
6. **FencedLock** — most complex: reentrant, fenced, session-aware, queued

### Raft Safety Invariants to Verify in Tests

These invariants from the Raft paper MUST hold. Implement assertion checks:

1. **Election Safety**: At most one leader per term across all nodes.
2. **Leader Append-Only**: A leader never overwrites or deletes entries in its log; it only appends.
3. **Log Matching**: If two logs contain an entry with the same index and term, the logs are identical in all entries through that index.
4. **Leader Completeness**: If an entry is committed in a given term, that entry will be present in the logs of all leaders for all higher-numbered terms.
5. **State Machine Safety**: If a server has applied a log entry at a given index, no other server will apply a different entry at that index.

### Performance Considerations

- **Log entry serialization**: Use structured clone or CBOR instead of JSON for Raft log entries in the binary wire format. JSON is fine for snapshots (less frequent).
- **Batched AppendEntries**: Send up to `appendRequestMaxEntryCount` (100) entries per AppendRequest to reduce message count.
- **Pipeline**: Don't wait for AppendResponse before sending next batch. Use the `nextIndex`/`matchIndex` tracking.
- **ReadIndex optimization** (future): For reads, the leader can skip a full log entry by just sending heartbeats to confirm leadership. Not in initial implementation.

### Error Handling at the Client Protocol Layer

The existing `CpServiceHandlers.ts` does NOT need modification for the protocol. However, it needs to handle new error types:

- `NotLeaderException` → The handler should catch this and either:
  - Return the leader hint in an error response (Hazelcast protocol has error encoding)
  - Internally redirect to the leader (requires knowing the leader's client endpoint)
  
- `CannotReplicateException` → Return a retryable error to the client
- `CPGroupDestroyedException` → Return a terminal error to the client

This is handled by wrapping the service call in a try/catch in the handler registration. The existing handlers in `CpServiceHandlers.ts` call the service methods via the `ServiceOperations` interfaces, so the service methods themselves throw these errors.

### Migration Safety Net

To ensure zero regression:

1. **Feature flag**: `CPSubsystemConfig.isEnabled()` (cpMemberCount >= 3)
2. **When disabled** (default): `CpSubsystemService` uses `SingleNodeRaftGroup` — exact current behavior
3. **When enabled**: `CpSubsystemService` uses real `RaftNode` + `CpGroupManager`
4. **All existing tests** run with the disabled path — guaranteed zero breakage
5. **New multi-node tests** run with the enabled path — tests the new implementation

---

## Summary

| Phase | Files Created | Files Modified | Risk Level | Est. LOC |
|-------|--------------|----------------|------------|----------|
| 1: Types & Config | 4 | 1 | Low | 350 |
| 2: State Store | 2 | 0 | Low | 250 |
| 3: Core Raft | 3 | 0 | **High** | 1200 |
| 4: Transport | 3 | 1 | Medium | 350 |
| 5: Group Lifecycle | 2 | 0 | Medium | 500 |
| 6: Data Structures | 0 | 6 | **High** | 800 |
| 7: Snapshots | 0 | 2 | Medium | 200 |
| 8: Integration | 2 | 1 | **High** | 600 |
| **Total** | **16** | **11** | | **~4,250** |

The plan is designed to be incrementally testable at each phase boundary, with zero regression risk until Phase 8 integration, which is guarded by a feature flag.
