#!/usr/bin/env bun
/**
 * Helios Remote Client — Authentication Example
 *
 * Demonstrates configuring client authentication with username/password
 * credentials against a Helios member whose client protocol is secured.
 *
 * Usage:
 *   HELIOS_USERNAME=admin HELIOS_PASSWORD=secret bun run examples/native-app/src/client-auth-example.ts
 *
 * Environment variables:
 *   HELIOS_CLUSTER_ADDRESS  — server address (default: 127.0.0.1:5701)
 *   HELIOS_CLUSTER_NAME     — cluster name   (default: dev)
 *   HELIOS_USERNAME         — username       (default: admin)
 *   HELIOS_PASSWORD         — password       (default: empty)
 *
 * Server-side setup example:
 *   const serverConfig = new HeliosConfig("dev");
 *   serverConfig.getNetworkConfig().setClientProtocolPort(5701);
 *   serverConfig.getNetworkConfig().setClientProtocolUsernamePasswordAuth("admin", "secret");
 */
import { HeliosClient } from "@zenystx/helios-core/client";
import { ClientConfig } from "@zenystx/helios-core/client/config";

async function main(): Promise<void> {
    const address = process.env["HELIOS_CLUSTER_ADDRESS"] ?? "127.0.0.1:5701";
    const clusterName = process.env["HELIOS_CLUSTER_NAME"] ?? "dev";
    const username = process.env["HELIOS_USERNAME"] ?? "admin";
    const password = process.env["HELIOS_PASSWORD"] ?? "";

    const config = new ClientConfig();
    config.setClusterName(clusterName);
    config.getNetworkConfig().addAddress(address);

    // ── Security configuration ───────────────────────────────────────────────
    config.getSecurityConfig().setUsernamePasswordIdentity(username, password);

    console.log(`Connecting to '${clusterName}' at ${address} with username '${username}'...`);
    const client = HeliosClient.newHeliosClient(config);
    await client.connect();
    console.log(`Authenticated as '${client.getName()}'.`);

    try {
        // Verify we can perform an operation
        const map = client.getMap<string, string>("auth-test");
        await map.put("key", "authenticated-value");
        const value = await map.get("key");
        console.log(`Authenticated operation result: ${value}`);
    } finally {
        client.shutdown();
    }
    console.log("Client shut down.");
}

main().catch((error) => {
    console.error("Fatal:", error);
    process.exit(1);
});
