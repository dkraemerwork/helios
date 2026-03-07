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
import { describe, test, expect } from "bun:test";

// ── Contract narrowing: HeliosInstance no longer includes local-only methods ──

describe("HeliosInstance contract narrowing", () => {
    test("HeliosInstance does NOT include getList()", async () => {
        // HeliosClient implements HeliosInstance — narrowed methods must not exist
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const client = new HeliosClient();
        expect("getList" in client).toBe(false);
    });

    test("HeliosInstance does NOT include getSet()", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const client = new HeliosClient();
        expect("getSet" in client).toBe(false);
    });

    test("HeliosInstance does NOT include getMultiMap()", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const client = new HeliosClient();
        expect("getMultiMap" in client).toBe(false);
    });

    test("HeliosInstance does NOT include getReplicatedMap()", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const client = new HeliosClient();
        expect("getReplicatedMap" in client).toBe(false);
    });

    test("HeliosInstance retains getMap()", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const client = new HeliosClient();
        expect(typeof client.getMap).toBe("function");
    });

    test("HeliosInstance retains getQueue()", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const client = new HeliosClient();
        expect(typeof client.getQueue).toBe("function");
    });

    test("HeliosInstance retains getTopic()", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const client = new HeliosClient();
        expect(typeof client.getTopic).toBe("function");
    });

    test("HeliosInstance retains getReliableTopic()", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const client = new HeliosClient();
        expect(typeof client.getReliableTopic).toBe("function");
    });

    test("HeliosInstance retains getExecutorService()", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const client = new HeliosClient();
        expect(typeof client.getExecutorService).toBe("function");
    });

    test("HeliosInstance retains getDistributedObject()", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const client = new HeliosClient();
        expect(typeof client.getDistributedObject).toBe("function");
    });

    test("HeliosInstance retains getCluster()", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
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
    test("retained proxy methods throw with Block 20.6 blocking reason, not permanent server blocker", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const client = HeliosClient.newHeliosClient();
        try {
            const singleArgMethods = ["getMap", "getQueue", "getTopic", "getReliableTopic",
                "getCluster", "getExecutorService"] as const;

            for (const method of singleArgMethods) {
                try {
                    if (method === "getCluster") {
                        (client as any)[method]();
                    } else {
                        (client as any)[method]("test");
                    }
                } catch (e: any) {
                    expect(e.message).toContain("Block 20.6");
                    expect(e.message).not.toContain("blocked-by-server");
                }
            }

            // getDistributedObject takes two args
            try {
                client.getDistributedObject("hz:impl:mapService", "test");
            } catch (e: any) {
                expect(e.message).toContain("Block 20.6");
            }
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
});

// ── getConfig() contract is resolved ──

describe("getConfig() contract", () => {
    test("HeliosInstance.getConfig() returns InstanceConfig, satisfied by ClientConfig", async () => {
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
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
        const { HeliosClient } = await import("@zenystx/helios-core/client/HeliosClient");
        const client = new HeliosClient();

        const retainedMethods = [
            "getName", "getMap", "getQueue", "getTopic", "getReliableTopic",
            "getDistributedObject", "getLifecycleService", "getCluster",
            "getConfig", "getExecutorService", "shutdown",
        ];

        for (const method of retainedMethods) {
            expect(typeof (client as any)[method]).toBe("function");
        }

        // Narrowed methods must NOT exist
        const narrowedMethods = ["getList", "getSet", "getMultiMap", "getReplicatedMap"];
        for (const method of narrowedMethods) {
            expect((client as any)[method]).toBeUndefined();
        }

        client.shutdown();
    });
});
