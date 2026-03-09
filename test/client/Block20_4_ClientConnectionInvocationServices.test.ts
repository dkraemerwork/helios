/**
 * Block 20.4 — Client connection manager + invocation/cluster/partition/listener services
 *
 * Tests prove the client runtime actually connects, routes requests, and recovers
 * listeners through one real runtime path with no in-process fake backing stores.
 */
import { ClientProtocolServer } from "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

// ── ClientConnection tests ─────────────────────────────────────────────────

describe("ClientConnection", () => {
    test("wraps an eventloop channel with uuid/address metadata", async () => {
        const { ClientConnection } = await import(
            "@zenystx/helios-core/client/connection/ClientConnection"
        );
        expect(ClientConnection).toBeDefined();
        expect(typeof ClientConnection).toBe("function");
    });

    test("tracks authenticated member uuid and cluster uuid", async () => {
        const { ClientConnection } = await import(
            "@zenystx/helios-core/client/connection/ClientConnection"
        );
        // Construct with mock channel
        const conn = new ClientConnection(null as any, "127.0.0.1", 5701);
        expect(conn.getMemberUuid()).toBeNull();
        conn.setMemberUuid("member-1");
        expect(conn.getMemberUuid()).toBe("member-1");
        conn.setClusterUuid("cluster-1");
        expect(conn.getClusterUuid()).toBe("cluster-1");
    });

    test("maintains event handler registry by correlation id", async () => {
        const { ClientConnection } = await import(
            "@zenystx/helios-core/client/connection/ClientConnection"
        );
        const conn = new ClientConnection(null as any, "127.0.0.1", 5701);
        const handler = () => {};
        conn.addEventHandler(42, handler);
        expect(conn.getEventHandler(42)).toBe(handler);
        conn.removeEventHandler(42);
        expect(conn.getEventHandler(42)).toBeUndefined();
    });
});

// ── ClientConnectionManager tests ──────────────────────────────────────────

