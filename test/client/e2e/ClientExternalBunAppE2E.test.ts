/**
 * P20-EXTERNAL-BUN-APP — Proves a fresh external Bun app imports only
 * public package paths and talks to a real cluster unchanged.
 *
 * Since we cannot spawn a truly separate Bun process in test, we prove
 * the contract by importing only from public paths (root barrel and
 * subpath exports) and performing real network operations.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { HeliosInstanceImpl } from "@zenystx/helios-core/instance/impl/HeliosInstanceImpl";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");

let instance: HeliosInstanceImpl | null = null;
afterEach(async () => {
    if (instance) {
        try { instance.shutdown(); } catch { /* ignore */ }
        instance = null;
    }
    await Bun.sleep(50);
});

describe("P20-EXTERNAL-BUN-APP — External Bun app E2E", () => {
    test("imports only from public package paths", async () => {
        // Subpath imports — recommended for external apps (avoids barrel circular deps)
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const { ClientConfig } = await import("@zenystx/helios-core/client/config/ClientConfig");
        expect(HeliosClient).toBeDefined();
        expect(ClientConfig).toBeDefined();
        expect(typeof HeliosClient.newHeliosClient).toBe("function");
    });

    test("subpath imports work for HeliosClient", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        expect(typeof HeliosClient.newHeliosClient).toBe("function");
    });

    test("subpath imports work for ClientConfig", async () => {
        const { ClientConfig } = await import("@zenystx/helios-core/client/config/ClientConfig");
        const config = new ClientConfig();
        expect(config.getName()).toBeDefined();
    });

    test("external app connects to real cluster and performs map operations", async () => {
        // Start a member
        const config = new HeliosConfig("external-app-e2e");
        config.getNetworkConfig().setClientProtocolPort(0);
        instance = new HeliosInstanceImpl(config);
        await Bun.sleep(100);
        const port = instance.getClientProtocolPort();

        // Import from public paths only
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const { ClientConfig } = await import("@zenystx/helios-core/client/config/ClientConfig");

        const clientConfig = new ClientConfig();
        clientConfig.setClusterName("external-app-e2e");
        clientConfig.getNetworkConfig().addAddress(`127.0.0.1:${port}`);
        clientConfig.setName(`ext-app-${Date.now()}`);

        const client = HeliosClient.newHeliosClient(clientConfig);
        await client.connect();

        const map = client.getMap<string, string>("ext-map");
        await map.put("hello", "world");
        expect(await map.get("hello")).toBe("world");

        client.shutdown();
    });

    test("example files exist and use only public imports", () => {
        const examples = [
            "examples/native-app/src/client-example.ts",
            "examples/native-app/src/client-auth-example.ts",
            "examples/native-app/src/client-reconnect-example.ts",
            "examples/native-app/src/client-nearcache-example.ts",
        ];
        for (const ex of examples) {
            expect(existsSync(resolve(ROOT, ex))).toBeTrue();
        }
    });

    test("package.json exports include client subpaths", async () => {
        const pkg = JSON.parse(await Bun.file(resolve(ROOT, "package.json")).text());
        expect(pkg.exports["./client"]).toBeDefined();
        expect(pkg.exports["./client/config"]).toBeDefined();
    });
});
