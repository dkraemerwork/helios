/**
 * Block K — Official Client Interop: IQueue Tests
 *
 * Verifies IQueue operations via the official hazelcast-client npm package
 * against a live Helios server instance.
 */
import { Client } from "hazelcast-client";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HeliosTestCluster } from "../helpers/HeliosTestCluster";
import { waitUntil } from "../helpers/waitUntil";

describe("Official Client — IQueue", () => {
  let cluster: HeliosTestCluster;
  let hzClient: Awaited<ReturnType<typeof Client.newHazelcastClient>>;

  beforeEach(async () => {
    cluster = new HeliosTestCluster();
    const { clusterName, addresses } = await cluster.startSingle();
    hzClient = await Client.newHazelcastClient({
      clusterName,
      network: { clusterMembers: addresses },
    });
  });

  afterEach(async () => {
    try { await hzClient.shutdown(); } catch { /* ignore */ }
    await cluster.shutdown();
  });

  it("offer and poll — round-trips a string value", async () => {
    const queue = await hzClient.getQueue<string>("interop-queue-basic");
    const offered = await queue.offer("hello-queue");
    expect(offered).toBe(true);
    const polled = await queue.poll();
    expect(polled).toBe("hello-queue");
  });

  it("poll on empty queue — returns null", async () => {
    const queue = await hzClient.getQueue<string>("interop-queue-empty-poll");
    const result = await queue.poll();
    expect(result).toBeNull();
  });

  it("peek — returns head without removing it", async () => {
    const queue = await hzClient.getQueue<string>("interop-queue-peek");
    await queue.offer("peek-value");
    const peeked = await queue.peek();
    expect(peeked).toBe("peek-value");
    // Value should still be in the queue
    expect(await queue.size()).toBe(1);
  });

  it("peek on empty queue — returns null", async () => {
    const queue = await hzClient.getQueue<string>("interop-queue-peek-empty");
    const result = await queue.peek();
    expect(result).toBeNull();
  });

  it("size — reflects correct element count", async () => {
    const queue = await hzClient.getQueue<string>("interop-queue-size");
    expect(await queue.size()).toBe(0);
    await queue.offer("a");
    await queue.offer("b");
    await queue.offer("c");
    expect(await queue.size()).toBe(3);
  });

  it("isEmpty — true when empty, false when not", async () => {
    const queue = await hzClient.getQueue<string>("interop-queue-isempty");
    expect(await queue.isEmpty()).toBe(true);
    await queue.offer("item");
    expect(await queue.isEmpty()).toBe(false);
  });

  it("clear — removes all elements", async () => {
    const queue = await hzClient.getQueue<string>("interop-queue-clear");
    await queue.offer("x");
    await queue.offer("y");
    await queue.clear();
    expect(await queue.size()).toBe(0);
    expect(await queue.isEmpty()).toBe(true);
  });

  it("FIFO ordering — elements polled in insertion order", async () => {
    const queue = await hzClient.getQueue<string>("interop-queue-order");
    await queue.offer("first");
    await queue.offer("second");
    await queue.offer("third");
    expect(await queue.poll()).toBe("first");
    expect(await queue.poll()).toBe("second");
    expect(await queue.poll()).toBe("third");
  });

  it("poll with timeout — waits for element if queue is empty", async () => {
    const queue = await hzClient.getQueue<string>("interop-queue-poll-timeout");
    // Poll with 500ms timeout — should return null since no producer
    const result = await queue.poll(500);
    expect(result).toBeNull();
  });

  it("remainingCapacity — returns positive value for unbounded queue", async () => {
    const queue = await hzClient.getQueue<string>("interop-queue-capacity");
    const cap = await queue.remainingCapacity();
    expect(cap).toBeGreaterThan(0);
  });
});

describe("Official Client — IQueue: clustered recovery", () => {
  let cluster: HeliosTestCluster;
  let hzClient: Awaited<ReturnType<typeof Client.newHazelcastClient>>;

  beforeEach(async () => {
    cluster = new HeliosTestCluster();
    const { clusterName, addresses } = await cluster.startThreeNode();
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
    await waitForClientMembers(hzClient, 3);
  });

  afterEach(async () => {
    try { await hzClient.shutdown(); } catch { /* ignore */ }
    await cluster.shutdown();
  });

  it("routes retained queue operations to a remote owner in a three-member cluster", async () => {
    const queueName = findQueueNameOwnedByMember(cluster, 1, "interop-queue-clustered-routing");
    const queue = await hzClient.getQueue<string>(queueName);

    await queue.offer("first");
    await queue.offer("second");
    await queue.offer("third");

    expect(await queue.peek()).toBe("first");
    expect(await queue.size()).toBe(3);
    expect(await queue.poll()).toBe("first");
    expect(await queue.poll()).toBe("second");
    expect(await queue.poll()).toBe("third");
    expect(await queue.isEmpty()).toBe(true);
  }, 60_000);

  it("preserves FIFO queue state through owner loss and member recovery", async () => {
    const ownerIndex = 1;
    const queueName = findQueueNameOwnedByMember(cluster, ownerIndex, "interop-queue-clustered-failover");
    const queue = await hzClient.getQueue<string>(queueName);

    await queue.offer("alpha");
    await queue.offer("beta");
    await queue.offer("gamma");
    expect(await queue.peek()).toBe("alpha");

    await cluster.stopMember(ownerIndex);
    await cluster.waitForRunningClusterSize(2);
    await waitForClientMembers(hzClient, 2);

    expect(await queue.poll()).toBe("alpha");
    expect(await queue.poll()).toBe("beta");
    expect(await queue.poll()).toBe("gamma");
    expect(await queue.isEmpty()).toBe(true);

    await cluster.restartMember(ownerIndex);
    await cluster.waitForRunningClusterSize(3);
    await waitForClientMembers(hzClient, 3);

    await queue.offer("after-recovery");
    expect(await queue.poll()).toBe("after-recovery");
  }, 60_000);
});

async function waitForClientMembers(
  client: Awaited<ReturnType<typeof Client.newHazelcastClient>>,
  expectedCount: number,
): Promise<void> {
  await waitUntil(() => client.getCluster().getMembers().length === expectedCount, 30_000);
}

function findQueueNameOwnedByMember(
  cluster: HeliosTestCluster,
  memberIndex: number,
  prefix: string,
): string {
  const instances = cluster.getRunningInstances();
  const routingInstance = instances[0]!;
  const targetMemberUuid = instances[memberIndex]!.getCluster().getLocalMember().getUuid();

  for (let attempt = 0; attempt < 10_000; attempt++) {
    const queueName = `${prefix}-${attempt}`;
    const partitionId = routingInstance.getPartitionIdForName(queueName);
    if (routingInstance.getPartitionOwnerId(partitionId) === targetMemberUuid) {
      return queueName;
    }
  }

  throw new Error(`Unable to find a queue name owned by member index ${memberIndex}`);
}
