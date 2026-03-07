/**
 * P20-RECONNECT-LISTENER — Reconnect, listener re-registration, and
 * post-reconnect event delivery.
 */
import { HeliosClient } from "@zenystx/helios-core/client";
import { ClientConfig } from "@zenystx/helios-core/client/config";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import { HeliosInstanceImpl } from "@zenystx/helios-core/instance/impl/HeliosInstanceImpl";
import { afterEach, describe, expect, test } from "bun:test";

let instance: HeliosInstanceImpl | null = null;
let replacementInstance: HeliosInstanceImpl | null = null;
let client: HeliosClient | null = null;

afterEach(async (): Promise<void> => {
    try {
        client?.shutdown();
    } catch {
        // Ignore shutdown races in reconnect tests.
    }
    client = null;

    try {
        replacementInstance?.shutdown();
    } catch {
        // Ignore shutdown races in reconnect tests.
    }
    replacementInstance = null;

    try {
        instance?.shutdown();
    } catch {
        // Ignore shutdown races in reconnect tests.
    }
    instance = null;

    await Bun.sleep(100);
});

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 5_000, intervalMs = 50): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await condition()) {
            return;
        }
        await Bun.sleep(intervalMs);
    }
    throw new Error(`Condition not met within ${timeoutMs}ms`);
}

async function startMember(clusterName: string, clientPort: number): Promise<HeliosInstanceImpl> {
    const config = new HeliosConfig(clusterName);
    config.getNetworkConfig().setClientProtocolPort(clientPort);
    const started = new HeliosInstanceImpl(config);
    await Bun.sleep(100);
    return started;
}

async function startClient(clusterName: string, clientPort: number): Promise<HeliosClient> {
    const config = new ClientConfig();
    config.setClusterName(clusterName);
    config.setName(`reconnect-client-${clusterName}-${Date.now()}`);
    config.getNetworkConfig().addAddress(`127.0.0.1:${clientPort}`);
    const started = HeliosClient.newHeliosClient(config);
    await started.connect();
    return started;
}

describe("P20-RECONNECT-LISTENER — Client reconnect E2E", () => {
    test("topic listener registration is real and delivers over the binary protocol", async (): Promise<void> => {
        instance = await startMember("reconnect-topiclistener-e2e", 0);
        const clientPort = instance.getClientProtocolPort();
        client = await startClient("reconnect-topiclistener-e2e", clientPort);

        const topic = client.getTopic<string>("reconnect-topic");
        const received: string[] = [];
        const regId = topic.addMessageListener((message) => {
            received.push(message.getMessageObject());
        });

        expect(typeof regId).toBe("string");
        expect(regId.length).toBeGreaterThan(0);

        await waitFor(async () => {
            const marker = `initial-${Date.now()}`;
            await instance!.getTopic<string>("reconnect-topic").publish(marker);
            await Bun.sleep(50);
            return received.includes(marker);
        });
    });

    test("client reconnects, re-registers topic listeners, and receives post-reconnect events", async (): Promise<void> => {
        const clusterName = `reconnect-recovery-e2e-${Date.now()}`;
        instance = await startMember(clusterName, 0);
        const clientPort = instance.getClientProtocolPort();
        client = await startClient(clusterName, clientPort);

        const topic = client.getTopic<string>("reconnect-topic");
        const received: string[] = [];
        topic.addMessageListener((message) => {
            received.push(message.getMessageObject());
        });

        await waitFor(async () => {
            const marker = `before-reconnect-${Date.now()}`;
            await instance!.getTopic<string>("reconnect-topic").publish(marker);
            await Bun.sleep(50);
            return received.includes(marker);
        });

        instance.shutdown();
        instance = null;
        await Bun.sleep(250);

        replacementInstance = await startMember(clusterName, clientPort);

        await waitFor(async () => {
            const marker = `after-reconnect-${Date.now()}`;
            await replacementInstance!.getTopic<string>("reconnect-topic").publish(marker);
            await Bun.sleep(100);
            return received.includes(marker);
        }, 10_000, 100);

        expect(received.some((message) => message.startsWith("before-reconnect-"))).toBeTrue();
        expect(received.some((message) => message.startsWith("after-reconnect-"))).toBeTrue();
    });
});
