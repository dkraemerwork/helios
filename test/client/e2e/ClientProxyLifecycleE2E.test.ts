/**
 * P20-PROXY-LIFECYCLE — Create/list/destroy/re-create semantics and
 * cache cleanup through ProxyManager.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { startE2E, teardownE2E, type E2EContext } from "./e2e-helper";

let ctx: E2EContext | null = null;
afterEach(async () => { if (ctx) { await teardownE2E(ctx); ctx = null; } });

describe("P20-PROXY-LIFECYCLE — Client proxy lifecycle E2E", () => {
    test("getMap returns a proxy with correct name", async () => {
        ctx = await startE2E("proxy-map-e2e");
        const map = ctx.client.getMap("lifecycle-map");
        expect(map.getName()).toBe("lifecycle-map");
    });

    test("getMap returns same instance for same name (cached)", async () => {
        ctx = await startE2E("proxy-cache-e2e");
        const map1 = ctx.client.getMap("cached-map");
        const map2 = ctx.client.getMap("cached-map");
        expect(map1).toBe(map2);
    });

    test("getQueue returns a proxy with correct name", async () => {
        ctx = await startE2E("proxy-queue-e2e");
        const queue = ctx.client.getQueue("lifecycle-queue");
        expect(queue.getName()).toBe("lifecycle-queue");
    });

    test("getTopic returns a proxy with correct name", async () => {
        ctx = await startE2E("proxy-topic-e2e");
        const topic = ctx.client.getTopic("lifecycle-topic");
        expect(topic.getName()).toBe("lifecycle-topic");
    });

    test("getDistributedObject returns a proxy for map service", async () => {
        ctx = await startE2E("proxy-dist-e2e");
        const obj = ctx.client.getDistributedObject("hz:impl:mapService", "dist-obj-map");
        expect(obj.getName()).toBe("dist-obj-map");
        expect(obj.getServiceName()).toBe("hz:impl:mapService");
    });

    test("proxy is usable after re-creation", async () => {
        ctx = await startE2E("proxy-recreate-e2e");
        const map1 = ctx.client.getMap<string, string>("recreate-map");
        await map1.put("k", "v1");
        // Destroy and re-create
        await (map1 as unknown as { destroy(): Promise<void> }).destroy();
        const map2 = ctx.client.getMap<string, string>("recreate-map");
        expect(map2).not.toBe(map1);
        // New proxy should be functional
        await map2.put("k", "v2");
        expect(await map2.get("k")).toBe("v2");
    });

    test("shutdown destroys all proxies", async () => {
        ctx = await startE2E("proxy-shutdown-e2e");
        ctx.client.getMap("m1");
        ctx.client.getQueue("q1");
        ctx.client.shutdown();
        expect(ctx.client.getLifecycleService().isRunning()).toBeFalse();
        // Operations on a shutdown client should throw
        let threw = false;
        try { ctx.client.getMap("m2"); } catch { threw = true; }
        expect(threw).toBeTrue();
        ctx = null;
    });
});
