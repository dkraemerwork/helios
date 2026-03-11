/**
 * HeliosTestCluster — programmatic test helper for official hazelcast-client interop tests.
 *
 * Starts one or three Helios server instances in-process, exposes the client protocol
 * port(s) for the official hazelcast-client npm package to connect to, and provides
 * clean shutdown semantics.
 *
 * Each cluster is isolated: it uses a unique cluster name plus dedicated random
 * member/client port ranges so there are never port conflicts between parallel
 * test suites, while still allowing deterministic member restarts.
 */
import { Helios } from "@zenystx/helios-core/Helios";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import type { HeliosInstanceImpl } from "@zenystx/helios-core/instance/impl/HeliosInstanceImpl";
import { waitUntil } from "./waitUntil";

// ── Cluster topology ──────────────────────────────────────────────────────────

export type ClusterTopology = "single" | "three-node";

// ── Connection info (returned to the caller / test) ──────────────────────────

export interface MemberConnectionInfo {
  /** Human-readable node name, e.g. "node-0". */
  name: string;
  /** Client protocol host, always 127.0.0.1. */
  host: string;
  /** Client protocol TCP port that the official hazelcast-client connects to. */
  clientPort: number;
  /** Member TCP port used for inter-member transport. */
  memberPort: number;
}

export interface ClusterConnectionInfo {
  /** Cluster name used by all members — pass as `clusterName` to hazelcast-client. */
  clusterName: string;
  /** Individual members in the cluster. */
  members: MemberConnectionInfo[];
  /**
   * Convenience address list in the format `"host:port"` expected by
   * `hazelcast-client` `network.clusterMembers` configuration.
   */
  addresses: string[];
}

// ── HeliosTestCluster ─────────────────────────────────────────────────────────

let clusterCounter = 0;

interface MemberSlot {
  name: string;
  host: string;
  memberPort: number;
  clientPort: number;
  instance: HeliosInstanceImpl | null;
}

export class HeliosTestCluster {
  private readonly _clusterName: string;
  private readonly _instances: HeliosInstanceImpl[] = [];
  private readonly _memberBasePort: number;
  private readonly _clientBasePort: number;
  private _memberSlots: MemberSlot[] = [];
  private _connectionInfo: ClusterConnectionInfo | null = null;
  private _started = false;

  /**
   * Unique multicast port for this cluster instance. Uses a random port in
   * the high range (40000–49999) to avoid collisions between concurrent test
   * runs and the default Hazelcast multicast port (54327).
   */
  private readonly _multicastPort: number;

