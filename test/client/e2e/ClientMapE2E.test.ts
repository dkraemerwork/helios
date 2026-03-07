/**
 * P20-MAP — Real remote map proxy use from a separate client over sockets.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { startE2E, teardownE2E, type E2EContext } from "./e2e-helper";

let ctx: E2EContext | null = null;
afterEach(async () => { if (ctx) { await teardownE2E(ctx); ctx = null; } });

describe("P20-MAP — Client Map E2E", () => {
    test("put and get a string value", async () => {
        ctx = await startE2E("map-putget-e2e");
        const map = ctx.client.getMap<string, string>("e2e-map");
        await map.put("key1", "value1");
        const val = await map.get("key1");
        expect(val).toBe("value1");
    });

    test("put returns previous value", async () => {
        ctx = await startE2E("map-prev-e2e");
        const map = ctx.client.getMap<string, string>("e2e-map-prev");
        const prev1 = await map.put("k", "v1");
        expect(prev1).toBeNull();
        const prev2 = await map.put("k", "v2");
        expect(prev2).toBe("v1");
    });

    test("remove returns removed value", async () => {
        ctx = await startE2E("map-remove-e2e");
        const map = ctx.client.getMap<string, string>("e2e-map-rm");
        await map.put("k", "v");
        const removed = await map.remove("k");
        expect(removed).toBe("v");
        const gone = await map.get("k");
        expect(gone).toBeNull();
    });

    test("size reflects entries", async () => {
        ctx = await startE2E("map-size-e2e");
        const map = ctx.client.getMap<string, number>("e2e-map-size");
        const s0 = await map.size();
        expect(s0).toBe(0);
        await map.put("a", 1);
        await map.put("b", 2);
        expect(await map.size()).toBe(2);
    });

    test("containsKey works", async () => {
        ctx = await startE2E("map-contains-e2e");
        const map = ctx.client.getMap<string, string>("e2e-map-ck");
        await map.put("x", "y");
        expect(await map.containsKey("x")).toBeTrue();
        expect(await map.containsKey("z")).toBeFalse();
    });

    test("clear removes all entries", async () => {
        ctx = await startE2E("map-clear-e2e");
        const map = ctx.client.getMap<string, string>("e2e-map-clr");
        await map.put("a", "1");
        await map.put("b", "2");
        await map.clear();
        expect(await map.size()).toBe(0);
    });
});
