/**
 * E2E test helper — starts a HeliosInstanceImpl with client protocol enabled
 * and creates a connected HeliosClient.
 */
import { HeliosInstanceImpl } from "@zenystx/helios-core/instance/impl/HeliosInstanceImpl";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import { HeliosClient } from "@zenystx/helios-core/client/HeliosClient";
import { ClientConfig } from "@zenystx/helios-core/client/config/ClientConfig";

let instanceCounter = 0;

export interface E2EContext {
    instance: HeliosInstanceImpl;
    client: HeliosClient;
    clientPort: number;
}

/**
 * Start a HeliosInstanceImpl with client protocol on an ephemeral port,
 * then create and connect a HeliosClient to it.
 */
export async function startE2E(clusterName?: string): Promise<E2EContext> {
    const name = clusterName ?? `e2e-cluster-${++instanceCounter}`;

    // Start member
    const heliosConfig = new HeliosConfig(name);
    heliosConfig.getNetworkConfig().setClientProtocolPort(0); // ephemeral
    const instance = new HeliosInstanceImpl(heliosConfig);
    await Bun.sleep(100); // wait for async server start

    const clientPort = instance.getClientProtocolPort();
    if (clientPort <= 0) {
        instance.shutdown();
        throw new Error("ClientProtocolServer did not start");
    }

    // Create and connect client
    const clientConfig = new ClientConfig();
    clientConfig.setClusterName(name);
    clientConfig.getNetworkConfig().addAddress(`127.0.0.1:${clientPort}`);
    // Use a unique name to avoid registry collisions
    clientConfig.setName(`e2e-client-${name}-${Date.now()}`);

    const client = HeliosClient.newHeliosClient(clientConfig);
    await client.connect();

    return { instance, client, clientPort };
}

/**
 * Shutdown both client and member cleanly.
 */
export async function teardownE2E(ctx: E2EContext): Promise<void> {
    try { ctx.client.shutdown(); } catch { /* ignore */ }
    try { ctx.instance.shutdown(); } catch { /* ignore */ }
    // Brief delay for socket cleanup
    await Bun.sleep(50);
}
