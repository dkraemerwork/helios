/**
 * CP Subsystem Service — Raft-based consensus for linearizable distributed operations.
 *
 * In single-node mode (cpMemberCount < 3): uses SingleNodeRaftGroup for immediate commit.
 * In multi-node mode (cpMemberCount >= 3): uses full Raft consensus via RaftNode.
 */

import type { RaftCommand } from '../raft/types.js';
import type { CPSubsystemConfig } from '../../config/CPSubsystemConfig.js';
import { CpGroupManager } from '../raft/CpGroupManager.js';
import { RaftMessageRouter } from '../raft/RaftMessageRouter.js';
import { RaftTransportAdapter } from '../raft/RaftTransportAdapter.js';
import type { TcpClusterTransport } from '../../cluster/tcp/TcpClusterTransport.js';
import { NotLeaderException } from '../raft/errors.js';
import { SingleNodeRaftGroup, type RaftLogEntry as SingleNodeLogEntry } from './SingleNodeRaftGroup.js';
import { CpStateMachine } from '../raft/CpStateMachine.js';

// ── Exported types (backward compatible) ────────────────────────────────────

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

export interface CpGroupState {
  groupId: string;
  members: string[];
  leader: string | null;
  term: number;
  commitIndex: number;
  /** Applied state machine data for the group. */
  stateMachine: Map<string, unknown>;
}

export interface CpSession {
  sessionId: string;
  memberId: string;
  createdAt: number;
  ttlMs: number;
  lastHeartbeatAt: number;
}

// ── CP Subsystem Service ─────────────────────────────────────────────────────

export class CpSubsystemService {
  static readonly SERVICE_NAME = 'hz:impl:cpSubsystemService';

  // -- Single-node state (backward compat) --
  private readonly _groups = new Map<string, SingleNodeRaftGroup>();
  private readonly _groupStates = new Map<string, CpGroupState>();
  private readonly _singleNodeStateMachine = new CpStateMachine();

  // -- Session management --
  private readonly _sessions = new Map<string, CpSession>();
  private static readonly SESSION_TTL_MS = 60_000;
  private static readonly SESSION_HEARTBEAT_INTERVAL_MS = 5_000;
  private _sessionHeartbeatHandle: ReturnType<typeof setInterval> | null = null;
  private _nextSessionId = 1n;
  private _nextThreadId = 1n;
  private readonly _sessionCloseListeners: Array<(sessionId: string) => void> = [];

  // -- Multi-node state --
  private readonly _multiNodeEnabled: boolean;
  private _groupManager: CpGroupManager | null = null;
  private _messageRouter: RaftMessageRouter | null = null;
  private _transportAdapter: RaftTransportAdapter | null = null;

  // -- WaitKey mechanism --
  private readonly _waitKeys = new Map<string, {
    resolve: (r: unknown) => void;
    reject: (e: Error) => void;
    timeoutId?: ReturnType<typeof setTimeout>;
  }>();

  constructor(
    private readonly _localMemberId: string,
    cpConfig?: CPSubsystemConfig,
    transport?: TcpClusterTransport,
    cpMembers?: Array<{ uuid: string; address: { host: string; port: number } }>,
  ) {
    this._multiNodeEnabled = cpConfig?.isEnabled() ?? false;

    if (this._multiNodeEnabled && transport && cpMembers && cpConfig) {
      this._messageRouter = new RaftMessageRouter();
      this._transportAdapter = new RaftTransportAdapter(transport);
      this._messageRouter.setSender(this._transportAdapter);
      this._groupManager = new CpGroupManager(
        { uuid: _localMemberId, address: { host: '127.0.0.1', port: 0 } },
        cpMembers,
        cpConfig,
        this._transportAdapter,
        this._messageRouter,
      );
    }

    this._startSessionHeartbeat();
  }

  // ── New Multi-Node API ───────────────────────────────────────────────────────

  /**
   * Execute a command through Raft consensus. In single-node mode, falls back to
   * the embedded SingleNodeRaftGroup for immediate commit.
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

    return node.propose(command);
  }

  /**
   * Perform a linearizable read. In single-node mode reads directly from
   * the CpStateMachine, falling back to the SingleNodeRaftGroup for backward compat.
   * In multi-node mode routes through RaftNode.linearizableRead() for true linearizability.
   */
  async linearizableRead(groupId: string, key: string): Promise<unknown> {
    if (!this._multiNodeEnabled) {
      return this._singleNodeStateMachine.getState().get(key) ?? this.readState(groupId, key);
    }

    const groupInfo = this._groupManager!.getGroup(groupId);
    if (!groupInfo) return undefined;
    const result = await groupInfo.raftNode.linearizableRead(key);
    return result.result;
  }

  /**
   * Extract the CP group name from a proxy name in the form "objectName@groupName".
   * Returns "default" if no "@" is present.
   */
  resolveGroupId(proxyName: string): string {
    const idx = proxyName.indexOf('@');
    return idx >= 0 ? proxyName.slice(idx + 1) : 'default';
  }

  /**
   * Extract the object name from a proxy name in the form "objectName@groupName".
   * Returns the full string if no "@" is present.
   */
  resolveObjectName(proxyName: string): string {
    const idx = proxyName.indexOf('@');
    return idx >= 0 ? proxyName.slice(0, idx) : proxyName;
  }

