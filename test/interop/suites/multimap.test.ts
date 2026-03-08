/**
 * Block K — Official Client Interop: MultiMap Tests
 *
 * Verifies MultiMap operations via the official hazelcast-client npm package
 * against a live Helios server instance.
 *
 * MultiMap allows multiple values per key.
 */
import { Client } from "hazelcast-client";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HeliosTestCluster } from "../helpers/HeliosTestCluster";

describe("Official Client — MultiMap", () => {
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

  it("put — associates value with key", async () => {
    const mm = await hzClient.getMultiMap<string, string>("interop-mm-put");
    const added = await mm.put("colors", "red");
    expect(added).toBe(true);
  });

  it("get — returns all values for a key", async () => {
    const mm = await hzClient.getMultiMap<string, string>("interop-mm-get");
    await mm.put("fruits", "apple");
    await mm.put("fruits", "banana");
    await mm.put("fruits", "cherry");
    const values = await mm.get("fruits");
    const arr = [...values];
    expect(arr).toHaveLength(3);
    expect(arr).toContain("apple");
    expect(arr).toContain("banana");
    expect(arr).toContain("cherry");
  });

  it("get — returns empty collection for missing key", async () => {
    const mm = await hzClient.getMultiMap<string, string>("interop-mm-get-miss");
    const values = await mm.get("nonexistent");
    expect([...values]).toHaveLength(0);
  });

  it("remove — removes a specific value from a key", async () => {
    const mm = await hzClient.getMultiMap<string, string>("interop-mm-remove");
    await mm.put("tags", "red");
    await mm.put("tags", "green");
    await mm.put("tags", "blue");
    const removed = await mm.remove("tags", "green");
    expect(removed).toBe(true);
    const remaining = await mm.get("tags");
    expect([...remaining]).not.toContain("green");
    expect([...remaining]).toHaveLength(2);
  });

  it("removeAll — removes all values for a key", async () => {
    const mm = await hzClient.getMultiMap<string, string>("interop-mm-remove-all");
    await mm.put("items", "a");
    await mm.put("items", "b");
    // removeAll removes all values for a key and returns them
    const removedAll = await mm.removeAll("items");
    expect([...removedAll]).toHaveLength(2);
    const empty = await mm.get("items");
    expect([...empty]).toHaveLength(0);
  });

  it("containsKey — true for key with values, false otherwise", async () => {
    const mm = await hzClient.getMultiMap<string, string>("interop-mm-containskey");
    await mm.put("exists-key", "some-value");
    expect(await mm.containsKey("exists-key")).toBe(true);
    expect(await mm.containsKey("missing-key")).toBe(false);
  });

  it("size — returns total number of value associations", async () => {
    const mm = await hzClient.getMultiMap<string, string>("interop-mm-size");
    expect(await mm.size()).toBe(0);
    await mm.put("k1", "v1");
    await mm.put("k1", "v2");
    await mm.put("k2", "v3");
    expect(await mm.size()).toBe(3);
  });

  it("keySet — returns all keys that have at least one value", async () => {
    const mm = await hzClient.getMultiMap<string, string>("interop-mm-keyset");
    await mm.put("alpha", "1");
    await mm.put("beta", "2");
    await mm.put("alpha", "3");
    const keys = await mm.keySet();
    const keyArr = [...keys];
    expect(keyArr).toContain("alpha");
    expect(keyArr).toContain("beta");
    // alpha appears only once in key set despite two values
    expect(keyArr.filter((k) => k === "alpha")).toHaveLength(1);
  });

  it("values — returns all values across all keys", async () => {
    const mm = await hzClient.getMultiMap<string, string>("interop-mm-values");
    await mm.put("k", "v1");
    await mm.put("k", "v2");
    await mm.put("j", "v3");
    const vals = await mm.values();
    const arr = [...vals];
    expect(arr).toHaveLength(3);
    expect(arr).toContain("v1");
    expect(arr).toContain("v2");
    expect(arr).toContain("v3");
  });
});
