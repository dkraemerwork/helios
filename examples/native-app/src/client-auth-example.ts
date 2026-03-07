#!/usr/bin/env bun
/**
 * Helios Remote Client — Authentication Example
 *
 * Demonstrates configuring client authentication with username/password
 * credentials against a secured Helios cluster.
 *
 * Usage:
 *   HELIOS_USERNAME=admin HELIOS_PASSWORD=secret bun run examples/native-app/src/client-auth-example.ts
 */
import { HeliosClient } from "@zenystx/helios-core/client/HeliosClient";
import { ClientConfig } from "@zenystx/helios-core/client/config/ClientConfig";
import { UsernamePasswordCredentials } from "@zenystx/helios-core/security/UsernamePasswordCredentials";

async function main(): Promise<void> {
    const address = process.env["HELIOS_CLUSTER_ADDRESS"] ?? "127.0.0.1:5701";
    const username = process.env["HELIOS_USERNAME"] ?? "admin";
    const password = process.env["HELIOS_PASSWORD"] ?? "";

    const config = new ClientConfig();
    config.getNetworkConfig().addAddress(address);

    // ── Security configuration ───────────────────────────────────────────────
    config.getSecurityConfig().setCredentials(
        new UsernamePasswordCredentials(username, password),
    );

    console.log(`Connecting with username '${username}'...`);
    const client = HeliosClient.newHeliosClient(config);
    console.log(`Authenticated as '${client.getName()}'.`);

    // Verify we can perform an operation
    const map = client.getMap<string, string>("auth-test");
    await map.put("key", "authenticated-value");
    const value = await map.get("key");
    console.log(`Authenticated operation result: ${value}`);

    client.shutdown();
    console.log("Client shut down.");
}

main().catch((error) => {
    console.error("Fatal:", error);
    process.exit(1);
});
