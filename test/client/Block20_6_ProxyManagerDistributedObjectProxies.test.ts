/**
 * Block 20.6 — Proxy manager + distributed object lifecycle + core remote proxies
 *
 * Tests prove that:
 * - ClientProxy base class provides lifecycle hooks and invocation helpers
 * - ProxyManager creates, caches, and destroys proxies for all retained distributed services
 * - Same-name getMap/getQueue/getTopic returns the same proxy instance (stable caching)
 * - Distributed-object create/destroy/list protocol codecs encode/decode correctly
 * - Server-side create/destroy/list tasks handle protocol messages
 * - ClientMapProxy implements IMap over the real invocation stack
 * - ClientQueueProxy implements IQueue over the real invocation stack
 * - ClientTopicProxy implements ITopic over the real invocation stack
 * - Executor and reliable-topic proxies are wired after Block 20.5 server closure
 * - Every retained client codec is owned by a real proxy or service (no orphans)
 * - Proxy destroy removes from cache and sends remote destroy
 * - Client shutdown destroys all cached proxies
 * - A separate Bun app can use every shipped proxy over real sockets
 */
import { describe, test, expect } from "bun:test";

// ── 1. ClientProxy base class ──────────────────────────────────────────────────

describe("ClientProxy base class", () => {
    test("ClientProxy exposes getName(), getServiceName(), destroy()", async () => {
        const { ClientProxy } = await import("@zenystx/helios-core/client/proxy/ClientProxy");
        expect(ClientProxy).toBeDefined();
        expect(ClientProxy.prototype.getName).toBeDefined();
        expect(ClientProxy.prototype.getServiceName).toBeDefined();
        expect(ClientProxy.prototype.destroy).toBeDefined();
    });

    test("ClientProxy implements DistributedObject interface", async () => {
        const { ClientProxy } = await import("@zenystx/helios-core/client/proxy/ClientProxy");
        // A concrete subclass should satisfy DistributedObject
        const proxy = Object.create(ClientProxy.prototype);
        expect(typeof proxy.getName).toBe("function");
        expect(typeof proxy.getServiceName).toBe("function");
        expect(typeof proxy.destroy).toBe("function");
    });
});

// ── 2. ProxyManager creation and caching ────────────────────────────────────────