  /**
   * Await a wait-key indefinitely (used by blocking CP operations like FencedLock.lock).
   * The returned promise resolves when completeWaitKey() is called with this key.
   */
  async awaitWaitKey(
    groupName: string,
    resourceName: string,
    sessionId: bigint,
    threadId: bigint,
    invocationUid: string,
  ): Promise<bigint> {
    return new Promise((resolve, reject) => {
      const key = `${groupName}:${resourceName}:${sessionId}:${threadId}:${invocationUid}`;
      this._waitKeys.set(key, { resolve: (r) => resolve(r as bigint), reject });
    });
  }

  /**
   * Await a wait-key with a timeout. Resolves with -1n (INVALID_FENCE) on timeout.
   */
  async awaitWaitKeyWithTimeout(
    groupName: string,
    resourceName: string,
    sessionId: bigint,
    threadId: bigint,
    invocationUid: string,
    timeoutMs: number,
  ): Promise<bigint> {
    return new Promise((resolve, reject) => {
      const key = `${groupName}:${resourceName}:${sessionId}:${threadId}:${invocationUid}`;
      const timeoutId = setTimeout(() => {
        this._waitKeys.delete(key);
        resolve(-1n); // INVALID_FENCE
      }, timeoutMs);
      this._waitKeys.set(key, {
        resolve: (r) => {
          clearTimeout(timeoutId);
          resolve(r as bigint);
        },
        reject,
        timeoutId,
      });
    });
  }

  /**
   * Complete a pending wait-key, resolving the awaiting promise.
   */
  completeWaitKey(key: string, result: unknown): void {
    const waiter = this._waitKeys.get(key);
    if (waiter) {
      this._waitKeys.delete(key);
      waiter.resolve(result);
    }
  }

  // ── Backward-Compatible API ──────────────────────────────────────────────────

  /**
   * Create or retrieve a CP group. A CP group represents a Raft cluster
   * for a specific data structure namespace (e.g. "default" for the default group).
   */
  getOrCreateGroup(groupId: string, members?: string[]): CpGroupState {
    if (!this._groups.has(groupId)) {
      const groupMembers = members ?? [this._localMemberId];
      const raft = new SingleNodeRaftGroup(this._localMemberId, groupMembers);
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

  // ── Session management ───────────────────────────────────────────────────────

  createSession(memberId: string): CpSession {
    const sessionId = String(this._nextSessionId++);
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

  getSessionTtlMs(): number {
    return CpSubsystemService.SESSION_TTL_MS;
  }

  getSessionHeartbeatIntervalMs(): number {
    return CpSubsystemService.SESSION_HEARTBEAT_INTERVAL_MS;
  }

  createThreadId(): bigint {
    const threadId = this._nextThreadId;
    this._nextThreadId += 1n;
    return threadId;
  }

  onSessionClosed(listener: (sessionId: string) => void): void {
    this._sessionCloseListeners.push(listener);
  }

  heartbeatSession(sessionId: string): boolean {
    const session = this._sessions.get(sessionId);
    if (session === undefined) return false;
    session.lastHeartbeatAt = Date.now();
    return true;
  }

  closeSession(sessionId: string): boolean {
    const closed = this._sessions.delete(sessionId);
    if (closed) {
      this._notifySessionClosed(sessionId);
    }
    return closed;
  }

  getSession(sessionId: string): CpSession | null {
    return this._sessions.get(sessionId) ?? null;
  }

  isSessionAlive(sessionId: string): boolean {
    const session = this._sessions.get(sessionId);
    if (session === undefined) return false;
    return Date.now() - session.lastHeartbeatAt < session.ttlMs;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this._groupManager) {
      await this._groupManager.initialize();
    }
  }

  shutdown(): void {
    if (this._sessionHeartbeatHandle !== null) {
      clearInterval(this._sessionHeartbeatHandle);
      this._sessionHeartbeatHandle = null;
    }
    this._groupManager?.shutdown();
    this._groups.clear();
    this._sessions.clear();
    this._groupStates.clear();
  }

  // ── Internal ─────────────────────────────────────────────────────────────────

  private _getRaft(groupId: string): SingleNodeRaftGroup {
    const raft = this._groups.get(groupId);
    if (raft === undefined) {
      // Auto-create on first access (matching Hazelcast's lazy CP group init)
      this.getOrCreateGroup(groupId);
      return this._groups.get(groupId)!;
    }
    return raft;
  }

  private _notifyGroupStateChanged(groupId: string, _entry: SingleNodeLogEntry): void {
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
        this._notifySessionClosed(sessionId);
      }
    }
  }

  private _notifySessionClosed(sessionId: string): void {
    for (const listener of this._sessionCloseListeners) {
      listener(sessionId);
    }
  }

  private async _executeSingleNode(command: RaftCommand): Promise<unknown> {
    // Ensure the SingleNodeRaftGroup exists for backward compat metadata tracking
    this._getRaft(command.groupId);
    // Apply through the deterministic state machine
    const result = this._singleNodeStateMachine.apply(command);
    // Sync the computed value back into the SingleNodeRaftGroup for backward compat reads
    const raft = this._groups.get(command.groupId);
    if (raft !== undefined) {
      const stateValue = this._singleNodeStateMachine.getState().get(command.key);
      raft.setState(command.key, stateValue);
    }
    return result;
  }

  private _singleNodeRead(groupId: string, key: string): unknown {
    return this._singleNodeStateMachine.getState().get(key) ?? this.readState(groupId, key);
  }
}
