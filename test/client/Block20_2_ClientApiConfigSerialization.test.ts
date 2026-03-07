/**
 * Block 20.2 — Public client API + config model + serialization foundation
 *
 * Tests:
 * 1. HeliosClient implements HeliosInstance with real lifecycle shell
 * 2. Named-client registry and shutdown-all
 * 3. ClientConfig is a real root config (not near-cache-only)
 * 4. Typed client config surfaces
 * 5. Production client-config loading and validation
 * 6. Client serialization owner
 * 7. Fail-fast on unsupported config sections
 * 8. Verification: separate import surface
 */
import { afterEach, describe, expect, test } from "bun:test";

// ── 1. HeliosClient runtime shell ────────────────────────────────────────────

describe("HeliosClient runtime shell", () => {
  test("implements HeliosInstance", async () => {
    const { HeliosClient } = await import("@zenystx/helios-core/client");
    const { ClientConfig } = await import("@zenystx/helios-core/client/config");

    const config = new ClientConfig();
    config.setClusterName("test-cluster");
    const client = new HeliosClient(config);

    expect(client.getName()).toBe("helios-client");
    expect(client.getConfig()).toBeInstanceOf(ClientConfig);
    expect(client.getConfig().getClusterName()).toBe("test-cluster");

    // HeliosInstance contract — lifecycle service must be real, not throwing
    const lifecycle = client.getLifecycleService();
    expect(lifecycle).toBeDefined();
    expect(lifecycle.isRunning()).toBe(true);

    client.shutdown();
    expect(lifecycle.isRunning()).toBe(false);
  });

  test("default config when no config provided", async () => {
    const { HeliosClient } = await import("@zenystx/helios-core/client");
    const client = new HeliosClient();
    expect(client.getName()).toBe("helios-client");
    expect(client.getConfig().getClusterName()).toBe("dev");
    client.shutdown();
  });

  test("custom instance name from config", async () => {
    const { HeliosClient } = await import("@zenystx/helios-core/client");
    const { ClientConfig } = await import("@zenystx/helios-core/client/config");
    const config = new ClientConfig();
    config.setName("my-client");
    const client = new HeliosClient(config);
    expect(client.getName()).toBe("my-client");
    client.shutdown();
  });

  test("shutdown is idempotent", async () => {
    const { HeliosClient } = await import("@zenystx/helios-core/client");
    const client = new HeliosClient();
    client.shutdown();
    client.shutdown(); // must not throw
    expect(client.getLifecycleService().isRunning()).toBe(false);
  });

  test("distributed object methods throw after shutdown", async () => {
    const { HeliosClient } = await import("@zenystx/helios-core/client");
    const client = new HeliosClient();
    client.shutdown();
    expect(() => client.getMap("m")).toThrow(/not active/i);
    expect(() => client.getQueue("q")).toThrow(/not active/i);
  });
});

// ── 2. Named-client registry and shutdown-all ────────────────────────────────

describe("Named-client registry", () => {
  afterEach(async () => {
    const { HeliosClient } = await import("@zenystx/helios-core/client");
    HeliosClient.shutdownAll();
  });

  test("newHeliosClient registers client by name", async () => {
    const { HeliosClient } = await import("@zenystx/helios-core/client");
    const { ClientConfig } = await import("@zenystx/helios-core/client/config");

    const config = new ClientConfig();
    config.setName("reg-test");
    const client = HeliosClient.newHeliosClient(config);

    expect(HeliosClient.getHeliosClientByName("reg-test")).toBe(client);
  });

  test("duplicate name throws", async () => {
    const { HeliosClient } = await import("@zenystx/helios-core/client");
    const { ClientConfig } = await import("@zenystx/helios-core/client/config");

    const config = new ClientConfig();
    config.setName("dup-test");
    HeliosClient.newHeliosClient(config);

    const config2 = new ClientConfig();
    config2.setName("dup-test");
    expect(() => HeliosClient.newHeliosClient(config2)).toThrow(/already exists/i);
  });

  test("shutdownAll shuts down all clients", async () => {
    const { HeliosClient } = await import("@zenystx/helios-core/client");
    const { ClientConfig } = await import("@zenystx/helios-core/client/config");

    const c1 = new ClientConfig();
    c1.setName("sa-1");
    const c2 = new ClientConfig();
    c2.setName("sa-2");
    const client1 = HeliosClient.newHeliosClient(c1);
    const client2 = HeliosClient.newHeliosClient(c2);

    HeliosClient.shutdownAll();

    expect(client1.getLifecycleService().isRunning()).toBe(false);
    expect(client2.getLifecycleService().isRunning()).toBe(false);
    expect(HeliosClient.getHeliosClientByName("sa-1")).toBeNull();
  });

  test("shutdown removes client from registry", async () => {
    const { HeliosClient } = await import("@zenystx/helios-core/client");
    const { ClientConfig } = await import("@zenystx/helios-core/client/config");

    const config = new ClientConfig();
    config.setName("remove-test");
    const client = HeliosClient.newHeliosClient(config);
    client.shutdown();

    expect(HeliosClient.getHeliosClientByName("remove-test")).toBeNull();
  });
});

