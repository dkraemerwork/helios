/**
 * Tests for Block 7.1 — Production HeliosInstanceImpl with service registry wiring.
 *
 * Verifies:
 *  - Lifecycle (isRunning, shutdown, getName)
 *  - NodeEngine accessible and has MapContainerService registered
 *  - All data structure accessors work (Map, Queue, Topic, List, Set, MultiMap)
 *  - Same-name returns same instance (idempotent)
 *  - Config-driven initialization (HeliosConfig with name and MapConfig)
 */
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import { MapConfig } from "@zenystx/helios-core/config/MapConfig";
import { Address } from "@zenystx/helios-core/cluster/Address";
import { MemberImpl } from "@zenystx/helios-core/cluster/impl/MemberImpl";
import { HeliosInstanceImpl } from "@zenystx/helios-core/instance/impl/HeliosInstanceImpl";
import { EndpointQualifier } from "@zenystx/helios-core/instance/EndpointQualifier";
import type { MapContainerService } from "@zenystx/helios-core/map/impl/MapContainerService";
import { MapService } from "@zenystx/helios-core/map/impl/MapService";
import type { NodeEngineImpl } from "@zenystx/helios-core/spi/impl/NodeEngineImpl";
import { MemberVersion } from "@zenystx/helios-core/version/MemberVersion";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

