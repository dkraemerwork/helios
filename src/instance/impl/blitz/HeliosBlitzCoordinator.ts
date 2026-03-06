/**
 * Coordinator service for Helios-managed Blitz cluster topology.
 *
 * Runs on every node but only processes topology-mutating operations
 * when the local node is the current Helios master. Tracks registrations,
 * computes topology snapshots, manages re-registration sweeps after
 * master changes, and generates announce messages.
 */
import {
  BlitzClusterTopology,
  type BlitzNodeRegistration,
} from "@zenystx/helios-core/instance/impl/blitz/BlitzClusterTopology";
import type {
  BlitzNodeRegisterMsg,
  BlitzNodeRemoveMsg,
  BlitzTopologyRequestMsg,
  BlitzTopologyResponseMsg,
  BlitzTopologyAnnounceMsg,
} from "@zenystx/helios-core/cluster/tcp/ClusterMessage";

const DEFAULT_RETRY_AFTER_MS = 1000;

export class HeliosBlitzCoordinator {
  private _topology: BlitzClusterTopology | null = null;
  private _masterMemberId: string | null = null;
  private _memberListVersion = 0;
  private _expectedRegistrants = new Set<string>();

  setMasterMemberId(masterId: string): void {
    this._masterMemberId = masterId;
  }

  getMasterMemberId(): string | null {
    return this._masterMemberId;
  }

  setMemberListVersion(version: number): void {
    if (version !== this._memberListVersion) {
      this._memberListVersion = version;
      this._topology = new BlitzClusterTopology(version);
      this._expectedRegistrants.clear();
    }
  }

  getMemberListVersion(): number {
    return this._memberListVersion;
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
    if (!isMaster || !this._topology || !this._masterMemberId) {
      return null;
    }

    const registrationsComplete = this.isRegistrationComplete();
    const routes = this._topology.getRoutes();

    return {
      type: "BLITZ_TOPOLOGY_RESPONSE",
      requestId: msg.requestId,
      routes,
      masterMemberId: this._masterMemberId,
      memberListVersion: this._memberListVersion,
      registrationsComplete,
      clientConnectUrl: "nats://127.0.0.1:4222",
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
    if (!this._topology || !this._masterMemberId) return null;

    return {
      type: "BLITZ_TOPOLOGY_ANNOUNCE",
      memberListVersion: this._memberListVersion,
      routes: this._topology.getRoutes(),
      masterMemberId: this._masterMemberId,
    };
  }

  getTopology(): BlitzClusterTopology | null {
    return this._topology;
  }
}
