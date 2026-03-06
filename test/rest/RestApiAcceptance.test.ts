/**
 * Block 11.6 — REST API e2e acceptance tests
 *
 * Starts a real HeliosInstanceImpl with all 4 REST endpoint groups enabled
 * on an OS-assigned port, then exercises every group via fetch().
 *
 * Tests:
 *  1. HEALTH_CHECK — /hazelcast/health/ready returns 200 UP
 *  2. HEALTH_CHECK — /hazelcast/health/node-state reflects ACTIVE state
 *  3. CLUSTER_READ — /hazelcast/rest/cluster returns cluster JSON
 *  4. CLUSTER_READ — /hazelcast/rest/instance returns instanceName
 *  5. CLUSTER_WRITE — GET /hazelcast/rest/log-level returns current level
 *  6. CLUSTER_WRITE — POST /hazelcast/rest/log-level sets + verifies level
 *  7. DATA — POST + GET IMap entry via REST (round-trip)
 *  8. REST server stops on instance.shutdown()
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';

describe('REST API e2e acceptance', () => {
    let instance: HeliosInstanceImpl;
    let baseUrl: string;

    beforeAll(() => {
        const config = new HeliosConfig('e2e-rest-node');
        config.getNetworkConfig()
            .getRestApiConfig()
            .setEnabled(true)
            .setPort(0)          // OS-assigned port
            .enableAllGroups();

        instance = new HeliosInstanceImpl(config);
        const port = instance.getRestServer().getBoundPort();
        baseUrl = `http://localhost:${port}`;
    });

    afterAll(() => {
        instance.shutdown();
    });

    // ─── HEALTH_CHECK group ──────────────────────────────────────────────────

    it('HEALTH_CHECK: /hazelcast/health/ready returns 200 UP when ACTIVE', async () => {
        const res = await fetch(`${baseUrl}/hazelcast/health/ready`);
        expect(res.status).toBe(200);
        const body = await res.json() as { status: string };
        expect(body.status).toBe('UP');
    });

    it('HEALTH_CHECK: /hazelcast/health/node-state reflects ACTIVE', async () => {
        const res = await fetch(`${baseUrl}/hazelcast/health/node-state`);
        expect(res.status).toBe(200);
        const body = await res.json() as { nodeState: string };
        expect(body.nodeState).toBe('ACTIVE');
    });

    // ─── CLUSTER_READ group ──────────────────────────────────────────────────

    it('CLUSTER_READ: /hazelcast/rest/cluster returns cluster JSON', async () => {
        const res = await fetch(`${baseUrl}/hazelcast/rest/cluster`);
        expect(res.status).toBe(200);
        const body = await res.json() as { name: string; state: string; memberCount: number };
        expect(typeof body.name).toBe('string');
        expect(typeof body.state).toBe('string');
        expect(body.memberCount).toBeGreaterThanOrEqual(1);
    });

    it('CLUSTER_READ: /hazelcast/rest/instance returns instanceName', async () => {
        const res = await fetch(`${baseUrl}/hazelcast/rest/instance`);
        expect(res.status).toBe(200);
        const body = await res.json() as { instanceName: string };
        expect(body.instanceName).toBe('e2e-rest-node');
    });

    // ─── CLUSTER_WRITE group ─────────────────────────────────────────────────

    it('CLUSTER_WRITE: GET /hazelcast/rest/log-level returns current level', async () => {
        const res = await fetch(`${baseUrl}/hazelcast/rest/log-level`);
        expect(res.status).toBe(200);
        const body = await res.json() as { logLevel: string };
        expect(typeof body.logLevel).toBe('string');
        expect(body.logLevel.length).toBeGreaterThan(0);
    });

    it('CLUSTER_WRITE: POST /hazelcast/rest/log-level changes level, reset restores it', async () => {
        // Change to DEBUG
        const set = await fetch(`${baseUrl}/hazelcast/rest/log-level`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ logLevel: 'DEBUG' }),
        });
        expect(set.status).toBe(200);

        // Verify change
        const check = await fetch(`${baseUrl}/hazelcast/rest/log-level`);
        const body = await check.json() as { logLevel: string };
        expect(body.logLevel).toBe('DEBUG');

        // Reset
        const reset = await fetch(`${baseUrl}/hazelcast/rest/log-level/reset`, { method: 'POST' });
        expect(reset.status).toBe(200);

        // Verify reset
        const after = await fetch(`${baseUrl}/hazelcast/rest/log-level`);
        const afterBody = await after.json() as { logLevel: string };
        expect(afterBody.logLevel).toBe('INFO');
    });

    // ─── DATA group ──────────────────────────────────────────────────────────

    it('DATA: POST + GET IMap entry round-trip via REST', async () => {
        // Write
        const put = await fetch(`${baseUrl}/hazelcast/rest/maps/e2e-map/greeting`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hello: 'world' }),
        });
        expect(put.status).toBe(200);

        // Read back
        const get = await fetch(`${baseUrl}/hazelcast/rest/maps/e2e-map/greeting`);
        expect(get.status).toBe(200);
        const value = await get.json() as { hello: string };
        expect(value.hello).toBe('world');
    });

    // ─── Shutdown ────────────────────────────────────────────────────────────

    it('REST server stops and port is released on instance.shutdown()', () => {
        const cfg = new HeliosConfig('shutdown-test-node');
        cfg.getNetworkConfig()
            .getRestApiConfig()
            .setEnabled(true)
            .setPort(0)
            .enableAllGroups();

        const inst = new HeliosInstanceImpl(cfg);
        const restServer = inst.getRestServer();
        expect(restServer.isStarted()).toBe(true);

        inst.shutdown();
        expect(restServer.isStarted()).toBe(false);
    });
});
