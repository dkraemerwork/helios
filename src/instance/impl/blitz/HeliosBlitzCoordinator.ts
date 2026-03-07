/**
 * Coordinator service for Helios-managed Blitz cluster topology.
 *
 * Runs on every node but only processes topology-mutating operations
 * when the local node is the current Helios master. Tracks registrations,
 * computes topology snapshots, manages re-registration sweeps after
 * master changes, and generates announce messages.
 */
import type {
  BlitzNodeRegisterMsg,
  BlitzNodeRemoveMsg,
  BlitzTopologyAnnounceMsg,
  BlitzTopologyRequestMsg,
  BlitzTopologyResponseMsg,
} from "@zenystx/helios-core/cluster/tcp/ClusterMessage";
import { BlitzClusterTopology } from "@zenystx/helios-core/instance/impl/blitz/BlitzClusterTopology";
import { BlitzReplicaReconciler } from "@zenystx/helios-core/instance/impl/blitz/BlitzReplicaReconciler";

const DEFAULT_RETRY_AFTER_MS = 1000;

export class HeliosBlitzCoordinator {
  private _topology: BlitzClusterTopology | null = null;
  private _masterMemberId: string | null = null;
  private _memberListVersion = 0;
  private _expectedRegistrants = new Set<string>();
  private _fenceToken: string | null = null;
  private _hasAuthoritativeFenceToken = false;
  private _pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly _reconciler = new BlitzReplicaReconciler(1, 0);

  /**
   * Returns the replica reconciler owned by this coordinator.
   * The coordinator propagates topology/authority changes to it automatically.
   */
  getReplicaReconciler(): BlitzReplicaReconciler {
    return this._reconciler;
  }

  setMasterMemberId(masterId: string): void {
    if (masterId !== this._masterMemberId) {
      this._masterMemberId = masterId;
      this._rotateFenceToken();
      this._hasAuthoritativeFenceToken = false;
      this._syncReconcilerAuthority();
    }
  }

  getMasterMemberId(): string | null {
    return this._masterMemberId;
  }

  setMemberListVersion(version: number): void {
    if (version !== this._memberListVersion) {
      this._memberListVersion = version;
      this._topology = new BlitzClusterTopology(version);
      this._expectedRegistrants.clear();
      this._rotateFenceToken();
      this._hasAuthoritativeFenceToken = false;
      this._reconciler.onMemberListVersionChange(version);
      this._syncReconcilerAuthority();
    }
  }

  getMemberListVersion(): number {
    return this._memberListVersion;
  }

  getFenceToken(): string | null {
    return this._fenceToken;
  }

  validateAuthority(
    masterMemberId: string,
    memberListVersion: number,
    fenceToken: string,
  ): boolean {
    return (
      masterMemberId === this._masterMemberId &&
      memberListVersion === this._memberListVersion &&
      fenceToken === this._fenceToken
    );
  }

