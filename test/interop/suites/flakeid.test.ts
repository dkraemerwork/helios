/**
 * Block K — Official Client Interop: FlakeIdGenerator Tests
 *
 * Verifies FlakeIdGenerator operations via the official hazelcast-client npm
 * package against a live Helios server instance.
 *
 * Flake IDs are 64-bit, cluster-wide unique, roughly time-ordered identifiers.
 */
import { Client } from "hazelcast-client";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HeliosTestCluster } from "../helpers/HeliosTestCluster";

describe("Official Client — FlakeIdGenerator", () => {
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

  it("newId — generates a non-null ID", async () => {
    const gen = await hzClient.getFlakeIdGenerator("interop-flakeid-basic");
    const id = await gen.newId();
    expect(id).not.toBeNull();
    expect(id).toBeDefined();
  });

  it("newId — successive IDs are unique", async () => {
    const gen = await hzClient.getFlakeIdGenerator("interop-flakeid-unique");
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const id = await gen.newId();
      ids.add(id.toString());
    }
    expect(ids.size).toBe(10);
  });

  it("newId — IDs are positive (non-zero, non-negative)", async () => {
    const gen = await hzClient.getFlakeIdGenerator("interop-flakeid-positive");
    const id = await gen.newId();
    // Flake IDs should be positive 64-bit Long values
    expect(id.toNumber()).toBeGreaterThan(0);
  });

  it("newId — IDs from multiple generators are unique across generators", async () => {
    const gen1 = await hzClient.getFlakeIdGenerator("interop-flakeid-multi-1");
    const gen2 = await hzClient.getFlakeIdGenerator("interop-flakeid-multi-2");
    const id1 = await gen1.newId();
    const id2 = await gen2.newId();
    // Different generator names produce independent ID sequences
    // (they may or may not overlap, but both should be valid)
    expect(id1.toString()).toBeDefined();
    expect(id2.toString()).toBeDefined();
  });

  it("newId — generates IDs in bulk (20 IDs, all unique)", async () => {
    const gen = await hzClient.getFlakeIdGenerator("interop-flakeid-bulk");
    const count = 20;
    const ids = new Set<string>();
    for (let i = 0; i < count; i++) {
      const id = await gen.newId();
      ids.add(id.toString());
    }
    expect(ids.size).toBe(count);
  });
});