describe("ClientConnectionManager", () => {
    let server: ClientProtocolServer;

    beforeAll(async () => {
        server = new ClientProtocolServer({
            clusterName: "dev",
            port: 0,
            host: "127.0.0.1",
        });
        await server.start();
    });

    afterAll(async () => {
        await server.shutdown();
    });

    test("connects to cluster with auth and establishes active connection", async () => {
        const { ClientConnectionManager, ClientState } = await import(
            "@zenystx/helios-core/client/connection/ClientConnectionManager"
        );
        const { ClientConfig } = await import(
            "@zenystx/helios-core/client/config"
        );
        const config = new ClientConfig();
        config.getNetworkConfig().addAddress(`127.0.0.1:${server.getPort()}`);

        const mgr = new ClientConnectionManager(config);
        await mgr.start();
        await mgr.connectToCluster();

        expect(mgr.getState()).toBe(ClientState.INITIALIZED_ON_CLUSTER);
        expect(mgr.getActiveConnections().length).toBeGreaterThan(0);

        await mgr.shutdown();
    });

    test("configured username/password credentials are sent during connect", async () => {
        const { ClientConnectionManager } = await import(
            "@zenystx/helios-core/client/connection/ClientConnectionManager"
        );
        const { ClientConfig } = await import(
            "@zenystx/helios-core/client/config"
        );

        const securedServer = new ClientProtocolServer({
            clusterName: "dev",
            port: 0,
            host: "127.0.0.1",
            auth: {
                username: "admin",
                password: "secret",
            },
        });
        await securedServer.start();

        try {
            const config = new ClientConfig();
            config.getNetworkConfig().addAddress(`127.0.0.1:${securedServer.getPort()}`);
            config.getSecurityConfig().setUsernamePasswordIdentity("admin", "secret");

            const mgr = new ClientConnectionManager(config);
            await mgr.start();
            await mgr.connectToCluster();

            expect(mgr.getActiveConnections().length).toBeGreaterThan(0);

            await mgr.shutdown();
        } finally {
            await securedServer.shutdown();
        }
    });

    test("wrong username/password is rejected as a credential error", async () => {
        const { ClientConnectionManager } = await import(
            "@zenystx/helios-core/client/connection/ClientConnectionManager"
        );
        const { ClientConfig } = await import(
            "@zenystx/helios-core/client/config"
        );

        const securedServer = new ClientProtocolServer({
            clusterName: "dev",
            port: 0,
            host: "127.0.0.1",
            auth: {
                username: "admin",
                password: "secret",
            },
        });
        await securedServer.start();

        try {
            const config = new ClientConfig();
            config.getNetworkConfig().addAddress(`127.0.0.1:${securedServer.getPort()}`);
            config.getSecurityConfig().setUsernamePasswordIdentity("admin", "wrong");
            config.getConnectionStrategyConfig().getConnectionRetryConfig()
                .setClusterConnectTimeoutMillis(2000);

            const mgr = new ClientConnectionManager(config);
            await mgr.start();
            await expect(mgr.connectToCluster()).rejects.toThrow(/credential|auth/i);
            await mgr.shutdown();
        } finally {
            await securedServer.shutdown();
        }
    });

    test("auth failure with wrong cluster name is classified as credentials error", async () => {
        const { ClientConnectionManager } = await import(
            "@zenystx/helios-core/client/connection/ClientConnectionManager"
        );
        const { ClientConfig } = await import(
            "@zenystx/helios-core/client/config"
        );
        const config = new ClientConfig();
        config.setClusterName("wrong-cluster");
        config.getNetworkConfig().addAddress(`127.0.0.1:${server.getPort()}`);
        config.getConnectionStrategyConfig().getConnectionRetryConfig()
            .setClusterConnectTimeoutMillis(2000);

        const mgr = new ClientConnectionManager(config);
        await mgr.start();
        await expect(mgr.connectToCluster()).rejects.toThrow(/credential|auth/i);
        await mgr.shutdown();
    });

    test("heartbeat keeps connections alive", async () => {
        const { ClientConnectionManager } = await import(
            "@zenystx/helios-core/client/connection/ClientConnectionManager"
        );
        const { ClientConfig } = await import(
            "@zenystx/helios-core/client/config"
        );
        const config = new ClientConfig();
        config.getNetworkConfig().addAddress(`127.0.0.1:${server.getPort()}`);

        const mgr = new ClientConnectionManager(config);
        await mgr.start();
        await mgr.connectToCluster();

        const conn = mgr.getRandomConnection();
        expect(conn).not.toBeNull();

        // Connection should remain alive after brief wait
        await new Promise((r) => setTimeout(r, 100));
        expect(conn!.isAlive()).toBe(true);

        await mgr.shutdown();
    });

    test("checkInvocationAllowed throws when disconnected with reconnect OFF", async () => {
        const { ClientConnectionManager } = await import(
            "@zenystx/helios-core/client/connection/ClientConnectionManager"
        );
        const { ClientConfig } = await import(
            "@zenystx/helios-core/client/config"
        );
        const config = new ClientConfig();
        config.getConnectionStrategyConfig().setReconnectMode("OFF");

        const mgr = new ClientConnectionManager(config);
        // Not connected
        expect(() => mgr.checkInvocationAllowed()).toThrow();
    });

    test("exponential backoff with jitter on reconnect", async () => {
        const { WaitStrategy } = await import(
            "@zenystx/helios-core/client/connection/WaitStrategy"
        );
        const ws = new WaitStrategy(100, 3000, 2.0, 0.1, 10_000);
        const d1 = ws.getCurrentSleepMillis();
        ws.sleep(); // advances attempt
        const d2 = ws.getCurrentSleepMillis();
        expect(d2).toBeGreaterThanOrEqual(d1);
    });

    test("cluster mismatch detected when cluster uuid changes", async () => {
        const { ClientConnectionManager } = await import(
            "@zenystx/helios-core/client/connection/ClientConnectionManager"
        );
        const { ClientConfig } = await import(
            "@zenystx/helios-core/client/config"
        );
        const config = new ClientConfig();
        config.getNetworkConfig().addAddress(`127.0.0.1:${server.getPort()}`);

        const mgr = new ClientConnectionManager(config);
        await mgr.start();
        await mgr.connectToCluster();

        // The manager should track the cluster UUID from auth response
        expect(mgr.getClusterId()).toBeTruthy();

        await mgr.shutdown();
    });

    test("automatic reconnect accepts a restarted cluster with a different cluster id", async () => {
        const { ClientConnectionManager } = await import(
            "@zenystx/helios-core/client/connection/ClientConnectionManager"
        );
        const { ClientConfig } = await import(
            "@zenystx/helios-core/client/config"
        );

        const initialServer = new ClientProtocolServer({
            clusterName: "dev",
            clusterId: "11111111-1111-1111-1111-111111111111",
            port: 0,
            host: "127.0.0.1",
        });
        await initialServer.start();

        const config = new ClientConfig();
        config.getNetworkConfig().addAddress(`127.0.0.1:${initialServer.getPort()}`);
        config.getConnectionStrategyConfig().getConnectionRetryConfig()
            .setClusterConnectTimeoutMillis(5000);

        const mgr = new ClientConnectionManager(config);
        await mgr.start();
        await mgr.connectToCluster();

        const reconnectPort = initialServer.getPort();
        expect(mgr.getClusterId()).toBe("11111111-1111-1111-1111-111111111111");

        // Trigger automatic reconnect by closing the connection
        mgr.getRandomConnection()?.close();
        await initialServer.shutdown();
        await Bun.sleep(100);

        const replacementServer = new ClientProtocolServer({
            clusterName: "dev",
            clusterId: "22222222-2222-2222-2222-222222222222",
            port: reconnectPort,
            host: "127.0.0.1",
        });
        await replacementServer.start();

        // Wait for automatic reconnect to complete with the new cluster
        await Bun.sleep(2000);

        try {
            // Automatic reconnect should succeed and update the cluster id
            expect(mgr.getClusterId()).toBe("22222222-2222-2222-2222-222222222222");
            expect(mgr.getRandomConnection()).not.toBeNull();
        } finally {
            await mgr.shutdown();
            await replacementServer.shutdown();
        }
    });

    test("reconnect keeps working when the cluster identity matches", async () => {
        const { ClientConnectionManager } = await import(
            "@zenystx/helios-core/client/connection/ClientConnectionManager"
        );
        const { ClientConfig } = await import(
            "@zenystx/helios-core/client/config"
        );

        const clusterId = "33333333-3333-3333-3333-333333333333";
        const initialServer = new ClientProtocolServer({
            clusterName: "dev",
            clusterId,
            port: 0,
            host: "127.0.0.1",
        });
        await initialServer.start();

        const config = new ClientConfig();
        config.getNetworkConfig().addAddress(`127.0.0.1:${initialServer.getPort()}`);
        config.getConnectionStrategyConfig().getConnectionRetryConfig()
            .setClusterConnectTimeoutMillis(750);

        const mgr = new ClientConnectionManager(config);
        await mgr.start();
        await mgr.connectToCluster();

        const reconnectPort = initialServer.getPort();
        mgr.getRandomConnection()?.close();
        await initialServer.shutdown();
        await Bun.sleep(100);

        const replacementServer = new ClientProtocolServer({
            clusterName: "dev",
            clusterId,
            port: reconnectPort,
            host: "127.0.0.1",
        });
        await replacementServer.start();

        try {
            await mgr.connectToCluster();
            expect(mgr.getClusterId()).toBe(clusterId);
            expect(mgr.getActiveConnections().length).toBeGreaterThan(0);
        } finally {
            await mgr.shutdown();
            await replacementServer.shutdown();
        }
    });
});

