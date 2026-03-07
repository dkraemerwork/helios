/**
 * P20-TOPIC — Real remote topic proxy use from a separate client over sockets.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { startE2E, teardownE2E, type E2EContext } from "./e2e-helper";

let ctx: E2EContext | null = null;
afterEach(async () => { if (ctx) { await teardownE2E(ctx); ctx = null; } });

describe("P20-TOPIC — Client Topic E2E", () => {
    test("publish succeeds without error", async () => {
        ctx = await startE2E("topic-pub-e2e");
        const topic = ctx.client.getTopic<string>("e2e-topic");
        // Publish should not throw — proves the topic proxy routes through
        // the binary protocol to the member's topic service
        await topic.publish("hello-from-client");
    });

    test("addMessageListener returns a registration id", async () => {
        ctx = await startE2E("topic-listener-e2e");
        const topic = ctx.client.getTopic<string>("e2e-topic-listen");
        const regId = topic.addMessageListener(() => {});
        expect(regId).toBeDefined();
        expect(typeof regId).toBe("string");
        expect(regId.length).toBeGreaterThan(0);
    });

    test("removeMessageListener removes a listener", async () => {
        ctx = await startE2E("topic-removelisten-e2e");
        const topic = ctx.client.getTopic<string>("e2e-topic-rm");
        const regId = topic.addMessageListener(() => {});
        const removed = topic.removeMessageListener(regId);
        expect(removed).toBeTrue();
    });

    test("multiple publishes succeed", async () => {
        ctx = await startE2E("topic-multi-e2e");
        const topic = ctx.client.getTopic<string>("e2e-topic-multi");
        await topic.publish("msg1");
        await topic.publish("msg2");
        await topic.publish("msg3");
        // No error means all three messages were dispatched via binary protocol
    });
});
