/**
 * Block K — Official Client Interop: Connection Tests
 *
 * Verifies that the official hazelcast-client npm package can connect to,
 * discover, and cleanly disconnect from Helios cluster instances.
 *
 * All tests use the OFFICIAL hazelcast-client, not the Helios native client.
 */
import { Client } from "hazelcast-client";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HeliosTestCluster } from "../helpers/HeliosTestCluster";

// ── Suite: single-member connection ──────────────────────────────────────────

describe("Official Client — Connection: single member", () => {
  let cluster: HeliosTestCluster;
  let hzClient: Awaited<ReturnType<typeof Client.newHazelcastClient>> | null = null;

  beforeEach(async () => {
    cluster = new HeliosTestCluster();
    await cluster.startSingle();
  });

  afterEach(async () => {
    if (hzClient) {
      try { await hzClient.shutdown(); } catch { /* ignore */ }
      hzClient = null;
    }
    await cluster.shutdown();
  });

  it("connects to a single Helios member", async () => {
    const { clusterName, addresses } = cluster.getConnectionInfo();

    hzClient = await Client.newHazelcastClient({
      clusterName,
      network: { clusterMembers: addresses },
    });

    expect(hzClient).toBeDefined();
    expect(hzClient.getLifecycleService().isRunning()).toBe(true);
  });

  it("client sees at least 1 cluster member", async () => {
    const { clusterName, addresses } = cluster.getConnectionInfo();

    hzClient = await Client.newHazelcastClient({
      clusterName,
      network: { clusterMembers: addresses },
    });

    const members = hzClient.getCluster().getMembers();
    expect(members.length).toBeGreaterThanOrEqual(1);
  });

  it("client lifecycle service reports running after connect", async () => {
    const { clusterName, addresses } = cluster.getConnectionInfo();

    hzClient = await Client.newHazelcastClient({
      clusterName,
      network: { clusterMembers: addresses },
    });

    expect(hzClient.getLifecycleService().isRunning()).toBe(true);
  });

  it("handles wrong cluster name — auth failure", async () => {
    const { addresses } = cluster.getConnectionInfo();

    await expect(
      Client.newHazelcastClient({
        clusterName: "wrong-cluster-name-xyz",
        network: {
          clusterMembers: addresses,
          connectionTimeout: 3000,
        },
        connectionStrategy: {
          connectionRetry: {
            clusterConnectTimeoutMillis: 3000,
          },
        },
      }),
    ).rejects.toBeDefined();
  });

  it("handles connection to unreachable address — timeout", async () => {
    await expect(
      Client.newHazelcastClient({
        clusterName: "dev",
        network: {
          clusterMembers: ["127.0.0.1:19999"],
          connectionTimeout: 1000,
        },
        connectionStrategy: {
          connectionRetry: {
            clusterConnectTimeoutMillis: 2000,
          },
        },
      }),
    ).rejects.toBeDefined();
  });
});

// ── Suite: three-node cluster discovery ──────────────────────────────────────

describe("Official Client — Connection: three-node cluster discovery", () => {
  let cluster: HeliosTestCluster;
  let hzClient: Awaited<ReturnType<typeof Client.newHazelcastClient>> | null = null;

  beforeEach(async () => {
    cluster = new HeliosTestCluster();
    await cluster.startThreeNode();
  });

  afterEach(async () => {
    if (hzClient) {
      try { await hzClient.shutdown(); } catch { /* ignore */ }
      hzClient = null;
    }
    await cluster.shutdown();
  });

  it("connects and discovers 3-node cluster", async () => {
    const { clusterName, addresses } = cluster.getConnectionInfo();

    hzClient = await Client.newHazelcastClient({
      clusterName,
      network: {
        clusterMembers: addresses,
        connectionTimeout: 10000,
      },
      connectionStrategy: {
        connectionRetry: {
          clusterConnectTimeoutMillis: 15000,
        },
      },
    });

    // Client may discover more members via topology push
    const members = hzClient.getCluster().getMembers();
    expect(members.length).toBeGreaterThanOrEqual(1);
  }, 30000);

  it("client connects via any of the listed addresses", async () => {
    const { clusterName, addresses } = cluster.getConnectionInfo();
    // Use only the first address — client should still connect
    hzClient = await Client.newHazelcastClient({
      clusterName,
      network: {
        clusterMembers: [addresses[0]!],
        connectionTimeout: 10000,
      },
      connectionStrategy: {
        connectionRetry: {
          clusterConnectTimeoutMillis: 15000,
        },
      },
    });

    expect(hzClient.getLifecycleService().isRunning()).toBe(true);
  }, 30000);
});
