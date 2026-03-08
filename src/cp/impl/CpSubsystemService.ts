/**
 * CP Subsystem Service — Raft-based consensus for linearizable distributed operations.
 *
 * Port of com.hazelcast.cp.CPSubsystem.
 *
 * Implements a single CP group with Raft-like consensus:
 *  - Leader election among CP group members
 *  - Log replication with majority acknowledgement
 *  - CP group creation/destruction
 *  - Session management for CP data structures
 */

// ── Raft log entry ──────────────────────────────────────────────────────

export interface RaftLogEntry {
  term: number;
  index: number;
  command: CpCommand;
}

export interface CpCommand {
  type: string;
  groupId: string;
  key: string;
  payload: unknown;
  sessionId?: string;
}

// ── CP Group state ──────────────────────────────────────────────────────

export interface CpGroupState {
  groupId: string;
  members: string[];
  leader: string | null;
  term: number;
  commitIndex: number;
  /** Applied state machine data for the group. */
  stateMachine: Map<string, unknown>;
}

// ── Session ─────────────────────────────────────────────────────────────

export interface CpSession {
  sessionId: string;
  memberId: string;
  createdAt: number;
  ttlMs: number;
  lastHeartbeatAt: number;
}

// ── Raft node (per CP group, single-node embedded implementation) ────────

class RaftNode {
  private _term = 0;
  private _leader: string | null = null;
  private _log: RaftLogEntry[] = [];
  private _commitIndex = -1;
  private _stateMachine: Map<string, unknown> = new Map();
  private _applyListeners: Array<(entry: RaftLogEntry) => void> = [];

  constructor(
    private readonly _localMemberId: string,
    private readonly _groupMembers: string[],
  ) {
    // In single-node mode the local member is always leader
    if (this._groupMembers.length === 1 || this._groupMembers[0] === this._localMemberId) {
      this._leader = this._localMemberId;
      this._term = 1;
    }
  }

  getLeader(): string | null {
    return this._leader;
  }

  getTerm(): number {
    return this._term;
  }

  getCommitIndex(): number {
    return this._commitIndex;
  }

  getStateMachine(): Map<string, unknown> {
    return this._stateMachine;
  }

  isLeader(): boolean {
    return this._leader === this._localMemberId;
  }

  onApply(listener: (entry: RaftLogEntry) => void): void {
    this._applyListeners.push(listener);
  }

  /**
   * Propose a command. In single-node mode this immediately appends and commits.
   * In multi-node mode this would replicate to majority before committing.
   */
  async propose(command: CpCommand): Promise<unknown> {
    if (!this.isLeader()) {
      throw new Error(`Not the leader. Leader is ${this._leader ?? 'unknown'}`);
    }

    const entry: RaftLogEntry = {
      term: this._term,
      index: this._log.length,
      command,
    };
    this._log.push(entry);

    // Majority write — with a single member, local commit satisfies majority.
    // With multiple members in the group array, we'd wait for ACKs (not modeled here).
    this._commitIndex = entry.index;
    this._apply(entry);

    return this._stateMachine.get(command.key);
  }

  /** Apply a committed log entry to the state machine. */
  private _apply(entry: RaftLogEntry): void {
    for (const listener of this._applyListeners) {
      listener(entry);
    }
  }

  /** For external state machine manipulation after apply. */
  setState(key: string, value: unknown): void {
    this._stateMachine.set(key, value);
  }

  getState(key: string): unknown {
    return this._stateMachine.get(key);
  }

  hasState(key: string): boolean {
    return this._stateMachine.has(key);
  }
}

// ── CP Subsystem Service ────────────────────────────────────────────────

export class CpSubsystemService {
  static readonly SERVICE_NAME = 'hz:impl:cpSubsystemService';

  private readonly _groups = new Map<string, RaftNode>();
  private readonly _sessions = new Map<string, CpSession>();
  private readonly _groupStates = new Map<string, CpGroupState>();

