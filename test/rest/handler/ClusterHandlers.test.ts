/**
 * Block 11.4 — ClusterReadHandler + ClusterWriteHandler
 *
 * Tests:
 *  ClusterReadHandler:
 *   - GET /hazelcast/rest/cluster  → {"name":"dev","state":"ACTIVE","memberCount":1}
 *   - GET /hazelcast/rest/instance → {"instanceName":"helios-node-1"}
 *   - CLUSTER_READ disabled → 403
 *
 *  ClusterWriteHandler:
 *   - GET  /hazelcast/rest/log-level               → {"logLevel":"INFO"}
 *   - POST /hazelcast/rest/log-level  {logLevel}   → 200 OK, updates level
 *   - POST /hazelcast/rest/log-level/reset          → 200 OK, resets to INFO
 *   - Log-level round-trip: set DEBUG → get → reset → get INFO
 *   - POST /hazelcast/rest/management/cluster/memberShutdown → 200 OK before shutdown fires
 *   - CLUSTER_WRITE disabled → 403
 */

import { describe, it, expect, afterEach, mock } from 'bun:test';
import { RestApiConfig } from '@helios/config/RestApiConfig';
import { RestEndpointGroup } from '@helios/rest/RestEndpointGroup';
import { HeliosRestServer } from '@helios/rest/HeliosRestServer';
import { ClusterReadHandler } from '@helios/rest/handler/ClusterReadHandler';
import { ClusterWriteHandler } from '@helios/rest/handler/ClusterWriteHandler';

// ─── helpers ──────────────────────────────────────────────────────────────────

const SERVERS: HeliosRestServer[] = [];

afterEach(() => {
    for (const s of SERVERS) s.stop();
    SERVERS.length = 0;
});

function makeReadServer(overrides: Partial<{
    clusterName: string;
    clusterState: string;
    memberCount: number;
    instanceName: string;
}> = {}): { port: number } {
    const state = {
        getClusterName: () => overrides.clusterName ?? 'dev',
        getClusterState: () => overrides.clusterState ?? 'ACTIVE',
        getMemberCount: () => overrides.memberCount ?? 1,
        getInstanceName: () => overrides.instanceName ?? 'helios-node-1',
    };
    const cfg = new RestApiConfig()
        .setEnabled(true)
        .setPort(0)
        .enableGroups(RestEndpointGroup.CLUSTER_READ);
    const server = new HeliosRestServer(cfg);
    const handler = new ClusterReadHandler(state);
    server.registerHandler('/hazelcast/rest/cluster', (req) => handler.handle(req));
    server.registerHandler('/hazelcast/rest/instance', (req) => handler.handle(req));
    server.start();
    SERVERS.push(server);
    return { port: server.getBoundPort() };
}

function makeReadServerDisabled(): { port: number } {
    const state = {
        getClusterName: () => 'dev',
        getClusterState: () => 'ACTIVE',
        getMemberCount: () => 1,
        getInstanceName: () => 'helios-node-1',
    };
    const cfg = new RestApiConfig()
        .setEnabled(true)
        .setPort(0)
        .disableAllGroups()
        .enableGroups(RestEndpointGroup.HEALTH_CHECK); // CLUSTER_READ NOT enabled
    const server = new HeliosRestServer(cfg);
    const handler = new ClusterReadHandler(state);
    server.registerHandler('/hazelcast/rest/cluster', (req) => handler.handle(req));
    server.registerHandler('/hazelcast/rest/instance', (req) => handler.handle(req));
    server.start();
    SERVERS.push(server);
    return { port: server.getBoundPort() };
}

function makeWriteServer(onShutdown?: () => void): {
    port: number;
    getLogLevel: () => string;
} {
    let logLevel = 'INFO';
    const state = {
        getLogLevel: () => logLevel,
        setLogLevel: (level: string) => { logLevel = level; },
        resetLogLevel: () => { logLevel = 'INFO'; },
        shutdown: onShutdown ?? (() => {}),
    };
    const cfg = new RestApiConfig()
        .setEnabled(true)
        .setPort(0)
        .enableGroups(RestEndpointGroup.CLUSTER_WRITE);
    const server = new HeliosRestServer(cfg);
    const handler = new ClusterWriteHandler(state);
    server.registerHandler('/hazelcast/rest/log-level', (req) => handler.handle(req));
    server.registerHandler('/hazelcast/rest/management', (req) => handler.handle(req));
    server.start();
    SERVERS.push(server);
    return { port: server.getBoundPort(), getLogLevel: () => logLevel };
}

function makeWriteServerDisabled(): { port: number } {
    const state = {
        getLogLevel: () => 'INFO',
        setLogLevel: (_level: string) => {},
        resetLogLevel: () => {},
        shutdown: () => {},
    };
    const cfg = new RestApiConfig()
        .setEnabled(true)
        .setPort(0)
        .disableAllGroups()
        .enableGroups(RestEndpointGroup.HEALTH_CHECK); // CLUSTER_WRITE NOT enabled
    const server = new HeliosRestServer(cfg);
    const handler = new ClusterWriteHandler(state);
    server.registerHandler('/hazelcast/rest/log-level', (req) => handler.handle(req));
    server.registerHandler('/hazelcast/rest/management', (req) => handler.handle(req));
    server.start();
    SERVERS.push(server);
    return { port: server.getBoundPort() };
}

