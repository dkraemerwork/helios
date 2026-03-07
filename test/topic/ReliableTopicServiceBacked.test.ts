/**
 * Phase 19T reliable-topic end-to-end coverage.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { Helios } from "@zenystx/helios-core/Helios";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import { ReliableTopicConfig, TopicOverloadPolicy } from "@zenystx/helios-core/config/ReliableTopicConfig";
import { RingbufferConfig } from "@zenystx/helios-core/config/RingbufferConfig";
import { HeliosInstanceImpl } from "@zenystx/helios-core/instance/impl/HeliosInstanceImpl";
import { RingbufferService } from "@zenystx/helios-core/ringbuffer/impl/RingbufferService";
import { TOPIC_RB_PREFIX } from "@zenystx/helios-core/topic/impl/reliable/ReliableTopicService";
import { TestHeliosInstance } from "@zenystx/helios-core/test-support/TestHeliosInstance";

async function waitFor<T>(fn: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (predicate(value)) {
      return value;
    }
    await Bun.sleep(50);
  }
  throw new Error("Timed out waiting for condition");
}

describe("ReliableTopicService - single-node backing", () => {
  it("stores publishes in the RingbufferService container", async () => {
    const instance = new HeliosInstanceImpl(new HeliosConfig("single-node"));
    const topic = instance.getReliableTopic<string>("svc-backed");

    await topic.publishAsync("hello");

    const rbService = instance.getRingbufferService();
    const rbName = TOPIC_RB_PREFIX + "svc-backed";
    const partitionId = rbService.getRingbufferPartitionId(rbName);
    const ns = RingbufferService.getRingbufferNamespace(rbName);
    const container = rbService.getContainerOrNull(partitionId, ns);

    expect(container).not.toBeNull();
    expect(container!.size()).toBe(1);
    instance.shutdown();
  });

  it("BLOCK waits for destroy instead of overwriting when the ringbuffer is full", async () => {
    const config = new HeliosConfig("block");
    config.addReliableTopicConfig(
      new ReliableTopicConfig("blocky").setTopicOverloadPolicy(TopicOverloadPolicy.BLOCK),
    );
    config.addRingbufferConfig(new RingbufferConfig("_hz_rb_blocky").setCapacity(1));

    const instance = new HeliosInstanceImpl(config);
    const topic = instance.getReliableTopic<string>("blocky");
    await topic.publishAsync("first");

    const pending = topic.publishAsync("second");
    await Bun.sleep(100);

    let settled = false;
    void pending.then(() => {
      settled = true;
    }, () => {
      settled = true;
    });

    expect(settled).toBe(false);
    topic.destroy();
    await expect(pending).rejects.toThrow(/destroyed/i);
    instance.shutdown();
  });

  it("destroy clears the backing ringbuffer and a fresh proxy works again", async () => {
    const instance = new HeliosInstanceImpl(new HeliosConfig("destroyable"));
    const topic = instance.getReliableTopic<string>("destroyable");
    await topic.publishAsync("before");
    topic.destroy();

    const rbService = instance.getRingbufferService();
    const rbName = TOPIC_RB_PREFIX + "destroyable";
    const partitionId = rbService.getRingbufferPartitionId(rbName);
    const ns = RingbufferService.getRingbufferNamespace(rbName);
    expect(rbService.getContainerOrNull(partitionId, ns)?.size()).toBe(0);

    const fresh = instance.getReliableTopic<string>("destroyable");
    await fresh.publishAsync("after");
    expect(rbService.getContainerOrNull(partitionId, ns)?.size()).toBe(1);
    instance.shutdown();
  });
});

describe("ReliableTopicService - test support honesty", () => {
  it("TestHeliosInstance uses the same service-backed reliable topic path", async () => {
    const instance = new TestHeliosInstance();
    const topic = instance.getReliableTopic<string>("test-rt");
    const received: string[] = [];

    topic.addMessageListener((msg) => {
      received.push(msg.getMessageObject());
    });
    await topic.publishAsync("hello");

    expect(received).toEqual(["hello"]);
    instance.shutdown();
  });
});

describe("ReliableTopicService - distributed path", () => {
  const instances: HeliosInstanceImpl[] = [];

  afterEach(async () => {
    for (const instance of instances) {
      if (instance.isRunning()) {
        instance.shutdown();
      }
    }
    instances.length = 0;
    await Bun.sleep(30);
  });

  async function waitForClusterSize(instance: HeliosInstanceImpl, size: number): Promise<void> {
    await waitFor(
      async () => instance.getCluster().getMembers().length,
      (value) => value === size,
    );
  }

  async function startNode(name: string, port: number, peers: number[]): Promise<HeliosInstanceImpl> {
    const config = new HeliosConfig(name);
    config.getNetworkConfig().setPort(port).getJoin().getTcpIpConfig().setEnabled(true);
    for (const peer of peers) {
      config.getNetworkConfig().getJoin().getTcpIpConfig().addMember(`localhost:${peer}`);
    }
    const instance = await Helios.newInstance(config);
    instances.push(instance);
    return instance;
  }

  async function startTwoMembers(): Promise<{ a: HeliosInstanceImpl; b: HeliosInstanceImpl }> {
    const a = await startNode("node-a", 15811, []);
    const b = await startNode("node-b", 15812, [15811]);
    await waitForClusterSize(a, 2);
    await waitForClusterSize(b, 2);
    return { a, b };
  }

  it("routes publish to the owner, replicates to backup, and delivers to listeners on both members", async () => {
    const { a, b } = await startTwoMembers();
    const topicA = a.getReliableTopic<string>("events");
    const topicB = b.getReliableTopic<string>("events");
    const receivedA: string[] = [];
    const receivedB: string[] = [];
    topicA.addMessageListener((msg) => receivedA.push(msg.getMessageObject()));
    topicB.addMessageListener((msg) => receivedB.push(msg.getMessageObject()));

    const rbName = TOPIC_RB_PREFIX + "events";
    const partitionId = a.getRingbufferService().getRingbufferPartitionId(rbName);
    const ownerId = a.getPartitionOwnerId(partitionId)!;
    const owner = ownerId === a.getName() ? a : b;
    const publisher = owner === a ? topicB : topicA;
    const backup = owner === a ? b : a;

    await publisher.publishAsync("alpha");
    await waitFor(async () => receivedA, (messages) => messages.includes("alpha"));
    await waitFor(async () => receivedB, (messages) => messages.includes("alpha"));

    const ns = RingbufferService.getRingbufferNamespace(rbName);
    expect(owner.getRingbufferService().getContainerOrNull(partitionId, ns)?.size()).toBe(1);
    expect(backup.getRingbufferService().getContainerOrNull(partitionId, ns)?.size()).toBe(1);
  });

  it("survives owner loss by promoting the backup-backed state", async () => {
    const { a, b } = await startTwoMembers();
    const rbName = TOPIC_RB_PREFIX + "failover";
    const partitionId = a.getRingbufferService().getRingbufferPartitionId(rbName);
    const ownerId = a.getPartitionOwnerId(partitionId)!;
    const owner = ownerId === a.getName() ? a : b;
    const survivor = owner === a ? b : a;
    const survivorTopic = survivor.getReliableTopic<string>("failover");
    const ownerTopic = owner.getReliableTopic<string>("failover");
    const received: string[] = [];
    survivorTopic.addMessageListener((msg) => received.push(msg.getMessageObject()));

    await ownerTopic.publishAsync("before-loss");
    const ns = RingbufferService.getRingbufferNamespace(rbName);
    await waitFor(
      async () => survivor.getRingbufferService().getContainerOrNull(partitionId, ns)?.size() ?? 0,
      (size) => size === 1,
    );

    owner.shutdown();
    await waitForClusterSize(survivor, 1);

    await survivorTopic.publishAsync("after-loss");
    const backupSize = await waitFor(
      async () => survivor.getRingbufferService().getContainerOrNull(partitionId, ns)?.size() ?? 0,
      (size) => size === 2,
    );

    expect(backupSize).toBe(2);
    expect(received).toEqual(["before-loss", "after-loss"]);
  });

  it("destroy propagates cluster-wide and shutdown of another member does not block later publishes", async () => {
    const { a, b } = await startTwoMembers();
    const destroyedA = a.getReliableTopic<string>("lifecycle");
    const destroyedB = b.getReliableTopic<string>("lifecycle");

    destroyedA.destroy();
    await expect(destroyedB.publishAsync("nope")).rejects.toThrow(/destroyed/i);

    a.shutdown();
    await waitForClusterSize(b, 1);

    const survivorTopic = b.getReliableTopic<string>("post-shutdown");
    const received: string[] = [];
    survivorTopic.addMessageListener((msg) => received.push(msg.getMessageObject()));
    await survivorTopic.publishAsync("still-works");
    await waitFor(async () => received, (messages) => messages.includes("still-works"));
    expect(received).toEqual(["still-works"]);
  });
});