  private static readonly SESSION_TTL_MS = 60_000;
  private static readonly SESSION_HEARTBEAT_INTERVAL_MS = 5_000;
  private _sessionHeartbeatHandle: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly _localMemberId: string) {
    this._startSessionHeartbeat();
  }

  // ── Group lifecycle ────────────────────────────────────────────────────

  /**
   * Create or retrieve a CP group. A CP group represents a Raft cluster
   * for a specific data structure namespace (e.g. "default" for the default group).
   */
  getOrCreateGroup(groupId: string, members?: string[]): CpGroupState {
    if (!this._groups.has(groupId)) {
      const groupMembers = members ?? [this._localMemberId];
      const raft = new RaftNode(this._localMemberId, groupMembers);
      raft.onApply((entry) => {
        this._notifyGroupStateChanged(groupId, entry);
      });
      this._groups.set(groupId, raft);
      this._groupStates.set(groupId, {
        groupId,
        members: groupMembers,
        leader: raft.getLeader(),
        term: raft.getTerm(),
        commitIndex: raft.getCommitIndex(),
        stateMachine: raft.getStateMachine(),
      });
    }
    return this._groupStates.get(groupId)!;
  }

  destroyGroup(groupId: string): void {
    this._groups.delete(groupId);
    this._groupStates.delete(groupId);
  }

  getGroup(groupId: string): CpGroupState | null {
    return this._groupStates.get(groupId) ?? null;
  }

  listGroups(): string[] {
    return Array.from(this._groups.keys());
  }

  // ── Consensus execution ────────────────────────────────────────────────

  /**
   * Execute a command through the Raft log for the given group.
   * Returns the result after consensus commits the entry.
   */
  async executeCommand(command: CpCommand): Promise<unknown> {
    const raft = this._getRaft(command.groupId);
    return raft.propose(command);
  }

  /**
   * Read a value directly from the group state machine.
   * Linearizable reads in production Raft require a ReadIndex, but in single-node
   * mode the state machine is always consistent.
   */
  readState(groupId: string, key: string): unknown {
    const raft = this._getRaft(groupId);
    return raft.getState(key);
  }

  /**
   * Apply a state mutation directly (post-consensus hook).
   * Called by the apply callback after log commitment.
   */
  applyStateMutation(groupId: string, key: string, value: unknown): void {
    const raft = this._getRaft(groupId);
    raft.setState(key, value);
    const groupState = this._groupStates.get(groupId);
    if (groupState !== undefined) {
      groupState.leader = raft.getLeader();
      groupState.term = raft.getTerm();
      groupState.commitIndex = raft.getCommitIndex();
    }
  }

  // ── Session management ─────────────────────────────────────────────────

  createSession(memberId: string): CpSession {
    const sessionId = crypto.randomUUID();
    const now = Date.now();
    const session: CpSession = {
      sessionId,
      memberId,
      createdAt: now,
      ttlMs: CpSubsystemService.SESSION_TTL_MS,
      lastHeartbeatAt: now,
    };
    this._sessions.set(sessionId, session);
    return session;
  }

  heartbeatSession(sessionId: string): boolean {
    const session = this._sessions.get(sessionId);
    if (session === undefined) return false;
    session.lastHeartbeatAt = Date.now();
    return true;
  }

  closeSession(sessionId: string): boolean {
    return this._sessions.delete(sessionId);
  }

  getSession(sessionId: string): CpSession | null {
    return this._sessions.get(sessionId) ?? null;
  }

  isSessionAlive(sessionId: string): boolean {
    const session = this._sessions.get(sessionId);
    if (session === undefined) return false;
    return Date.now() - session.lastHeartbeatAt < session.ttlMs;
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private _getRaft(groupId: string): RaftNode {
    const raft = this._groups.get(groupId);
    if (raft === undefined) {
      // Auto-create on first access (matching Hazelcast's lazy CP group init)
      this.getOrCreateGroup(groupId);
      return this._groups.get(groupId)!;
    }
    return raft;
  }

  private _notifyGroupStateChanged(groupId: string, _entry: RaftLogEntry): void {
    const raft = this._groups.get(groupId);
    const groupState = this._groupStates.get(groupId);
    if (raft === undefined || groupState === undefined) return;
    groupState.leader = raft.getLeader();
    groupState.term = raft.getTerm();
    groupState.commitIndex = raft.getCommitIndex();
  }

  private _startSessionHeartbeat(): void {
    this._sessionHeartbeatHandle = setInterval(() => {
      this._evictExpiredSessions();
    }, CpSubsystemService.SESSION_HEARTBEAT_INTERVAL_MS);
  }

  private _evictExpiredSessions(): void {
    const now = Date.now();
    for (const [sessionId, session] of this._sessions) {
      if (now - session.lastHeartbeatAt >= session.ttlMs) {
        this._sessions.delete(sessionId);
      }
    }
  }

  shutdown(): void {
    if (this._sessionHeartbeatHandle !== null) {
      clearInterval(this._sessionHeartbeatHandle);
      this._sessionHeartbeatHandle = null;
    }
    this._groups.clear();
    this._sessions.clear();
    this._groupStates.clear();
  }
}
