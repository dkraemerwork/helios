/**
 * Block 7.5 — Multi-node TCP integration test.
 * Block 12.A3: Updated to use async IMap methods.
 *
 * Proves two real Helios instances can communicate over TCP using
 * Bun.listen / Bun.connect via the TcpClusterTransport:
 *  - Instance A starts, listens on a port
 *  - Instance B connects to Instance A
 *  - Instance B puts a map entry that Instance A can read
 *  - Instance A puts a map entry that Instance B can read
 *  - Near-cache INVALIDATE messages propagate between nodes
 */
import { Helios } from "@zenystx/helios-core/Helios";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import { QueueConfig } from "@zenystx/helios-core/config/QueueConfig";
import { RingbufferConfig } from "@zenystx/helios-core/config/RingbufferConfig";
import { TopicConfig } from "@zenystx/helios-core/config/TopicConfig";
import type { HeliosInstanceImpl } from "@zenystx/helios-core/instance/impl/HeliosInstanceImpl";
import { RingbufferService } from "@zenystx/helios-core/ringbuffer/impl/RingbufferService";
import { afterEach, describe, expect, it } from "bun:test";

// Ports in the 15780+ range — unlikely to conflict with other tests.
const BASE_PORT = 15780;

/** Wait (poll) until `predicate()` returns true or timeout is reached. */
async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) {
      throw new Error(`waitUntil: timed out after ${timeoutMs} ms`);
    }
    await Bun.sleep(20);
  }
}

/** Wait for nodeA to see at least `count` connected peers. */
async function waitForPeers(
  instance: HeliosInstanceImpl,
  count: number,
): Promise<void> {
  await waitUntil(() => instance.getTcpPeerCount() >= count);
}

async function waitForClusterSize(
  instance: HeliosInstanceImpl,
  count: number,
): Promise<void> {
  await waitUntil(() => instance.getCluster().getMembers().length === count);
}