describe("HeliosInstanceImpl", () => {
  let hz: HeliosInstanceImpl;

  beforeEach(() => {
    hz = new HeliosInstanceImpl();
  });

  afterEach(() => {
    if (hz.isRunning()) hz.shutdown();
  });

  // ── Lifecycle ────────────────────────────────────────────────────────────

  describe("lifecycle", () => {
    it("should be running after creation", () => {
      expect(hz.isRunning()).toBe(true);
    });

    it("should not be running after shutdown", () => {
      hz.shutdown();
      expect(hz.isRunning()).toBe(false);
    });

    it('should use default name "helios" when no config provided', () => {
      expect(hz.getName()).toBe("helios");
    });

    it("should use configured name", () => {
      const config = new HeliosConfig("my-cluster");
      const named = new HeliosInstanceImpl(config);
      expect(named.getName()).toBe("my-cluster");
      named.shutdown();
    });

    it("should stop NodeEngine on shutdown", () => {
      const nodeEngine = hz.getNodeEngine();
      hz.shutdown();
      expect(nodeEngine.isRunning()).toBe(false);
    });
  });

  // ── NodeEngine / Service Registry ───────────────────────────────────────

  describe("service registry", () => {
    it("should expose a running NodeEngine", () => {
      const nodeEngine = hz.getNodeEngine();
      expect(nodeEngine).toBeDefined();
      expect(nodeEngine.isRunning()).toBe(true);
    });

    it("should have MapContainerService registered under MapService.SERVICE_NAME", () => {
      const mapSvc = hz
        .getNodeEngine()
        .getService<MapContainerService>(MapService.SERVICE_NAME);
      expect(mapSvc).toBeDefined();
    });

    it("should throw when requesting unknown service", () => {
      expect(() => hz.getNodeEngine().getService("no-such-service")).toThrow();
    });
  });

  // ── IMap ────────────────────────────────────────────────────────────────

  describe("IMap", () => {
    it("should create and use a map", async () => {
      const map = hz.getMap<string, string>("test-map");
      expect(map).toBeDefined();
      await map.put("k", "v");
      expect(await map.get("k")).toBe("v");
    });

    it("should return the same instance for the same name", () => {
      expect(hz.getMap("m")).toBe(hz.getMap("m"));
    });

    it("should return different instances for different names", () => {
      expect(hz.getMap("a")).not.toBe(hz.getMap("b"));
    });

    it("should expose the map name via getName()", () => {
      expect(hz.getMap("my-map").getName()).toBe("my-map");
    });

    it("should handle complex objects round-trip", async () => {
      const map = hz.getMap<string, { x: number }>("complex-map");
      await map.put("key", { x: 42 });
      expect(await map.get("key")).toEqual({ x: 42 });
    });
  });

  // ── IQueue ──────────────────────────────────────────────────────────────

  describe("IQueue", () => {
    it("should create and use a queue (FIFO)", () => {
      const queue = hz.getQueue<number>("q");
      queue.offer(1);
      queue.offer(2);
      expect(queue.poll()).toBe(1);
      expect(queue.poll()).toBe(2);
    });

    it("should return the same instance for the same name", () => {
      expect(hz.getQueue("q1")).toBe(hz.getQueue("q1"));
    });

    it("should return different instances for different names", () => {
      expect(hz.getQueue("qa")).not.toBe(hz.getQueue("qb"));
    });
  });

  // ── ITopic ──────────────────────────────────────────────────────────────

  describe("ITopic", () => {
    it("should create and use a topic (publish/subscribe)", () => {
      const topic = hz.getTopic<string>("t");
      const received: string[] = [];
      topic.addMessageListener((msg) => received.push(msg.getMessageObject()));
      topic.publish("hello");
      expect(received).toEqual(["hello"]);
    });

    it("should keep reliable topics on a separate API path", () => {
      expect(() => hz.getReliableTopic("rt")).toThrow(
        "ReliableTopic is not implemented yet; use getTopic() for classic topic semantics",
      );
    });

    it("should return the same instance for the same name", () => {
      expect(hz.getTopic("t1")).toBe(hz.getTopic("t1"));
    });

    it("should return different instances for different names", () => {
      expect(hz.getTopic("ta")).not.toBe(hz.getTopic("tb"));
    });
  });

  // ── IList ───────────────────────────────────────────────────────────────

  describe("IList", () => {
    it("should create and use a list", () => {
      const list = hz.getList<string>("l");
      list.add("a");
      list.add("b");
      expect(list.size()).toBe(2);
      expect(list.get(0)).toBe("a");
    });

    it("should return the same instance for the same name", () => {
      expect(hz.getList("l1")).toBe(hz.getList("l1"));
    });
  });

  // ── ISet ─────────────────────────────────────────────────────────────────

  describe("ISet", () => {
    it("should create and use a set (dedup)", () => {
      const set = hz.getSet<string>("s");
      set.add("x");
      set.add("x");
      expect(set.size()).toBe(1);
    });

    it("should return the same instance for the same name", () => {
      expect(hz.getSet("s1")).toBe(hz.getSet("s1"));
    });
  });

  // ── MultiMap ─────────────────────────────────────────────────────────────

  describe("MultiMap", () => {
    it("should create and use a multimap (multi-value per key)", () => {
      const mm = hz.getMultiMap<string, number>("mm");
      mm.put("k", 1);
      mm.put("k", 2);
      const vals = mm.get("k");
      expect(vals).toContain(1);
      expect(vals).toContain(2);
    });

    it("should return the same instance for the same name", () => {
      expect(hz.getMultiMap("mm1")).toBe(hz.getMultiMap("mm1"));
    });
  });

  // ── Config-driven initialization ─────────────────────────────────────────

  describe("config-driven", () => {
    it("should accept a HeliosConfig with a custom instance name", () => {
      const config = new HeliosConfig("prod-cluster");
      const inst = new HeliosInstanceImpl(config);
      expect(inst.getName()).toBe("prod-cluster");
      inst.shutdown();
    });

    it("should create maps using MapConfig registered in HeliosConfig", () => {
      const mapCfg = new MapConfig("orders");
      mapCfg.setTimeToLiveSeconds(600);

      const config = new HeliosConfig("shop");
      config.addMapConfig(mapCfg);

      const inst = new HeliosInstanceImpl(config);
      const map = inst.getMap<string, string>("orders");
      expect(map).toBeDefined();
      expect(map.getName()).toBe("orders");
      inst.shutdown();
    });

    it("should resolve map config by name", () => {
      const config = new HeliosConfig("test");
      config.addMapConfig(new MapConfig("inventory"));

      const inst = new HeliosInstanceImpl(config);
      const cfg = inst.getMapConfig("inventory");
      expect(cfg).toBeDefined();
      expect(cfg!.getName()).toBe("inventory");
      inst.shutdown();
    });

    it("should return null for unknown map config", () => {
      const inst = new HeliosInstanceImpl(new HeliosConfig());
      expect(inst.getMapConfig("not-configured")).toBeNull();
      inst.shutdown();
    });

    it("NodeEngine serialization service is functional after construction", () => {
      const ne: NodeEngineImpl = hz.getNodeEngine();
      const data = ne.toData({ a: 1 });
      expect(data).not.toBeNull();
      const obj = ne.toObject<{ a: number }>(data);
      expect(obj?.a).toBe(1);
    });
  });

  describe("phase 1 quick wins", () => {
    it("builds authoritative REST advertisements for remote members", () => {
      const config = new HeliosConfig("test-cluster");
      config.getNetworkConfig().getRestApiConfig().setEnabled(true).setPort(8080);
      config.getNetworkConfig().setPublicAddress("public-local.example:8080");

      const localMember = new MemberImpl.Builder(new Address("127.0.0.1", 5701))
        .uuid("local-member")
        .localMember(true)
        .version(new MemberVersion(1, 0, 0))
        .build();
      const remoteMember = new MemberImpl.Builder(new Address("10.0.0.6", 5701))
        .uuid("remote-member")
        .version(new MemberVersion(1, 0, 0))
        .addressMap(new Map([[EndpointQualifier.REST, new Address("public-remote.example", 18082)]]))
        .build();

      const instance = Object.create(HeliosInstanceImpl.prototype) as any;
      instance._config = config;
      instance._restServer = {
        isStarted: () => true,
        getBoundPort: () => 8080,
      };
      instance._cluster = {
        getMembers: () => [localMember, remoteMember],
        getLocalMember: () => localMember,
      };
      instance.getCluster = () => instance._cluster;
      instance.getClusterMasterAddress = () => "127.0.0.1:5701";
      instance.getPartitionCount = () => 2;
      instance.getPartitionOwnerId = (pid: number) => pid === 0 ? "local-member" : "remote-member";
      instance.getPartitionBackupIds = (pid: number) => pid === 0 ? ["remote-member"] : ["local-member"];

      const members = instance._buildMemberPartitionInfo();
      expect(members).toHaveLength(2);
      expect(members).toEqual([
        expect.objectContaining({
          uuid: "local-member",
          restPort: 8080,
          restAddress: "http://public-local.example:8080",
        }),
        expect.objectContaining({
          uuid: "remote-member",
          restPort: 18082,
          restAddress: "http://public-remote.example:18082",
        }),
      ]);
    });

    it("sweeps expired pending responses without touching fresh ones", () => {
      const instance = Object.create(HeliosInstanceImpl.prototype) as any;

      const rejected: string[] = [];
      instance._pendingResponses = new Map([
        [
          1,
          {
            resolve: () => {},
            reject: (error: Error) => rejected.push(error.message),
            createdAt: 1_000,
            timeoutMs: 10,
          },
        ],
        [
          2,
          {
            resolve: () => {},
            reject: () => rejected.push("fresh should not reject"),
            createdAt: 1_995,
            timeoutMs: 10,
          },
        ],
      ]);

      instance._sweepPendingResponses(2_000);

      expect(rejected).toEqual(["Operation timed out (callId=1)"]);
      expect(instance._pendingResponses.has(1)).toBe(false);
      expect(instance._pendingResponses.has(2)).toBe(true);
    });

    it("rebuilds the address-to-member cache for O(1) lookups", () => {
      const instance = Object.create(HeliosInstanceImpl.prototype) as any;

      instance._addressToMemberId = new Map();
      instance._clusterCoordinator = {};
      instance._cluster = {
        getMembers: () => [
          {
            getAddress: () => new Address("127.0.0.1", 5701),
            getUuid: () => "member-a",
          },
          {
            getAddress: () => new Address("127.0.0.1", 5702),
            getUuid: () => "member-b",
          },
        ],
      };

      instance._rebuildAddressToMemberIdCache();

      expect(instance._findMemberIdByAddress(new Address("127.0.0.1", 5701))).toBe("member-a");
      expect(instance._findMemberIdByAddress(new Address("127.0.0.1", 5702))).toBe("member-b");
      expect(instance._findMemberIdByAddress(new Address("127.0.0.1", 5799))).toBeNull();
    });
  });
});
