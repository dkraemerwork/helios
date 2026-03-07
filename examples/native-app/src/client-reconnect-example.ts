#!/usr/bin/env bun
/**
 * Helios Remote Client — Reconnect Example
 *
 * Demonstrates configuring connection retry and reconnect behavior
 * for resilient client connections.
 *
 * Usage:
 *   bun run examples/native-app/src/client-reconnect-example.ts
 */
import { HeliosClient } from "@zenystx/helios-core/client/HeliosClient";
import { ClientConfig } from "@zenystx/helios-core/client/config/ClientConfig";

async function main(): Promise<void> {
    const address = process.env["HELIOS_CLUSTER_ADDRESS"] ?? "127.0.0.1:5701";

    const config = new ClientConfig();
    config.getNetworkConfig().addAddress(address);

    // ── Connection retry configuration ───────────────────────────────────────
    const connectionStrategy = config.getConnectionStrategyConfig();
    connectionStrategy.getConnectionRetryConfig()
        .setInitialBackoffMillis(500)
        .setMaxBackoffMillis(30_000)
        .setMultiplier(1.5)
        .setClusterConnectTimeoutMillis(60_000)
        .setJitter(0.2);

    // ── Lifecycle listener for connection events ─────────────────────────────
    console.log("Connecting with reconnect-aware configuration...");
    const client = HeliosClient.newHeliosClient(config);

    const lifecycle = client.getLifecycleService();
    console.log(`Connected. Lifecycle running: ${lifecycle.isRunning()}`);

    // Perform some operations
    const map = client.getMap<string, number>("reconnect-test");
    await map.put("counter", 1);
    const value = await map.get("counter");
    console.log(`Map value: ${value}`);

    console.log("Client is configured for automatic reconnect on connection loss.");
    console.log("Press Ctrl+C to exit.");

    // Keep alive for reconnect demo
    const interval = setInterval(async () => {
        try {
            const current = await map.get("counter") ?? 0;
            await map.put("counter", current + 1);
            console.log(`Heartbeat: counter = ${current + 1}`);
        } catch (err) {
            console.warn("Operation failed (reconnecting?):", (err as Error).message);
        }
    }, 5_000);

    process.on("SIGINT", () => {
        clearInterval(interval);
        client.shutdown();
        console.log("Client shut down.");
        process.exit(0);
    });
}

main().catch((error) => {
    console.error("Fatal:", error);
    process.exit(1);
});
