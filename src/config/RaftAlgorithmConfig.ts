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
