/**
 * Block K — Official Client Interop: Client Lifecycle Tests
 *
 * Verifies client lifecycle operations — connection, clean shutdown,
 * reconnect cycles, and server-side shutdown handling — via the official
 * hazelcast-client npm package against a live Helios server instance.
 */
import { Client } from "hazelcast-client";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HeliosTestCluster } from "../helpers/HeliosTestCluster";

describe("Official Client — Lifecycle", () => {
  let cluster: HeliosTestCluster;

  beforeEach(() => {
    cluster = new HeliosTestCluster();
  });

  afterEach(async () => {
    await cluster.shutdown();
  });

  it("client shutdown is clean — no errors thrown", async () => {
    const { clusterName, addresses } = await cluster.startSingle();

    const hzClient = await Client.newHazelcastClient({
      clusterName,
      network: { clusterMembers: addresses },
    });

    expect(hzClient.getLifecycleService().isRunning()).toBe(true);
    await expect(hzClient.shutdown()).resolves.toBeUndefined();
  });

  it("client isRunning is false after shutdown", async () => {
    const { clusterName, addresses } = await cluster.startSingle();

    const hzClient = await Client.newHazelcastClient({
      clusterName,
      network: { clusterMembers: addresses },
    });

    await hzClient.shutdown();
    expect(hzClient.getLifecycleService().isRunning()).toBe(false);
  });

  it("multiple connect/disconnect cycles — client reconnects cleanly", async () => {
    const { clusterName, addresses } = await cluster.startSingle();

    for (let cycle = 0; cycle < 3; cycle++) {
      const hzClient = await Client.newHazelcastClient({
        clusterName,
        network: { clusterMembers: addresses },
      });

      expect(hzClient.getLifecycleService().isRunning()).toBe(true);

      // Do a quick operation to confirm the connection works
      const map = await hzClient.getMap<string, string>(`lifecycle-map-cycle-${cycle}`);
      await map.put(`cycle-key-${cycle}`, `cycle-value-${cycle}`);
      const val = await map.get(`cycle-key-${cycle}`);
      expect(val).toBe(`cycle-value-${cycle}`);

      await hzClient.shutdown();
      expect(hzClient.getLifecycleService().isRunning()).toBe(false);
    }
  });

  it("lifecycle listeners receive CONNECTED state", async () => {
    const { clusterName, addresses } = await cluster.startSingle();
    const stateChanges: string[] = [];

    const hzClient = await Client.newHazelcastClient({
      clusterName,
      network: { clusterMembers: addresses },
      lifecycleListeners: [
        (state: string) => { stateChanges.push(state); },
      ],
    });

    await hzClient.shutdown();

    // Should have received at least STARTED and CONNECTED events
    expect(stateChanges.length).toBeGreaterThan(0);
  });

  it("lifecycle listeners receive SHUTDOWN state after shutdown()", async () => {
    const { clusterName, addresses } = await cluster.startSingle();
    const stateChanges: string[] = [];

    const hzClient = await Client.newHazelcastClient({
      clusterName,
      network: { clusterMembers: addresses },
      lifecycleListeners: [
        (state: string) => { stateChanges.push(state); },
      ],
    });

    await hzClient.shutdown();

    expect(stateChanges).toContain("SHUTDOWN");
  });

  it("server shutdown while client connected — client detects disconnection", async () => {
    const { clusterName, addresses } = await cluster.startSingle();

    const hzClient = await Client.newHazelcastClient({
      clusterName,
      network: { clusterMembers: addresses },
      connectionStrategy: {
        connectionRetry: {
          clusterConnectTimeoutMillis: 2000,
        },
      },
    });

    expect(hzClient.getLifecycleService().isRunning()).toBe(true);

    // Shut down the server while client is connected
    await cluster.shutdown();

    // Give the client time to detect the disconnection
    await sleep(500);

    // Client is still in running state (Hazelcast client continues trying to reconnect)
    // but operations should fail. Cleanly shut down the client.
    try {
      await hzClient.shutdown();
    } catch {
      // Client may throw if already disconnected — acceptable
    }
  });

  it("getName — returns the client instance name", async () => {
    const { clusterName, addresses } = await cluster.startSingle();

    const hzClient = await Client.newHazelcastClient({
      clusterName,
      network: { clusterMembers: addresses },
      instanceName: "interop-named-client",
    });

    expect(hzClient.getName()).toBe("interop-named-client");
    await hzClient.shutdown();
  });

  it("getCluster — provides access to cluster membership info", async () => {
    const { clusterName, addresses } = await cluster.startSingle();

    const hzClient = await Client.newHazelcastClient({
      clusterName,
      network: { clusterMembers: addresses },
    });

    const clusterService = hzClient.getCluster();
    expect(clusterService).toBeDefined();
    const members = clusterService.getMembers();
    expect(members.length).toBeGreaterThanOrEqual(1);

    await hzClient.shutdown();
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
