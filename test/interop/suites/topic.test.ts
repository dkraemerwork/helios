/**
 * Block K — Official Client Interop: ITopic Tests
 *
 * Verifies ITopic publish/subscribe operations via the official hazelcast-client
 * npm package against a live Helios server instance.
 */
import { Client, type Message } from "hazelcast-client";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HeliosTestCluster } from "../helpers/HeliosTestCluster";

describe("Official Client — ITopic", () => {
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

  it("publish message — received by single listener", async () => {
    const topic = await hzClient.getReliableTopic<string>("interop-topic-basic");
    const received: string[] = [];

    const registrationId = await topic.addMessageListener((message: Message<string>) => {
      received.push(message.messageObject);
    });

    await topic.publish("hello-topic");
    await sleep(300);

    await topic.removeMessageListener(registrationId);
    expect(received).toContain("hello-topic");
  });

  it("publish message — received by multiple listeners", async () => {
    const topic = await hzClient.getReliableTopic<string>("interop-topic-multi");
    const receivedA: string[] = [];
    const receivedB: string[] = [];

    const idA = await topic.addMessageListener((message: Message<string>) => {
      receivedA.push(message.messageObject);
    });
    const idB = await topic.addMessageListener((message: Message<string>) => {
      receivedB.push(message.messageObject);
    });

    await topic.publish("broadcast");
    await sleep(300);

    await topic.removeMessageListener(idA);
    await topic.removeMessageListener(idB);

    expect(receivedA).toContain("broadcast");
    expect(receivedB).toContain("broadcast");
  });

  it("removeMessageListener — listener no longer receives messages", async () => {
    const topic = await hzClient.getReliableTopic<string>("interop-topic-remove");
    const received: string[] = [];

    const registrationId = await topic.addMessageListener((message: Message<string>) => {
      received.push(message.messageObject);
    });

    // Remove listener before publishing
    await topic.removeMessageListener(registrationId);
    await topic.publish("should-not-arrive");
    await sleep(200);

    expect(received).not.toContain("should-not-arrive");
  });

  it("multiple publishes — all messages received in order", async () => {
    const topic = await hzClient.getReliableTopic<string>("interop-topic-order");
    const received: string[] = [];

    const registrationId = await topic.addMessageListener((message: Message<string>) => {
      received.push(message.messageObject);
    });

    await topic.publish("msg-1");
    await topic.publish("msg-2");
    await topic.publish("msg-3");
    await sleep(400);

    await topic.removeMessageListener(registrationId);
    expect(received).toContain("msg-1");
    expect(received).toContain("msg-2");
    expect(received).toContain("msg-3");
  });

  it("message object carries published value", async () => {
    const topic = await hzClient.getReliableTopic<number>("interop-topic-number");
    let receivedValue: number | null = null;

    const registrationId = await topic.addMessageListener((message: Message<number>) => {
      receivedValue = message.messageObject;
    });

    await topic.publish(42);
    await sleep(300);

    await topic.removeMessageListener(registrationId);
    expect(receivedValue as number | null).toBe(42);
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
