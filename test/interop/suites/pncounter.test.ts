/**
 * Block K — Official Client Interop: PNCounter Tests
 *
 * Verifies PNCounter (Positive-Negative Counter CRDT) operations via the
 * official hazelcast-client npm package against a live Helios server instance.
 *
 * PNCounter is a CRDT that supports eventual consistency for increment/decrement.
 */
import { Client } from "hazelcast-client";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HeliosTestCluster } from "../helpers/HeliosTestCluster";

describe("Official Client — PNCounter", () => {
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

  it("get — initial value is 0", async () => {
    const counter = await hzClient.getPNCounter("interop-pncounter-get");
    const val = await counter.get();
    expect(Number(val)).toBe(0);
  });

  it("addAndGet — increments by delta and returns new value", async () => {
    const counter = await hzClient.getPNCounter("interop-pncounter-add");
    const result = await counter.addAndGet(5);
    expect(Number(result)).toBe(5);
  });

  it("addAndGet — multiple increments accumulate correctly", async () => {
    const counter = await hzClient.getPNCounter("interop-pncounter-multi-add");
    await counter.addAndGet(10);
    await counter.addAndGet(20);
    await counter.addAndGet(30);
    const val = await counter.get();
    expect(Number(val)).toBe(60);
  });

  it("subtractAndGet — decrements by delta and returns new value", async () => {
    const counter = await hzClient.getPNCounter("interop-pncounter-sub");
    await counter.addAndGet(100);
    const result = await counter.subtractAndGet(30);
    expect(Number(result)).toBe(70);
  });

  it("subtractAndGet — counter can go negative", async () => {
    const counter = await hzClient.getPNCounter("interop-pncounter-neg");
    const result = await counter.subtractAndGet(10);
    expect(Number(result)).toBe(-10);
  });

  it("getAndAdd — returns value before increment", async () => {
    const counter = await hzClient.getPNCounter("interop-pncounter-gaa");
    await counter.addAndGet(50);
    const before = await counter.getAndAdd(10);
    expect(Number(before)).toBe(50);
    expect(Number(await counter.get())).toBe(60);
  });

  it("getAndSubtract — returns value before decrement", async () => {
    const counter = await hzClient.getPNCounter("interop-pncounter-gas");
    await counter.addAndGet(100);
    const before = await counter.getAndSubtract(25);
    expect(Number(before)).toBe(100);
    expect(Number(await counter.get())).toBe(75);
  });

  it("increment and decrement — net result is correct", async () => {
    const counter = await hzClient.getPNCounter("interop-pncounter-net");
    await counter.addAndGet(100);
    await counter.subtractAndGet(40);
    await counter.addAndGet(10);
    await counter.subtractAndGet(20);
    // 100 - 40 + 10 - 20 = 50
    expect(Number(await counter.get())).toBe(50);
  });
});