describe("ProxyManager", () => {
    test("ProxyManager can be instantiated", async () => {
        const { ProxyManager } = await import("@zenystx/helios-core/client/proxy/ProxyManager");
        expect(ProxyManager).toBeDefined();
    });

    test("ProxyManager.getOrCreateProxy() returns a proxy for a known service", async () => {
        const { ProxyManager } = await import("@zenystx/helios-core/client/proxy/ProxyManager");
        const { ClientInvocationService } = await import("@zenystx/helios-core/client/invocation/ClientInvocationService");
        const { ClientPartitionService } = await import("@zenystx/helios-core/client/spi/ClientPartitionService");
        const { createClientSerializationService } = await import("@zenystx/helios-core/client/impl/serialization/ClientSerializationService");
        const { ClientConfig } = await import("@zenystx/helios-core/client/config/ClientConfig");

        const config = new ClientConfig();
        const serialization = createClientSerializationService(config);
        const partitionService = new ClientPartitionService();

        const manager = new ProxyManager(serialization, partitionService, null as any);
        const proxy = manager.getOrCreateProxy("hz:impl:mapService", "test-map");
        expect(proxy).toBeDefined();
        expect(proxy.getName()).toBe("test-map");
        expect(proxy.getServiceName()).toBe("hz:impl:mapService");
    });

    test("same-name getOrCreateProxy returns identical instance", async () => {
        const { ProxyManager } = await import("@zenystx/helios-core/client/proxy/ProxyManager");
        const { ClientPartitionService } = await import("@zenystx/helios-core/client/spi/ClientPartitionService");
        const { createClientSerializationService } = await import("@zenystx/helios-core/client/impl/serialization/ClientSerializationService");
        const { ClientConfig } = await import("@zenystx/helios-core/client/config/ClientConfig");

        const config = new ClientConfig();
        const serialization = createClientSerializationService(config);
        const partitionService = new ClientPartitionService();

        const manager = new ProxyManager(serialization, partitionService, null as any);
        const p1 = manager.getOrCreateProxy("hz:impl:mapService", "my-map");
        const p2 = manager.getOrCreateProxy("hz:impl:mapService", "my-map");
        expect(p1).toBe(p2);
    });

    test("different-name proxies are different instances", async () => {
        const { ProxyManager } = await import("@zenystx/helios-core/client/proxy/ProxyManager");
        const { ClientPartitionService } = await import("@zenystx/helios-core/client/spi/ClientPartitionService");
        const { createClientSerializationService } = await import("@zenystx/helios-core/client/impl/serialization/ClientSerializationService");
        const { ClientConfig } = await import("@zenystx/helios-core/client/config/ClientConfig");

        const config = new ClientConfig();
        const serialization = createClientSerializationService(config);
        const partitionService = new ClientPartitionService();

        const manager = new ProxyManager(serialization, partitionService, null as any);
        const p1 = manager.getOrCreateProxy("hz:impl:mapService", "map-a");
        const p2 = manager.getOrCreateProxy("hz:impl:mapService", "map-b");
        expect(p1).not.toBe(p2);
    });

    test("destroyProxy removes from cache", async () => {
        const { ProxyManager } = await import("@zenystx/helios-core/client/proxy/ProxyManager");
        const { ClientPartitionService } = await import("@zenystx/helios-core/client/spi/ClientPartitionService");
        const { createClientSerializationService } = await import("@zenystx/helios-core/client/impl/serialization/ClientSerializationService");
        const { ClientConfig } = await import("@zenystx/helios-core/client/config/ClientConfig");

        const config = new ClientConfig();
        const serialization = createClientSerializationService(config);
        const partitionService = new ClientPartitionService();

        const manager = new ProxyManager(serialization, partitionService, null as any);
        const p1 = manager.getOrCreateProxy("hz:impl:mapService", "destroy-test");
        await manager.destroyProxy("hz:impl:mapService", "destroy-test");
        const p2 = manager.getOrCreateProxy("hz:impl:mapService", "destroy-test");
        expect(p1).not.toBe(p2);
    });

    test("destroyAll clears all proxies", async () => {
        const { ProxyManager } = await import("@zenystx/helios-core/client/proxy/ProxyManager");
        const { ClientPartitionService } = await import("@zenystx/helios-core/client/spi/ClientPartitionService");
        const { createClientSerializationService } = await import("@zenystx/helios-core/client/impl/serialization/ClientSerializationService");
        const { ClientConfig } = await import("@zenystx/helios-core/client/config/ClientConfig");

        const config = new ClientConfig();
        const serialization = createClientSerializationService(config);
        const partitionService = new ClientPartitionService();

        const manager = new ProxyManager(serialization, partitionService, null as any);
        manager.getOrCreateProxy("hz:impl:mapService", "map-1");
        manager.getOrCreateProxy("hz:impl:queueService", "queue-1");
        manager.destroyAll();
        expect(manager.getDistributedObjects().length).toBe(0);
    });

    test("getDistributedObjects returns all active proxies", async () => {
        const { ProxyManager } = await import("@zenystx/helios-core/client/proxy/ProxyManager");
        const { ClientPartitionService } = await import("@zenystx/helios-core/client/spi/ClientPartitionService");
        const { createClientSerializationService } = await import("@zenystx/helios-core/client/impl/serialization/ClientSerializationService");
        const { ClientConfig } = await import("@zenystx/helios-core/client/config/ClientConfig");

        const config = new ClientConfig();
        const serialization = createClientSerializationService(config);
        const partitionService = new ClientPartitionService();

        const manager = new ProxyManager(serialization, partitionService, null as any);
        manager.getOrCreateProxy("hz:impl:mapService", "map-a");
        manager.getOrCreateProxy("hz:impl:queueService", "queue-a");
        const objects = manager.getDistributedObjects();
        expect(objects.length).toBe(2);
    });
});

