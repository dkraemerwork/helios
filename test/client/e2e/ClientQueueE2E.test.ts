/**
 * P20-QUEUE — Real remote queue proxy use from a separate client over sockets.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { startE2E, teardownE2E, type E2EContext } from "./e2e-helper";

let ctx: E2EContext | null = null;
afterEach(async () => { if (ctx) { await teardownE2E(ctx); ctx = null; } });

describe("P20-QUEUE — Client Queue E2E", () => {
    test("offer and poll a value", async () => {
        ctx = await startE2E("queue-basic-e2e");
        const queue = ctx.client.getQueue<string>("e2e-queue");
        const offered = await queue.offer("item1");
        expect(offered).toBeTrue();
        const polled = await queue.poll();
        expect(polled).toBe("item1");
    });

    test("poll returns null on empty queue", async () => {
        ctx = await startE2E("queue-empty-e2e");
        const queue = ctx.client.getQueue<string>("e2e-queue-empty");
        const polled = await queue.poll();
        expect(polled).toBeNull();
    });

    test("peek does not remove element", async () => {
        ctx = await startE2E("queue-peek-e2e");
        const queue = ctx.client.getQueue<string>("e2e-queue-peek");
        await queue.offer("peekme");
        const peeked = await queue.peek();
        expect(peeked).toBe("peekme");
        expect(await queue.size()).toBe(1);
    });

    test("size reflects queue depth", async () => {
        ctx = await startE2E("queue-size-e2e");
        const queue = ctx.client.getQueue<string>("e2e-queue-size");
        expect(await queue.size()).toBe(0);
        await queue.offer("a");
        await queue.offer("b");
        expect(await queue.size()).toBe(2);
    });

    test("FIFO order is preserved", async () => {
        ctx = await startE2E("queue-fifo-e2e");
        const queue = ctx.client.getQueue<string>("e2e-queue-fifo");
        await queue.offer("first");
        await queue.offer("second");
        expect(await queue.poll()).toBe("first");
        expect(await queue.poll()).toBe("second");
    });
});
