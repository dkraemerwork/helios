/**
 * Block K — Official Client Interop: IMap Tests
 *
 * Verifies IMap operations via the official hazelcast-client npm package
 * against a live Helios server instance.
 */
import { Client } from "hazelcast-client";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HeliosTestCluster } from "../helpers/HeliosTestCluster";

describe("Official Client — IMap", () => {
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

  // ── Basic CRUD ─────────────────────────────────────────────────────────────

  it("put and get — string value round-trips correctly", async () => {
    const map = await hzClient.getMap<string, string>("interop-map-basic");
    await map.put("key1", "hello-interop");
    const value = await map.get("key1");
    expect(value).toBe("hello-interop");
  });

  it("put returns previous value", async () => {
    const map = await hzClient.getMap<string, string>("interop-map-prev");
    const first = await map.put("k", "v1");
    expect(first).toBeNull();
    const second = await map.put("k", "v2");
    expect(second).toBe("v1");
  });

  it("get returns null for missing key", async () => {
    const map = await hzClient.getMap<string, string>("interop-map-miss");
    const val = await map.get("nonexistent-key");
    expect(val).toBeNull();
  });

  it("remove — returns removed value and deletes entry", async () => {
    const map = await hzClient.getMap<string, string>("interop-map-remove");
    await map.put("rem-key", "rem-value");
    const removed = await map.remove("rem-key");
    expect(removed).toBe("rem-value");
    const gone = await map.get("rem-key");
    expect(gone).toBeNull();
  });

  it("remove — returns null for missing key", async () => {
    const map = await hzClient.getMap<string, string>("interop-map-remove-miss");
    const result = await map.remove("does-not-exist");
    expect(result).toBeNull();
  });

  it("containsKey — true for existing key", async () => {
    const map = await hzClient.getMap<string, string>("interop-map-ck");
    await map.put("ck-key", "ck-value");
    expect(await map.containsKey("ck-key")).toBe(true);
  });

  it("containsKey — false for missing key", async () => {
    const map = await hzClient.getMap<string, string>("interop-map-ck-miss");
    expect(await map.containsKey("never-put")).toBe(false);
  });

  it("size — reflects entry count correctly", async () => {
    const map = await hzClient.getMap<string, number>("interop-map-size");
    expect(await map.size()).toBe(0);
    await map.put("a", 1);
    await map.put("b", 2);
    await map.put("c", 3);
    expect(await map.size()).toBe(3);
  });

  it("clear — removes all entries", async () => {
    const map = await hzClient.getMap<string, string>("interop-map-clear");
    await map.put("x", "1");
    await map.put("y", "2");
    await map.clear();
    expect(await map.size()).toBe(0);
  });

  // ── TTL ───────────────────────────────────────────────────────────────────

  it("put with TTL — entry accessible before expiry", async () => {
    const map = await hzClient.getMap<string, string>("interop-map-ttl");
    // TTL of 5 seconds — entry should still be accessible immediately
    await map.put("ttl-key", "ttl-value", 5000);
    const val = await map.get("ttl-key");
    expect(val).toBe("ttl-value");
  });

  it("put with TTL — entry expires after TTL elapses", async () => {
    const map = await hzClient.getMap<string, string>("interop-map-ttl-exp");
    // Very short TTL of 200ms
    await map.put("exp-key", "exp-value", 200);
    // Wait for expiry
    await sleep(400);
    const val = await map.get("exp-key");
    expect(val).toBeNull();
  });

  // ── Key set / values / entry set ──────────────────────────────────────────

  it("keySet — returns all keys", async () => {
    const map = await hzClient.getMap<string, string>("interop-map-keyset");
    await map.put("ks-a", "1");
    await map.put("ks-b", "2");
    const keys = await map.keySet();
    expect(keys).toHaveLength(2);
    expect(keys).toContain("ks-a");
    expect(keys).toContain("ks-b");
  });

  it("values — returns all values", async () => {
    const map = await hzClient.getMap<string, string>("interop-map-values");
    await map.put("v-a", "apple");
    await map.put("v-b", "banana");
    const vals = await map.values();
    const valArr = [...vals];
    expect(valArr).toHaveLength(2);
    expect(valArr).toContain("apple");
    expect(valArr).toContain("banana");
  });

  it("entrySet — returns all entries", async () => {
    const map = await hzClient.getMap<string, string>("interop-map-entryset");
    await map.put("es-k1", "es-v1");
    await map.put("es-k2", "es-v2");
    const entries = await map.entrySet();
    const arr = [...entries];
    expect(arr).toHaveLength(2);
  });

  // ── Advanced map operations ───────────────────────────────────────────────

  it("putIfAbsent — inserts when key absent, ignores when present", async () => {
    const map = await hzClient.getMap<string, string>("interop-map-pia");
    const first = await map.putIfAbsent("pia-key", "first");
    expect(first).toBeNull(); // null means key was absent
    const second = await map.putIfAbsent("pia-key", "second");
    expect(second).toBe("first"); // returns existing value
    const val = await map.get("pia-key");
    expect(val).toBe("first"); // value was NOT replaced
  });

  it("replace — replaces existing value", async () => {
    const map = await hzClient.getMap<string, string>("interop-map-replace");
    await map.put("rep-key", "original");
    const old = await map.replace("rep-key", "replaced");
    expect(old).toBe("original");
    expect(await map.get("rep-key")).toBe("replaced");
  });

  it("replace — returns null for non-existent key", async () => {
    const map = await hzClient.getMap<string, string>("interop-map-replace-miss");
    const result = await map.replace("no-key", "value");
    expect(result).toBeNull();
  });

  it("getAll — returns entries for specified keys", async () => {
    const map = await hzClient.getMap<string, string>("interop-map-getall");
    await map.put("ga-1", "one");
    await map.put("ga-2", "two");
    await map.put("ga-3", "three");
    // getAll returns Array<[K, V]>
    const result = await map.getAll(["ga-1", "ga-3"]);
    const resultMap = new Map(result);
    expect(resultMap.get("ga-1")).toBe("one");
    expect(resultMap.get("ga-3")).toBe("three");
    expect(resultMap.has("ga-2")).toBe(false);
  });

  it("putAll — inserts multiple entries at once", async () => {
    const map = await hzClient.getMap<string, string>("interop-map-putall");
    // putAll accepts Array<[K, V]>
    const entries: Array<[string, string]> = [
      ["pa-a", "alpha"],
      ["pa-b", "beta"],
      ["pa-c", "gamma"],
    ];
    await map.putAll(entries);
    expect(await map.get("pa-a")).toBe("alpha");
    expect(await map.get("pa-b")).toBe("beta");
    expect(await map.get("pa-c")).toBe("gamma");
    expect(await map.size()).toBe(3);
  });

  // ── Entry listener ────────────────────────────────────────────────────────

  it("entry listener — fires on put", async () => {
    const map = await hzClient.getMap<string, string>("interop-map-listener");
    const events: string[] = [];

    const listenerId = await map.addEntryListener({
      added(event: { key: string; value: string | null }) {
        events.push(`added:${event.key}=${event.value}`);
      },
    }, undefined, true);

    await map.put("listen-key", "listen-value");
    await sleep(200);

    await map.removeEntryListener(listenerId);
    expect(events).toContain("added:listen-key=listen-value");
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