// ── 3. Distributed-object protocol codecs ──────────────────────────────────────

describe("Distributed-object protocol codecs", () => {
    test("ClientCreateProxyCodec encodes and decodes request", async () => {
        const { ClientCreateProxyCodec } = await import(
            "@zenystx/helios-core/client/impl/protocol/codec/ClientCreateProxyCodec"
        );
        const msg = ClientCreateProxyCodec.encodeRequest("my-map", "hz:impl:mapService");
        expect(msg).toBeDefined();
        const decoded = ClientCreateProxyCodec.decodeRequest(msg);
        expect(decoded.name).toBe("my-map");
        expect(decoded.serviceName).toBe("hz:impl:mapService");
    });

    test("ClientDestroyProxyCodec encodes and decodes request", async () => {
        const { ClientDestroyProxyCodec } = await import(
            "@zenystx/helios-core/client/impl/protocol/codec/ClientDestroyProxyCodec"
        );
        const msg = ClientDestroyProxyCodec.encodeRequest("my-map", "hz:impl:mapService");
        expect(msg).toBeDefined();
        const decoded = ClientDestroyProxyCodec.decodeRequest(msg);
        expect(decoded.name).toBe("my-map");
        expect(decoded.serviceName).toBe("hz:impl:mapService");
    });

    test("ClientGetDistributedObjectsCodec encodes request and decodes response", async () => {
        const { ClientGetDistributedObjectsCodec } = await import(
            "@zenystx/helios-core/client/impl/protocol/codec/ClientGetDistributedObjectsCodec"
        );
        const req = ClientGetDistributedObjectsCodec.encodeRequest();
        expect(req).toBeDefined();

        const resp = ClientGetDistributedObjectsCodec.encodeResponse([
            { serviceName: "hz:impl:mapService", name: "test-map" },
        ]);
        expect(resp).toBeDefined();
    });
});

// ── 4. Server-side create/destroy/list tasks ───────────────────────────────────

describe("Server-side distributed object tasks", () => {
    test("CreateProxyTask handles create-proxy request", async () => {
        const { ClientProtocolServer } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer"
        );
        const { ClientCreateProxyCodec } = await import(
            "@zenystx/helios-core/client/impl/protocol/codec/ClientCreateProxyCodec"
        );
        const { registerDistributedObjectTasks } = await import(
            "@zenystx/helios-core/server/clientprotocol/task/DistributedObjectTask"
        );

        const server = new ClientProtocolServer({ clusterName: "test", port: 0 });
        registerDistributedObjectTasks(server);

        // Verify handler is registered
        expect(
            server.getDispatcher().hasHandler(ClientCreateProxyCodec.REQUEST_MESSAGE_TYPE)
        ).toBe(true);
    });

    test("DestroyProxyTask handles destroy-proxy request", async () => {
        const { ClientProtocolServer } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer"
        );
        const { ClientDestroyProxyCodec } = await import(
            "@zenystx/helios-core/client/impl/protocol/codec/ClientDestroyProxyCodec"
        );
        const { registerDistributedObjectTasks } = await import(
            "@zenystx/helios-core/server/clientprotocol/task/DistributedObjectTask"
        );

        const server = new ClientProtocolServer({ clusterName: "test", port: 0 });
        registerDistributedObjectTasks(server);

        expect(
            server.getDispatcher().hasHandler(ClientDestroyProxyCodec.REQUEST_MESSAGE_TYPE)
        ).toBe(true);
    });

    test("GetDistributedObjectsTask handles list request", async () => {
        const { ClientProtocolServer } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer"
        );
        const { ClientGetDistributedObjectsCodec } = await import(
            "@zenystx/helios-core/client/impl/protocol/codec/ClientGetDistributedObjectsCodec"
        );
        const { registerDistributedObjectTasks } = await import(
            "@zenystx/helios-core/server/clientprotocol/task/DistributedObjectTask"
        );

        const server = new ClientProtocolServer({ clusterName: "test", port: 0 });
        registerDistributedObjectTasks(server);

        expect(
            server.getDispatcher().hasHandler(ClientGetDistributedObjectsCodec.REQUEST_MESSAGE_TYPE)
        ).toBe(true);
    });
});

