/**
 * HeliosTestCluster — programmatic test helper for official hazelcast-client interop tests.
 *
 * Starts one or three Helios server instances in-process, exposes the client protocol
 * port(s) for the official hazelcast-client npm package to connect to, and provides
 * clean shutdown semantics.
 *
 * Each cluster is isolated: it uses a unique cluster name to avoid cross-test
 * interference and binds the client protocol listener on an ephemeral port (0) so
 * there are never port conflicts between parallel test suites.
 */
import { Helios } from "@zenystx/helios-core/Helios";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import type { HeliosInstanceImpl } from "@zenystx/helios-core/instance/impl/HeliosInstanceImpl";

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

export class HeliosTestCluster {
  private readonly _clusterName: string;
  private readonly _instances: HeliosInstanceImpl[] = [];
  private _connectionInfo: ClusterConnectionInfo | null = null;
  private _started = false;

  constructor(clusterName?: string) {
    this._clusterName = clusterName ?? `interop-${++clusterCounter}-${Date.now()}`;
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
    for (const inst of this._instances) {
      if (inst.isRunning()) {
        inst.shutdown();
      }
    }
    this._instances.length = 0;
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

  // ── Internal ────────────────────────────────────────────────────────────────

  private async _start(nodeCount: 1 | 3): Promise<ClusterConnectionInfo> {
    if (this._started) {
      throw new Error("HeliosTestCluster: already started");
    }

    const basePort = 17000 + Math.floor(Math.random() * 1000) * 3;
    const memberPorts: number[] = Array.from({ length: nodeCount }, (_, i) => basePort + i);

    for (let i = 0; i < nodeCount; i++) {
      const nodeName = `${this._clusterName}-node-${i}`;
      const cfg = this._buildConfig(nodeName, memberPorts[i]!, memberPorts.filter((_, j) => j !== i));
      const inst = await Helios.newInstance(cfg);
      this._instances.push(inst);
    }

    // Allow client protocol servers to bind their ephemeral ports
    await sleep(120);

    const members: MemberConnectionInfo[] = this._instances.map((inst, i) => ({
      name: `node-${i}`,
      host: "127.0.0.1",
      clientPort: inst.getClientProtocolPort(),
    }));

    // Verify all client protocol servers started
    for (const m of members) {
      if (m.clientPort <= 0) {
        await this.shutdown();
        throw new Error(
          `HeliosTestCluster: ClientProtocolServer did not start on node ${m.name}. ` +
          "Ensure setClientProtocolPort(0) is set in config.",
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

  private _buildConfig(nodeName: string, memberPort: number, peerPorts: number[]): HeliosConfig {
    const cfg = new HeliosConfig(nodeName);
    cfg.setClusterName(this._clusterName);

    const network = cfg.getNetworkConfig();

    // Client protocol on ephemeral port (0 = OS-assigned)
    network.setClientProtocolPort(0);

    if (peerPorts.length > 0) {
      // Enable TCP-IP join for multi-node clusters
      const tcpIp = network.getJoin().getTcpIpConfig();
      tcpIp.setEnabled(true);
      network.setPort(memberPort);
      network.setPortAutoIncrement(false);
      for (const port of peerPorts) {
        tcpIp.addMember(`127.0.0.1:${port}`);
      }
    } else {
      // Single-node: no join needed — disable multicast to keep tests fast
      network.getJoin().getMulticastConfig().setEnabled(false);
    }

    return cfg;
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