// ── 3. ClientConfig is real root config ──────────────────────────────────────

describe("ClientConfig root config", () => {
  test("has clusterName with default 'dev'", async () => {
    const { ClientConfig } = await import("@zenystx/helios-core/client/config");
    const config = new ClientConfig();
    expect(config.getClusterName()).toBe("dev");
    config.setClusterName("prod");
    expect(config.getClusterName()).toBe("prod");
  });

  test("has network config", async () => {
    const { ClientConfig } = await import("@zenystx/helios-core/client/config");
    const config = new ClientConfig();
    const net = config.getNetworkConfig();
    expect(net).toBeDefined();
    net.addAddress("localhost:5701");
    expect(net.getAddresses()).toContain("localhost:5701");
  });

  test("has connection strategy config", async () => {
    const { ClientConfig } = await import("@zenystx/helios-core/client/config");
    const config = new ClientConfig();
    const cs = config.getConnectionStrategyConfig();
    expect(cs).toBeDefined();
    expect(cs.isAsyncStart()).toBe(false);
    expect(cs.getReconnectMode()).toBe("ON");
  });

  test("still supports near-cache config", async () => {
    const { ClientConfig } = await import("@zenystx/helios-core/client/config");
    const { NearCacheConfig } = await import("@zenystx/helios-core/config/NearCacheConfig");
    const config = new ClientConfig();
    config.addNearCacheConfig(new NearCacheConfig("map*"));
    expect(config.getNearCacheConfig("mapFoo")).toBeDefined();
  });
});

// ── 4. Typed client config surfaces ──────────────────────────────────────────