  constructor(clusterName?: string) {
    this._clusterName = clusterName ?? `interop-${++clusterCounter}-${Date.now()}`;
    this._multicastPort = 40000 + Math.floor(Math.random() * 10000);
    this._memberBasePort = 17000 + Math.floor(Math.random() * 1000) * 3;
    this._clientBasePort = 22000 + Math.floor(Math.random() * 1000) * 3;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Start a single-member Helios cluster and return connection info for the
   * official hazelcast-client.
   */
  async startSingle(): Promise<ClusterConnectionInfo> {
    return this._start(1);
  }

  /**
   * Start a three-member Helios cluster and return connection info for the
   * official hazelcast-client.
   */
  async startThreeNode(): Promise<ClusterConnectionInfo> {
    return this._start(3);
  }

  /**
   * Shut down all running Helios instances in this cluster.
   * Safe to call multiple times.
   */
  async shutdown(): Promise<void> {
    await Promise.all(this._instances.map((inst) => this._shutdownInstance(inst)));
    this._instances.length = 0;
    for (const slot of this._memberSlots) {
      slot.instance = null;
    }
    this._started = false;
    this._connectionInfo = null;
    // Allow OS to reclaim ports before the next test
    await sleep(50);
  }

  /**
   * Returns the connection info after {@link startSingle} or {@link startThreeNode}
   * has been called.
   */
  getConnectionInfo(): ClusterConnectionInfo {
    if (!this._connectionInfo) {
      throw new Error("HeliosTestCluster: cluster not started — call startSingle() or startThreeNode() first");
    }
    return this._connectionInfo;
  }

  isStarted(): boolean {
    return this._started;
  }

  getMemberConnectionInfo(index: number): MemberConnectionInfo {
    const slot = this._getMemberSlot(index);

    return {
      name: slot.name,
      host: slot.host,
      clientPort: slot.clientPort,
      memberPort: slot.memberPort,
    };
  }

  getRunningInstances(): HeliosInstanceImpl[] {
    return this._memberSlots
      .map((slot) => slot.instance)
      .filter((instance): instance is HeliosInstanceImpl => instance !== null);
  }

  async stopMember(index: number): Promise<void> {
    const slot = this._getMemberSlot(index);
    if (slot.instance === null) {
      throw new Error(`HeliosTestCluster: member ${index} is not running`);
    }

    const instance = slot.instance;
    slot.instance = null;
    this._removeInstance(instance);
    await this._shutdownInstance(instance);
    this._refreshConnectionInfo();
  }

  async restartMember(index: number): Promise<MemberConnectionInfo> {
    const slot = this._getMemberSlot(index);
    if (slot.instance !== null) {
      throw new Error(`HeliosTestCluster: member ${index} is already running`);
    }

    const instance = await this._startMember(slot, this._memberSlots.length, true);
    this._instances.push(instance);
    slot.instance = instance;
    this._refreshConnectionInfo();

    return this.getMemberConnectionInfo(index);
  }

  async addMember(): Promise<MemberConnectionInfo> {
    if (!this._started) {
      throw new Error("HeliosTestCluster: cluster not started");
    }

    const index = this._memberSlots.length;
    const slot: MemberSlot = {
      name: `node-${index}`,
      host: "127.0.0.1",
      memberPort: this._memberBasePort + index,
      clientPort: this._clientBasePort + index,
      instance: null,
    };
    this._memberSlots.push(slot);

    const instance = await this._startMember(slot, this._memberSlots.length, true);
    this._instances.push(instance);
    slot.instance = instance;
    this._refreshConnectionInfo();

    return this.getMemberConnectionInfo(index);
  }

  reassignStoppedMemberPorts(index: number): MemberConnectionInfo {
    const slot = this._getMemberSlot(index);
    if (slot.instance !== null) {
      throw new Error(`HeliosTestCluster: member ${index} must be stopped before reassigning ports`);
    }

    slot.memberPort = this._memberBasePort + this._memberSlots.length + index;
    slot.clientPort = this._clientBasePort + this._memberSlots.length + index;
    this._refreshConnectionInfo();
    return this.getMemberConnectionInfo(index);
  }

  async waitForRunningClusterSize(expectedSize: number, timeoutMs = 30_000): Promise<void> {
    let consecutiveStablePolls = 0;
    const requiredStablePolls = 2;

    await waitUntil(() => {
      const runningSlots = this._memberSlots.filter((slot) => slot.instance !== null);

      if (runningSlots.length !== expectedSize) {
        consecutiveStablePolls = 0;
        return false;
      }

      const expectedMemberAddresses = new Set(
        runningSlots.map((slot) => `${slot.host}:${slot.memberPort}`),
      );

      const clusterViewsMatch = runningSlots.every((slot) => {
        const members = slot.instance!.getCluster().getMembers();
        if (members.length !== expectedSize) {
          return false;
        }

        const actualMemberAddresses = new Set(
          members.map((member) => {
            const address = member.getAddress();
            return `${address.getHost()}:${address.getPort()}`;
          }),
        );

        return actualMemberAddresses.size === expectedMemberAddresses.size
          && [...actualMemberAddresses].every((address) => expectedMemberAddresses.has(address));
      });

      if (!clusterViewsMatch) {
        consecutiveStablePolls = 0;
        return false;
      }

      consecutiveStablePolls += 1;
      return consecutiveStablePolls >= requiredStablePolls;
    }, timeoutMs);
  }

  async waitForRunningMemberCount(expectedSize: number, timeoutMs = 10_000): Promise<void> {
    await waitUntil(
      () => this._memberSlots.filter((slot) => slot.instance !== null).length === expectedSize,
      timeoutMs,
    );
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private async _start(nodeCount: 1 | 3): Promise<ClusterConnectionInfo> {
    if (this._started) {
      throw new Error("HeliosTestCluster: already started");
    }

    this._memberSlots = this._createMemberSlots(nodeCount);

    for (const slot of this._memberSlots) {
      const instance = await this._startMember(slot, nodeCount, true);
      slot.instance = instance;
      this._instances.push(instance);
    }

    if (nodeCount > 1) {
      await this.waitForRunningClusterSize(nodeCount);
    }

    const members: MemberConnectionInfo[] = this._memberSlots.map((slot) => ({
      name: slot.name,
      host: slot.host,
      clientPort: slot.clientPort,
      memberPort: slot.memberPort,
    }));

    // Verify all client protocol servers started
    for (const m of members) {
      if (m.clientPort <= 0) {
        await this.shutdown();
        throw new Error(
          `HeliosTestCluster: ClientProtocolServer did not start on node ${m.name}. ` +
          "Ensure the cluster helper reserved a valid client protocol port.",
        );
      }
    }

    const addresses = members.map((m) => `${m.host}:${m.clientPort}`);

    this._connectionInfo = {
      clusterName: this._clusterName,
      members,
      addresses,
    };
    this._started = true;

    return this._connectionInfo;
  }

  private _refreshConnectionInfo(): void {
    if (!this._started || this._connectionInfo === null) {
      return;
    }

    const members: MemberConnectionInfo[] = this._memberSlots.map((slot) => ({
      name: slot.name,
      host: slot.host,
      clientPort: slot.clientPort,
      memberPort: slot.memberPort,
    }));
    this._connectionInfo = {
      clusterName: this._clusterName,
      members,
      addresses: members.map((member) => `${member.host}:${member.clientPort}`),
    };
  }

  private async _startMember(
    slot: MemberSlot,
    nodeCount: number,
    useTcpSeedJoin: boolean,
  ): Promise<HeliosInstanceImpl> {
    const seedSlots = this._memberSlots.filter((memberSlot) => memberSlot.instance !== null);
    const instance = await Helios.newInstance(
      this._buildConfig(
        slot.name,
        slot.memberPort,
        slot.clientPort,
        nodeCount,
        seedSlots,
        useTcpSeedJoin,
      ),
    );
    await instance.waitForClientProtocolReady();

    if (instance.getClientProtocolPort() !== slot.clientPort) {
      await this._shutdownInstance(instance);
      throw new Error(
        `HeliosTestCluster: expected client port ${slot.clientPort} for ${slot.name}, `
        + `got ${instance.getClientProtocolPort()}`,
      );
    }

    return instance;
  }

  private _buildConfig(
    nodeName: string,
    memberPort: number,
    clientPort: number,
    nodeCount: number,
    seedSlots: MemberSlot[],
    useTcpSeedJoin: boolean,
  ): HeliosConfig {
    const cfg = new HeliosConfig(nodeName);
    cfg.setClusterName(this._clusterName);

    const network = cfg.getNetworkConfig();

    network.setClientProtocolPort(clientPort);

    // Bind the cluster transport on a deterministic port
    network.setPort(memberPort);
    network.setPortAutoIncrement(false);

    if (nodeCount > 1 || useTcpSeedJoin) {
      const join = network.getJoin();
      join.getMulticastConfig().setEnabled(false);
      join.getTcpIpConfig()
        .setEnabled(true)
        .clear()
        .setConnectionTimeoutSeconds(1);

      if (useTcpSeedJoin && seedSlots.length > 0) {
        join.getTcpIpConfig().setMembers(seedSlots.map((memberSlot) => `${memberSlot.host}:${memberSlot.memberPort}`));
      }
    } else {
      // Single-node: no join needed — disable multicast to keep tests fast
      network.getJoin().getMulticastConfig().setEnabled(false);
      network.getJoin().getTcpIpConfig().setEnabled(false).clear();
    }

    return cfg;
  }

  private _createMemberSlots(nodeCount: 1 | 3): MemberSlot[] {
    return Array.from({ length: nodeCount }, (_, index) => ({
      name: `node-${index}`,
      host: "127.0.0.1",
      memberPort: this._memberBasePort + index,
      clientPort: this._clientBasePort + index,
      instance: null,
    }));
  }

  private _getMemberSlot(index: number): MemberSlot {
    const slot = this._memberSlots[index];
    if (slot === undefined) {
      throw new Error(`HeliosTestCluster: member ${index} does not exist`);
    }
    return slot;
  }

  private _removeInstance(instance: HeliosInstanceImpl): void {
    const index = this._instances.indexOf(instance);
    if (index >= 0) {
      this._instances.splice(index, 1);
    }
  }

  private async _shutdownInstance(instance: HeliosInstanceImpl): Promise<void> {
    if (!instance.isRunning()) {
      return;
    }

    await instance.shutdownAsync();
  }
}

// ── Static factory helpers ────────────────────────────────────────────────────

/**
 * Start a single-member Helios cluster and return an object with connection
 * info and a `shutdown()` callback.
 *
 * ```typescript
 * const cluster = await startSingleMemberCluster("my-cluster");
 * // ... run tests using cluster.addresses ...
 * await cluster.shutdown();
 * ```
 */
export async function startSingleMemberCluster(
  clusterName?: string,
): Promise<HeliosTestCluster & { connectionInfo: ClusterConnectionInfo }> {
  const cluster = new HeliosTestCluster(clusterName);
  const connectionInfo = await cluster.startSingle();
  return Object.assign(cluster, { connectionInfo });
}

/**
 * Start a three-member Helios cluster and return an object with connection
 * info and a `shutdown()` callback.
 */
export async function startThreeMemberCluster(
  clusterName?: string,
): Promise<HeliosTestCluster & { connectionInfo: ClusterConnectionInfo }> {
  const cluster = new HeliosTestCluster(clusterName);
  const connectionInfo = await cluster.startThreeNode();
  return Object.assign(cluster, { connectionInfo });
}

// ── Utilities ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