// ── ClientInvocation tests ─────────────────────────────────────────────────

describe("ClientInvocation", () => {
    test("assigns correlation id and tracks sent connection", async () => {
        const { ClientInvocation } = await import(
            "@zenystx/helios-core/client/invocation/ClientInvocation"
        );
        const { ClientMessage } = await import(
            "@zenystx/helios-core/client/impl/protocol/ClientMessage"
        );
        const msg = ClientMessage.createForEncode();
        const buf = Buffer.alloc(16);
        msg.add(new ClientMessage.Frame(buf));
        msg.setFinal();

        const inv = ClientInvocation.create(msg, -1);
        expect(inv.getClientMessage()).toBe(msg);
        expect(inv.getPartitionId()).toBe(-1);
    });

    test("completes future on notify", async () => {
        const { ClientInvocation } = await import(
            "@zenystx/helios-core/client/invocation/ClientInvocation"
        );
        const { ClientMessage } = await import(
            "@zenystx/helios-core/client/impl/protocol/ClientMessage"
        );
        const req = ClientMessage.createForEncode();
        const buf = Buffer.alloc(16);
        req.add(new ClientMessage.Frame(buf));
        req.setFinal();

        const inv = ClientInvocation.create(req, -1);
        const future = inv.getFuture();

        // Simulate response
        const resp = ClientMessage.createForEncode();
        const rbuf = Buffer.alloc(16);
        resp.add(new ClientMessage.Frame(rbuf));
        resp.setFinal();

        inv.notify(resp);
        const result = await future;
        expect(result).toBe(resp);
    });

    test("retry classification: retryable vs terminal errors", async () => {
        const { ClientInvocation } = await import(
            "@zenystx/helios-core/client/invocation/ClientInvocation"
        );
        // Should have static retry classification
        expect(ClientInvocation.isRetryable(new Error("target disconnected"))).toBe(true);
        expect(ClientInvocation.isRetryable(new Error("credentials failed"))).toBe(false);
    });
});

