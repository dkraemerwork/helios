/**
 * Integration test: two Helios instances with built-in REST server + near-cache.
 *
 * Verifies the full distributed lifecycle using HeliosRestServer endpoints:
 *  1. PUT on instance A via REST → data replicates to instance B via TCP
 *  2. GET on instance B via REST → returns replicated value
 *  3. Health/cluster endpoints work on both nodes
 *  4. UPDATE on A → near-cache on B is invalidated → GET returns fresh data
 *  5. DELETE on A → GET on B returns 204 No Content
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Helios } from '@zenystx/core/Helios';
import { HeliosConfig } from '@zenystx/core/config/HeliosConfig';
import { MapConfig } from '@zenystx/core/config/MapConfig';
import { NearCacheConfig } from '@zenystx/core/config/NearCacheConfig';
import type { HeliosInstanceImpl } from '@zenystx/core/instance/impl/HeliosInstanceImpl';

// Use high ports to avoid conflicts with other tests
const TCP_PORT_A = 16901;
const TCP_PORT_B = 16902;

describe('Distributed near-cache integration (REST API)', () => {
    let nodeA: HeliosInstanceImpl;
    let nodeB: HeliosInstanceImpl;
    let urlA: string;
    let urlB: string;

    beforeAll(async () => {
        // ── Node A: server only, no peers ─────────────────────────────
        const cfgA = new HeliosConfig('nodeA');
        cfgA.getNetworkConfig()
            .setPort(TCP_PORT_A)
            .getJoin()
            .getTcpIpConfig()
            .setEnabled(true);
        cfgA.getNetworkConfig()
            .getRestApiConfig()
            .setEnabled(true)
            .setPort(0)
            .enableAllGroups();

        const demoMapA = new MapConfig('demo');
        demoMapA.setNearCacheConfig(new NearCacheConfig());
        cfgA.addMapConfig(demoMapA);

        nodeA = await Helios.newInstance(cfgA) as HeliosInstanceImpl;
        urlA = `http://localhost:${nodeA.getRestServer().getBoundPort()}`;

        // ── Node B: connects to A ──────────────────────────────────────
        const cfgB = new HeliosConfig('nodeB');
        cfgB.getNetworkConfig()
            .setPort(TCP_PORT_B)
            .getJoin()
            .getTcpIpConfig()
            .setEnabled(true)
            .addMember(`localhost:${TCP_PORT_A}`);
        cfgB.getNetworkConfig()
            .getRestApiConfig()
            .setEnabled(true)
            .setPort(0)
            .enableAllGroups();

        const demoMapB = new MapConfig('demo');
        demoMapB.setNearCacheConfig(new NearCacheConfig());
        cfgB.addMapConfig(demoMapB);

        nodeB = await Helios.newInstance(cfgB) as HeliosInstanceImpl;
        urlB = `http://localhost:${nodeB.getRestServer().getBoundPort()}`;

        // Wait for TCP peering
        const deadline = Date.now() + 5000;
        while (nodeA.getTcpPeerCount() < 1 && Date.now() < deadline) {
            await Bun.sleep(20);
        }
        expect(nodeA.getTcpPeerCount()).toBeGreaterThanOrEqual(1);
    });

    afterAll(() => {
        nodeB?.shutdown();
        nodeA?.shutdown();
    });

    // ── Health check ──────────────────────────────────────────────────────

    it('health/ready returns 200 UP on both nodes', async () => {
        const resA = await fetch(`${urlA}/hazelcast/health/ready`);
        const resB = await fetch(`${urlB}/hazelcast/health/ready`);
        expect(resA.status).toBe(200);
        expect(resB.status).toBe(200);
        const bodyA = await resA.json() as { status: string };
        const bodyB = await resB.json() as { status: string };
        expect(bodyA.status).toBe('UP');
        expect(bodyB.status).toBe('UP');
    });

    // ── Cluster info ──────────────────────────────────────────────────────

    it('/hazelcast/rest/cluster returns correct instance names', async () => {
        const resA = await fetch(`${urlA}/hazelcast/rest/instance`);
        const resB = await fetch(`${urlB}/hazelcast/rest/instance`);
        const bodyA = await resA.json() as { instanceName: string };
        const bodyB = await resB.json() as { instanceName: string };
        expect(bodyA.instanceName).toBe('nodeA');
        expect(bodyB.instanceName).toBe('nodeB');
    });

    // ── Data replication ──────────────────────────────────────────────────

    it('POST on A → data replicates to B → GET on B returns value', async () => {
        const putRes = await fetch(`${urlA}/hazelcast/rest/maps/demo/user1`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Alice', age: 30 }),
        });
        expect(putRes.status).toBe(200);

        // Wait for TCP replication
        await Bun.sleep(200);

        const getRes = await fetch(`${urlB}/hazelcast/rest/maps/demo/user1`);
        expect(getRes.status).toBe(200);
        const value = await getRes.json() as { name: string; age: number };
        expect(value.name).toBe('Alice');
        expect(value.age).toBe(30);
    });

    it('GET on missing key returns 204 No Content', async () => {
        const res = await fetch(`${urlA}/hazelcast/rest/maps/demo/nonexistent`);
        expect(res.status).toBe(204);
    });

    // ── Near-cache invalidation ────────────────────────────────────────────

    it('UPDATE on A → near-cache on B invalidated → GET on B returns fresh data', async () => {
        // Warm near-cache on B by reading user1
        const warmup = await fetch(`${urlB}/hazelcast/rest/maps/demo/user1`);
        expect(warmup.status).toBe(200);

        // Update on A
        const update = await fetch(`${urlA}/hazelcast/rest/maps/demo/user1`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Alice', age: 31 }),
        });
        expect(update.status).toBe(200);

        // Wait for invalidation to propagate
        await Bun.sleep(200);

        // GET on B must return fresh (updated) data
        const getRes = await fetch(`${urlB}/hazelcast/rest/maps/demo/user1`);
        expect(getRes.status).toBe(200);
        const value = await getRes.json() as { name: string; age: number };
        expect(value.age).toBe(31);  // must be the updated value
    });

    // ── DELETE ────────────────────────────────────────────────────────────

    it('DELETE on A → key absent on B after replication', async () => {
        // Ensure key exists first
        await fetch(`${urlA}/hazelcast/rest/maps/demo/user1`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Alice', age: 31 }),
        });
        await Bun.sleep(100);

        const delRes = await fetch(`${urlA}/hazelcast/rest/maps/demo/user1`, {
            method: 'DELETE',
        });
        expect(delRes.status).toBe(200);

        // Wait for replication
        await Bun.sleep(200);

        // GET on B should return 204 (absent)
        const getRes = await fetch(`${urlB}/hazelcast/rest/maps/demo/user1`);
        expect(getRes.status).toBe(204);
    });

    // ── Multi-key replication ─────────────────────────────────────────────

    it('multiple keys replicate from A to B', async () => {
        for (const key of ['k1', 'k2', 'k3']) {
            await fetch(`${urlA}/hazelcast/rest/maps/demo/${key}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(`value-${key}`),
            });
        }

        await Bun.sleep(200);

        for (const key of ['k1', 'k2', 'k3']) {
            const res = await fetch(`${urlB}/hazelcast/rest/maps/demo/${key}`);
            expect(res.status).toBe(200);
            const val = await res.json() as string;
            expect(val).toBe(`value-${key}`);
        }
    });
});
