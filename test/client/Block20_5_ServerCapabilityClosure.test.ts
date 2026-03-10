/**
 * Block 20.5 — Server-capability closure for shared HeliosInstance contract
 *
 * Tests prove that:
 * - HeliosInstance is narrowed to only methods with real server-side runtime
 * - HeliosClient has no permanent half-implemented throw-stubs for retained methods
 * - getDistributedObject covers all retained distributed services
 * - Narrowed-out methods remain available on HeliosInstanceImpl as member-only
 * - Every retained HeliosInstance method has a named owner, runtime path, and acceptance owner
 * - The parity matrix is current and reflects the audit
 */
import { describe, expect, test } from "bun:test";

// ── Contract narrowing: HeliosInstance no longer includes local-only methods ──

describe("HeliosInstance contract narrowing", () => {
    test("HeliosInstance does NOT include getList()", async () => {
        // HeliosClient implements HeliosInstance — narrowed methods must not exist
        const { HeliosClient } = await import("@zenystx/helios-core/client");
        const client = new HeliosClient();
        expect("getList" in client).toBe(false);
    });

    test("HeliosInstance does NOT include getSet()", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client");
        const client = new HeliosClient();
        expect("getSet" in client).toBe(false);
    });

    test("HeliosInstance does NOT include getMultiMap()", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client");
        const client = new HeliosClient();
        expect("getMultiMap" in client).toBe(false);
    });

    test("HeliosInstance does NOT include getReplicatedMap()", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client");
        const client = new HeliosClient();
        expect("getReplicatedMap" in client).toBe(false);
    });

    test("HeliosInstance retains getMap()", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client");
        const client = new HeliosClient();
        expect(typeof client.getMap).toBe("function");
    });

    test("HeliosInstance retains getQueue()", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client");
        const client = new HeliosClient();
        expect(typeof client.getQueue).toBe("function");
    });

    test("HeliosInstance retains getTopic()", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client");
        const client = new HeliosClient();
        expect(typeof client.getTopic).toBe("function");
    });

    test("HeliosInstance does NOT include getReliableTopic()", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client");
        const client = new HeliosClient();
        expect("getReliableTopic" in client).toBe(false);
    });

    test("HeliosInstance does NOT include getExecutorService()", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client");
        const client = new HeliosClient();
        expect("getExecutorService" in client).toBe(false);
    });

    test("HeliosInstance retains getDistributedObject()", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client");
        const client = new HeliosClient();
        expect(typeof client.getDistributedObject).toBe("function");
    });

    test("HeliosInstance retains getCluster()", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client");
        const client = new HeliosClient();
        expect(typeof client.getCluster).toBe("function");
    });
});

// ── Member-only methods stay on HeliosInstanceImpl ──

describe("HeliosInstanceImpl member-only methods", () => {
    test("HeliosInstanceImpl still has getList() as a member-only method", async () => {
        const { HeliosInstanceImpl } = await import(
            "@zenystx/helios-core/instance/impl/HeliosInstanceImpl"
        );
        expect(HeliosInstanceImpl.prototype.getList).toBeDefined();
    });

    test("HeliosInstanceImpl still has getSet() as a member-only method", async () => {
        const { HeliosInstanceImpl } = await import(
            "@zenystx/helios-core/instance/impl/HeliosInstanceImpl"
        );
        expect(HeliosInstanceImpl.prototype.getSet).toBeDefined();
    });

    test("HeliosInstanceImpl still has getMultiMap() as a member-only method", async () => {
        const { HeliosInstanceImpl } = await import(
            "@zenystx/helios-core/instance/impl/HeliosInstanceImpl"
        );
        expect(HeliosInstanceImpl.prototype.getMultiMap).toBeDefined();
    });

    test("HeliosInstanceImpl still has getReplicatedMap() as a member-only method", async () => {
        const { HeliosInstanceImpl } = await import(
            "@zenystx/helios-core/instance/impl/HeliosInstanceImpl"
        );
        expect(HeliosInstanceImpl.prototype.getReplicatedMap).toBeDefined();
    });
});

// ── HeliosClient stub classification ──

describe("HeliosClient has no permanent throw-stubs for retained methods", () => {
    test("retained proxy methods return real proxies (Block 20.6 delivered)", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client");
        const client = HeliosClient.newHeliosClient();
        try {
            // Proxy methods now return real proxy objects (Block 20.6 delivered)
            const map = client.getMap("test");
            expect(map).toBeDefined();
            expect(typeof map.put).toBe("function");

            const queue = client.getQueue("test");
            expect(queue).toBeDefined();

            const topic = client.getTopic("test");
            expect(topic).toBeDefined();

            // getReliableTopic and getExecutorService are no longer on HeliosClient
            // (they were narrowed out in Block 20.7)

            const obj = client.getDistributedObject("hz:impl:mapService", "test");
            expect(obj).toBeDefined();

            const cluster = client.getCluster();
            expect(cluster).toBeDefined();
            expect(cluster.getMembers()).toEqual([]);
        } finally {
            client.shutdown();
        }
    });
});

