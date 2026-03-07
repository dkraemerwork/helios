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

    test("addMessageListener returns a registration id and receives pushed events", async () => {
        ctx = await startE2E("topic-listener-e2e");
        const topic = ctx.client.getTopic<string>("e2e-topic-listen");
        const received: string[] = [];
        const regId = topic.addMessageListener((message) => {
            received.push(message.getMessageObject());
        });
        expect(regId).toBeDefined();
        expect(typeof regId).toBe("string");
        expect(regId.length).toBeGreaterThan(0);

        let delivered = false;
        for (let attempt = 0; attempt < 20; attempt++) {
            const marker = `listener-live-${attempt}`;
            await ctx.instance.getTopic<string>("e2e-topic-listen").publish(marker);
            await Bun.sleep(50);
            if (received.includes(marker)) {
                delivered = true;
                break;
            }
        }

        expect(delivered).toBeTrue();
    });

    test("removeMessageListener removes a listener on the member", async () => {
        ctx = await startE2E("topic-removelisten-e2e");
        const topic = ctx.client.getTopic<string>("e2e-topic-rm");
        const received: string[] = [];
        const regId = topic.addMessageListener((message) => {
            received.push(message.getMessageObject());
        });
        const removed = topic.removeMessageListener(regId);
        expect(removed).toBeTrue();

        await ctx.instance.getTopic<string>("e2e-topic-rm").publish("should-not-arrive");
        await Bun.sleep(100);
        expect(received).not.toContain("should-not-arrive");
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
