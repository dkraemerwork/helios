import type { RaftAlgorithmConfig } from '../../config/RaftAlgorithmConfig.js';
import {
  CannotReplicateException,
  CPGroupDestroyedException,
  LeaderDemotedException,
  NotLeaderException,
} from './errors.js';
import type {
  AppendFailureResponse,
  AppendRequest,
  AppendSuccessResponse,
  InstallSnapshotRequest,
  InstallSnapshotResponse,
  PreVoteRequest,
  PreVoteResponse,
  RaftMessage,
  VoteRequest,
  VoteResponse,
} from './messages.js';
import type { RaftStateMachine } from './RaftStateMachine.js';
import type { RaftStateStore } from './RaftStateStore.js';
import type {
  PendingProposal,
  RaftCommand,
  RaftEndpoint,
  RaftLogEntry,
  RaftProposalResult,
  RaftRole,
  SnapshotEntry,
} from './types.js';

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

/**
 * Core Raft consensus node implementing the Raft paper (Sections 5.1-5.4)
 * plus the Pre-Vote extension to prevent disruptive elections.
 *
 * Lifecycle:
 *   1. Construct with RaftNodeConfig
 *   2. Call setSender() to wire up the network layer
 *   3. Call start() — loads durable state and starts the election timer
 *   4. Route incoming messages to the appropriate handle* method
 *   5. Call shutdown() to clean up
 *
 * Thread/concurrency note: All methods are synchronous from the perspective
 * of the caller; async operations (store I/O) are fire-and-forget where safe,
 * or awaited in start(). This class must be driven from a single event-loop
 * tick at a time (no re-entrant calls).
 */
export class RaftNode {
  // ── Identity ────────────────────────────────────────────────────────────────
  private readonly _groupId: string;
  private readonly _localEndpoint: RaftEndpoint;
  private _members: RaftEndpoint[];

  // ── Configuration ───────────────────────────────────────────────────────────
  private readonly _config: RaftAlgorithmConfig;

  // ── Durable storage & state machine ─────────────────────────────────────────
  private readonly _store: RaftStateStore;
  private readonly _stateMachine: RaftStateMachine;

  // ── Network ─────────────────────────────────────────────────────────────────
  private _sender: RaftMessageSender | null = null;

  // ── Volatile Raft state ──────────────────────────────────────────────────────
  private _role: RaftRole = 'FOLLOWER';
  private _currentTerm = 0;           // Cached from persistent store; updated on every write
  private _votedFor: string | null = null;
  private _leader: RaftEndpoint | null = null;
  private _commitIndex = -1;
  private _lastApplied = -1;

  // ── Election pre-vote state ──────────────────────────────────────────────────
  private _inPreVote = false;
  private _preVoteTerm = 0;

  // ── Candidate vote state ─────────────────────────────────────────────────────

  // ── Leader-only: replication state (per follower) ────────────────────────────
  /** Next log index to send to each peer. */
  private _nextIndex: Map<string, number> = new Map();
  /** Highest log index known to be replicated on each peer. */
  private _matchIndex: Map<string, number> = new Map();

  // ── Leader-only: pending client proposals ────────────────────────────────────
  /** Keyed by log index of the proposed entry. */
  private _pendingProposals: Map<number, PendingProposal> = new Map();

  // ── Snapshot tracking ───────────────────────────────────────────────────────
  private _lastSnapshotIndex = -1;

  // ── Timers ──────────────────────────────────────────────────────────────────
  private _electionTimer: ReturnType<typeof setTimeout> | null = null;
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // ── Liveness ────────────────────────────────────────────────────────────────
  /** Timestamp (ms) of the last AppendEntries or InstallSnapshot from the leader. */
  private _lastLeaderHeartbeat = 0;
  /** Set to true after shutdown(); prevents any further state changes. */
  private _destroyed = false;

  // ────────────────────────────────────────────────────────────────────────────