// ─── ClusterReadHandler tests ─────────────────────────────────────────────────

describe('ClusterReadHandler — /hazelcast/rest/cluster', () => {
    it('GET /hazelcast/rest/cluster returns cluster name, state, memberCount', async () => {
        const { port } = makeReadServer();
        const res = await fetch(`http://localhost:${port}/hazelcast/rest/cluster`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('application/json');
        const body = await res.json() as Record<string, unknown>;
        expect(body).toMatchObject({ name: 'dev', state: 'ACTIVE', memberCount: 1 });
    });

    it('GET /hazelcast/rest/cluster reflects overridden values', async () => {
        const { port } = makeReadServer({ clusterName: 'prod', clusterState: 'PASSIVE', memberCount: 3 });
        const res = await fetch(`http://localhost:${port}/hazelcast/rest/cluster`);
        const body = await res.json() as Record<string, unknown>;
        expect(body).toMatchObject({ name: 'prod', state: 'PASSIVE', memberCount: 3 });
    });

    it('GET /hazelcast/rest/instance returns instanceName', async () => {
        const { port } = makeReadServer();
        const res = await fetch(`http://localhost:${port}/hazelcast/rest/instance`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('application/json');
        const body = await res.json() as { instanceName: string };
        expect(body.instanceName).toBe('helios-node-1');
    });

    it('GET /hazelcast/rest/cluster returns 403 when CLUSTER_READ group is disabled', async () => {
        const { port } = makeReadServerDisabled();
        const res = await fetch(`http://localhost:${port}/hazelcast/rest/cluster`);
        expect(res.status).toBe(403);
    });
});

// ─── ClusterWriteHandler tests ────────────────────────────────────────────────

describe('ClusterWriteHandler — /hazelcast/rest/log-level + memberShutdown', () => {
    it('GET /hazelcast/rest/log-level returns {"logLevel":"INFO"} by default', async () => {
        const { port } = makeWriteServer();
        const res = await fetch(`http://localhost:${port}/hazelcast/rest/log-level`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('application/json');
        const body = await res.json() as { logLevel: string };
        expect(body.logLevel).toBe('INFO');
    });

    it('POST /hazelcast/rest/log-level sets the log level', async () => {
        const { port } = makeWriteServer();
        const res = await fetch(`http://localhost:${port}/hazelcast/rest/log-level`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ logLevel: 'DEBUG' }),
        });
        expect(res.status).toBe(200);
    });

    it('log-level round-trip: set DEBUG → get DEBUG → reset → get INFO', async () => {
        const { port } = makeWriteServer();

        // Set to DEBUG
        await fetch(`http://localhost:${port}/hazelcast/rest/log-level`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ logLevel: 'DEBUG' }),
        });

        // Verify DEBUG
        const r1 = await fetch(`http://localhost:${port}/hazelcast/rest/log-level`);
        const b1 = await r1.json() as { logLevel: string };
        expect(b1.logLevel).toBe('DEBUG');

        // Reset
        const resetRes = await fetch(`http://localhost:${port}/hazelcast/rest/log-level/reset`, {
            method: 'POST',
        });
        expect(resetRes.status).toBe(200);

        // Verify back to INFO
        const r2 = await fetch(`http://localhost:${port}/hazelcast/rest/log-level`);
        const b2 = await r2.json() as { logLevel: string };
        expect(b2.logLevel).toBe('INFO');
    });

    it('POST /hazelcast/rest/management/cluster/memberShutdown returns 200 before shutdown fires', async () => {
        let shutdownCalled = false;
        const { port } = makeWriteServer(() => { shutdownCalled = true; });

        const res = await fetch(
            `http://localhost:${port}/hazelcast/rest/management/cluster/memberShutdown`,
            { method: 'POST' },
        );
        // Response must be 200 (sent before async shutdown)
        expect(res.status).toBe(200);

        // Shutdown fires asynchronously — wait briefly
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        expect(shutdownCalled).toBe(true);
    });

    it('GET /hazelcast/rest/log-level returns 403 when CLUSTER_WRITE is disabled', async () => {
        const { port } = makeWriteServerDisabled();
        const res = await fetch(`http://localhost:${port}/hazelcast/rest/log-level`);
        expect(res.status).toBe(403);
    });

    it('POST /hazelcast/rest/management/cluster/memberShutdown returns 403 when CLUSTER_WRITE is disabled', async () => {
        const { port } = makeWriteServerDisabled();
        const res = await fetch(
            `http://localhost:${port}/hazelcast/rest/management/cluster/memberShutdown`,
            { method: 'POST' },
        );
        expect(res.status).toBe(403);
    });
});
