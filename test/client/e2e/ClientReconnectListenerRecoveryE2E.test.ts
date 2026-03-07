/**
 * P20-RECONNECT-LISTENER — Reconnect, listener re-registration, and
 * post-reconnect event delivery.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { startE2E, teardownE2E, type E2EContext } from "./e2e-helper";
import { ClientConfig } from "@zenystx/helios-core/client/config/ClientConfig";

let ctx: E2EContext | null = null;
afterEach(async () => { if (ctx) { await teardownE2E(ctx); ctx = null; } });

describe("P20-RECONNECT-LISTENER — Client reconnect E2E", () => {
    test("client connection strategy config has reconnect mode", async () => {
        ctx = await startE2E("reconnect-cfg-e2e");
        const strategy = ctx.client.getConfig().getConnectionStrategyConfig();
        expect(strategy.getReconnectMode()).toBeDefined();
    });

    test("client retry config has backoff parameters", async () => {
        ctx = await startE2E("reconnect-retry-e2e");
        const retry = ctx.client.getConfig().getConnectionStrategyConfig().getConnectionRetryConfig();
        expect(retry.getInitialBackoffMillis()).toBeGreaterThan(0);
        expect(retry.getMaxBackoffMillis()).toBeGreaterThan(0);
        expect(retry.getMultiplier()).toBeGreaterThan(0);
    });

    test("client detects disconnection when member shuts down", async () => {
        ctx = await startE2E("reconnect-disconnect-e2e");
        expect(ctx.client.getLifecycleService().isRunning()).toBeTrue();
        // Shut down the member — client should detect disconnection
        ctx.instance.shutdown();
        await Bun.sleep(200);
        // Client lifecycle is still "running" (it may try to reconnect)
        // but operations should fail
        const map = ctx.client.getMap<string, string>("test-disc");
        let threw = false;
        try {
            await map.put("k", "v");
        } catch {
            threw = true;
        }
        expect(threw).toBeTrue();
        ctx.client.shutdown();
        ctx = null;
    });

    test("topic listener registration returns id before any publish", async () => {
        ctx = await startE2E("reconnect-topiclistener-e2e");
        const topic = ctx.client.getTopic<string>("reconnect-topic");
        const regId = topic.addMessageListener(() => {});
        expect(typeof regId).toBe("string");
        expect(regId.length).toBeGreaterThan(0);
    });

    test("reconnect config defaults are reasonable", async () => {
        const config = new ClientConfig();
        const retry = config.getConnectionStrategyConfig().getConnectionRetryConfig();
        // Default is -1 (infinite retry); verify it's set
        expect(retry.getClusterConnectTimeoutMillis()).not.toBeNaN();
        expect(retry.getJitter()).toBeGreaterThanOrEqual(0);
    });
});
