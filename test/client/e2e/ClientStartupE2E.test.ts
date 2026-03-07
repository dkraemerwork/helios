/**
 * P20-STARTUP — Client bootstrap, authentication, binary-protocol connect,
 * and clean shutdown against a real member.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { startE2E, teardownE2E, type E2EContext } from "./e2e-helper";

let ctx: E2EContext | null = null;
afterEach(async () => { if (ctx) { await teardownE2E(ctx); ctx = null; } });

describe("P20-STARTUP — Client startup E2E", () => {
    test("client connects to a real member over binary protocol", async () => {
        ctx = await startE2E("startup-e2e");
        expect(ctx.client).toBeDefined();
        expect(ctx.clientPort).toBeGreaterThan(0);
    });

    test("client getName() returns configured name", async () => {
        ctx = await startE2E("startup-name-e2e");
        expect(ctx.client.getName()).toContain("e2e-client-");
    });

    test("client getLifecycleService() reports running", async () => {
        ctx = await startE2E("startup-lifecycle-e2e");
        expect(ctx.client.getLifecycleService().isRunning()).toBeTrue();
    });

    test("client getCluster() returns at least one member", async () => {
        ctx = await startE2E("startup-cluster-e2e");
        const members = ctx.client.getCluster().getMembers();
        expect(members.length).toBeGreaterThanOrEqual(1);
    });

    test("client shutdown is clean and idempotent", async () => {
        ctx = await startE2E("startup-shutdown-e2e");
        ctx.client.shutdown();
        expect(ctx.client.getLifecycleService().isRunning()).toBeFalse();
        // Second shutdown should not throw
        ctx.client.shutdown();
        ctx = null; // skip afterEach teardown
    });

    test("shutdownAll cleans up all clients", async () => {
        ctx = await startE2E("startup-shutdownall-e2e");
        const { HeliosClient } = await import("@zenystx/helios-core/client");
        expect(HeliosClient.getAllHeliosClients().length).toBeGreaterThanOrEqual(1);
        HeliosClient.shutdownAll();
        expect(HeliosClient.getAllHeliosClients().length).toBe(0);
        ctx.instance.shutdown();
        ctx = null;
    });
});