describe("Typed client config surfaces", () => {
  test("ClientNetworkConfig has addresses and connectionTimeout", async () => {
    const { ClientNetworkConfig } = await import("@zenystx/helios-core/client/config/ClientNetworkConfig");
    const net = new ClientNetworkConfig();
    expect(net.getAddresses()).toEqual([]);
    net.addAddress("host1:5701", "host2:5702");
    expect(net.getAddresses()).toEqual(["host1:5701", "host2:5702"]);
    expect(net.getConnectionTimeout()).toBe(5000);
    net.setConnectionTimeout(10000);
    expect(net.getConnectionTimeout()).toBe(10000);
  });

  test("ConnectionRetryConfig has exponential backoff defaults", async () => {
    const { ConnectionRetryConfig } = await import("@zenystx/helios-core/client/config/ConnectionRetryConfig");
    const retry = new ConnectionRetryConfig();
    expect(retry.getInitialBackoffMillis()).toBe(1000);
    expect(retry.getMaxBackoffMillis()).toBe(30000);
    expect(retry.getMultiplier()).toBe(1.05);
    expect(retry.getJitter()).toBe(0);
    expect(retry.getClusterConnectTimeoutMillis()).toBe(-1);
  });

  test("ConnectionRetryConfig validates multiplier >= 1.0", async () => {
    const { ConnectionRetryConfig } = await import("@zenystx/helios-core/client/config/ConnectionRetryConfig");
    const retry = new ConnectionRetryConfig();
    expect(() => retry.setMultiplier(0.5)).toThrow();
  });

  test("ConnectionRetryConfig validates jitter [0, 1]", async () => {
    const { ConnectionRetryConfig } = await import("@zenystx/helios-core/client/config/ConnectionRetryConfig");
    const retry = new ConnectionRetryConfig();
    expect(() => retry.setJitter(-0.1)).toThrow();
    expect(() => retry.setJitter(1.1)).toThrow();
    retry.setJitter(0.5);
    expect(retry.getJitter()).toBe(0.5);
  });

  test("ClientConnectionStrategyConfig has reconnect modes", async () => {
    const { ClientConnectionStrategyConfig } = await import("@zenystx/helios-core/client/config/ClientConnectionStrategyConfig");
    const cs = new ClientConnectionStrategyConfig();
    expect(cs.getReconnectMode()).toBe("ON");
    cs.setReconnectMode("OFF");
    expect(cs.getReconnectMode()).toBe("OFF");
    cs.setReconnectMode("ASYNC");
    expect(cs.getReconnectMode()).toBe("ASYNC");
    // Has embedded retry config
    expect(cs.getConnectionRetryConfig()).toBeDefined();
  });

  test("ClientSecurityConfig supports username/password", async () => {
    const { ClientSecurityConfig } = await import("@zenystx/helios-core/client/config/ClientSecurityConfig");
    const sec = new ClientSecurityConfig();
    sec.setUsernamePasswordIdentity("admin", "secret");
    const creds = sec.getCredentials();
    expect(creds).toBeDefined();
    expect(creds!.getName()).toBe("admin");
  });

  test("ClientFailoverConfig with tryCount and multiple configs", async () => {
    const { ClientFailoverConfig } = await import("@zenystx/helios-core/client/config/ClientFailoverConfig");
    const { ClientConfig } = await import("@zenystx/helios-core/client/config");

    const fo = new ClientFailoverConfig();
    expect(fo.getTryCount()).toBe(Number.MAX_SAFE_INTEGER);
    fo.setTryCount(3);

    const c1 = new ClientConfig();
    c1.setClusterName("cluster-a");
    const c2 = new ClientConfig();
    c2.setClusterName("cluster-b");
    fo.addClientConfig(c1);
    fo.addClientConfig(c2);

    expect(fo.getClientConfigs()).toHaveLength(2);
  });
});

// ── 5. Production client-config loading ──────────────────────────────────────

describe("Client config loading", () => {
  test("loads client config from JSON", async () => {
    const { loadClientConfig } = await import("@zenystx/helios-core/client/config/ClientConfigLoader");
    const tmpFile = "/tmp/helios-client-test-config.json";
    await Bun.write(tmpFile, JSON.stringify({
      "instance-name": "loaded-client",
      "cluster-name": "my-cluster",
      network: {
        "cluster-members": ["host1:5701", "host2:5702"],
        "connection-timeout": 10000,
      },
      "connection-strategy": {
        "async-start": true,
        "reconnect-mode": "ASYNC",
        "connection-retry": {
          "initial-backoff-millis": 500,
          "max-backoff-millis": 60000,
        },
      },
    }));

    const config = await loadClientConfig(tmpFile);
    expect(config.getName()).toBe("loaded-client");
    expect(config.getClusterName()).toBe("my-cluster");
    expect(config.getNetworkConfig().getAddresses()).toEqual(["host1:5701", "host2:5702"]);
    expect(config.getNetworkConfig().getConnectionTimeout()).toBe(10000);
    expect(config.getConnectionStrategyConfig().isAsyncStart()).toBe(true);
    expect(config.getConnectionStrategyConfig().getReconnectMode()).toBe("ASYNC");
    expect(config.getConnectionStrategyConfig().getConnectionRetryConfig().getInitialBackoffMillis()).toBe(500);
  });

  test("loads client config from YAML", async () => {
    const { loadClientConfig } = await import("@zenystx/helios-core/client/config/ClientConfigLoader");
    const tmpFile = "/tmp/helios-client-test-config.yaml";
    await Bun.write(tmpFile, `
instance-name: yaml-client
cluster-name: yaml-cluster
network:
  cluster-members:
    - host3:5701
`);

    const config = await loadClientConfig(tmpFile);
    expect(config.getName()).toBe("yaml-client");
    expect(config.getClusterName()).toBe("yaml-cluster");
    expect(config.getNetworkConfig().getAddresses()).toEqual(["host3:5701"]);
  });

  test("missing config file throws", async () => {
    const { loadClientConfig } = await import("@zenystx/helios-core/client/config/ClientConfigLoader");
    await expect(loadClientConfig("/tmp/nonexistent-helios-client.json")).rejects.toThrow(/not found/i);
  });
});