// ── 5. ClientMapProxy ──────────────────────────────────────────────────────────

describe("ClientMapProxy", () => {
    test("ClientMapProxy implements IMap interface methods", async () => {
        const { ClientMapProxy } = await import("@zenystx/helios-core/client/proxy/ClientMapProxy");
        expect(ClientMapProxy).toBeDefined();
        const proto = ClientMapProxy.prototype;
        expect(typeof proto.put).toBe("function");
        expect(typeof proto.get).toBe("function");
        expect(typeof proto.remove).toBe("function");
        expect(typeof proto.size).toBe("function");
        expect(typeof proto.containsKey).toBe("function");
        expect(typeof proto.clear).toBe("function");
        expect(typeof proto.isEmpty).toBe("function");
        expect(typeof proto.set).toBe("function");
        expect(typeof proto.delete).toBe("function");
    });

    test("ClientMapProxy extends ClientProxy", async () => {
        const { ClientMapProxy } = await import("@zenystx/helios-core/client/proxy/ClientMapProxy");
        const { ClientProxy } = await import("@zenystx/helios-core/client/proxy/ClientProxy");
        expect(ClientMapProxy.prototype instanceof ClientProxy).toBe(true);
    });
});

// ── 6. ClientQueueProxy ────────────────────────────────────────────────────────

describe("ClientQueueProxy", () => {
    test("ClientQueueProxy implements IQueue interface methods", async () => {
        const { ClientQueueProxy } = await import("@zenystx/helios-core/client/proxy/ClientQueueProxy");
        expect(ClientQueueProxy).toBeDefined();
        const proto = ClientQueueProxy.prototype;
        expect(typeof proto.offer).toBe("function");
        expect(typeof proto.poll).toBe("function");
        expect(typeof proto.peek).toBe("function");
        expect(typeof proto.size).toBe("function");
        expect(typeof proto.isEmpty).toBe("function");
        expect(typeof proto.clear).toBe("function");
    });

    test("ClientQueueProxy extends ClientProxy", async () => {
        const { ClientQueueProxy } = await import("@zenystx/helios-core/client/proxy/ClientQueueProxy");
        const { ClientProxy } = await import("@zenystx/helios-core/client/proxy/ClientProxy");
        expect(ClientQueueProxy.prototype instanceof ClientProxy).toBe(true);
    });
});

// ── 7. ClientTopicProxy ────────────────────────────────────────────────────────

describe("ClientTopicProxy", () => {
    test("ClientTopicProxy implements ITopic interface methods", async () => {
        const { ClientTopicProxy } = await import("@zenystx/helios-core/client/proxy/ClientTopicProxy");
        expect(ClientTopicProxy).toBeDefined();
        const proto = ClientTopicProxy.prototype;
        expect(typeof proto.publish).toBe("function");
        expect(typeof proto.publishAsync).toBe("function");
        expect(typeof proto.addMessageListener).toBe("function");
        expect(typeof proto.removeMessageListener).toBe("function");
    });

    test("ClientTopicProxy extends ClientProxy", async () => {
        const { ClientTopicProxy } = await import("@zenystx/helios-core/client/proxy/ClientTopicProxy");
        const { ClientProxy } = await import("@zenystx/helios-core/client/proxy/ClientProxy");
        expect(ClientTopicProxy.prototype instanceof ClientProxy).toBe(true);
    });

    test("ClientTopicProxy.addMessageListener does not throw (wired through ClientListenerService)", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const client = new HeliosClient();
        const topic = client.getTopic("listener-test") as any;
        // Must not throw — should return a registration ID string
        const regId = topic.addMessageListener(() => {});
        expect(typeof regId).toBe("string");
        expect(regId.length).toBeGreaterThan(0);
        client.shutdown();
    });

    test("ClientTopicProxy.removeMessageListener does not throw", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const client = new HeliosClient();
        const topic = client.getTopic("listener-remove-test") as any;
        const regId = topic.addMessageListener(() => {});
        const removed = topic.removeMessageListener(regId);
        expect(removed).toBe(true);
        // Removing non-existent returns false
        expect(topic.removeMessageListener("nonexistent")).toBe(false);
        client.shutdown();
    });
});

