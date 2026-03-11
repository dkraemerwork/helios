import { Client } from "hazelcast-client";
import { ReconnectMode } from "hazelcast-client/lib/config/ConnectionStrategyConfig";
import { afterEach, describe, expect, it } from "bun:test";
import { buildMalformedUnknownOpcodeRequest, openRawSocket } from "../helpers/RawClientProtocolProbe";
import { HeliosTestCluster } from "../helpers/HeliosTestCluster";
import { waitUntil } from "../helpers/waitUntil";

describe("WP0 Harness Baseline", () => {
  let cluster: HeliosTestCluster | null = null;
  let hzClient: Awaited<ReturnType<typeof Client.newHazelcastClient>> | null = null;
  let recoveryClient: Awaited<ReturnType<typeof Client.newHazelcastClient>> | null = null;

  afterEach(async () => {
    if (hzClient !== null) {
      await shutdownClientQuietly(hzClient);
      hzClient = null;
    }

    if (recoveryClient !== null) {
      await shutdownClientQuietly(recoveryClient);
      recoveryClient = null;
    }

    if (cluster !== null) {
      await cluster.shutdown();
      cluster = null;
    }
  });

  it("proves the WP0 harness can exercise official-client, malformed-input, and restart flows", async () => {
    cluster = new HeliosTestCluster();
    const { clusterName, addresses } = await cluster.startThreeNode();
    const restartMemberIndex = 2;
    const trackedAddress = [addresses[restartMemberIndex]!];

    await cluster.waitForRunningClusterSize(3);

    hzClient = await connectClient(clusterName, trackedAddress, ReconnectMode.ASYNC);
    const map = await hzClient.getMap<string, string>("wp0-harness-map");
    await map.put("before-restart", "value-1");
    expect(await map.get("before-restart")).toBe("value-1");

    const malformedSocket = await openRawSocket(cluster.getMemberConnectionInfo(restartMemberIndex).clientPort);
    malformedSocket.socket.write(buildMalformedUnknownOpcodeRequest(91));

    await expectSocketToClose(malformedSocket.waitForClose, "malformed raw-socket input");
    expect(malformedSocket.receivedBuffers).toHaveLength(0);
    malformedSocket.socket.end();

    const liveSocket = await openRawSocket(cluster.getMemberConnectionInfo(restartMemberIndex).clientPort);
    await cluster.stopMember(restartMemberIndex);

    await expectSocketToClose(liveSocket.waitForClose, "member shutdown failure observation");
    await cluster.waitForRunningMemberCount(2);
    await expectMapToRemainUnavailable(hzClient, "wp0-harness-map", "during-failover", "value-2");

    await cluster.restartMember(restartMemberIndex);
    await cluster.waitForRunningMemberCount(3);

    const restartedSocket = await openRawSocket(cluster.getMemberConnectionInfo(restartMemberIndex).clientPort);
    restartedSocket.socket.end();

    await expectMapToRemainUnavailable(hzClient, "wp0-harness-map", "after-restart", "value-3");

    recoveryClient = await connectClient(clusterName, addresses, ReconnectMode.ON);
    const recoveredMap = await recoveryClient.getMap<string, string>("wp0-harness-map");
    await waitForMapRecovery(recoveredMap, "after-restart", "value-3", "post-restart recovery");
    expect(await recoveredMap.get("after-restart")).toBe("value-3");
  }, 60_000);
});

async function connectClient(
  clusterName: string,
  addresses: string[],
  reconnectMode: ReconnectMode,
): Promise<Awaited<ReturnType<typeof Client.newHazelcastClient>>> {
  return Client.newHazelcastClient({
    clusterName,
    network: {
      clusterMembers: addresses,
      connectionTimeout: 10_000,
    },
    connectionStrategy: {
      reconnectMode,
      connectionRetry: {
        clusterConnectTimeoutMillis: 60_000,
        initialBackoffMillis: 200,
        maxBackoffMillis: 1_000,
        multiplier: 1.2,
        jitter: 0,
      },
    },
    properties: {
      "hazelcast.logging.level": "OFF",
    },
  });
}

async function waitForMapRecovery(
  map: Awaited<ReturnType<Awaited<ReturnType<typeof Client.newHazelcastClient>>["getMap"]>>,
  key: string,
  value: string,
  context: string,
): Promise<void> {
  await Promise.race([
    waitUntil(
      () => attemptMapRoundTrip(map, key, value),
      20_000,
    ),
    Bun.sleep(20_000).then(() => {
      throw new Error(`Timed out waiting for ${context}`);
    }),
  ]);
}

async function expectMapToRemainUnavailable(
  client: Awaited<ReturnType<typeof Client.newHazelcastClient>>,
  mapName: string,
  key: string,
  value: string,
): Promise<void> {
  const deadline = Date.now() + 3_000;

  while (Date.now() < deadline) {
    if (await attemptClientMapRoundTrip(client, mapName, key, value)) {
      throw new Error(`Expected ${mapName} round-trip to remain unavailable`);
    }
    await Bun.sleep(100);
  }
}

async function attemptClientMapRoundTrip(
  client: Awaited<ReturnType<typeof Client.newHazelcastClient>>,
  mapName: string,
  key: string,
  value: string,
): Promise<boolean> {
  try {
    return await Promise.race([
      (async () => {
        const map = await client.getMap<string, string>(mapName);
        await map.put(key, value);
        return (await map.get(key)) === value;
      })(),
      Bun.sleep(1_000).then(() => false),
    ]);
  } catch {
    return false;
  }
}

async function attemptMapRoundTrip(
  map: Awaited<ReturnType<Awaited<ReturnType<typeof Client.newHazelcastClient>>["getMap"]>>,
  key: string,
  value: string,
): Promise<boolean> {
  try {
    return await Promise.race([
      (async () => {
        await map.put(key, value);
        return (await map.get(key)) === value;
      })(),
      Bun.sleep(1_000).then(() => false),
    ]);
  } catch {
    return false;
  }
}

async function expectSocketToClose(waitForClose: Promise<void>, context: string): Promise<void> {
  await Promise.race([
    waitForClose,
    Bun.sleep(5_000).then(() => {
      throw new Error(`Expected socket to close for ${context}`);
    }),
  ]);
}

async function shutdownClientQuietly(client: Awaited<ReturnType<typeof Client.newHazelcastClient>>): Promise<void> {
  try {
    await Promise.race([
      client.shutdown(),
      Bun.sleep(5_000),
    ]);
  } catch {
    // Ignore cleanup races after member shutdown.
  }
}
