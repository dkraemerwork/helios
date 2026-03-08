/**
 * Block K — Official Client Interop: CP Atomics Tests
 *
 * Verifies AtomicLong and AtomicReference operations via the official
 * hazelcast-client npm package against a live Helios server instance.
 *
 * CP data structures require the CP subsystem to be enabled on the server.
 * These tests exercise the official client's getCPSubsystem() API.
 */
import { Client } from "hazelcast-client";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HeliosTestCluster } from "../helpers/HeliosTestCluster";

describe("Official Client — AtomicLong (CP Subsystem)", () => {
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

  it("get — returns initial value of 0", async () => {
    const atomic = await hzClient.getCPSubsystem().getAtomicLong("interop-atomic-long-get");
    const val = await atomic.get();
    // Long type — convert to number for comparison
    expect(Number(val)).toBe(0);
  });

  it("set — updates value", async () => {
    const atomic = await hzClient.getCPSubsystem().getAtomicLong("interop-atomic-long-set");
    await atomic.set(42);
    const val = await atomic.get();
    expect(Number(val)).toBe(42);
  });

  it("incrementAndGet — increments by 1 and returns new value", async () => {
    const atomic = await hzClient.getCPSubsystem().getAtomicLong("interop-atomic-long-inc");
    await atomic.set(10);
    const result = await atomic.incrementAndGet();
    expect(Number(result)).toBe(11);
  });

  it("decrementAndGet — decrements by 1 and returns new value", async () => {
    const atomic = await hzClient.getCPSubsystem().getAtomicLong("interop-atomic-long-dec");
    await atomic.set(10);
    const result = await atomic.decrementAndGet();
    expect(Number(result)).toBe(9);
  });

  it("compareAndSet — updates when expected value matches", async () => {
    const atomic = await hzClient.getCPSubsystem().getAtomicLong("interop-atomic-long-cas");
    await atomic.set(5);
    const swapped = await atomic.compareAndSet(5, 99);
    expect(swapped).toBe(true);
    expect(Number(await atomic.get())).toBe(99);
  });

  it("compareAndSet — does not update when expected value mismatches", async () => {
    const atomic = await hzClient.getCPSubsystem().getAtomicLong("interop-atomic-long-cas-fail");
    await atomic.set(5);
    const swapped = await atomic.compareAndSet(999, 0);
    expect(swapped).toBe(false);
    // Value unchanged
    expect(Number(await atomic.get())).toBe(5);
  });

  it("addAndGet — adds delta and returns new value", async () => {
    const atomic = await hzClient.getCPSubsystem().getAtomicLong("interop-atomic-long-add");
    await atomic.set(100);
    const result = await atomic.addAndGet(25);
    expect(Number(result)).toBe(125);
  });

  it("getAndAdd — returns old value and adds delta", async () => {
    const atomic = await hzClient.getCPSubsystem().getAtomicLong("interop-atomic-long-gaa");
    await atomic.set(50);
    const old = await atomic.getAndAdd(10);
    expect(Number(old)).toBe(50);
    expect(Number(await atomic.get())).toBe(60);
  });
});

describe("Official Client — AtomicReference (CP Subsystem)", () => {
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

  it("get — returns null for unset reference", async () => {
    const ref = await hzClient.getCPSubsystem().getAtomicReference<string>("interop-atomic-ref-get");
    const val = await ref.get();
    expect(val).toBeNull();
  });

  it("set — stores and retrieves a value", async () => {
    const ref = await hzClient.getCPSubsystem().getAtomicReference<string>("interop-atomic-ref-set");
    await ref.set("hello-ref");
    const val = await ref.get();
    expect(val).toBe("hello-ref");
  });

  it("compareAndSet — updates when expected value matches", async () => {
    const ref = await hzClient.getCPSubsystem().getAtomicReference<string>("interop-atomic-ref-cas");
    await ref.set("old-value");
    const swapped = await ref.compareAndSet("old-value", "new-value");
    expect(swapped).toBe(true);
    expect(await ref.get()).toBe("new-value");
  });

  it("compareAndSet — does not update when expected value mismatches", async () => {
    const ref = await hzClient.getCPSubsystem().getAtomicReference<string>("interop-atomic-ref-cas-fail");
    await ref.set("current");
    const swapped = await ref.compareAndSet("wrong-expected", "new-value");
    expect(swapped).toBe(false);
    expect(await ref.get()).toBe("current");
  });

  it("isNull — true for unset reference, false when set", async () => {
    const ref = await hzClient.getCPSubsystem().getAtomicReference<string>("interop-atomic-ref-isnull");
    expect(await ref.isNull()).toBe(true);
    await ref.set("value");
    expect(await ref.isNull()).toBe(false);
  });

  it("clear — resets reference to null", async () => {
    const ref = await hzClient.getCPSubsystem().getAtomicReference<string>("interop-atomic-ref-clear");
    await ref.set("something");
    await ref.clear();
    expect(await ref.get()).toBeNull();
  });
});