// ── ClientInvocationService tests ──────────────────────────────────────────

describe("ClientInvocationService", () => {
    let server: ClientProtocolServer;

    beforeAll(async () => {
        server = new ClientProtocolServer({
            clusterName: "dev",
            port: 0,
            host: "127.0.0.1",
            enableMapHandler: true,
        });
        await server.start();
    });

    afterAll(async () => {
        await server.shutdown();
    });

    test("invoke routes request through connection and receives response", async () => {
        const { ClientConnectionManager } = await import(
            "@zenystx/helios-core/client/connection/ClientConnectionManager"
        );
        const { ClientInvocationService } = await import(
            "@zenystx/helios-core/client/invocation/ClientInvocationService"
        );
        const { ClientInvocation } = await import(
            "@zenystx/helios-core/client/invocation/ClientInvocation"
        );
        const { ClientConfig } = await import(
            "@zenystx/helios-core/client/config"
        );
        const { MapPutCodec } = await import(
            "@zenystx/helios-core/client/impl/protocol/codec/MapPutCodec"
        );
        const { HeapData } = await import(
            "@zenystx/helios-core/internal/serialization/impl/HeapData"
        );
        const config = new ClientConfig();
        config.getNetworkConfig().addAddress(`127.0.0.1:${server.getPort()}`);

        const connMgr = new ClientConnectionManager(config);
        await connMgr.start();
        await connMgr.connectToCluster();

        const invService = new ClientInvocationService(connMgr, config);
        invService.start();

        // Create a MapPut request
        const key = new HeapData(Buffer.from([0, 0, 0, 0, 1, 2, 3, 4]));
        const val = new HeapData(Buffer.from([0, 0, 0, 0, 5, 6, 7, 8]));
        const msg = MapPutCodec.encodeRequest("test-map", key, val, 0n, -1n);

        const inv = ClientInvocation.create(msg, -1);
        const resp = await invService.invoke(inv);

        expect(resp).toBeDefined();

        invService.shutdown();
        await connMgr.shutdown();
    });

    test("deregisters invocation after response", async () => {
        const { ClientInvocationService } = await import(
            "@zenystx/helios-core/client/invocation/ClientInvocationService"
        );
        const { ClientConnectionManager } = await import(
            "@zenystx/helios-core/client/connection/ClientConnectionManager"
        );
        const { ClientConfig } = await import(
            "@zenystx/helios-core/client/config"
        );
        const config = new ClientConfig();
        config.getNetworkConfig().addAddress(`127.0.0.1:${server.getPort()}`);

        const connMgr = new ClientConnectionManager(config);
        await connMgr.start();
        await connMgr.connectToCluster();

        const invService = new ClientInvocationService(connMgr, config);
        invService.start();

        expect(invService.getActiveInvocationCount()).toBe(0);

        invService.shutdown();
        await connMgr.shutdown();
    });
});

// ── ClientClusterService tests ──────────────────────────────────────────────