  constructor(cfg: RaftNodeConfig) {
    this._groupId = cfg.groupId;
    this._localEndpoint = cfg.localEndpoint;
    this._members = [...cfg.initialMembers];
    this._config = cfg.config;
    this._store = cfg.stateStore;
    this._stateMachine = cfg.stateMachine;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  /**
   * Loads durable state from the store and starts the election timer.
   * Must be awaited before the node participates in the protocol.
   */
  async start(): Promise<void> {
    if (this._destroyed) {
      throw new CPGroupDestroyedException(this._groupId);
    }

    const { term, votedFor } = await this._store.readTermAndVote();
    this._currentTerm = term;
    this._votedFor = votedFor;

    const snapshot = await this._store.readSnapshot();
    if (snapshot !== null) {
      this._lastSnapshotIndex = snapshot.index;
      this._commitIndex = snapshot.index;
      this._lastApplied = snapshot.index;
      this._members = [...snapshot.groupMembers];
      this._stateMachine.restoreFromSnapshot(snapshot.data);
    }

    this._resetElectionTimer();
  }

  /**
   * Shuts down the node, cancels all timers, and rejects pending proposals.
   */
  shutdown(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    this._clearElectionTimer();
    this._clearHeartbeatTimer();

    this._rejectPendingProposals(
      new CPGroupDestroyedException(this._groupId),
    );
  }

  /** Wire up the outbound message sender. Must be called before start(). */
  setSender(sender: RaftMessageSender): void {
    this._sender = sender;
  }

  // ── Getters ──────────────────────────────────────────────────────────────────

  getRole(): RaftRole {
    return this._role;
  }

  getLeader(): RaftEndpoint | null {
    return this._leader;
  }

  getTerm(): number {
    return this._currentTerm;
  }

  getCommitIndex(): number {
    return this._commitIndex;
  }

  getMembers(): readonly RaftEndpoint[] {
    return this._members;
  }

  isLeader(): boolean {
    return this._role === 'LEADER';
  }

  // ── Client API ───────────────────────────────────────────────────────────────

  /**
   * Proposes a command for replication. Only the leader can accept proposals.
   *
   * Returns a promise that resolves with the committed result, or rejects if
   * the leader steps down before the entry commits.
   */
  propose(command: RaftCommand): Promise<RaftProposalResult> {
    if (this._destroyed) {
      return Promise.reject(new CPGroupDestroyedException(this._groupId));
    }
    if (this._role !== 'LEADER') {
      return Promise.reject(new NotLeaderException(this._leader, this._groupId));
    }

    const uncommitted = this._store.lastLogIndex() - this._commitIndex;
    if (uncommitted >= this._config.getUncommittedEntryCountToRejectNewAppends()) {
      return Promise.reject(new CannotReplicateException(this._groupId));
    }

    const nextIndex = this._store.lastLogIndex() + 1;
    const entry: RaftLogEntry = {
      term: this._currentTerm,
      index: nextIndex,
      command,
    };

    // Fire-and-forget the append; we keep things synchronous from the caller
    // perspective. The store update completes before we broadcast.
    void this._store.appendEntries([entry]);

    // Single-member cluster: immediately commit and apply.
    if (this._members.length === 1) {
      this._commitIndex = nextIndex;
      const result = this._stateMachine.apply(entry.command);
      this._lastApplied = nextIndex;
      this._maybeTakeSnapshot();
      return Promise.resolve({ commitIndex: this._commitIndex, result });
    }

    // Multi-member: queue the proposal and replicate.
    const promise = new Promise<RaftProposalResult>((resolve, reject) => {
      const proposal: PendingProposal = { entry, resolve, reject };
      this._pendingProposals.set(nextIndex, proposal);
    });

    this._broadcastAppendEntries();
    return promise;
  }

  /**
   * Linearizable read: routes through the commit pipeline to guarantee
   * we are reading from an up-to-date committed state.
   *
   * For a single-member cluster the read is applied directly.
   * For multi-member clusters, a NOP barrier entry is committed first.
   */
  linearizableRead(key: string): Promise<RaftProposalResult> {
    if (this._destroyed) {
      return Promise.reject(new CPGroupDestroyedException(this._groupId));
    }

    if (this._members.length === 1) {
      const result = this._stateMachine.apply({
        type: 'LINEARIZABLE_READ',
        groupId: this._groupId,
        key,
        payload: null,
      });
      return Promise.resolve({ commitIndex: this._commitIndex, result });
    }

    // Multi-member: propose a LINEARIZABLE_READ command through the commit pipeline.
    // This guarantees linearizability (the command is committed at a specific log index)
    // and returns the actual state value when the state machine applies it.
    const readCmd: RaftCommand = {
      type: 'LINEARIZABLE_READ',
      groupId: this._groupId,
      key,
      payload: null,
    };
    return this.propose(readCmd);
  }

  // ── Pre-vote message handlers ─────────────────────────────────────────────

  /**
   * Handles an incoming PreVoteRequest.
   *
   * Grants the pre-vote if all of the following hold:
   *   - The candidate's next term is greater than our current term.
   *   - We currently have no leader or the leader has timed out.
   *   - The candidate's log is at least as up-to-date as ours.
   */
  handlePreVoteRequest(msg: PreVoteRequest): PreVoteResponse {
    const granted =
      msg.nextTerm > this._currentTerm &&
      this._leaderHasTimedOut() &&
      this._isLogUpToDate(msg.lastLogTerm, msg.lastLogIndex);

    return {
      type: 'RAFT_PRE_VOTE_RESPONSE',
      groupId: this._groupId,
      term: this._currentTerm,
      granted,
      voterId: this._localEndpoint.uuid,
    };
  }

  /**
   * Handles an incoming PreVoteResponse.
   * When a quorum of pre-votes is collected, transitions to a real election.
   */
  handlePreVoteResponse(msg: PreVoteResponse): void {
    if (this._destroyed) return;
    if (!this._inPreVote) return;
    if (msg.term > this._currentTerm) {
      // We're out of date; abandon the pre-vote campaign.
      this._becomeFollower(msg.term, null);
      return;
    }
    if (!msg.granted) return;

    this._preVoteGrantedVoters.add(msg.voterId);

    if (this._preVoteGrantedVoters.size >= this._quorumSize()) {
      this._inPreVote = false;
      this._startElection();
    }
  }

  // ── Vote message handlers ─────────────────────────────────────────────────

  /**
   * Handles an incoming VoteRequest (real election).
   *
   * Grants if:
   *   - msg.term >= currentTerm
   *   - We haven't voted yet, or we already voted for this candidate
   *   - Candidate's log is at least as up-to-date as ours
   */
  handleVoteRequest(msg: VoteRequest): VoteResponse {
    if (this._destroyed) {
      return {
        type: 'RAFT_VOTE_RESPONSE',
        groupId: this._groupId,
        term: this._currentTerm,
        voteGranted: false,
        voterId: this._localEndpoint.uuid,
      };
    }

    if (msg.term > this._currentTerm) {
      this._becomeFollower(msg.term, null);
    }

    const logOk = this._isLogUpToDate(msg.lastLogTerm, msg.lastLogIndex);
    const canVote =
      msg.term === this._currentTerm &&
      (this._votedFor === null || this._votedFor === msg.candidateId) &&
      logOk;

    if (canVote) {
      this._votedFor = msg.candidateId;
      void this._store.persistTermAndVote(this._currentTerm, this._votedFor);
      // Reset election timer: we just acknowledged a valid candidate.
      this._resetElectionTimer();
    }

    return {
      type: 'RAFT_VOTE_RESPONSE',
      groupId: this._groupId,
      term: this._currentTerm,
      voteGranted: canVote,
      voterId: this._localEndpoint.uuid,
    };
  }

  /**
   * Handles an incoming VoteResponse.
   * Transitions to leader when a quorum of votes is collected.
   */
  handleVoteResponse(msg: VoteResponse): void {
    if (this._destroyed) return;

    if (msg.term > this._currentTerm) {
      this._becomeFollower(msg.term, null);
      return;
    }

    if (this._role !== 'CANDIDATE') return;
    if (msg.term !== this._currentTerm) return;
    if (!msg.voteGranted) return;

    this._votesGrantedVoters.add(msg.voterId);

    if (this._votesGrantedVoters.size >= this._quorumSize()) {
      this._becomeLeader();
    }
  }

  // ── AppendEntries message handlers ───────────────────────────────────────

  /**
   * Handles an AppendEntries RPC from the current leader.
   * Implements log consistency check, conflict resolution, and commit advance.
   */
  handleAppendRequest(msg: AppendRequest): AppendSuccessResponse | AppendFailureResponse {
    if (this._destroyed) {
      return this._appendFailure(this._localEndpoint.uuid);
    }

    // Reject stale messages.
    if (msg.term < this._currentTerm) {
      return this._appendFailure(this._localEndpoint.uuid);
    }

    // Step down if we see a higher term, or if we're a candidate in the same term.
    if (msg.term > this._currentTerm || this._role === 'CANDIDATE') {
      const leaderEndpoint = this._findEndpoint(msg.leaderId);
      this._becomeFollower(msg.term, leaderEndpoint);
    }

    // Acknowledge the leader.
    this._lastLeaderHeartbeat = Date.now();
    const leaderEndpoint = this._findEndpoint(msg.leaderId);
    if (leaderEndpoint !== null) {
      this._leader = leaderEndpoint;
    }

    // Log consistency check: prevLogIndex == -1 means the leader is sending
    // from the very beginning (no previous entry to check).
    if (msg.prevLogIndex >= 0) {
      const localLastIndex = this._store.lastLogIndex();
      if (localLastIndex < msg.prevLogIndex) {
        // We are missing entries before prevLogIndex.
        return {
          type: 'RAFT_APPEND_FAILURE',
          groupId: this._groupId,
          term: this._currentTerm,
          followerId: this._localEndpoint.uuid,
          lastLogIndex: localLastIndex,
        };
      }
      const termAtPrev = this._store.termAt(msg.prevLogIndex);
      if (termAtPrev !== msg.prevLogTerm) {
        // Conflict: our entry at prevLogIndex is from a different term.
        // Hint the leader to back up to before the conflicting term.
        const hintIndex = this._findFirstIndexOfTerm(termAtPrev, msg.prevLogIndex) - 1;
        return {
          type: 'RAFT_APPEND_FAILURE',
          groupId: this._groupId,
          term: this._currentTerm,
          followerId: this._localEndpoint.uuid,
          lastLogIndex: Math.max(hintIndex, this._commitIndex),
        };
      }
    }

    // Append new entries, resolving any conflicts.
    if (msg.entries.length > 0) {
      const firstNewIndex = msg.prevLogIndex + 1;

      // Detect and truncate any conflicting suffix in our log.
      let truncateAt = -1;
      for (const entry of msg.entries) {
        if (entry.index <= this._store.lastLogIndex()) {
          const existingTerm = this._store.termAt(entry.index);
          if (existingTerm !== entry.term) {
            truncateAt = entry.index - 1;
            break;
          }
        }
      }
      if (truncateAt >= 0) {
        void this._store.truncateAfter(truncateAt);
      }

      // Filter out entries we already have (no conflict, just duplicates).
      const toAppend = msg.entries.filter(
        (e) => e.index > Math.max(truncateAt >= 0 ? truncateAt : -1, firstNewIndex - 1),
      );
      if (toAppend.length > 0 || truncateAt >= 0) {
        // After truncation, all remaining entries from firstNewIndex are new.
        const appendFrom = truncateAt >= 0 ? truncateAt + 1 : firstNewIndex;
        const newEntries = msg.entries.filter((e) => e.index >= appendFrom);
        if (newEntries.length > 0) {
          void this._store.appendEntries(newEntries);
        }
      }
    }

    // Advance commit index.
    const lastNewIndex =
      msg.entries.length > 0
        ? msg.entries[msg.entries.length - 1]!.index
        : msg.prevLogIndex;

    if (msg.leaderCommit > this._commitIndex) {
      this._commitIndex = Math.min(msg.leaderCommit, lastNewIndex);
      this._applyCommitted();
    }

    return {
      type: 'RAFT_APPEND_SUCCESS',
      groupId: this._groupId,
      term: this._currentTerm,
      followerId: this._localEndpoint.uuid,
      lastLogIndex: this._store.lastLogIndex(),
    };
  }

  /**
   * Handles a success or failure response from a follower to AppendEntries.
   * Called on the leader only.
   */
  handleAppendResponse(
    msg: AppendSuccessResponse | AppendFailureResponse,
  ): void {
    if (this._destroyed) return;

    if (msg.term > this._currentTerm) {
      this._becomeFollower(msg.term, null);
      return;
    }

    if (this._role !== 'LEADER') return;
    if (msg.term !== this._currentTerm) return;

    const followerId = msg.followerId;
    const followerEndpoint = this._findEndpoint(followerId);
    if (followerEndpoint === null) return;

    if (msg.type === 'RAFT_APPEND_SUCCESS') {
      const prevMatch = this._matchIndex.get(followerId) ?? -1;
      if (msg.lastLogIndex > prevMatch) {
        this._matchIndex.set(followerId, msg.lastLogIndex);
        this._nextIndex.set(followerId, msg.lastLogIndex + 1);
      }
      this._advanceCommitIndex();
    } else {
      // Failure: back up nextIndex using follower's hint.
      const currentNext = this._nextIndex.get(followerId) ?? 0;
      const hintedNext = msg.lastLogIndex + 1;
      const newNext = Math.min(currentNext - 1, hintedNext);

      const snapshotIndex = this._lastSnapshotIndex;
      if (newNext <= snapshotIndex) {
        // Follower is behind our snapshot — send InstallSnapshot instead.
        this._sendInstallSnapshot(followerEndpoint);
      } else {
        this._nextIndex.set(followerId, Math.max(snapshotIndex + 1, newNext));
        this._sendAppendEntries(followerEndpoint);
      }
    }
  }

  // ── InstallSnapshot message handlers ────────────────────────────────────

  /**
   * Handles an InstallSnapshot RPC from the leader.
   * Restores the state machine and resets log state.
   */
  handleInstallSnapshot(msg: InstallSnapshotRequest): InstallSnapshotResponse {
    if (this._destroyed) {
      return {
        type: 'RAFT_INSTALL_SNAPSHOT_RESPONSE',
        groupId: this._groupId,
        term: this._currentTerm,
        followerId: this._localEndpoint.uuid,
        success: false,
        lastLogIndex: this._store.lastLogIndex(),
      };
    }

    if (msg.term < this._currentTerm) {
      return {
        type: 'RAFT_INSTALL_SNAPSHOT_RESPONSE',
        groupId: this._groupId,
        term: this._currentTerm,
        followerId: this._localEndpoint.uuid,
        success: false,
        lastLogIndex: this._store.lastLogIndex(),
      };
    }

    if (msg.term > this._currentTerm) {
      const leaderEndpoint = this._findEndpoint(msg.leaderId);
      this._becomeFollower(msg.term, leaderEndpoint);
    }

    this._lastLeaderHeartbeat = Date.now();
    const leaderEndpoint = this._findEndpoint(msg.leaderId);
    if (leaderEndpoint !== null) {
      this._leader = leaderEndpoint;
    }

    const snapshot = msg.snapshot;

    // Only apply the snapshot if it's newer than our current state.
    if (snapshot.index <= this._commitIndex) {
      return {
        type: 'RAFT_INSTALL_SNAPSHOT_RESPONSE',
        groupId: this._groupId,
        term: this._currentTerm,
        followerId: this._localEndpoint.uuid,
        success: true,
        lastLogIndex: this._store.lastLogIndex(),
      };
    }

    // Restore state machine and persist.
    this._stateMachine.restoreFromSnapshot(snapshot.data);
    void this._store.persistSnapshot(snapshot);

    this._commitIndex = snapshot.index;
    this._lastApplied = snapshot.index;
    this._lastSnapshotIndex = snapshot.index;
    this._members = [...snapshot.groupMembers];
    this._stateMachine.onGroupMembersChanged(this._members);

    this._resetElectionTimer();

    return {
      type: 'RAFT_INSTALL_SNAPSHOT_RESPONSE',
      groupId: this._groupId,
      term: this._currentTerm,
      followerId: this._localEndpoint.uuid,
      success: true,
      lastLogIndex: this._store.lastLogIndex(),
    };
  }

  /**
   * Handles a response to an InstallSnapshot RPC from a follower.
   * Updates replication state for that follower.
   */
  handleInstallSnapshotResponse(msg: InstallSnapshotResponse): void {
    if (this._destroyed) return;

    if (msg.term > this._currentTerm) {
      this._becomeFollower(msg.term, null);
      return;
    }

    if (this._role !== 'LEADER') return;
    if (msg.term !== this._currentTerm) return;

    const followerId = msg.followerId;
    if (!msg.success) return;

    const prevMatch = this._matchIndex.get(followerId) ?? -1;
    if (msg.lastLogIndex > prevMatch) {
      this._matchIndex.set(followerId, msg.lastLogIndex);
      this._nextIndex.set(followerId, msg.lastLogIndex + 1);
    }

    this._advanceCommitIndex();
  }

  /**
   * External trigger to force an election (e.g. leadership transfer).
   * Immediately starts the pre-vote phase.
   */
  handleTriggerLeaderElection(): void {
    if (this._destroyed) return;
    this._startPreVote();
  }

  // ── Internal timer management ────────────────────────────────────────────

  private _resetElectionTimer(): void {
    this._clearElectionTimer();
    if (this._destroyed) return;

    const base = this._config.getLeaderElectionTimeoutInMillis();
    const jitter = Math.floor(Math.random() * base);
    const timeout = base + jitter;

    this._electionTimer = setTimeout(() => {
      this._electionTimer = null;
      this._onElectionTimeout();
    }, timeout);
  }

  private _clearElectionTimer(): void {
    if (this._electionTimer !== null) {
      clearTimeout(this._electionTimer);
      this._electionTimer = null;
    }
  }

  private _clearHeartbeatTimer(): void {
    if (this._heartbeatTimer !== null) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  private _onElectionTimeout(): void {
    if (this._destroyed) return;
    if (this._role === 'LEADER') return; // Leaders don't time out.
    this._startPreVote();
  }

  // ── Election phases ──────────────────────────────────────────────────────

  /**
   * Phase 1 — Pre-vote: Sound out peers without incrementing the term.
   * Prevents nodes that were partitioned from disrupting a stable cluster.
   */
  private _startPreVote(): void {
    if (this._destroyed) return;

    this._inPreVote = true;
    this._preVoteGrantedVoters = new Set();
    this._preVoteTerm = this._currentTerm + 1;

    // Single-member cluster skips pre-vote entirely.
    if (this._members.length === 1) {
      this._inPreVote = false;
      this._startElection();
      return;
    }

    // Vote for self immediately.
    this._preVoteGrantedVoters.add(this._localEndpoint.uuid);

    const req: PreVoteRequest = {
      type: 'RAFT_PRE_VOTE_REQUEST',
      groupId: this._groupId,
      candidateId: this._localEndpoint.uuid,
      nextTerm: this._preVoteTerm,
      lastLogTerm: this._store.lastLogTerm(),
      lastLogIndex: this._store.lastLogIndex(),
    };

    for (const peer of this._peers()) {
      this._send(peer, req);
    }

    // Reset election timer so we retry if pre-vote doesn't complete.
    this._resetElectionTimer();
  }

  /**
   * Phase 2 — Real election: Increment term, vote for self, ask peers for votes.
   */
  private _startElection(): void {
    if (this._destroyed) return;

    this._currentTerm++;
    this._votedFor = this._localEndpoint.uuid;
    void this._store.persistTermAndVote(this._currentTerm, this._votedFor);

    this._role = 'CANDIDATE';
    this._leader = null;
    this._votesGrantedVoters = new Set();
    this._votesGrantedVoters.add(this._localEndpoint.uuid);

    this._resetElectionTimer();

    // Single-member cluster wins immediately.
    if (this._members.length === 1) {
      this._becomeLeader();
      return;
    }

    const req: VoteRequest = {
      type: 'RAFT_VOTE_REQUEST',
      groupId: this._groupId,
      term: this._currentTerm,
      candidateId: this._localEndpoint.uuid,
      lastLogTerm: this._store.lastLogTerm(),
      lastLogIndex: this._store.lastLogIndex(),
    };

    for (const peer of this._peers()) {
      this._send(peer, req);
    }
  }

  // ── Role transitions ─────────────────────────────────────────────────────

  private _becomeLeader(): void {
    if (this._destroyed) return;

    this._role = 'LEADER';
    this._leader = this._localEndpoint;
    this._inPreVote = false;

    this._clearElectionTimer();

    // Initialise per-follower replication state.
    const nextIdx = this._store.lastLogIndex() + 1;
    for (const peer of this._peers()) {
      this._nextIndex.set(peer.uuid, nextIdx);
      this._matchIndex.set(peer.uuid, -1);
    }

    // Start heartbeat timer.
    this._clearHeartbeatTimer();
    const heartbeatMs = this._config.getLeaderHeartbeatPeriodInMillis();
    this._heartbeatTimer = setInterval(() => {
      if (this._destroyed || this._role !== 'LEADER') {
        this._clearHeartbeatTimer();
        return;
      }
      this._broadcastAppendEntries();
    }, heartbeatMs);

    // Propose a NOP to commit any entries from previous terms.
    // We can't directly call propose() here because we may not want the
    // NOP to flow through the public API (no-op is internal). We append
    // it directly.
    //
    // Race-condition analysis: although appendEntries() is declared async,
    // InMemoryRaftStateStore pushes to _log synchronously — the async
    // signature is only a contractual requirement of RaftStateStore. The
    // array mutation completes before the returned Promise is even
    // constructed, so lastLogIndex() already reflects nopIndex by the time
    // the next line executes.  A concurrent propose() call in the same
    // microtask tick will therefore read nopIndex + 1 as its nextIndex and
    // will not collide with the NOP entry.  Durable (disk-backed) store
    // implementations must uphold the same invariant: the entry must be
    // visible via lastLogIndex() before the Promise resolves.
    const nopIndex = this._store.lastLogIndex() + 1;
    const nopEntry: RaftLogEntry = {
      term: this._currentTerm,
      index: nopIndex,
      command: {
        type: 'NOP',
        groupId: this._groupId,
        key: '',
        payload: null,
      },
    };
    void this._store.appendEntries([nopEntry]);

    // Broadcast immediately so followers learn about the new leader quickly.
    this._broadcastAppendEntries();
  }

  /**
   * Steps down to follower, updates term, and rejects all in-flight proposals.
   */
  private _becomeFollower(term: number, leader: RaftEndpoint | null): void {
    const wasLeader = this._role === 'LEADER';

    this._role = 'FOLLOWER';
    this._leader = leader;

    if (term > this._currentTerm) {
      this._currentTerm = term;
      this._votedFor = null;
      void this._store.persistTermAndVote(this._currentTerm, null);
    }

    this._clearHeartbeatTimer();
    this._resetElectionTimer();

    if (wasLeader) {
      this._rejectPendingProposals(
        new LeaderDemotedException(this._groupId, this._currentTerm),
      );
    }
  }

  // ── Replication helpers (leader-only) ────────────────────────────────────

  /**
   * Sends AppendEntries to a specific peer, or InstallSnapshot if the peer
   * is behind the last snapshot.
   */
  private _sendAppendEntries(target: RaftEndpoint): void {
    if (this._sender === null) return;

    const nextIdx = this._nextIndex.get(target.uuid) ?? this._store.lastLogIndex() + 1;
    const snapshotIndex = this._lastSnapshotIndex;

    // Follower needs entries that have been compacted — install snapshot.
    if (nextIdx <= snapshotIndex) {
      this._sendInstallSnapshot(target);
      return;
    }

    const prevLogIndex = nextIdx - 1;
    const prevLogTerm = prevLogIndex < 0 ? 0 : this._store.termAt(prevLogIndex);
    const lastLogIdx = this._store.lastLogIndex();

    const maxEntries = this._config.getAppendRequestMaxEntryCount();
    const toIndex = Math.min(lastLogIdx, nextIdx + maxEntries - 1);

    // Gather entries synchronously via the synchronous-capable API.
    // The store's readEntries is async, but we need to send synchronously.
    // We batch-load entries using an immediate IIFE to keep the hot path fast.
    // For the in-memory store the promise resolves synchronously; for durable
    // stores this is fire-and-forget with the send happening in the callback.
    void this._store.readEntries(nextIdx, toIndex).then((entries) => {
      if (this._destroyed || this._role !== 'LEADER') return;

      const req: AppendRequest = {
        type: 'RAFT_APPEND_REQUEST',
        groupId: this._groupId,
        term: this._currentTerm,
        leaderId: this._localEndpoint.uuid,
        prevLogIndex,
        prevLogTerm,
        entries,
        leaderCommit: this._commitIndex,
      };

      this._sender!.sendRaftMessage(target, req);
    });
  }

  /** Sends AppendEntries to all peers. */
  private _broadcastAppendEntries(): void {
    for (const peer of this._peers()) {
      this._sendAppendEntries(peer);
    }
  }

  /**
   * Advances the commit index on the leader by checking the median matchIndex.
   *
   * Safety rule (Raft §5.4.2): only commit entries from the current term.
   * Entries from previous terms are committed implicitly when a current-term
   * entry is committed.
   */
  private _advanceCommitIndex(): void {
    if (this._role !== 'LEADER') return;

    // Collect matchIndex for all members (including self = lastLogIndex).
    const indices: number[] = [this._store.lastLogIndex()];
    for (const peer of this._peers()) {
      indices.push(this._matchIndex.get(peer.uuid) ?? -1);
    }

    // Sort ascending; the value at position (quorumSize - 1) is the highest
    // index replicated on a quorum of nodes.
    indices.sort((a, b) => a - b);
    const quorumIdx = indices.length - this._quorumSize();
    const newCommit = indices[quorumIdx] ?? -1;

    if (
      newCommit > this._commitIndex &&
      this._store.termAt(newCommit) === this._currentTerm
    ) {
      this._commitIndex = newCommit;
      this._applyCommitted();
      // Snapshot is taken inside _applyCommitted() after each entry is applied,
      // ensuring the state machine is up-to-date before snapshot data is captured.
    }
  }

  /** Sends an InstallSnapshot RPC to the given peer. */
  private _sendInstallSnapshot(target: RaftEndpoint): void {
    if (this._sender === null) return;

    void this._store.readSnapshot().then((snapshot) => {
      if (this._destroyed || this._role !== 'LEADER') return;
      if (snapshot === null) return;

      const req: InstallSnapshotRequest = {
        type: 'RAFT_INSTALL_SNAPSHOT',
        groupId: this._groupId,
        term: this._currentTerm,
        leaderId: this._localEndpoint.uuid,
        snapshot,
      };

      this._sender!.sendRaftMessage(target, req);
    });
  }

  // ── State machine application ────────────────────────────────────────────

  /**
   * Applies all log entries from lastApplied+1 through commitIndex to the
   * state machine in order, resolving any pending proposals for each entry.
   *
   * Entries are read via a sequential promise chain so that, regardless of
   * whether the store is synchronous (InMemoryRaftStateStore) or async
   * (disk-backed), application order is always preserved and `_lastApplied`
   * is advanced exactly once per entry after it has been applied.
   */
  private _applyCommitted(): void {
    // Snapshot the target so that recursive calls or re-entrant advances
    // don't overshoot.
    const upTo = this._commitIndex;

    const applyNext = (index: number): void => {
      if (index > upTo || index > this._commitIndex) return;

      void this._store.readEntry(index).then((entry) => {
        if (entry === null) {
          // Entry is missing (should not happen in a correct implementation).
          // Skip it to avoid stalling the apply pipeline.
          this._lastApplied = index;
          applyNext(index + 1);
          return;
        }

        const result = this._stateMachine.apply(entry.command);
        this._lastApplied = index;

        const proposal = this._pendingProposals.get(index);
        if (proposal !== undefined) {
          this._pendingProposals.delete(index);
          proposal.resolve({ commitIndex: index, result });
        }

        // Followers (and candidates) also need to take snapshots for memory
        // efficiency — prevents unbounded log growth on non-leader nodes.
        this._maybeTakeSnapshot();

        applyNext(index + 1);
      });
    };

    if (this._lastApplied < upTo) {
      applyNext(this._lastApplied + 1);
    }
  }

  // ── Snapshot management ──────────────────────────────────────────────────

  /** Returns true when we should compact the log into a new snapshot. */
  private _shouldTakeSnapshot(): boolean {
    const threshold = this._config.getCommitIndexAdvanceCountToSnapshot();
    return this._commitIndex - this._lastSnapshotIndex >= threshold;
  }

  /** Takes a snapshot and persists it, compacting the log. */
  private _takeSnapshot(): void {
    const snapshotData = this._stateMachine.takeSnapshot();
    const snapshot: SnapshotEntry = {
      term: this._store.termAt(this._commitIndex) || this._currentTerm,
      index: this._commitIndex,
      data: snapshotData,
      groupMembers: [...this._members],
      groupMembersLogIndex: this._commitIndex,
    };
    this._lastSnapshotIndex = this._commitIndex;
    void this._store.persistSnapshot(snapshot);
  }

  /** Conditionally takes a snapshot after advancing the commit index. */
  private _maybeTakeSnapshot(): void {
    if (this._shouldTakeSnapshot()) {
      this._takeSnapshot();
    }
  }

  // ── Quorum and log helpers ───────────────────────────────────────────────

  /** Quorum size for this group. */
  private _quorumSize(): number {
    return Math.floor(this._members.length / 2) + 1;
  }

  /**
   * Returns true if the given (lastLogTerm, lastLogIndex) is at least as
   * up-to-date as our own log (Raft §5.4.1 — compare terms first, then index).
   */
  private _isLogUpToDate(lastLogTerm: number, lastLogIndex: number): boolean {
    const ourTerm = this._store.lastLogTerm();
    const ourIndex = this._store.lastLogIndex();

    if (lastLogTerm !== ourTerm) {
      return lastLogTerm > ourTerm;
    }
    return lastLogIndex >= ourIndex;
  }

  /**
   * Returns true if we currently have no known leader, or the last heartbeat
   * from the leader is older than the configured follower timeout.
   */
  private _leaderHasTimedOut(): boolean {
    if (this._leader === null) return true;
    if (this._lastLeaderHeartbeat === 0) return true;
    const timeout = this._config.getFollowerTimeoutMillis();
    return Date.now() - this._lastLeaderHeartbeat > timeout;
  }

  /**
   * Finds the first log index that has the given term, searching backward
   * from `upToIndex`. Used for the optimised conflict-rollback hint.
   */
  private _findFirstIndexOfTerm(term: number, upToIndex: number): number {
    let first = upToIndex;
    for (let i = upToIndex - 1; i >= 0; i--) {
      if (this._store.termAt(i) !== term) break;
      first = i;
    }
    return first;
  }

  /** Helper that builds an AppendFailureResponse for this node. */
  private _appendFailure(followerId: string): AppendFailureResponse {
    return {
      type: 'RAFT_APPEND_FAILURE',
      groupId: this._groupId,
      term: this._currentTerm,
      followerId,
      lastLogIndex: this._store.lastLogIndex(),
    };
  }

  /** Returns all members except self. */
  private _peers(): RaftEndpoint[] {
    return this._members.filter((m) => m.uuid !== this._localEndpoint.uuid);
  }

  /** Finds a member endpoint by UUID, or returns null. */
  private _findEndpoint(uuid: string): RaftEndpoint | null {
    return this._members.find((m) => m.uuid === uuid) ?? null;
  }

  /** Sends a message via the configured sender, dropping it if no sender is set. */
  private _send(target: RaftEndpoint, message: RaftMessage): void {
    this._sender?.sendRaftMessage(target, message);
  }

  /** Rejects all pending proposals with the given error and clears the map. */
  private _rejectPendingProposals(error: Error): void {
    for (const proposal of this._pendingProposals.values()) {
      proposal.reject(error);
    }
    this._pendingProposals.clear();
  }

  // ── Vote sets (deduplicate by voterId to prevent double-counting) ──────────
  private _preVoteGrantedVoters: Set<string> = new Set();
  private _votesGrantedVoters: Set<string> = new Set();
}
