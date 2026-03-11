import { Client } from "hazelcast-client";
import { afterEach, describe, expect, it } from "bun:test";
import { buildUnauthenticatedMapPutRequest, openRawSocket } from "../helpers/RawClientProtocolProbe";
import { HeliosTestCluster } from "../helpers/HeliosTestCluster";

describe("WP0 Harness Baseline", () => {
  let cluster: HeliosTestCluster | null = null;
  let hzClient: Awaited<ReturnType<typeof Client.newHazelcastClient>> | null = null;

  afterEach(async () => {
    if (hzClient !== null) {
      try {
        await hzClient.shutdown();
      } catch {
        // Ignore cleanup races after member shutdown.
      }
      hzClient = null;
    }

    if (cluster !== null) {
      await cluster.shutdown();
      cluster = null;
    }
  });

  it("proves the WP0 harness can exercise official-client, malformed-input, and restart flows", async () => {
    cluster = new HeliosTestCluster();
    const { clusterName, addresses } = await cluster.startThreeNode();

    await cluster.waitForRunningClusterSize(3);

    hzClient = await connectClient(clusterName, addresses);
    let map = await hzClient.getMap<string, string>("wp0-harness-map");
    await map.put("before-restart", "value-1");
    expect(await map.get("before-restart")).toBe("value-1");
    await hzClient.shutdown();
    hzClient = null;

    const malformedSocket = await openRawSocket(cluster.getMemberConnectionInfo(0).clientPort);
    malformedSocket.socket.write(
      buildUnauthenticatedMapPutRequest("wp0-harness-map", "bad-key", "bad-value", 91),
    );

    await expectSocketToClose(malformedSocket.waitForClose, "unauthenticated malformed input");
    expect(malformedSocket.receivedBuffers).toHaveLength(0);
    malformedSocket.socket.end();

    const liveSocket = await openRawSocket(cluster.getMemberConnectionInfo(0).clientPort);
    await cluster.stopMember(0);

    await expectSocketToClose(liveSocket.waitForClose, "member shutdown failure observation");
    await cluster.waitForRunningClusterSize(2);

    await cluster.restartMember(0);
    await cluster.waitForRunningClusterSize(3);

    const restartedSocket = await openRawSocket(cluster.getMemberConnectionInfo(0).clientPort);
    restartedSocket.socket.end();

    hzClient = await connectClient(clusterName, addresses);
    map = await hzClient.getMap<string, string>("wp0-harness-map");
    await map.put("after-restart", "value-3");
    expect(await map.get("after-restart")).toBe("value-3");
  }, 60_000);
});

async function connectClient(
  clusterName: string,
  addresses: string[],
): Promise<Awaited<ReturnType<typeof Client.newHazelcastClient>>> {
  return Client.newHazelcastClient({
    clusterName,
    network: {
      clusterMembers: addresses,
      connectionTimeout: 10_000,
    },
    connectionStrategy: {
      connectionRetry: {
        clusterConnectTimeoutMillis: 20_000,
      },
    },
    properties: {
      "hazelcast.logging.level": "OFF",
    },
  });
}

async function expectSocketToClose(waitForClose: Promise<void>, context: string): Promise<void> {
  await Promise.race([
    waitForClose,
    Bun.sleep(5_000).then(() => {
      throw new Error(`Expected socket to close for ${context}`);
    }),
  ]);
}
