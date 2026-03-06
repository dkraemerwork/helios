/**
 * Master-owned, fenced replica-count upgrade policy for Blitz-owned KV/state.
 *
 * When Blitz resources are created before the full cluster is present,
 * they may have fewer replicas than the target `defaultReplicas` setting.
 * This reconciler tracks under-replicated resources and determines when
 * upgrades are actionable based on current cluster size.
 *
 * Fencing semantics:
 * - All pending work is keyed by `memberListVersion`
 * - On version change, cached pending work is cleared (restart-safe)
 * - Work must be recomputed from live JetStream state after failover
 * - Only the current master may execute upgrades
 *
 * Hazelcast parity: mirrors PartitionReplicaManager's approach where
 * replica count is bounded by available members and reconciliation
 * is master-authoritative.
 */

export interface UnderReplicatedResource {
  readonly resourceName: string;
  readonly currentReplicas: number;
  readonly targetReplicas: number;
  readonly memberListVersion: number;
}

export class BlitzReplicaReconciler {
  private readonly _defaultReplicas: number;
  private _memberListVersion: number;
  private _isMaster = true;
  private readonly _pending = new Map<string, UnderReplicatedResource>();

  constructor(defaultReplicas: number, memberListVersion: number) {
    this._defaultReplicas = defaultReplicas;
    this._memberListVersion = memberListVersion;
  }

  /**
   * Compute effective replica count: min(target, readyNodes).
   * Mirrors Hazelcast's `getMaxAllowedBackupCount()` pattern.
   */
  effectiveReplicas(readyNodeCount: number): number {
    return Math.min(this._defaultReplicas, readyNodeCount);
  }

  /**
   * Mark a Blitz-owned resource as under-replicated.
   * The resource is tagged with the current memberListVersion for fencing.
   */
  markUnderReplicated(
    resourceName: string,
    currentReplicas: number,
    targetReplicas: number,
  ): void {
    this._pending.set(resourceName, {
      resourceName,
      currentReplicas,
      targetReplicas,
      memberListVersion: this._memberListVersion,
    });
  }

  /**
   * Mark a resource as successfully upgraded, removing it from pending.
   */
  markUpgraded(resourceName: string): void {
    this._pending.delete(resourceName);
  }

  /**
   * Get all pending upgrades.
   */
  getPendingUpgrades(): UnderReplicatedResource[] {
    return [...this._pending.values()];
  }

  /**
   * Get upgrades that are actionable given the current cluster size.
   * Only returns results when this reconciler is master-owned.
   * A resource is actionable when readyNodeCount > its currentReplicas.
   */
  getActionableUpgrades(readyNodeCount: number): UnderReplicatedResource[] {
    if (!this._isMaster) return [];
    return [...this._pending.values()].filter(
      (r) => readyNodeCount > r.currentReplicas,
    );
  }

  /**
   * Handle memberListVersion change (master failover or topology change).
   * Clears cached pending work — must be recomputed from live state.
   */
  onMemberListVersionChange(newVersion: number): void {
    this._memberListVersion = newVersion;
    this._pending.clear();
  }

  setIsMaster(isMaster: boolean): void {
    this._isMaster = isMaster;
  }

  getIsMaster(): boolean {
    return this._isMaster;
  }

  getMemberListVersion(): number {
    return this._memberListVersion;
  }

  getDefaultReplicas(): number {
    return this._defaultReplicas;
  }
}
