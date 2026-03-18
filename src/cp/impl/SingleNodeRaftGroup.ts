import type { CpCommand } from './CpSubsystemService.js';

export interface RaftLogEntry {
  term: number;
  index: number;
  command: CpCommand;
}

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

  constructor(
    private readonly _localMemberId: string,
    private readonly _groupMembers: string[],
  ) {
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
   *
   * Backward-compat note: this method is only called via the legacy
   * CpSubsystemService.executeCommand() path. The primary execution path
   * for all CP data structures goes through CpSubsystemService._executeSingleNode(),
   * which bypasses this method and applies the command directly to the
   * CpStateMachine. The return value here (stateMachine.get(command.key))
   * reflects the post-apply state only if setState() has been called back
   * by _executeSingleNode(); callers of this backward-compat path must not
   * rely on the returned value.
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
    this._commitIndex = entry.index;
    this._apply(entry);

    // Return value is unreliable for external callers — see note above.
    return this._stateMachine.get(command.key);
  }

  private _apply(entry: RaftLogEntry): void {
    for (const listener of this._applyListeners) {
      listener(entry);
    }
  }

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
