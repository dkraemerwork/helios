import { Client } from "hazelcast-client";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HeliosTestCluster } from "../helpers/HeliosTestCluster";

describe("Official Client — CP CountDownLatch (single-node)", () => {
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
    try {
      await hzClient.shutdown();
    } catch {
      // ignore disconnect races during cleanup
    }
    await cluster.shutdown();
  });

  it("supports named-group isolation plus trySetCount/countDown/await", async () => {
    const cp = hzClient.getCPSubsystem();
    const groupA = await cp.getCountDownLatch("interop-latch@group-a");
    const groupB = await cp.getCountDownLatch("interop-latch@group-b");

    expect(await groupA.trySetCount(1)).toBe(true);
    expect(await groupB.trySetCount(2)).toBe(true);

    expect(await groupA.await(25)).toBe(false);
    await groupA.countDown();
    expect(await groupA.await(100)).toBe(true);
    expect(await groupA.getCount()).toBe(0);
    expect(await groupB.getCount()).toBe(2);
  });

  it("times out and preserves latch state across client reconnect", async () => {
    const name = "interop-latch-reconnect@group-reconnect";
    const latch = await hzClient.getCPSubsystem().getCountDownLatch(name);

    expect(await latch.trySetCount(1)).toBe(true);
    expect(await latch.await(25)).toBe(false);

    await hzClient.shutdown();
    const { clusterName, addresses } = cluster.getConnectionInfo();
    hzClient = await Client.newHazelcastClient({
      clusterName,
      network: { clusterMembers: addresses },
    });

    const reconnectedLatch = await hzClient.getCPSubsystem().getCountDownLatch(name);
    expect(await reconnectedLatch.getCount()).toBe(1);
    await reconnectedLatch.countDown();
    expect(await reconnectedLatch.await(100)).toBe(true);
  });

  it("reaches the destroy path without widening beyond single-node CP", async () => {
    const latch = await hzClient.getCPSubsystem().getCountDownLatch("interop-latch-destroy@group-destroy");
    expect(await latch.trySetCount(1)).toBe(true);
    await expect(latch.destroy()).resolves.toBeUndefined();
  });
});

describe("Official Client — CP Semaphore (single-node)", () => {
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
    try {
      await hzClient.shutdown();
    } catch {
      // ignore disconnect races during cleanup
    }
    await cluster.shutdown();
  });

  it("supports named-group isolation plus init/acquire/release/tryAcquire", async () => {
    const cp = hzClient.getCPSubsystem();
    const groupA = await cp.getSemaphore("interop-semaphore@group-a");
    const groupB = await cp.getSemaphore("interop-semaphore@group-b");

    expect(await groupA.init(1)).toBe(true);
    expect(await groupB.init(2)).toBe(true);

    await groupA.acquire();
    expect(await groupA.tryAcquire(1, 0)).toBe(false);
    expect(await groupA.availablePermits()).toBe(0);
    expect(await groupB.availablePermits()).toBe(2);

    await groupA.release();
    expect(await groupA.tryAcquire(1, 50)).toBe(true);
    await groupA.release();
  });

  it("preserves semaphore state across reconnect on a single CP member", async () => {
    const name = "interop-semaphore-reconnect@group-reconnect";
    const semaphore = await hzClient.getCPSubsystem().getSemaphore(name);

    expect(await semaphore.init(1)).toBe(true);
    await semaphore.acquire();
    expect(await semaphore.availablePermits()).toBe(0);

    await semaphore.release();
    expect(await semaphore.availablePermits()).toBe(1);

    await hzClient.shutdown();
    const { clusterName, addresses } = cluster.getConnectionInfo();
    hzClient = await Client.newHazelcastClient({
      clusterName,
      network: { clusterMembers: addresses },
    });

    const reconnectedSemaphore = await hzClient.getCPSubsystem().getSemaphore(name);
    expect(await reconnectedSemaphore.availablePermits()).toBe(1);
    expect(await reconnectedSemaphore.tryAcquire(1, 50)).toBe(true);
    await reconnectedSemaphore.release();
  });

  it("reaches semaphore destroy through the official client", async () => {
    const semaphore = await hzClient.getCPSubsystem().getSemaphore("interop-semaphore-destroy@group-destroy");
    expect(await semaphore.init(1)).toBe(true);
    await expect(semaphore.destroy()).resolves.toBeUndefined();
  });
});