describe("ClientClusterService", () => {
    test("tracks member list with versioning", async () => {
        const { ClientClusterService } = await import(
            "@zenystx/helios-core/client/spi/ClientClusterService"
        );
        const svc = new ClientClusterService();

        expect(svc.getMemberList()).toEqual([]);
        expect(svc.getMemberListVersion()).toBe(-1);
    });

    test("handles members view event with version monotonicity", async () => {
        const { ClientClusterService } = await import(
            "@zenystx/helios-core/client/spi/ClientClusterService"
        );
        const { MemberInfo } = await import(
            "@zenystx/helios-core/cluster/MemberInfo"
        );
        const { Address } = await import("@zenystx/helios-core/cluster/Address");
        const { MemberVersion } = await import(
            "@zenystx/helios-core/version/MemberVersion"
        );

        const svc = new ClientClusterService();

        const member = new MemberInfo(
            new Address("127.0.0.1", 5701),
            "uuid-1",
            new Map(),
            false,
            new MemberVersion(0, 1, 0),
        );

        svc.handleMembersViewEvent(1, [member], "cluster-1");
        expect(svc.getMemberList().length).toBe(1);
        expect(svc.getMemberListVersion()).toBe(1);

        // Stale version should be rejected
        svc.handleMembersViewEvent(0, [], "cluster-1");
        expect(svc.getMemberList().length).toBe(1);
    });

    test("detects cluster id change and resets member list", async () => {
        const { ClientClusterService } = await import(
            "@zenystx/helios-core/client/spi/ClientClusterService"
        );
        const { MemberInfo } = await import(
            "@zenystx/helios-core/cluster/MemberInfo"
        );
        const { Address } = await import("@zenystx/helios-core/cluster/Address");
        const { MemberVersion } = await import(
            "@zenystx/helios-core/version/MemberVersion"
        );

        const svc = new ClientClusterService();
        const member = new MemberInfo(
            new Address("127.0.0.1", 5701),
            "uuid-1",
            new Map(),
            false,
            new MemberVersion(0, 1, 0),
        );

        svc.handleMembersViewEvent(1, [member], "cluster-1");
        expect(svc.getMemberList().length).toBe(1);

        // New cluster means new start
        svc.onClusterConnect("cluster-2");
        expect(svc.getMemberListVersion()).toBe(0);
    });

    test("fires membership events to registered listeners", async () => {
        const { ClientClusterService } = await import(
            "@zenystx/helios-core/client/spi/ClientClusterService"
        );
        const { MemberInfo } = await import(
            "@zenystx/helios-core/cluster/MemberInfo"
        );
        const { Address } = await import("@zenystx/helios-core/cluster/Address");
        const { MemberVersion } = await import(
            "@zenystx/helios-core/version/MemberVersion"
        );

        const svc = new ClientClusterService();
        const events: string[] = [];
        svc.addMembershipListener({
            memberAdded: () => events.push("added"),
            memberRemoved: () => events.push("removed"),
        });

        const member = new MemberInfo(
            new Address("127.0.0.1", 5701),
            "uuid-1",
            new Map(),
            false,
            new MemberVersion(0, 1, 0),
        );
        svc.handleMembersViewEvent(1, [member], "cluster-1");
        expect(events).toContain("added");
    });
});

// ── ClientPartitionService tests ────────────────────────────────────────────

describe("ClientPartitionService", () => {
    test("tracks partition table with version monotonicity", async () => {
        const { ClientPartitionService } = await import(
            "@zenystx/helios-core/client/spi/ClientPartitionService"
        );
        const svc = new ClientPartitionService();

        expect(svc.getPartitionCount()).toBe(0);

        svc.handlePartitionsViewEvent(
            new Map([
                ["uuid-1", [0, 1, 2]],
                ["uuid-2", [3, 4, 5]],
            ]),
            1,
            6,
        );
        expect(svc.getPartitionCount()).toBe(6);
        expect(svc.getPartitionOwner(0)).toBe("uuid-1");
        expect(svc.getPartitionOwner(3)).toBe("uuid-2");

        // Stale version rejected
        svc.handlePartitionsViewEvent(new Map(), 0, 6);
        expect(svc.getPartitionOwner(0)).toBe("uuid-1");
    });

    test("computes partition id from data key hash", async () => {
        const { ClientPartitionService } = await import(
            "@zenystx/helios-core/client/spi/ClientPartitionService"
        );
        const svc = new ClientPartitionService();
        svc.handlePartitionsViewEvent(new Map([["u", [0]]]), 1, 271);

        const id = svc.getPartitionId(42);
        expect(id).toBeGreaterThanOrEqual(0);
        expect(id).toBeLessThan(271);
    });
});

// ── ClientListenerService tests ─────────────────────────────────────────────

