/**
 * Block 11.2 — HeliosRestServer + RestApiFilter + lifecycle
 *
 * Tests:
 *  - HeliosRestServer lifecycle (start, stop, getBoundPort, isStarted)
 *  - RestApiFilter group routing + 403/404 responses
 *  - HeliosInstanceImpl REST wiring (starts/stops with instance)
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { RestApiConfig } from '@zenystx/helios-core/config/RestApiConfig';
import { RestEndpointGroup } from '@zenystx/helios-core/rest/RestEndpointGroup';
import { HeliosRestServer } from '@zenystx/helios-core/rest/HeliosRestServer';
import { RestApiFilter } from '@zenystx/helios-core/rest/RestApiFilter';
import { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';

// ─── RestApiFilter — group routing ────────────────────────────────────────────

describe('RestApiFilter — group routing', () => {
    it('maps /hazelcast/health to HEALTH_CHECK', () => {
        const filter = new RestApiFilter(new RestApiConfig().setEnabled(true).enableAllGroups());
        expect(filter.getGroupForPath('/hazelcast/health')).toBe(RestEndpointGroup.HEALTH_CHECK);
    });

    it('maps /hazelcast/health/ready to HEALTH_CHECK', () => {
        const filter = new RestApiFilter(new RestApiConfig().setEnabled(true).enableAllGroups());
        expect(filter.getGroupForPath('/hazelcast/health/ready')).toBe(RestEndpointGroup.HEALTH_CHECK);
    });

    it('maps /hazelcast/rest/cluster to CLUSTER_READ', () => {
        const filter = new RestApiFilter(new RestApiConfig().setEnabled(true).enableAllGroups());
        expect(filter.getGroupForPath('/hazelcast/rest/cluster')).toBe(RestEndpointGroup.CLUSTER_READ);
    });

    it('maps /hazelcast/rest/instance to CLUSTER_READ', () => {
        const filter = new RestApiFilter(new RestApiConfig().setEnabled(true).enableAllGroups());
        expect(filter.getGroupForPath('/hazelcast/rest/instance')).toBe(RestEndpointGroup.CLUSTER_READ);
    });

    it('maps /hazelcast/rest/log-level to CLUSTER_WRITE', () => {
        const filter = new RestApiFilter(new RestApiConfig().setEnabled(true).enableAllGroups());
        expect(filter.getGroupForPath('/hazelcast/rest/log-level')).toBe(RestEndpointGroup.CLUSTER_WRITE);
    });

    it('maps /hazelcast/rest/management/cluster/memberShutdown to CLUSTER_WRITE', () => {
        const filter = new RestApiFilter(new RestApiConfig().setEnabled(true).enableAllGroups());
        expect(filter.getGroupForPath('/hazelcast/rest/management/cluster/memberShutdown')).toBe(RestEndpointGroup.CLUSTER_WRITE);
    });

    it('maps /hazelcast/rest/maps/mymap/key1 to DATA', () => {
        const filter = new RestApiFilter(new RestApiConfig().setEnabled(true).enableAllGroups());
        expect(filter.getGroupForPath('/hazelcast/rest/maps/mymap/key1')).toBe(RestEndpointGroup.DATA);
    });

    it('maps /hazelcast/rest/queues/myqueue/size to DATA', () => {
        const filter = new RestApiFilter(new RestApiConfig().setEnabled(true).enableAllGroups());
        expect(filter.getGroupForPath('/hazelcast/rest/queues/myqueue/size')).toBe(RestEndpointGroup.DATA);
    });

    it('returns null for unknown path', () => {
        const filter = new RestApiFilter(new RestApiConfig().setEnabled(true).enableAllGroups());
        expect(filter.getGroupForPath('/unknown/path')).toBeNull();
    });
});

// ─── HeliosRestServer — lifecycle ─────────────────────────────────────────────

describe('HeliosRestServer — lifecycle', () => {
    const servers: HeliosRestServer[] = [];

    afterEach(() => {
        for (const s of servers) s.stop();
        servers.length = 0;
    });

    it('does not start when config.isEnabledAndNotEmpty() is false', () => {
        const cfg = new RestApiConfig(); // disabled by default
        const server = new HeliosRestServer(cfg);
        servers.push(server);
        server.start();
        expect(server.isStarted()).toBe(false);
    });

    it('starts and isStarted returns true', () => {
        const cfg = new RestApiConfig().setEnabled(true).setPort(0);
        const server = new HeliosRestServer(cfg);
        servers.push(server);
        server.start();
        expect(server.isStarted()).toBe(true);
    });

    it('getBoundPort returns actual port after start', () => {
        const cfg = new RestApiConfig().setEnabled(true).setPort(0);
        const server = new HeliosRestServer(cfg);
        servers.push(server);
        server.start();
        const port = server.getBoundPort();
        expect(port).toBeGreaterThan(0);
    });

    it('stop sets isStarted to false', () => {
        const cfg = new RestApiConfig().setEnabled(true).setPort(0);
        const server = new HeliosRestServer(cfg);
        servers.push(server);
        server.start();
        expect(server.isStarted()).toBe(true);
        server.stop();
        expect(server.isStarted()).toBe(false);
    });

    it('returns 404 JSON for unknown path on enabled server', async () => {
        const cfg = new RestApiConfig().setEnabled(true).setPort(0).enableAllGroups();
        const server = new HeliosRestServer(cfg);
        servers.push(server);
        server.start();
        const port = server.getBoundPort();

        const res = await fetch(`http://localhost:${port}/unknown`);
        expect(res.status).toBe(404);
        const body = await res.json() as { status: number; message: string };
        expect(body.status).toBe(404);
        expect(body.message).toBe('Unknown REST endpoint.');
    });

    it('returns 403 JSON for request to disabled group', async () => {
        // DATA group is disabled by default
        const cfg = new RestApiConfig().setEnabled(true).setPort(0);
        // Default enabled: HEALTH_CHECK + CLUSTER_READ only
        const server = new HeliosRestServer(cfg);
        servers.push(server);
        server.start();
        const port = server.getBoundPort();

        const res = await fetch(`http://localhost:${port}/hazelcast/rest/maps/test/key`);
        expect(res.status).toBe(403);
        const body = await res.json() as { status: number; message: string };
        expect(body.status).toBe(403);
        expect(body.message).toContain('disabled');
    });
});

// ─── HeliosInstanceImpl — REST wiring ─────────────────────────────────────────

describe('HeliosInstanceImpl — REST wiring', () => {
    it('starts REST server when REST config is enabled', () => {
        const config = new HeliosConfig();
        config.getNetworkConfig()
            .getRestApiConfig()
            .setEnabled(true)
            .setPort(0);

        const instance = new HeliosInstanceImpl(config);
        try {
            const restServer = instance.getRestServer();
            expect(restServer.isStarted()).toBe(true);
        } finally {
            instance.shutdown();
        }
    });

    it('does not start REST server when REST config is disabled', () => {
        const config = new HeliosConfig();
        // REST is disabled by default

        const instance = new HeliosInstanceImpl(config);
        try {
            const restServer = instance.getRestServer();
            expect(restServer.isStarted()).toBe(false);
        } finally {
            instance.shutdown();
        }
    });

    it('stops REST server on instance shutdown', () => {
        const config = new HeliosConfig();
        config.getNetworkConfig()
            .getRestApiConfig()
            .setEnabled(true)
            .setPort(0);

        const instance = new HeliosInstanceImpl(config);
        const restServer = instance.getRestServer();
        expect(restServer.isStarted()).toBe(true);

        instance.shutdown();
        expect(restServer.isStarted()).toBe(false);
    });
});