// ── 6. Client serialization owner ────────────────────────────────────────────

describe("Client serialization owner", () => {
  test("ClientSerializationService is created from client config", async () => {
    const { ClientConfig } = await import("@zenystx/helios-core/client/config");
    const { createClientSerializationService } = await import("@zenystx/helios-core/client/impl/serialization/ClientSerializationService");
    const config = new ClientConfig();
    const svc = createClientSerializationService(config);
    expect(svc).toBeDefined();
    expect(svc.toData).toBeDefined();
    expect(svc.toObject).toBeDefined();
  });

  test("serializes and deserializes primitives", async () => {
    const { ClientConfig } = await import("@zenystx/helios-core/client/config");
    const { createClientSerializationService } = await import("@zenystx/helios-core/client/impl/serialization/ClientSerializationService");
    const svc = createClientSerializationService(new ClientConfig());
    const data = svc.toData("hello");
    expect(data).not.toBeNull();
    const obj = svc.toObject<string>(data!);
    expect(obj).toBe("hello");
  });

  test("serializes JSON objects via JSON serializer", async () => {
    const { ClientConfig } = await import("@zenystx/helios-core/client/config");
    const { createClientSerializationService } = await import("@zenystx/helios-core/client/impl/serialization/ClientSerializationService");
    const svc = createClientSerializationService(new ClientConfig());
    const data = svc.toData({ key: "value" });
    expect(data).not.toBeNull();
    const obj = svc.toObject<{ key: string }>(data!);
    expect(obj).toEqual({ key: "value" });
  });
});

// ── 7. Fail fast on unsupported config sections ──────────────────────────────

describe("Fail-fast on unsupported config sections", () => {
  test("rejects unknown top-level config keys from file", async () => {
    const { loadClientConfig } = await import("@zenystx/helios-core/client/config/ClientConfigLoader");
    const tmpFile = "/tmp/helios-client-unsupported.json";
    await Bun.write(tmpFile, JSON.stringify({
      "cluster-name": "ok",
      "native-memory": { enabled: true },
    }));

    await expect(loadClientConfig(tmpFile)).rejects.toThrow(/unsupported.*native-memory/i);
  });

  test("rejects unknown network sub-config keys", async () => {
    const { loadClientConfig } = await import("@zenystx/helios-core/client/config/ClientConfigLoader");
    const tmpFile = "/tmp/helios-client-unsupported-net.json";
    await Bun.write(tmpFile, JSON.stringify({
      "cluster-name": "ok",
      network: {
        "aws": { enabled: true },
      },
    }));

    await expect(loadClientConfig(tmpFile)).rejects.toThrow(/unsupported.*aws/i);
  });
});

// ── 8. Verification: separate Bun app can import the public client surface ──

describe("Public client surface import verification", () => {
  test("HeliosClient is importable from root barrel", async () => {
    // This proves that src/index.ts exports HeliosClient
    const mod = await import("@zenystx/helios-core/client");
    expect(mod.HeliosClient).toBeDefined();
  });

  test("ClientConfig is importable from root barrel", async () => {
    const mod = await import("@zenystx/helios-core/client/config");
    expect(mod.ClientConfig).toBeDefined();
  });

  test("can construct HeliosClient with real config, get lifecycle, and shutdown without internal imports", async () => {
    // This test simulates an external consumer using only public surface
    const { HeliosClient } = await import("@zenystx/helios-core/client");
    const { ClientConfig } = await import("@zenystx/helios-core/client/config");

    const config = new ClientConfig();
    config.setClusterName("ext-cluster");
    config.getNetworkConfig().addAddress("localhost:5701");

    const client = new HeliosClient(config);
    expect(client.getName()).toBe("helios-client");
    expect(client.getConfig().getClusterName()).toBe("ext-cluster");
    expect(client.getLifecycleService().isRunning()).toBe(true);

    client.shutdown();
    expect(client.getLifecycleService().isRunning()).toBe(false);
  });
});