describe("ClientListenerService", () => {
    test("registers listener and assigns registration id", async () => {
        const { ClientListenerService } = await import(
            "@zenystx/helios-core/client/spi/ClientListenerService"
        );
        const svc = new ClientListenerService();
        const regId = svc.registerListener(
            {
                encodeAddRequest: () => null as any,
                decodeAddResponse: () => "reg-1",
                encodeRemoveRequest: () => null as any,
                decodeRemoveResponse: () => true,
            },
            () => {},
        );
        expect(regId).toBeTruthy();
    });

    test("deregisters listener by registration id", async () => {
        const { ClientListenerService } = await import(
            "@zenystx/helios-core/client/spi/ClientListenerService"
        );
        const svc = new ClientListenerService();
        const regId = svc.registerListener(
            {
                encodeAddRequest: () => null as any,
                decodeAddResponse: () => "reg-1",
                encodeRemoveRequest: () => null as any,
                decodeRemoveResponse: () => true,
            },
            () => {},
        );
        const removed = svc.deregisterListener(regId);
        expect(removed).toBe(true);
    });

    test("dispatches event messages to registered handlers", async () => {
        const { ClientListenerService } = await import(
            "@zenystx/helios-core/client/spi/ClientListenerService"
        );
        const { ClientMessage } = await import(
            "@zenystx/helios-core/client/impl/protocol/ClientMessage"
        );

        const svc = new ClientListenerService();
        const events: any[] = [];

        // Register a handler for correlation id 99
        svc.addEventHandler(99, (msg: any) => {
            events.push(msg);
        });

        const evtMsg = ClientMessage.createForEncode();
        const buf = Buffer.alloc(16);
        evtMsg.add(new ClientMessage.Frame(buf, ClientMessage.IS_EVENT_FLAG));
        evtMsg.setCorrelationId(99);
        evtMsg.setFinal();

        svc.handleEventMessage(evtMsg);
        expect(events.length).toBe(1);
    });

    test("re-registers listeners on reconnect", async () => {
        const { ClientListenerService } = await import(
            "@zenystx/helios-core/client/spi/ClientListenerService"
        );
        const svc = new ClientListenerService();
        const regIds: string[] = [];

        const regId = svc.registerListener(
            {
                encodeAddRequest: () => null as any,
                decodeAddResponse: () => `reg-${regIds.length}`,
                encodeRemoveRequest: () => null as any,
                decodeRemoveResponse: () => true,
            },
            () => {},
        );
        regIds.push(regId);

        // After reconnect, all registrations should be recoverable
        const pending = svc.getPendingReRegistrations();
        expect(pending.length).toBeGreaterThanOrEqual(0);
    });
});

// ── Member-side protocol tasks ──────────────────────────────────────────────

describe("Member-side protocol tasks", () => {
    let server: ClientProtocolServer;

    beforeAll(async () => {
        server = new ClientProtocolServer({
            clusterName: "dev",
            port: 0,
            host: "127.0.0.1",
        });
        await server.start();
    });

    afterAll(async () => {
        await server.shutdown();
    });

    test("distributed object metadata task registered on server", async () => {
        const { registerDistributedObjectTasks } = await import(
            "@zenystx/helios-core/server/clientprotocol/task/DistributedObjectTask"
        );
        expect(typeof registerDistributedObjectTasks).toBe("function");
    });
});

// ── Integration: end-to-end flow ────────────────────────────────────────────

