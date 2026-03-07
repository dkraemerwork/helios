#!/usr/bin/env bun
/**
 * Helios Remote Client — Near-Cache Example
 *
 * Demonstrates configuring client-side near-cache for frequently read
 * map entries, reducing network round trips for hot data.
 *
 * Usage:
 *   bun run examples/native-app/src/client-nearcache-example.ts
 */
import { HeliosClient } from "@zenystx/helios-core/client/HeliosClient";
import { ClientConfig } from "@zenystx/helios-core/client/config/ClientConfig";
import { NearCacheConfig } from "@zenystx/helios-core/config/NearCacheConfig";
import { InMemoryFormat } from "@zenystx/helios-core/config/InMemoryFormat";
import { EvictionConfig } from "@zenystx/helios-core/config/EvictionConfig";
import { EvictionPolicy } from "@zenystx/helios-core/config/EvictionPolicy";
import { MaxSizePolicy } from "@zenystx/helios-core/config/MaxSizePolicy";

async function main(): Promise<void> {
    const address = process.env["HELIOS_CLUSTER_ADDRESS"] ?? "127.0.0.1:5701";

    const config = new ClientConfig();
    config.getNetworkConfig().addAddress(address);

    // ── Near-cache configuration ─────────────────────────────────────────────
    const nearCacheConfig = new NearCacheConfig();
    nearCacheConfig.setName("hot-data");
    nearCacheConfig.setInMemoryFormat(InMemoryFormat.OBJECT);
    nearCacheConfig.setTimeToLiveSeconds(60);
    nearCacheConfig.setMaxIdleSeconds(30);
    nearCacheConfig.setInvalidateOnChange(true);

    const eviction = new EvictionConfig();
    eviction.setEvictionPolicy(EvictionPolicy.LRU);
    eviction.setMaxSizePolicy(MaxSizePolicy.ENTRY_COUNT);
    eviction.setSize(10_000);
    nearCacheConfig.setEvictionConfig(eviction);

    config.addNearCacheConfig(nearCacheConfig);

    // ── Connect ──────────────────────────────────────────────────────────────
    console.log("Connecting with near-cache enabled for 'hot-data' map...");
    const client = HeliosClient.newHeliosClient(config);
    console.log(`Connected as '${client.getName()}'.`);

    // ── Populate data ────────────────────────────────────────────────────────
    const map = client.getMap<string, string>("hot-data");
    for (let i = 0; i < 100; i++) {
        await map.put(`key-${i}`, `value-${i}`);
    }
    console.log("Populated 100 entries.");

    // ── Read with near-cache ─────────────────────────────────────────────────
    // First read: fetches from server and populates near-cache
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) {
        await map.get(`key-${i}`);
    }
    const firstReadMs = performance.now() - t0;
    console.log(`First read (populating near-cache): ${firstReadMs.toFixed(1)}ms`);

    // Second read: should be served from near-cache (faster)
    const t1 = performance.now();
    for (let i = 0; i < 100; i++) {
        await map.get(`key-${i}`);
    }
    const secondReadMs = performance.now() - t1;
    console.log(`Second read (from near-cache): ${secondReadMs.toFixed(1)}ms`);

    // ── Near-cache stats ─────────────────────────────────────────────────────
    const ncManager = client.getNearCacheManager();
    console.log(`Near-cache manager active: ${ncManager !== null && ncManager !== undefined}`);

    client.shutdown();
    console.log("Client shut down.");
}

main().catch((error) => {
    console.error("Fatal:", error);
    process.exit(1);
});
