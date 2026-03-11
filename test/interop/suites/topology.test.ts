import { Client } from "hazelcast-client";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HeliosTestCluster } from "../helpers/HeliosTestCluster";
import { waitUntil } from "../helpers/waitUntil";

describe("Official Client — Topology updates", () => {
  let cluster: HeliosTestCluster;
  let hzClient: Awaited<ReturnType<typeof Client.newHazelcastClient>> | null = null;

  beforeEach(async () => {
    cluster = new HeliosTestCluster();
    await cluster.startSingle();
  });

  afterEach(async () => {
    if (hzClient !== null) {
      try {
        await hzClient.shutdown();
      } catch {
        // Ignore disconnect races during cleanup.
      }
      hzClient = null;
    }
    await cluster.shutdown();
  });

  it("publishes join, leave, and endpoint update changes after startup", async () => {
    const { clusterName, addresses } = cluster.getConnectionInfo();
    hzClient = await Client.newHazelcastClient({
      clusterName,
      network: {
        clusterMembers: [addresses[0]!],
        connectionTimeout: 10_000,
      },
      connectionStrategy: {
        connectionRetry: {
          clusterConnectTimeoutMillis: 15_000,
        },
      },
    });

    await waitForClientMembers(hzClient, 1);

    await cluster.addMember();
    await cluster.waitForRunningClusterSize(2);
    await waitForClientMembers(hzClient, 2);

    const memberBeforeLeave = collectMemberAddresses(hzClient);
    expect(memberBeforeLeave.size).toBe(2);

    await cluster.stopMember(1);
    await cluster.waitForRunningClusterSize(1);
    await waitForClientMembers(hzClient, 1);

    cluster.reassignStoppedMemberPorts(1);
    await cluster.restartMember(1);
    await cluster.waitForRunningClusterSize(2);
    await waitForClientMembers(hzClient, 2);

    const memberAfterEndpointUpdate = collectMemberAddresses(hzClient);
    expect(memberAfterEndpointUpdate.size).toBe(2);
    expect(memberAfterEndpointUpdate).not.toEqual(memberBeforeLeave);
  }, 60_000);
});

async function waitForClientMembers(
  client: Awaited<ReturnType<typeof Client.newHazelcastClient>>,
  expectedCount: number,
): Promise<void> {
  await waitUntil(() => client.getCluster().getMembers().length === expectedCount, 30_000);
}

function collectMemberAddresses(
  client: Awaited<ReturnType<typeof Client.newHazelcastClient>>,
): Set<string> {
  return new Set(client.getCluster().getMembers().map((member) => {
    const address = (member as any).getAddress?.() ?? (member as any).address;
    const host = address?.getHost?.() ?? address?.host ?? "unknown";
    const port = address?.getPort?.() ?? address?.port ?? -1;
    return `${host}:${port}`;
  }));
}