  private _rotateFenceToken(): void {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    this._fenceToken = Array.from(bytes, (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  }

  /**
   * Sync the current authority tuple to the reconciler so scheduled
   * reconciliation jobs can capture and revalidate it.
   */
  private _syncReconcilerAuthority(): void {
    if (this._masterMemberId && this._fenceToken) {
      this._reconciler.setAuthority(
        this._masterMemberId,
        this._memberListVersion,
        this._fenceToken,
      );
    }
  }

  setExpectedRegistrants(memberIds: Set<string>): void {
    this._expectedRegistrants = new Set(memberIds);
  }

  getExpectedRegistrants(): ReadonlySet<string> {
    return this._expectedRegistrants;
  }

  handleRegister(msg: BlitzNodeRegisterMsg, isMaster: boolean): boolean {
    if (!isMaster) return false;

    if (!this._topology) {
      this._topology = new BlitzClusterTopology(this._memberListVersion);
    }

    this._topology.addRegistration(msg.registration);
    return true;
  }

  handleTopologyRequest(
    msg: BlitzTopologyRequestMsg,
    isMaster: boolean,
  ): BlitzTopologyResponseMsg | null {
    if (!isMaster || !this._topology || !this._masterMemberId || !this._fenceToken) {
      return null;
    }

    const registrationsComplete = this.isRegistrationComplete();
    const routes = this._topology.getRoutes();
    const leaderRegistration = this._topology.getRegistration(this._masterMemberId);

    return {
      type: "BLITZ_TOPOLOGY_RESPONSE",
      requestId: msg.requestId,
      routes,
      masterMemberId: this._masterMemberId,
      memberListVersion: this._memberListVersion,
      fenceToken: this._fenceToken,
      registrationsComplete,
      clientConnectUrl: leaderRegistration
        ? `nats://${leaderRegistration.advertiseHost}:${leaderRegistration.clientPort}`
        : "nats://127.0.0.1:4222",
      retryAfterMs: registrationsComplete ? undefined : DEFAULT_RETRY_AFTER_MS,
    };
  }

  handleRemove(msg: BlitzNodeRemoveMsg, isMaster: boolean): boolean {
    if (!isMaster || !this._topology) return false;

    this._topology.removeRegistration(msg.memberId);
    return true;
  }

  isRegistrationComplete(): boolean {
    if (!this._topology) return false;
    if (this._expectedRegistrants.size === 0) return true;

    const registered = this._topology.getRegistrations();
    for (const expected of this._expectedRegistrants) {
      if (!registered.has(expected)) {
        return false;
      }
    }
    return true;
  }

  generateTopologyAnnounce(): BlitzTopologyAnnounceMsg | null {
    if (!this._topology || !this._masterMemberId || !this._fenceToken) return null;

    return {
      type: "BLITZ_TOPOLOGY_ANNOUNCE",
      memberListVersion: this._memberListVersion,
      routes: this._topology.getRoutes(),
      masterMemberId: this._masterMemberId,
      fenceToken: this._fenceToken,
    };
  }

  /**
   * Validate an incoming authoritative BLITZ_TOPOLOGY_RESPONSE or
   * BLITZ_TOPOLOGY_ANNOUNCE against this node's current master view.
   */
  validateIncomingAuthoritative(
    msg: BlitzTopologyResponseMsg | BlitzTopologyAnnounceMsg,
  ): boolean {
    return (
      msg.masterMemberId === this._masterMemberId &&
      msg.memberListVersion === this._memberListVersion &&
      (!this._hasAuthoritativeFenceToken || msg.fenceToken === this._fenceToken)
    );
  }

  /**
   * Process an incoming BLITZ_TOPOLOGY_RESPONSE from the master.
   * Validates authority fencing before accepting the topology data.
   */
  handleIncomingTopologyResponse(
    msg: BlitzTopologyResponseMsg,
  ): { accepted: boolean; routes?: string[]; registrationsComplete?: boolean; clientConnectUrl?: string; retryAfterMs?: number } {
    if (!this.validateIncomingAuthoritative(msg)) {
      return { accepted: false };
    }
    this._fenceToken = msg.fenceToken;
    this._hasAuthoritativeFenceToken = true;
    this._syncReconcilerAuthority();
    return {
      accepted: true,
      routes: msg.routes,
      registrationsComplete: msg.registrationsComplete,
      clientConnectUrl: msg.clientConnectUrl,
      retryAfterMs: msg.retryAfterMs,
    };
  }

  /**
   * Process an incoming BLITZ_TOPOLOGY_ANNOUNCE from the master.
   * Validates authority fencing before accepting the topology update.
   */
  handleIncomingTopologyAnnounce(
    msg: BlitzTopologyAnnounceMsg,
  ): { accepted: boolean; routes?: string[] } {
    if (!this.validateIncomingAuthoritative(msg)) {
      return { accepted: false };
    }
    this._fenceToken = msg.fenceToken;
    this._hasAuthoritativeFenceToken = true;
    this._syncReconcilerAuthority();
    return {
      accepted: true,
      routes: msg.routes,
    };
  }

  getTopology(): BlitzClusterTopology | null {
    return this._topology;
  }

  /**
   * Schedule a retry timer for topology work.
   * Tracked so it can be cancelled on demotion.
   */
  scheduleRetryTimer(id: string, fn: () => void, delayMs: number): void {
    this.cancelRetryTimer(id);
    const timer = setTimeout(fn, delayMs);
    this._pendingTimers.set(id, timer);
  }

  cancelRetryTimer(id: string): void {
    const existing = this._pendingTimers.get(id);
    if (existing !== undefined) {
      clearTimeout(existing);
      this._pendingTimers.delete(id);
    }
  }

  hasPendingTimers(): boolean {
    return this._pendingTimers.size > 0;
  }

  /**
   * Synchronously cancel and fence all outstanding topology-authority work
   * owned by the old master epoch on demotion or master loss.
   *
   * Cancels:
   * - In-flight BLITZ_TOPOLOGY_RESPONSE work (topology cleared)
   * - Re-registration sweeps (expected registrants cleared)
   * - Retry timers
   * - Topology announce tasks (topology cleared)
   *
   * Rotates the fence token so any in-flight work that checks authority
   * after demotion will be rejected.
   */
  onDemotion(): void {
    // Cancel all pending retry timers
    for (const timer of this._pendingTimers.values()) {
      clearTimeout(timer);
    }
    this._pendingTimers.clear();

    // Clear topology so no stale responses can be generated
    this._topology = null;

    // Clear expected registrants (re-registration sweep cancelled)
    this._expectedRegistrants.clear();

    // Rotate fence token so old-epoch authority is invalid
    this._rotateFenceToken();
    this._hasAuthoritativeFenceToken = false;

    // Cascade demotion to the reconciler — cancels outstanding jobs,
    // clears pending work, and nullifies authority
    this._reconciler.onDemotion();
  }
}
