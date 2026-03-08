/**
 * Block K — Official Client Interop: IQueue Tests
 *
 * Verifies IQueue operations via the official hazelcast-client npm package
 * against a live Helios server instance.
 */
import { Client } from "hazelcast-client";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HeliosTestCluster } from "../helpers/HeliosTestCluster";

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
