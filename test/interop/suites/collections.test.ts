/**
 * Block K — Official Client Interop: Collections Tests (IList, ISet)
 *
 * Verifies IList and ISet operations via the official hazelcast-client npm package
 * against a live Helios server instance.
 */
import { Client } from "hazelcast-client";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HeliosTestCluster } from "../helpers/HeliosTestCluster";

describe("Official Client — IList", () => {
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

  it("add — appends element to the list", async () => {
    const list = await hzClient.getList<string>("interop-list-add");
    const added = await list.add("list-item-1");
    expect(added).toBe(true);
    expect(await list.size()).toBe(1);
  });

  it("get — retrieves element by index", async () => {
    const list = await hzClient.getList<string>("interop-list-get");
    await list.add("alpha");
    await list.add("beta");
    const first = await list.get(0);
    const second = await list.get(1);
    expect(first).toBe("alpha");
    expect(second).toBe("beta");
  });

  it("remove by index — removes element and shifts remaining", async () => {
    const list = await hzClient.getList<string>("interop-list-remove-idx");
    await list.add("x");
    await list.add("y");
    await list.add("z");
    const removed = await list.removeAt(0);
    expect(removed).toBe("x");
    expect(await list.size()).toBe(2);
    expect(await list.get(0)).toBe("y");
  });

  it("remove by value — removes first occurrence", async () => {
    const list = await hzClient.getList<string>("interop-list-remove-val");
    await list.add("cat");
    await list.add("dog");
    await list.add("cat");
    const removed = await list.remove("cat");
    expect(removed).toBe(true);
    expect(await list.size()).toBe(2);
  });

  it("size — reflects correct element count", async () => {
    const list = await hzClient.getList<number>("interop-list-size");
    expect(await list.size()).toBe(0);
    await list.add(1);
    await list.add(2);
    expect(await list.size()).toBe(2);
  });

  it("contains — true for existing element, false for missing", async () => {
    const list = await hzClient.getList<string>("interop-list-contains");
    await list.add("present");
    expect(await list.contains("present")).toBe(true);
    expect(await list.contains("absent")).toBe(false);
  });

  it("clear — removes all elements", async () => {
    const list = await hzClient.getList<string>("interop-list-clear");
    await list.add("a");
    await list.add("b");
    await list.clear();
    expect(await list.size()).toBe(0);
  });

  it("maintains insertion order", async () => {
    const list = await hzClient.getList<number>("interop-list-order");
    await list.add(10);
    await list.add(20);
    await list.add(30);
    expect(await list.get(0)).toBe(10);
    expect(await list.get(1)).toBe(20);
    expect(await list.get(2)).toBe(30);
  });
});

describe("Official Client — ISet", () => {
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

  it("add — inserts element into the set", async () => {
    const set = await hzClient.getSet<string>("interop-set-add");
    const added = await set.add("set-item-1");
    expect(added).toBe(true);
    expect(await set.size()).toBe(1);
  });

  it("add — duplicate element is not inserted (set semantics)", async () => {
    const set = await hzClient.getSet<string>("interop-set-dedup");
    await set.add("dup");
    const secondAdd = await set.add("dup");
    expect(secondAdd).toBe(false);
    expect(await set.size()).toBe(1);
  });

  it("remove — deletes element from the set", async () => {
    const set = await hzClient.getSet<string>("interop-set-remove");
    await set.add("to-remove");
    const removed = await set.remove("to-remove");
    expect(removed).toBe(true);
    expect(await set.size()).toBe(0);
  });

  it("remove — false for missing element", async () => {
    const set = await hzClient.getSet<string>("interop-set-remove-miss");
    const removed = await set.remove("not-in-set");
    expect(removed).toBe(false);
  });

  it("contains — true for existing element, false for missing", async () => {
    const set = await hzClient.getSet<string>("interop-set-contains");
    await set.add("exists");
    expect(await set.contains("exists")).toBe(true);
    expect(await set.contains("missing")).toBe(false);
  });

  it("size — correct element count with no duplicates", async () => {
    const set = await hzClient.getSet<string>("interop-set-size");
    expect(await set.size()).toBe(0);
    await set.add("a");
    await set.add("b");
    await set.add("a"); // duplicate
    expect(await set.size()).toBe(2);
  });

  it("clear — removes all elements", async () => {
    const set = await hzClient.getSet<string>("interop-set-clear");
    await set.add("x");
    await set.add("y");
    await set.clear();
    expect(await set.size()).toBe(0);
  });
});
