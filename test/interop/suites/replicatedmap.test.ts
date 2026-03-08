/**
 * Block K — Official Client Interop: ReplicatedMap Tests
 *
 * Verifies ReplicatedMap operations via the official hazelcast-client npm package
 * against a live Helios server instance.
 *
 * ReplicatedMap replicates its state to all cluster members.
 */
import { Client } from "hazelcast-client";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HeliosTestCluster } from "../helpers/HeliosTestCluster";

describe("Official Client — ReplicatedMap", () => {
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

  it("put — stores a key-value pair", async () => {
    const rm = await hzClient.getReplicatedMap<string, string>("interop-rm-put");
    const prev = await rm.put("rep-key", "rep-value");
    // null when key was absent before
    expect(prev).toBeNull();
  });

  it("get — retrieves stored value", async () => {
    const rm = await hzClient.getReplicatedMap<string, string>("interop-rm-get");
    await rm.put("rk", "rv");
    const val = await rm.get("rk");
    expect(val).toBe("rv");
  });

  it("get — returns null for missing key", async () => {
    const rm = await hzClient.getReplicatedMap<string, string>("interop-rm-get-miss");
    const val = await rm.get("missing");
    expect(val).toBeNull();
  });

  it("put — returns previous value on overwrite", async () => {
    const rm = await hzClient.getReplicatedMap<string, string>("interop-rm-put-overwrite");
    await rm.put("k", "original");
    const prev = await rm.put("k", "updated");
    expect(prev).toBe("original");
    expect(await rm.get("k")).toBe("updated");
  });

  it("remove — deletes key and returns previous value", async () => {
    const rm = await hzClient.getReplicatedMap<string, string>("interop-rm-remove");
    await rm.put("rem-k", "rem-v");
    const prev = await rm.remove("rem-k");
    expect(prev).toBe("rem-v");
    expect(await rm.get("rem-k")).toBeNull();
  });

  it("size — reflects entry count correctly", async () => {
    const rm = await hzClient.getReplicatedMap<string, number>("interop-rm-size");
    expect(await rm.size()).toBe(0);
    await rm.put("a", 1);
    await rm.put("b", 2);
    expect(await rm.size()).toBe(2);
  });

  it("containsKey — true for existing key, false for missing", async () => {
    const rm = await hzClient.getReplicatedMap<string, string>("interop-rm-ck");
    await rm.put("exists", "yes");
    expect(await rm.containsKey("exists")).toBe(true);
    expect(await rm.containsKey("not-here")).toBe(false);
  });

  it("containsValue — true for existing value, false for missing", async () => {
    const rm = await hzClient.getReplicatedMap<string, string>("interop-rm-cv");
    await rm.put("k", "present-value");
    expect(await rm.containsValue("present-value")).toBe(true);
    expect(await rm.containsValue("absent-value")).toBe(false);
  });
});