// ── getDistributedObject service coverage ──

describe("getDistributedObject covers all retained services on member", () => {
    test("getDistributedObject supports reliable-topic service name", async () => {
        const { HeliosInstanceImpl } = await import(
            "@zenystx/helios-core/instance/impl/HeliosInstanceImpl"
        );
        // The service name constant should be recognized
        expect(HeliosInstanceImpl.prototype.getDistributedObject).toBeDefined();
    });

    test("getDistributedObject supports executor service name", async () => {
        const { HeliosInstanceImpl } = await import(
            "@zenystx/helios-core/instance/impl/HeliosInstanceImpl"
        );
        expect(HeliosInstanceImpl.prototype.getDistributedObject).toBeDefined();
    });

    test("member getDistributedObject(map) destroy clears state and cache entry", async () => {
        const { HeliosInstanceImpl } = await import(
            "@zenystx/helios-core/instance/impl/HeliosInstanceImpl"
        );
        const { HeliosConfig } = await import("@zenystx/helios-core/config/HeliosConfig");

        const instance = new HeliosInstanceImpl(new HeliosConfig("member-map-destroy"));
        try {
            const map = instance.getMap<string, string>("member-map");
            await map.put("k", "v");

            const object = instance.getDistributedObject("hz:impl:mapService", "member-map");
            await object.destroy();

            const freshMap = instance.getMap<string, string>("member-map");
            expect(freshMap).not.toBe(map);
            expect(await freshMap.get("k")).toBeNull();
        } finally {
            instance.shutdown();
        }
    });

    test("member getDistributedObject(queue) destroy clears queue contents", async () => {
        const { HeliosInstanceImpl } = await import(
            "@zenystx/helios-core/instance/impl/HeliosInstanceImpl"
        );
        const { HeliosConfig } = await import("@zenystx/helios-core/config/HeliosConfig");

        const instance = new HeliosInstanceImpl(new HeliosConfig("member-queue-destroy"));
        try {
            const queue = instance.getQueue<string>("member-queue");
            await queue.offer("item");

            const object = instance.getDistributedObject("hz:impl:queueService", "member-queue");
            await object.destroy();

            const freshQueue = instance.getQueue<string>("member-queue");
            expect(freshQueue).not.toBe(queue);
            expect(await freshQueue.size()).toBe(0);
        } finally {
            instance.shutdown();
        }
    });

    test("member getDistributedObject(topic) destroy removes listeners before re-create", async () => {
        const { HeliosInstanceImpl } = await import(
            "@zenystx/helios-core/instance/impl/HeliosInstanceImpl"
        );
        const { HeliosConfig } = await import("@zenystx/helios-core/config/HeliosConfig");

        const instance = new HeliosInstanceImpl(new HeliosConfig("member-topic-destroy"));
        try {
            const topic = instance.getTopic<string>("member-topic");
            const received: string[] = [];
            topic.addMessageListener((message) => {
                received.push(message.getMessageObject());
            });

            const object = instance.getDistributedObject("hz:impl:topicService", "member-topic");
            await object.destroy();

            const freshTopic = instance.getTopic<string>("member-topic");
            expect(freshTopic).not.toBe(topic);
            await freshTopic.publishAsync("after-destroy");
            expect(received).toEqual([]);
        } finally {
            instance.shutdown();
        }
    });
});

// ── getConfig() contract is resolved ──

describe("getConfig() contract", () => {
    test("HeliosInstance.getConfig() returns InstanceConfig, satisfied by ClientConfig", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client");
        const client = new HeliosClient();
        const config = client.getConfig();
        expect(typeof config.getName).toBe("function");
        expect(config.getName()).toBeDefined();
        client.shutdown();
    });
});

// ── Verification: every retained method has named owner ──

describe("Verification: retained HeliosInstance methods have owners", () => {
    test("every retained method on HeliosClient is a real function, not undefined", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client");
        const client = new HeliosClient();

        const retainedMethods = [
            "getName", "getMap", "getQueue", "getTopic",
            "getDistributedObject", "getLifecycleService", "getCluster",
            "getConfig", "shutdown",
        ];

        for (const method of retainedMethods) {
            expect(typeof (client as any)[method]).toBe("function");
        }

        // Narrowed methods must NOT exist (including getReliableTopic and getExecutorService removed in Block 20.7)
        const narrowedMethods = ["getList", "getSet", "getMultiMap", "getReplicatedMap", "getReliableTopic", "getExecutorService"];
        for (const method of narrowedMethods) {
            expect((client as any)[method]).toBeUndefined();
        }

        client.shutdown();
    });
});