describe("Multi-node TCP integration", () => {
  const instances: HeliosInstanceImpl[] = [];

  afterEach(async () => {
    for (const inst of instances) {
      if (inst.isRunning()) inst.shutdown();
    }
    instances.length = 0;
    // Brief pause so ports are fully released before next test
    await Bun.sleep(30);
  });

  // ── Helpers ───────────────────────────────────────────────────────────

  async function startNode(
    nodeName: string,
    portOffset: number,
    peerPorts: number[] = [],
    configure?: (config: HeliosConfig) => void,
  ): Promise<HeliosInstanceImpl> {
    const cfg = new HeliosConfig(nodeName);
    cfg
      .getNetworkConfig()
      .setPort(BASE_PORT + portOffset)
      .getJoin()
      .getTcpIpConfig()
      .setEnabled(true);
    for (const peerPort of peerPorts) {
      cfg
        .getNetworkConfig()
        .getJoin()
        .getTcpIpConfig()
        .addMember(`localhost:${peerPort}`);
    }
    configure?.(cfg);
    const inst = await Helios.newInstance(cfg);
    instances.push(inst);
    return inst;
  }

  async function startNodeA(portOffset = 0): Promise<HeliosInstanceImpl> {
    return startNode(`nodeA-${portOffset}`, portOffset);
  }

  async function startNodeB(
    portOffset: number,
    peerPort: number,
  ): Promise<HeliosInstanceImpl> {
    return startNode(`nodeB-${portOffset}`, portOffset, [peerPort]);
  }

  async function waitForQueueReplicaState(
    owner: HeliosInstanceImpl,
    backup: HeliosInstanceImpl,
    queueName: string,
    itemCount: number,
  ): Promise<void> {
    await waitUntil(() => {
      const ownerStats = owner.getQueue(queueName).getLocalQueueStats();
      const backupStats = backup.getQueue(queueName).getLocalQueueStats();
      return (
        ownerStats.getOwnedItemCount() === itemCount &&
        backupStats.getBackupItemCount() === itemCount
      );
    }, 10_000);
  }

  async function resolveQueueOwnerAndBackup(
    left: HeliosInstanceImpl,
    right: HeliosInstanceImpl,
    queueName: string,
    itemCount: number,
  ): Promise<{
    owner: HeliosInstanceImpl;
    backup: HeliosInstanceImpl;
  }> {
    await waitUntil(() => {
      const leftStats = left.getQueue(queueName).getLocalQueueStats();
      const rightStats = right.getQueue(queueName).getLocalQueueStats();
      return (
        (leftStats.getOwnedItemCount() === itemCount &&
          rightStats.getBackupItemCount() === itemCount) ||
        (rightStats.getOwnedItemCount() === itemCount &&
          leftStats.getBackupItemCount() === itemCount)
      );
    });

    const leftStats = left.getQueue(queueName).getLocalQueueStats();
    if (leftStats.getOwnedItemCount() === itemCount) {
      return { owner: left, backup: right };
    }
    return { owner: right, backup: left };
  }

  function getRingbufferState(
    instance: HeliosInstanceImpl,
    ringbufferName: string,
  ): {
    ownerId: string | null;
    size: number;
    headSequence: number;
    tailSequence: number;
    items: string[];
  } {
    const service = instance.getRingbufferService();
    const partitionId = service.getRingbufferPartitionId(ringbufferName);
    const container = service.getContainerOrNull(
      partitionId,
      RingbufferService.getRingbufferNamespace(ringbufferName),
    );
    if (container === null) {
      return {
        ownerId: instance.getPartitionOwnerId(partitionId),
        size: 0,
        headSequence: -1,
        tailSequence: -1,
        items: [],
      };
    }
    const nodeEngine = instance.getNodeEngine();
    const items: string[] = [];
    for (
      let sequence = container.headSequence();
      sequence <= container.tailSequence();
      sequence++
    ) {
      const item = nodeEngine.toObject<string>(
        container.getRingbuffer().read(sequence) as any,
      );
      if (item !== null) {
        items.push(item);
      }
    }
    return {
      ownerId: instance.getPartitionOwnerId(partitionId),
      size: container.size(),
      headSequence: container.headSequence(),
      tailSequence: container.tailSequence(),
      items,
    };
  }

  function resolveRingbufferOwnerAndBackup(
    left: HeliosInstanceImpl,
    right: HeliosInstanceImpl,
    ringbufferName: string,
  ): {
    owner: HeliosInstanceImpl;
    backup: HeliosInstanceImpl;
  } {
    const leftState = getRingbufferState(left, ringbufferName);
    if (leftState.ownerId === left.getLocalMemberId()) {
      return { owner: left, backup: right };
    }
    return { owner: right, backup: left };
  }

  async function readRingbufferItems(
    instance: HeliosInstanceImpl,
    ringbufferName: string,
  ): Promise<string[]> {
    const service = (instance as any)._distributedRingbufferService;
    const items = await service.readMany(ringbufferName, 0, 1, 100);
    return items.map((item: unknown) =>
      instance.getNodeEngine().toObject<string>(item as any),
    );
  }

  // ── Tests ─────────────────────────────────────────────────────────────

  it("nodeB_put_replicates_to_nodeA", async () => {
    const nodeA = await startNodeA(0);
    const nodeB = await startNodeB(1, BASE_PORT + 0);

    await waitForPeers(nodeA, 1);

    const mapB = nodeB.getMap<string, string>("shared");
    await mapB.put("hello", "world");

    // Allow replication to propagate
    await waitUntil(
      async () =>
        (await nodeA.getMap<string, string>("shared").get("hello")) === "world",
    );

    expect(await nodeA.getMap<string, string>("shared").get("hello")).toBe(
      "world",
    );
  });

  it("nodeA_put_replicates_to_nodeB", async () => {
    const nodeA = await startNodeA(2);
    const nodeB = await startNodeB(3, BASE_PORT + 2);

    await waitForPeers(nodeA, 1);

    const mapA = nodeA.getMap<string, string>("shared");
    await mapA.put("foo", "bar");

    await waitUntil(
      async () =>
        (await nodeB.getMap<string, string>("shared").get("foo")) === "bar",
    );

    expect(await nodeB.getMap<string, string>("shared").get("foo")).toBe("bar");
  });

  it("remove_propagates_to_peer", async () => {
    const nodeA = await startNodeA(4);
    const nodeB = await startNodeB(5, BASE_PORT + 4);

    await waitForPeers(nodeA, 1);

    // Put on A, verify B sees it
    await nodeA.getMap<string, string>("shared").put("k", "v");
    await waitUntil(
      async () =>
        (await nodeB.getMap<string, string>("shared").get("k")) === "v",
    );

    // Remove on A, verify B loses it
    await nodeA.getMap<string, string>("shared").remove("k");
    await waitUntil(
      async () =>
        (await nodeB.getMap<string, string>("shared").get("k")) === null,
    );

    expect(await nodeB.getMap<string, string>("shared").get("k")).toBeNull();
  });

  it("entry_listener_fires_for_local_put_in_clustered_mode", async () => {
    const nodeA = await startNodeA(6);
    const nodeB = await startNodeB(7, BASE_PORT + 6);

    await waitForPeers(nodeA, 1);
    await waitForClusterSize(nodeA, 2);

    const received: string[] = [];
    const mapA = nodeA.getMap<string, string>("listen-map");
    mapA.addEntryListener(
      {
        entryAdded: (event) =>
          received.push(`add:${event.getKey()}=${event.getValue()}`),
      },
      true,
    );

    // A puts entries — entry listeners fire for local puts
    await mapA.put("x", "1");
    await mapA.put("y", "2");

    // Entry listeners fire synchronously for locally-routed puts
    expect(received).toContain("add:x=1");
    expect(received).toContain("add:y=2");
  });

  it("owner_routed_get_sees_latest_value_after_update", async () => {
    const nodeA = await startNodeA(8);
    const nodeB = await startNodeB(9, BASE_PORT + 8);

    await waitForPeers(nodeA, 1);
    await waitForClusterSize(nodeA, 2);

    // Seed a value via A
    await nodeA.getMap<string, string>("inv-map").put("key", "v1");

    // B reads via owner routing — should see v1
    expect(await nodeB.getMap<string, string>("inv-map").get("key")).toBe("v1");

    // A updates the value
    await nodeA.getMap<string, string>("inv-map").put("key", "v2");

    // B reads again — should see v2 immediately (routed to owner)
    expect(await nodeB.getMap<string, string>("inv-map").get("key")).toBe("v2");
  });

  it("bidirectional_put_and_update", async () => {
    const nodeA = await startNodeA(10);
    const nodeB = await startNodeB(11, BASE_PORT + 10);

    await waitForPeers(nodeA, 1);

    const mapA = nodeA.getMap<string, string>("bidir");
    const mapB = nodeB.getMap<string, string>("bidir");

    // A puts
    await mapA.put("a", "1");
    await waitUntil(async () => (await mapB.get("a")) === "1");
    expect(await mapB.get("a")).toBe("1");

    // B puts
    await mapB.put("b", "2");
    await waitUntil(async () => (await mapA.get("b")) === "2");
    expect(await mapA.get("b")).toBe("2");

    // A updates B's entry
    await mapA.put("b", "3");
    await waitUntil(async () => (await mapB.get("b")) === "3");
    expect(await mapB.get("b")).toBe("3");
  });

  it("queue_offer_replicates_and_remote_poll_updates_owner", async () => {
    const nodeA = await startNodeA(12);
    const nodeB = await startNodeB(13, BASE_PORT + 12);

    await waitForPeers(nodeA, 1);

    const queueA = nodeA.getQueue<{ id: string }>("jobs");
    const queueB = nodeB.getQueue<{ id: string }>("jobs");

    expect(await queueA.offer({ id: "job-1" })).toBe(true);

    await waitUntil(async () => (await queueB.size()) === 1);
    expect(await queueB.poll()).toEqual({ id: "job-1" });
    await waitUntil(async () => (await queueA.size()) === 0);
  });

  it("topic_publish_reaches_remote_listener", async () => {
    const nodeA = await startNodeA(14);
    const nodeB = await startNodeB(15, BASE_PORT + 14);

    await waitForPeers(nodeA, 1);

    const received: string[] = [];
    nodeB.getTopic<string>("events").addMessageListener((message) => {
      received.push(message.getMessageObject());
    });

    nodeA.getTopic<string>("events").publish("hello");

    await waitUntil(() => received.includes("hello"));
    expect(received).toContain("hello");
  });

  it("queue_backup_is_promoted_when_owner_shuts_down", async () => {
    const queueConfig = new QueueConfig("jobs").setBackupCount(1);
    const nodeA = await startNode("queue-owner-a", 16, [], (config) =>
      config.addQueueConfig(queueConfig),
    );
    const nodeB = await startNode(
      "queue-owner-b",
      17,
      [BASE_PORT + 16],
      (config) => config.addQueueConfig(queueConfig),
    );

    await waitForPeers(nodeA, 1);
    await waitForClusterSize(nodeA, 2);
    await waitForClusterSize(nodeB, 2);

    const queueName = "jobs";
    await nodeA.getQueue<string>(queueName).offer("job-1");
    await nodeB.getQueue<string>(queueName).offer("job-2");

    await waitUntil(
      async () => (await nodeA.getQueue<string>(queueName).size()) === 2,
    );
    await waitUntil(
      async () => (await nodeB.getQueue<string>(queueName).size()) === 2,
    );

    const { owner, backup } = await resolveQueueOwnerAndBackup(
      nodeA,
      nodeB,
      queueName,
      2,
    );

    owner.shutdown();

    await waitUntil(() => !owner.isRunning());
    await waitForClusterSize(backup, 1);
    await waitUntil(
      async () => (await backup.getQueue<string>(queueName).size()) === 2,
    );

    expect(await backup.getQueue<string>(queueName).poll()).toBe("job-1");
    expect(await backup.getQueue<string>(queueName).poll()).toBe("job-2");
    expect(await backup.getQueue<string>(queueName).poll()).toBeNull();
  });

  it("promoted_queue_owner_syncs_state_to_a_new_backup", async () => {
    const queueConfig = new QueueConfig("jobs").setBackupCount(1);
    const nodeA = await startNode("queue-sync-a", 18, [], (config) =>
      config.addQueueConfig(queueConfig),
    );
    const nodeB = await startNode(
      "queue-sync-b",
      19,
      [BASE_PORT + 18],
      (config) => config.addQueueConfig(queueConfig),
    );

    await waitForPeers(nodeA, 1);
    await waitForClusterSize(nodeA, 2);
    await waitForPeers(nodeB, 1);
    await waitForClusterSize(nodeB, 2);

    const queueName = "jobs";
    await nodeA.getQueue<string>(queueName).offer("job-1");
    await nodeA.getQueue<string>(queueName).offer("job-2");

    const { owner, backup } = await resolveQueueOwnerAndBackup(
      nodeA,
      nodeB,
      queueName,
      2,
    );

    owner.shutdown();
    await waitForClusterSize(backup, 1);

    const nodeC = await startNode(
      "queue-sync-c",
      20,
      [backup.getConfig().getNetworkConfig().getPort()],
      (config) => config.addQueueConfig(queueConfig),
    );

    await waitForPeers(backup, 1);
    await waitForClusterSize(backup, 2);
    await waitForClusterSize(nodeC, 2);
    const { owner: currentOwner, backup: currentBackup } =
      await resolveQueueOwnerAndBackup(backup, nodeC, queueName, 2);

    expect(await currentOwner.getQueue<string>(queueName).poll()).toBe("job-1");
    await waitForQueueReplicaState(currentOwner, currentBackup, queueName, 1);
    expect(await currentOwner.getQueue<string>(queueName).poll()).toBe("job-2");
    await waitForQueueReplicaState(currentOwner, currentBackup, queueName, 0);
  }, 30_000);

  it("ringbuffer_backup_is_promoted_when_owner_shuts_down", async () => {
    const ringbufferConfig = new RingbufferConfig("events")
      .setCapacity(10)
      .setBackupCount(1);
    const nodeA = await startNode("ringbuffer-owner-a", 23, [], (config) =>
      config.addRingbufferConfig(ringbufferConfig),
    );
    const nodeB = await startNode(
      "ringbuffer-owner-b",
      24,
      [BASE_PORT + 23],
      (config) => config.addRingbufferConfig(ringbufferConfig),
    );

    await waitForPeers(nodeA, 1);
    await waitForClusterSize(nodeA, 2);
    await waitForClusterSize(nodeB, 2);

    const ringbufferName = "events";
    const items = ["event-1", "event-2", "event-3"];
    const { owner, backup } = resolveRingbufferOwnerAndBackup(
      nodeA,
      nodeB,
      ringbufferName,
    );
    const ownerService = (owner as any)._distributedRingbufferService;

    for (const item of items) {
      await ownerService.add(ringbufferName, owner.getNodeEngine().toData(item)!);
    }

    owner.shutdown();

    await waitUntil(() => !owner.isRunning());
    await waitForClusterSize(backup, 1);
    await waitUntil(
      () => getRingbufferState(backup, ringbufferName).size === items.length,
      10_000,
    );
    const recoveredItems = await readRingbufferItems(backup, ringbufferName);
    const state = getRingbufferState(backup, ringbufferName);

    expect(recoveredItems).toEqual(items);
    expect(state.size).toBe(3);
    expect(state.headSequence).toBe(0);
    expect(state.tailSequence).toBe(2);
  }, 30_000);

  it("promoted_ringbuffer_owner_keeps_state_when_a_member_restarts", async () => {
    const ringbufferConfig = new RingbufferConfig("events")
      .setCapacity(10)
      .setBackupCount(1);
    const nodeA = await startNode("ringbuffer-sync-a", 25, [], (config) =>
      config.addRingbufferConfig(ringbufferConfig),
    );
    const nodeB = await startNode(
      "ringbuffer-sync-b",
      26,
      [BASE_PORT + 25],
      (config) => config.addRingbufferConfig(ringbufferConfig),
    );

    await waitForPeers(nodeA, 1);
    await waitForClusterSize(nodeA, 2);
    await waitForClusterSize(nodeB, 2);

    const ringbufferName = "events";
    const items = ["event-1", "event-2", "event-3"];
    const { owner, backup } = resolveRingbufferOwnerAndBackup(
      nodeA,
      nodeB,
      ringbufferName,
    );
    const ownerService = (owner as any)._distributedRingbufferService;
    for (const item of items) {
      await ownerService.add(ringbufferName, owner.getNodeEngine().toData(item)!);
    }
    const restartPort = owner === nodeA ? BASE_PORT + 25 : BASE_PORT + 26;

    owner.shutdown();
    await waitUntil(() => !owner.isRunning());
    await waitForClusterSize(backup, 1);

    const restarted = await startNode(
      "ringbuffer-sync-restarted",
      restartPort - BASE_PORT,
      [backup.getConfig().getNetworkConfig().getPort()],
      (config) => config.addRingbufferConfig(ringbufferConfig),
    );

    await waitForPeers(backup, 1);
    await waitForClusterSize(backup, 2);
    await waitForClusterSize(restarted, 2);
    await waitUntil(
      () => getRingbufferState(backup, ringbufferName).size === items.length,
      10_000,
    );

    const survivorState = getRingbufferState(backup, ringbufferName);

    expect(survivorState.items).toEqual(items);
    expect(survivorState.headSequence).toBe(0);
    expect(survivorState.tailSequence).toBe(2);
  }, 30_000);

  it("topic_config_without_global_ordering_publishes_after_peer_loss", async () => {
    const topicConfig = new TopicConfig("events").setGlobalOrderingEnabled(
      false,
    );
    const nodeA = await startNode("topic-order-a", 21, [], (config) =>
      config.addTopicConfig(topicConfig),
    );
    const nodeB = await startNode(
      "topic-order-b",
      22,
      [BASE_PORT + 21],
      (config) => config.addTopicConfig(topicConfig),
    );

    await waitForPeers(nodeA, 1);
    await waitForClusterSize(nodeA, 2);

    const received: string[] = [];
    nodeB.getTopic<string>("events").addMessageListener((message) => {
      received.push(message.getMessageObject());
    });

    await nodeA.getTopic<string>("events").publish("before-loss");
    await waitUntil(() => received.includes("before-loss"));

    nodeA.shutdown();
    await waitForClusterSize(nodeB, 1);

    await nodeB.getTopic<string>("events").publish("after-loss");
    await waitUntil(() => received.includes("after-loss"));
    expect(received).toEqual(["before-loss", "after-loss"]);
  });
});
