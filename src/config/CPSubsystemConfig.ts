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
  /** Raft algorithm tuning. */
  private _raftAlgorithmConfig = new RaftAlgorithmConfig();

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