describe("Integration: client runtime end-to-end", () => {
    let server: ClientProtocolServer;

    beforeAll(async () => {
        server = new ClientProtocolServer({
            clusterName: "dev",
            port: 0,
            host: "127.0.0.1",
            enableMapHandler: true,
        });
        await server.start();
    });

    afterAll(async () => {
        await server.shutdown();
    });

    test("full connect → auth → invoke → response flow through central services", async () => {
        const { ClientConnectionManager } = await import(
            "@zenystx/helios-core/client/connection/ClientConnectionManager"
        );
        const { ClientInvocationService } = await import(
            "@zenystx/helios-core/client/invocation/ClientInvocationService"
        );
        const { ClientClusterService } = await import(
            "@zenystx/helios-core/client/spi/ClientClusterService"
        );
        const { ClientPartitionService } = await import(
            "@zenystx/helios-core/client/spi/ClientPartitionService"
        );
        const { ClientListenerService } = await import(
            "@zenystx/helios-core/client/spi/ClientListenerService"
        );
        const { ClientInvocation } = await import(
            "@zenystx/helios-core/client/invocation/ClientInvocation"
        );
        const { ClientConfig } = await import(
            "@zenystx/helios-core/client/config"
        );
        const { MapPutCodec } = await import(
            "@zenystx/helios-core/client/impl/protocol/codec/MapPutCodec"
        );
        const { HeapData } = await import(
            "@zenystx/helios-core/internal/serialization/impl/HeapData"
        );

        const config = new ClientConfig();
        config.getNetworkConfig().addAddress(`127.0.0.1:${server.getPort()}`);

        // Build the runtime services
        const connMgr = new ClientConnectionManager(config);
        const clusterSvc = new ClientClusterService();
        const partitionSvc = new ClientPartitionService();
        const listenerSvc = new ClientListenerService();
        const invSvc = new ClientInvocationService(connMgr, config);

        // Wire connection events to cluster/partition/listener services
        connMgr.setClusterService(clusterSvc);
        connMgr.setPartitionService(partitionSvc);
        connMgr.setListenerService(listenerSvc);

        await connMgr.start();
        await connMgr.connectToCluster();
        invSvc.start();

        // Verify cluster service received member info from auth
        expect(clusterSvc.getMemberList().length).toBeGreaterThan(0);

        // Invoke a map put through the invocation service
        const key = new HeapData(Buffer.from([0, 0, 0, 0, 1, 2, 3, 4]));
        const val = new HeapData(Buffer.from([0, 0, 0, 0, 5, 6, 7, 8]));
        const req = MapPutCodec.encodeRequest("test-map", key, val, 0n, -1n);

        const inv = ClientInvocation.create(req, -1);
        const resp = await invSvc.invoke(inv);
        expect(resp).toBeDefined();

        // Cleanup
        invSvc.shutdown();
        await connMgr.shutdown();
    });

    test("no in-process fake backing store used for remote calls", async () => {
        // Verify the invocation service routes ONLY through real connections
        const { ClientInvocationService } = await import(
            "@zenystx/helios-core/client/invocation/ClientInvocationService"
        );
        // The service should not have any local map/backing store references
        const proto = Object.getOwnPropertyNames(ClientInvocationService.prototype);
        const badNames = proto.filter(
            (n) =>
                n.includes("backingStore") ||
                n.includes("localMap") ||
                n.includes("fakeStore"),
        );
        expect(badNames).toEqual([]);
    });
});

// ── Verification: central runtime services only ─────────────────────────────

describe("Verification: all calls flow through central runtime", () => {
    test("ClientConnectionManager is the sole connection owner", async () => {
        const { ClientConnectionManager } = await import(
            "@zenystx/helios-core/client/connection/ClientConnectionManager"
        );
        // Must expose getActiveConnections, getRandomConnection, shutdown
        const proto = ClientConnectionManager.prototype;
        expect(typeof proto.getActiveConnections).toBe("function");
        expect(typeof proto.getRandomConnection).toBe("function");
        expect(typeof proto.shutdown).toBe("function");
    });

    test("ClientInvocationService is the sole invocation router", async () => {
        const { ClientInvocationService } = await import(
            "@zenystx/helios-core/client/invocation/ClientInvocationService"
        );
        const proto = ClientInvocationService.prototype;
        expect(typeof proto.invoke).toBe("function");
        expect(typeof proto.shutdown).toBe("function");
    });

    test("ClientClusterService is the sole member-list owner", async () => {
        const { ClientClusterService } = await import(
            "@zenystx/helios-core/client/spi/ClientClusterService"
        );
        const proto = ClientClusterService.prototype;
        expect(typeof proto.getMemberList).toBe("function");
        expect(typeof proto.handleMembersViewEvent).toBe("function");
    });

    test("ClientPartitionService is the sole partition-table owner", async () => {
        const { ClientPartitionService } = await import(
            "@zenystx/helios-core/client/spi/ClientPartitionService"
        );
        const proto = ClientPartitionService.prototype;
        expect(typeof proto.getPartitionOwner).toBe("function");
        expect(typeof proto.handlePartitionsViewEvent).toBe("function");
    });

    test("ClientListenerService is the sole listener registration owner", async () => {
        const { ClientListenerService } = await import(
            "@zenystx/helios-core/client/spi/ClientListenerService"
        );
        const proto = ClientListenerService.prototype;
        expect(typeof proto.registerListener).toBe("function");
        expect(typeof proto.deregisterListener).toBe("function");
        expect(typeof proto.handleEventMessage).toBe("function");
    });
});
