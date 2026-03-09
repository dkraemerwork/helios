/**
 * P20-EXTERNAL-BUN-APP — Proves a separate Bun process can run the shipped
 * public example file against a real cluster over the wire.
 */
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import { HeliosInstanceImpl } from "@zenystx/helios-core/instance/impl/HeliosInstanceImpl";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");
const CLIENT_EXAMPLE = resolve(ROOT, "examples/native-app/src/client-example.ts");

let instance: HeliosInstanceImpl | null = null;
afterEach(async () => {
    if (instance) {
        try { instance.shutdown(); } catch { /* ignore */ }
        instance = null;
    }
    await Bun.sleep(50);
});

describe("P20-EXTERNAL-BUN-APP — External Bun app E2E", () => {
    test("imports only from public package paths (via built dist targets)", async () => {
        // Import from built dist files — not tsconfig alias — to honestly
        // prove the package.json export targets are shippable.
        const distClient = resolve(ROOT, "dist/src/client/index.js");
        const distClientConfig = resolve(ROOT, "dist/src/client/config/index.js");
        const { HeliosClient } = await import(distClient);
        const { ClientConfig } = await import(distClientConfig);
        expect(HeliosClient).toBeDefined();
        expect(ClientConfig).toBeDefined();
        expect(typeof HeliosClient.newHeliosClient).toBe("function");
    });

    test("public ./client dist target exports HeliosClient", async () => {
        const { HeliosClient } = await import(resolve(ROOT, "dist/src/client/index.js"));
        expect(typeof HeliosClient.newHeliosClient).toBe("function");
    });

    test("public ./client/config dist target exports ClientConfig", async () => {
        const { ClientConfig } = await import(resolve(ROOT, "dist/src/client/config/index.js"));
        const config = new ClientConfig();
        expect(config.getName()).toBeDefined();
    });

    test("separate Bun process runs the real public client example against a cluster", async () => {
        const config = new HeliosConfig("external-app-e2e");
        config.setClusterName("external-app-e2e");
        config.getNetworkConfig().setClientProtocolPort(0);
        instance = new HeliosInstanceImpl(config);
        await Bun.sleep(100);
        const port = instance.getClientProtocolPort();

        const proc = Bun.spawn([
            "bun",
            "run",
            CLIENT_EXAMPLE,
        ], {
            cwd: ROOT,
            env: {
                ...process.env,
                HELIOS_CLUSTER_NAME: "external-app-e2e",
                HELIOS_CLUSTER_ADDRESS: `127.0.0.1:${port}`,
            },
            stdout: "pipe",
            stderr: "pipe",
        });

        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ]);

        expect(exitCode).toBe(0);
        expect(stderr).toBe("");
        expect(stdout).toContain("Connecting to Helios cluster 'external-app-e2e'");
        expect(stdout).toContain("Map 'demo-map' -> greeting = hello from remote client");
        expect(stdout).toContain("Queue 'demo-queue' -> polled = task-1");
        expect(stdout).toContain("Client shut down.");
    });

    test("example files exist and near-cache example uses only exported public imports", async () => {
        const examples = [
            "examples/native-app/src/client-example.ts",
            "examples/native-app/src/client-auth-example.ts",
            "examples/native-app/src/client-reconnect-example.ts",
            "examples/native-app/src/client-nearcache-example.ts",
        ];
        for (const ex of examples) {
            expect(existsSync(resolve(ROOT, ex))).toBeTrue();
        }

        const nearCacheExample = await Bun.file(resolve(ROOT, "examples/native-app/src/client-nearcache-example.ts")).text();
        expect(nearCacheExample).toContain('from "@zenystx/helios-core"');
        expect(nearCacheExample).toContain('from "@zenystx/helios-core/client"');
        expect(nearCacheExample).toContain('from "@zenystx/helios-core/client/config"');
        expect(nearCacheExample).not.toContain("@zenystx/helios-core/config/NearCacheConfig");
        expect(nearCacheExample).not.toContain("@zenystx/helios-core/config/InMemoryFormat");
        expect(nearCacheExample).not.toContain("@zenystx/helios-core/config/EvictionConfig");
        expect(nearCacheExample).not.toContain("@zenystx/helios-core/config/EvictionPolicy");
        expect(nearCacheExample).not.toContain("@zenystx/helios-core/config/MaxSizePolicy");
    });

    test("package.json exports include client subpaths", async () => {
        const pkg = JSON.parse(await Bun.file(resolve(ROOT, "package.json")).text());
        expect(pkg.exports["./client"]).toBeDefined();
        expect(pkg.exports["./client/config"]).toBeDefined();
    });
});