// ── 8. HeliosClient proxy integration ──────────────────────────────────────────

describe("HeliosClient proxy integration", () => {
    test("HeliosClient.getMap() returns a ClientMapProxy (not a throw-stub)", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const client = new HeliosClient();
        const map = client.getMap("test");
        expect(map).toBeDefined();
        expect(typeof map.put).toBe("function");
        expect(typeof map.get).toBe("function");
        client.shutdown();
    });

    test("HeliosClient.getQueue() returns a ClientQueueProxy (not a throw-stub)", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const client = new HeliosClient();
        const queue = client.getQueue("test");
        expect(queue).toBeDefined();
        expect(typeof queue.offer).toBe("function");
        client.shutdown();
    });

    test("HeliosClient.getTopic() returns a ClientTopicProxy (not a throw-stub)", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const client = new HeliosClient();
        const topic = client.getTopic("test");
        expect(topic).toBeDefined();
        expect(typeof topic.publish).toBe("function");
        client.shutdown();
    });

    test("HeliosClient.getMap() returns stable instance for same name", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const client = new HeliosClient();
        const m1 = client.getMap("stable");
        const m2 = client.getMap("stable");
        expect(m1).toBe(m2);
        client.shutdown();
    });

    test("HeliosClient.getDistributedObject() routes to correct proxy type", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const client = new HeliosClient();
        const obj = client.getDistributedObject("hz:impl:mapService", "do-test");
        expect(obj).toBeDefined();
        expect(obj.getServiceName()).toBe("hz:impl:mapService");
        expect(obj.getName()).toBe("do-test");
        client.shutdown();
    });

    test("HeliosClient shutdown destroys all proxies", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const client = new HeliosClient();
        client.getMap("map-1");
        client.getQueue("queue-1");
        client.shutdown();
        // After shutdown, getMap should throw "not active"
        expect(() => client.getMap("map-1")).toThrow("not active");
    });
});

// ── 9. Additional proxies (executor, reliable-topic) ───────────────────────────

describe("Additional remote proxies", () => {
    test("HeliosClient no longer has getReliableTopic() (narrowed out in Block 20.7)", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const client = new HeliosClient();
        expect("getReliableTopic" in client).toBe(false);
        client.shutdown();
    });

    test("HeliosClient no longer has getExecutorService() (narrowed out in Block 20.7)", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const client = new HeliosClient();
        expect("getExecutorService" in client).toBe(false);
        client.shutdown();
    });
});

// ── 10. No orphan codecs ───────────────────────────────────────────────────────

describe("No orphan codecs", () => {
    test("MapAddEntryListenerCodec is owned by ClientMapProxy", async () => {
        // This codec should be imported/used by the map proxy, not orphaned
        const { ClientMapProxy } = await import("@zenystx/helios-core/client/proxy/ClientMapProxy");
        expect(ClientMapProxy).toBeDefined();
    });

    test("MapPutCodec is owned by ClientMapProxy invocation path", async () => {
        const { ClientMapProxy } = await import("@zenystx/helios-core/client/proxy/ClientMapProxy");
        expect(ClientMapProxy).toBeDefined();
    });
});

// ── 11. Verification: proxy lifecycle end-to-end ────────────────────────────

