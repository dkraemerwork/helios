/**
 * Block 11.3 — HealthCheckHandler — /hazelcast/health/* endpoints
 *
 * Tests:
 *  - GET /hazelcast/health returns full health JSON (all 6 fields)
 *  - GET /hazelcast/health/ready returns 200 {"status":"UP"} when ACTIVE
 *  - GET /hazelcast/health/ready returns 503 {"status":"DOWN"} when not ACTIVE
 *  - GET /hazelcast/health/node-state returns {"nodeState":"ACTIVE"}
 *  - GET /hazelcast/health/cluster-state returns {"clusterState":"ACTIVE"}
 *  - GET /hazelcast/health/cluster-safe returns {"clusterSafe":true}
 *  - GET /hazelcast/health/cluster-size returns {"clusterSize":1}
 *  - All responses carry Content-Type: application/json
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { RestApiConfig } from '@zenystx/helios-core/config/RestApiConfig';
import { HeliosRestServer } from '@zenystx/helios-core/rest/HeliosRestServer';
import { HealthCheckHandler } from '@zenystx/helios-core/rest/handler/HealthCheckHandler';
import { NodeState } from '@zenystx/helios-core/instance/lifecycle/NodeState';

// ─── helpers ──────────────────────────────────────────────────────────────────

const ACTIVE_STATE = {
    getNodeState: () => NodeState.ACTIVE,
    getClusterState: () => 'ACTIVE',
    isClusterSafe: () => true,
    getClusterSize: () => 1,
    getMemberVersion: () => '1.0.0',
    getInstanceName: () => 'helios-node-1',
};

function makeServer(state = ACTIVE_STATE): { port: number } {
    const cfg = new RestApiConfig().setEnabled(true).setPort(0).enableAllGroups();
    const server = new HeliosRestServer(cfg);
    const handler = new HealthCheckHandler(state);
    server.registerHandler('/hazelcast/health', (req) => handler.handle(req));
    server.start();
    SERVERS.push(server);
    return { port: server.getBoundPort() };
}

const SERVERS: HeliosRestServer[] = [];

afterEach(() => {
    for (const s of SERVERS) s.stop();
    SERVERS.length = 0;
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe('HealthCheckHandler — /hazelcast/health', () => {
    it('GET /hazelcast/health returns full health JSON with all 6 fields', async () => {
        const { port } = makeServer();
        const res = await fetch(`http://localhost:${port}/hazelcast/health`);
        expect(res.status).toBe(200);
        const body = await res.json() as Record<string, unknown>;
        expect(body).toMatchObject({
            nodeState: 'ACTIVE',
            clusterState: 'ACTIVE',
            clusterSafe: true,
            clusterSize: 1,
            memberVersion: '1.0.0',
            instanceName: 'helios-node-1',
        });
    });

    it('GET /hazelcast/health/ready returns 200 with status UP when ACTIVE', async () => {
        const { port } = makeServer();
        const res = await fetch(`http://localhost:${port}/hazelcast/health/ready`);
        expect(res.status).toBe(200);
        const body = await res.json() as { status: string };
        expect(body.status).toBe('UP');
    });

    it('GET /hazelcast/health/ready returns 503 with status DOWN when STARTING', async () => {
        const startingState = { ...ACTIVE_STATE, getNodeState: () => NodeState.STARTING };
        const { port } = makeServer(startingState);
        const res = await fetch(`http://localhost:${port}/hazelcast/health/ready`);
        expect(res.status).toBe(503);
        const body = await res.json() as { status: string };
        expect(body.status).toBe('DOWN');
    });

    it('GET /hazelcast/health/ready returns 503 when SHUTTING_DOWN', async () => {
        const shuttingState = { ...ACTIVE_STATE, getNodeState: () => NodeState.SHUTTING_DOWN };
        const { port } = makeServer(shuttingState);
        const res = await fetch(`http://localhost:${port}/hazelcast/health/ready`);
        expect(res.status).toBe(503);
        const body = await res.json() as { status: string };
        expect(body.status).toBe('DOWN');
    });

    it('GET /hazelcast/health/node-state returns {"nodeState":"ACTIVE"}', async () => {
        const { port } = makeServer();
        const res = await fetch(`http://localhost:${port}/hazelcast/health/node-state`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ nodeState: 'ACTIVE' });
    });

    it('GET /hazelcast/health/cluster-state returns {"clusterState":"ACTIVE"}', async () => {
        const { port } = makeServer();
        const res = await fetch(`http://localhost:${port}/hazelcast/health/cluster-state`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ clusterState: 'ACTIVE' });
    });

    it('GET /hazelcast/health/cluster-safe returns {"clusterSafe":true}', async () => {
        const { port } = makeServer();
        const res = await fetch(`http://localhost:${port}/hazelcast/health/cluster-safe`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ clusterSafe: true });
    });

    it('GET /hazelcast/health/cluster-size returns {"clusterSize":1}', async () => {
        const { port } = makeServer();
        const res = await fetch(`http://localhost:${port}/hazelcast/health/cluster-size`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ clusterSize: 1 });
    });

    it('all health endpoints respond with Content-Type: application/json', async () => {
        const { port } = makeServer();
        const paths = [
            '/hazelcast/health',
            '/hazelcast/health/ready',
            '/hazelcast/health/node-state',
            '/hazelcast/health/cluster-state',
            '/hazelcast/health/cluster-safe',
            '/hazelcast/health/cluster-size',
        ];
        for (const path of paths) {
            const res = await fetch(`http://localhost:${port}${path}`);
            expect(res.headers.get('content-type')).toContain('application/json');
        }
    });
});
