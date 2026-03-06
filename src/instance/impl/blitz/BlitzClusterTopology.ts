/**
 * Topology models for Helios-managed Blitz clustering.
 *
 * BlitzNodeRegistration represents a single node's Blitz metadata.
 * BlitzClusterTopology tracks all registrations and computes seed routes,
 * keyed by the current memberListVersion.
 */

export interface BlitzNodeRegistration {
  readonly memberId: string;
  readonly memberListVersion: number;
  readonly serverName: string;
  readonly clientPort: number;
  readonly clusterPort: number;
  readonly advertiseHost: string;
  readonly clusterName: string;
  readonly ready: boolean;
  readonly startedAt: number;
}

export class BlitzClusterTopology {
  private readonly _memberListVersion: number;
  private readonly _registrations = new Map<string, BlitzNodeRegistration>();

  constructor(memberListVersion: number) {
    this._memberListVersion = memberListVersion;
  }

  getMemberListVersion(): number {
    return this._memberListVersion;
  }

  addRegistration(reg: BlitzNodeRegistration): void {
    this._registrations.set(reg.memberId, reg);
  }

  removeRegistration(memberId: string): void {
    this._registrations.delete(memberId);
  }

  getRegistration(memberId: string): BlitzNodeRegistration | null {
    return this._registrations.get(memberId) ?? null;
  }

  getRegistrations(): ReadonlyMap<string, BlitzNodeRegistration> {
    return this._registrations;
  }

  /**
   * Returns ordered nats:// seed routes from registered nodes.
   * Sorted deterministically for stable cluster formation.
   */
  getRoutes(): string[] {
    return Array.from(this._registrations.values())
      .map((reg) => `nats://${reg.advertiseHost}:${reg.clusterPort}`)
      .sort();
  }

  getReadyNodeCount(): number {
    let count = 0;
    for (const reg of this._registrations.values()) {
      if (reg.ready) count++;
    }
    return count;
  }

  clear(): void {
    this._registrations.clear();
  }
}