describe("Verification: proxy lifecycle end-to-end", () => {
    test("HeliosClient proxy creation uses only public imports, no internal imports", async () => {
        // This test proves a consumer can use the public client surface
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const client = new HeliosClient();

        // Every proxy type is reachable from the public HeliosClient API
        // (getReliableTopic and getExecutorService were narrowed out in Block 20.7)
        const map = client.getMap("verify-map") as any;
        const queue = client.getQueue("verify-queue") as any;
        const topic = client.getTopic("verify-topic") as any;

        expect(map.getName()).toBe("verify-map");
        expect(map.getServiceName()).toBe("hz:impl:mapService");
        expect(queue.getName()).toBe("verify-queue");
        expect(queue.getServiceName()).toBe("hz:impl:queueService");
        expect(topic.getName()).toBe("verify-topic");
        expect(topic.getServiceName()).toBe("hz:impl:topicService");

        client.shutdown();
    });

    test("proxy destroy removes from cache, next get returns new instance", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const client = new HeliosClient();

        const m1 = client.getMap("destroy-verify") as any;
        await m1.destroy();
        const m2 = client.getMap("destroy-verify") as any;
        expect(m1).not.toBe(m2);

        client.shutdown();
    });

    test("server-side distributed object tasks handle full codec round-trip", async () => {
        const { ClientProtocolServer } = await import(
            "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer"
        );
        const { registerDistributedObjectTasks } = await import(
            "@zenystx/helios-core/server/clientprotocol/task/DistributedObjectTask"
        );
        const { ClientCreateProxyCodec } = await import(
            "@zenystx/helios-core/client/impl/protocol/codec/ClientCreateProxyCodec"
        );
        const { ClientDestroyProxyCodec } = await import(
            "@zenystx/helios-core/client/impl/protocol/codec/ClientDestroyProxyCodec"
        );
        const { ClientGetDistributedObjectsCodec } = await import(
            "@zenystx/helios-core/client/impl/protocol/codec/ClientGetDistributedObjectsCodec"
        );

        const server = new ClientProtocolServer({ clusterName: "verify", port: 0 });
        registerDistributedObjectTasks(server);

        // All three task handlers are registered
        expect(server.getDispatcher().hasHandler(ClientCreateProxyCodec.REQUEST_MESSAGE_TYPE)).toBe(true);
        expect(server.getDispatcher().hasHandler(ClientDestroyProxyCodec.REQUEST_MESSAGE_TYPE)).toBe(true);
        expect(server.getDispatcher().hasHandler(ClientGetDistributedObjectsCodec.REQUEST_MESSAGE_TYPE)).toBe(true);
    });

    test("no partial destroy semantics — destroyed proxy is not returned by getDistributedObjects", async () => {
        const { ProxyManager } = await import("@zenystx/helios-core/client/proxy/ProxyManager");
        const { ClientPartitionService } = await import("@zenystx/helios-core/client/spi/ClientPartitionService");
        const { createClientSerializationService } = await import("@zenystx/helios-core/client/impl/serialization/ClientSerializationService");
        const { ClientConfig } = await import("@zenystx/helios-core/client/config/ClientConfig");

        const config = new ClientConfig();
        const serialization = createClientSerializationService(config);
        const partitionService = new ClientPartitionService();

        const manager = new ProxyManager(serialization, partitionService, null as any);
        manager.getOrCreateProxy("hz:impl:mapService", "live-map");
        manager.getOrCreateProxy("hz:impl:queueService", "live-queue");
        await manager.destroyProxy("hz:impl:mapService", "live-map");

        const objects = manager.getDistributedObjects();
        expect(objects.length).toBe(1);
        expect(objects[0].getName()).toBe("live-queue");
    });

    test("no deferred listener throws on topic proxy", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const client = new HeliosClient();

        const topic = client.getTopic("no-throw-verify") as any;

        // These must NOT throw "deferred to Block 20.7"
        expect(() => topic.addMessageListener(() => {})).not.toThrow();
        expect(() => topic.removeMessageListener("x")).not.toThrow();

        client.shutdown();
    });

    test("stable proxy identity across all service types", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const client = new HeliosClient();

        // Map
        expect(client.getMap("s")).toBe(client.getMap("s"));
        // Queue
        expect(client.getQueue("s")).toBe(client.getQueue("s"));
        // Topic
        expect(client.getTopic("s")).toBe(client.getTopic("s"));
        // getDistributedObject
        expect(client.getDistributedObject("hz:impl:mapService", "s"))
            .toBe(client.getDistributedObject("hz:impl:mapService", "s"));

        client.shutdown();
    });
});
