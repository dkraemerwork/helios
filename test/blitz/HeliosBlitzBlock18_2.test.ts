/**
 * Block 18.2 — Helios Blitz Config, Protocol, and Topology Service
 *
 * 18 tests proving config, topology models, cluster messages,
 * coordinator service, re-registration sweep, and announce semantics.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import { parseRawConfig } from "@zenystx/helios-core/config/ConfigLoader";
import type { HeliosBlitzRuntimeConfig } from "@zenystx/helios-core/config/BlitzRuntimeConfig";
import {
  BlitzClusterTopology,
  type BlitzNodeRegistration,
} from "@zenystx/helios-core/instance/impl/blitz/BlitzClusterTopology";
import { HeliosBlitzCoordinator } from "@zenystx/helios-core/instance/impl/blitz/HeliosBlitzCoordinator";
import type {
  BlitzNodeRegisterMsg,
  BlitzTopologyRequestMsg,
  BlitzTopologyResponseMsg,
  BlitzTopologyAnnounceMsg,
  BlitzNodeRemoveMsg,
} from "@zenystx/helios-core/cluster/tcp/ClusterMessage";

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("Block 18.2 — Helios Blitz Config, Protocol, and Topology Service", () => {
  // ──────────────────────────────────────────────────────────────────────────
  // 1. HeliosConfig Blitz runtime section (3 tests)
  // ──────────────────────────────────────────────────────────────────────────

  describe("HeliosConfig Blitz runtime section", () => {
    test("HeliosConfig has getBlitzConfig/setBlitzConfig that store and retrieve HeliosBlitzRuntimeConfig", () => {
      const config = new HeliosConfig("test-cluster");

      expect(config.getBlitzConfig()).toBeNull();

      const blitzConfig: HeliosBlitzRuntimeConfig = {
        enabled: true,
        mode: "distributed-auto",
        localPort: 4222,
        localClusterPort: 6222,
        clusterName: "helios-blitz",
        defaultReplicas: 3,
      };

      config.setBlitzConfig(blitzConfig);

      const retrieved = config.getBlitzConfig();
      expect(retrieved).not.toBeNull();
      expect(retrieved?.enabled).toBe(true);
      expect(retrieved?.mode).toBe("distributed-auto");
      expect(retrieved?.localPort).toBe(4222);
      expect(retrieved?.localClusterPort).toBe(6222);
      expect(retrieved?.clusterName).toBe("helios-blitz");
      expect(retrieved?.defaultReplicas).toBe(3);
    });

    test("default config has enabled=false, mode='embedded-local'", () => {
      const defaultConfig: HeliosBlitzRuntimeConfig = {
        enabled: false,
        mode: "embedded-local",
      };

      const config = new HeliosConfig();
      config.setBlitzConfig(defaultConfig);

      const retrieved = config.getBlitzConfig();
      expect(retrieved?.enabled).toBe(false);
      expect(retrieved?.mode).toBe("embedded-local");
    });

    test("parseRawConfig parses a blitz section from raw config", () => {
      const rawConfig = {
        name: "production-cluster",
        blitz: {
          enabled: true,
          mode: "distributed-auto",
          localPort: 14222,
          clusterName: "prod-blitz",
          dataDir: "/var/lib/blitz",
          defaultReplicas: 5,
        },
      };

      const config = parseRawConfig(rawConfig);

      expect(config.getName()).toBe("production-cluster");

      const blitz = config.getBlitzConfig();
      expect(blitz).not.toBeNull();
      expect(blitz?.enabled).toBe(true);
      expect(blitz?.mode).toBe("distributed-auto");
      expect(blitz?.localPort).toBe(14222);
      expect(blitz?.clusterName).toBe("prod-blitz");
      expect(blitz?.dataDir).toBe("/var/lib/blitz");
      expect(blitz?.defaultReplicas).toBe(5);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Topology models (3 tests)
  // ──────────────────────────────────────────────────────────────────────────

  describe("Topology models", () => {
    test("BlitzNodeRegistration holds all required fields", () => {
      const reg: BlitzNodeRegistration = {
        memberId: "node-1",
        memberListVersion: 5,
        serverName: "helios-blitz-node-1",
        clientPort: 4222,
        clusterPort: 6222,
        advertiseHost: "node-1.cluster.local",
        clusterName: "helios-blitz",
        ready: true,
        startedAt: Date.now(),
      };

      expect(reg.memberId).toBe("node-1");
      expect(reg.memberListVersion).toBe(5);
      expect(reg.serverName).toBe("helios-blitz-node-1");
      expect(reg.clientPort).toBe(4222);
      expect(reg.clusterPort).toBe(6222);
      expect(reg.advertiseHost).toBe("node-1.cluster.local");
      expect(reg.clusterName).toBe("helios-blitz");
      expect(reg.ready).toBe(true);
      expect(reg.startedAt).toBeGreaterThan(0);
    });

    test("BlitzClusterTopology tracks registrations and is keyed by memberListVersion", () => {
      const topology = new BlitzClusterTopology(10);

      expect(topology.getMemberListVersion()).toBe(10);
      expect(topology.getRegistrations().size).toBe(0);

      const reg1: BlitzNodeRegistration = {
        memberId: "node-1",
        memberListVersion: 10,
        serverName: "nats-1",
        clientPort: 4222,
        clusterPort: 6222,
        advertiseHost: "node-1.local",
        clusterName: "test-cluster",
        ready: true,
        startedAt: Date.now(),
      };

      const reg2: BlitzNodeRegistration = {
        memberId: "node-2",
        memberListVersion: 10,
        serverName: "nats-2",
        clientPort: 4223,
        clusterPort: 6223,
        advertiseHost: "node-2.local",
        clusterName: "test-cluster",
        ready: false,
        startedAt: Date.now(),
      };

      topology.addRegistration(reg1);
      topology.addRegistration(reg2);

      expect(topology.getRegistrations().size).toBe(2);
      expect(topology.getRegistration("node-1")).toEqual(reg1);
      expect(topology.getRegistration("node-2")).toEqual(reg2);
      expect(topology.getReadyNodeCount()).toBe(1);

      topology.removeRegistration("node-1");
      expect(topology.getRegistrations().size).toBe(1);
      expect(topology.getRegistration("node-1")).toBeNull();
    });

    test("BlitzClusterTopology.getRoutes returns ordered nats:// seed routes from registered nodes", () => {
      const topology = new BlitzClusterTopology(1);

      const reg1: BlitzNodeRegistration = {
        memberId: "node-3",
        memberListVersion: 1,
        serverName: "nats-3",
        clientPort: 4224,
        clusterPort: 6224,
        advertiseHost: "node-3.cluster.local",
        clusterName: "test",
        ready: true,
        startedAt: Date.now(),
      };

      const reg2: BlitzNodeRegistration = {
        memberId: "node-1",
        memberListVersion: 1,
        serverName: "nats-1",
        clientPort: 4222,
        clusterPort: 6222,
        advertiseHost: "node-1.cluster.local",
        clusterName: "test",
        ready: true,
        startedAt: Date.now(),
      };

      const reg3: BlitzNodeRegistration = {
        memberId: "node-2",
        memberListVersion: 1,
        serverName: "nats-2",
        clientPort: 4223,
        clusterPort: 6223,
        advertiseHost: "node-2.cluster.local",
        clusterName: "test",
        ready: true,
        startedAt: Date.now(),
      };

      topology.addRegistration(reg1);
      topology.addRegistration(reg2);
      topology.addRegistration(reg3);

      const routes = topology.getRoutes();

      expect(routes).toHaveLength(3);
      // Routes should be sorted for deterministic ordering
      expect(routes[0]).toBe("nats://node-1.cluster.local:6222");
      expect(routes[1]).toBe("nats://node-2.cluster.local:6223");
      expect(routes[2]).toBe("nats://node-3.cluster.local:6224");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. BLITZ_* cluster messages (3 tests)
  // ──────────────────────────────────────────────────────────────────────────

  describe("BLITZ_* cluster messages", () => {
    test("BLITZ_NODE_REGISTER message carries the full BlitzNodeRegistration payload", () => {
      const registration: BlitzNodeRegistration = {
        memberId: "node-1",
        memberListVersion: 5,
        serverName: "helios-blitz-node-1",
        clientPort: 4222,
        clusterPort: 6222,
        advertiseHost: "node-1.cluster.local",
        clusterName: "helios-blitz",
        ready: true,
        startedAt: Date.now(),
      };

      const msg: BlitzNodeRegisterMsg = {
        type: "BLITZ_NODE_REGISTER",
        registration,
      };

      expect(msg.type).toBe("BLITZ_NODE_REGISTER");
      expect(msg.registration).toEqual(registration);
      expect(msg.registration.memberId).toBe("node-1");
      expect(msg.registration.memberListVersion).toBe(5);
      expect(msg.registration.serverName).toBe("helios-blitz-node-1");
      expect(msg.registration.clientPort).toBe(4222);
      expect(msg.registration.clusterPort).toBe(6222);
      expect(msg.registration.advertiseHost).toBe("node-1.cluster.local");
      expect(msg.registration.clusterName).toBe("helios-blitz");
      expect(msg.registration.ready).toBe(true);
    });

    test("BLITZ_TOPOLOGY_REQUEST carries requestId", () => {
      const msg: BlitzTopologyRequestMsg = {
        type: "BLITZ_TOPOLOGY_REQUEST",
        requestId: "req-12345",
      };

      expect(msg.type).toBe("BLITZ_TOPOLOGY_REQUEST");
      expect(msg.requestId).toBe("req-12345");
    });

    test("BLITZ_TOPOLOGY_RESPONSE carries all required fields", () => {
      const msg: BlitzTopologyResponseMsg = {
        type: "BLITZ_TOPOLOGY_RESPONSE",
        requestId: "req-12345",
        routes: [
          "nats://node-1.cluster.local:6222",
          "nats://node-2.cluster.local:6223",
          "nats://node-3.cluster.local:6224",
        ],
        masterMemberId: "node-1",
        memberListVersion: 10,
        fenceToken: "fence-abc-123",
        registrationsComplete: false,
        retryAfterMs: 1000,
        clientConnectUrl: "nats://127.0.0.1:4222",
      };

      expect(msg.type).toBe("BLITZ_TOPOLOGY_RESPONSE");
      expect(msg.requestId).toBe("req-12345");
      expect(msg.routes).toHaveLength(3);
      expect(msg.routes[0]).toBe("nats://node-1.cluster.local:6222");
      expect(msg.masterMemberId).toBe("node-1");
      expect(msg.memberListVersion).toBe(10);
      expect(msg.registrationsComplete).toBe(false);
      expect(msg.retryAfterMs).toBe(1000);
      expect(msg.clientConnectUrl).toBe("nats://127.0.0.1:4222");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. HeliosBlitzCoordinator (6 tests)
  // ──────────────────────────────────────────────────────────────────────────

  describe("HeliosBlitzCoordinator", () => {
    let coordinator: HeliosBlitzCoordinator;

    beforeEach(() => {
      coordinator = new HeliosBlitzCoordinator();
      coordinator.setMasterMemberId("master-node");
      coordinator.setMemberListVersion(1);
    });

    test("handleRegister on master stores registration and updates topology", () => {
      const registration: BlitzNodeRegistration = {
        memberId: "node-1",
        memberListVersion: 1,
        serverName: "nats-1",
        clientPort: 4222,
        clusterPort: 6222,
        advertiseHost: "node-1.local",
        clusterName: "test-cluster",
        ready: true,
        startedAt: Date.now(),
      };

      const msg: BlitzNodeRegisterMsg = {
        type: "BLITZ_NODE_REGISTER",
        registration,
      };

      const handled = coordinator.handleRegister(msg, true);

      expect(handled).toBe(true);

      const topology = coordinator.getTopology();
      expect(topology).not.toBeNull();
      expect(topology?.getRegistration("node-1")).toEqual(registration);
    });

    test("handleRegister on non-master is ignored and returns false", () => {
      const freshCoordinator = new HeliosBlitzCoordinator();

      const registration: BlitzNodeRegistration = {
        memberId: "node-1",
        memberListVersion: 1,
        serverName: "nats-1",
        clientPort: 4222,
        clusterPort: 6222,
        advertiseHost: "node-1.local",
        clusterName: "test-cluster",
        ready: true,
        startedAt: Date.now(),
      };

      const msg: BlitzNodeRegisterMsg = {
        type: "BLITZ_NODE_REGISTER",
        registration,
      };

      const handled = freshCoordinator.handleRegister(msg, false);

      expect(handled).toBe(false);
      expect(freshCoordinator.getTopology()).toBeNull();
    });

    test("handleTopologyRequest on master with complete registrations returns authoritative response", () => {
      coordinator.setExpectedRegistrants(new Set(["node-1", "node-2"]));

      const reg1: BlitzNodeRegistration = {
        memberId: "node-1",
        memberListVersion: 1,
        serverName: "nats-1",
        clientPort: 4222,
        clusterPort: 6222,
        advertiseHost: "node-1.local",
        clusterName: "test",
        ready: true,
        startedAt: Date.now(),
      };

      const reg2: BlitzNodeRegistration = {
        memberId: "node-2",
        memberListVersion: 1,
        serverName: "nats-2",
        clientPort: 4223,
        clusterPort: 6223,
        advertiseHost: "node-2.local",
        clusterName: "test",
        ready: true,
        startedAt: Date.now(),
      };

      coordinator.handleRegister(
        { type: "BLITZ_NODE_REGISTER", registration: reg1 },
        true,
      );
      coordinator.handleRegister(
        { type: "BLITZ_NODE_REGISTER", registration: reg2 },
        true,
      );

      const request: BlitzTopologyRequestMsg = {
        type: "BLITZ_TOPOLOGY_REQUEST",
        requestId: "req-123",
      };

      const response = coordinator.handleTopologyRequest(request, true);

      expect(response).not.toBeNull();
      expect(response?.type).toBe("BLITZ_TOPOLOGY_RESPONSE");
      expect(response?.requestId).toBe("req-123");
      expect(response?.registrationsComplete).toBe(true);
      expect(response?.routes).toHaveLength(2);
      expect(response?.masterMemberId).toBe("master-node");
      expect(response?.memberListVersion).toBe(1);
      expect(response?.retryAfterMs).toBeUndefined();
    });

    test("handleTopologyRequest on master with incomplete registrations returns retryable response", () => {
      coordinator.setExpectedRegistrants(
        new Set(["node-1", "node-2", "node-3"]),
      );

      const reg1: BlitzNodeRegistration = {
        memberId: "node-1",
        memberListVersion: 1,
        serverName: "nats-1",
        clientPort: 4222,
        clusterPort: 6222,
        advertiseHost: "node-1.local",
        clusterName: "test",
        ready: true,
        startedAt: Date.now(),
      };

      coordinator.handleRegister(
        { type: "BLITZ_NODE_REGISTER", registration: reg1 },
        true,
      );

      const request: BlitzTopologyRequestMsg = {
        type: "BLITZ_TOPOLOGY_REQUEST",
        requestId: "req-456",
      };

      const response = coordinator.handleTopologyRequest(request, true);

      expect(response).not.toBeNull();
      expect(response?.type).toBe("BLITZ_TOPOLOGY_RESPONSE");
      expect(response?.requestId).toBe("req-456");
      expect(response?.registrationsComplete).toBe(false);
      expect(response?.retryAfterMs).toBe(1000);
      expect(response?.masterMemberId).toBe("master-node");
      expect(response?.memberListVersion).toBe(1);
    });

    test("handleRemove removes the registration and updates topology", () => {
      const reg1: BlitzNodeRegistration = {
        memberId: "node-1",
        memberListVersion: 1,
        serverName: "nats-1",
        clientPort: 4222,
        clusterPort: 6222,
        advertiseHost: "node-1.local",
        clusterName: "test",
        ready: true,
        startedAt: Date.now(),
      };

      coordinator.handleRegister(
        { type: "BLITZ_NODE_REGISTER", registration: reg1 },
        true,
      );

      expect(coordinator.getTopology()?.getRegistration("node-1")).not.toBeNull();

      const removeMsg: BlitzNodeRemoveMsg = {
        type: "BLITZ_NODE_REMOVE",
        memberId: "node-1",
      };

      const handled = coordinator.handleRemove(removeMsg, true);

      expect(handled).toBe(true);
      expect(coordinator.getTopology()?.getRegistration("node-1")).toBeNull();
    });

    test("after master change, existing registrations are cleared and re-registration is required", () => {
      const reg1: BlitzNodeRegistration = {
        memberId: "node-1",
        memberListVersion: 1,
        serverName: "nats-1",
        clientPort: 4222,
        clusterPort: 6222,
        advertiseHost: "node-1.local",
        clusterName: "test",
        ready: true,
        startedAt: Date.now(),
      };

      coordinator.handleRegister(
        { type: "BLITZ_NODE_REGISTER", registration: reg1 },
        true,
      );

      expect(coordinator.getTopology()?.getRegistrations().size).toBe(1);

      // Simulate master change with new member list version
      coordinator.setMasterMemberId("new-master-node");
      coordinator.setMemberListVersion(2);

      const topology = coordinator.getTopology();
      expect(topology?.getRegistrations().size).toBe(0);
      expect(topology?.getMemberListVersion()).toBe(2);

      // Re-register under new version
      const newReg: BlitzNodeRegistration = {
        memberId: "node-1",
        memberListVersion: 2,
        serverName: "nats-1",
        clientPort: 4222,
        clusterPort: 6222,
        advertiseHost: "node-1.local",
        clusterName: "test",
        ready: true,
        startedAt: Date.now(),
      };

      coordinator.handleRegister(
        { type: "BLITZ_NODE_REGISTER", registration: newReg },
        true,
      );

      expect(coordinator.getTopology()?.getRegistrations().size).toBe(1);
      expect(
        coordinator.getTopology()?.getRegistration("node-1")?.memberListVersion,
      ).toBe(2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Re-registration sweep (2 tests)
  // ──────────────────────────────────────────────────────────────────────────

  describe("Re-registration sweep", () => {
    let coordinator: HeliosBlitzCoordinator;

    beforeEach(() => {
      coordinator = new HeliosBlitzCoordinator();
      coordinator.setMasterMemberId("master-node");
      coordinator.setMemberListVersion(1);
    });

    test("after master change, isRegistrationComplete returns false until all expected members re-register", () => {
      coordinator.setExpectedRegistrants(
        new Set(["node-1", "node-2", "node-3"]),
      );

      expect(coordinator.isRegistrationComplete()).toBe(false);

      coordinator.handleRegister(
        {
          type: "BLITZ_NODE_REGISTER",
          registration: {
            memberId: "node-1",
            memberListVersion: 1,
            serverName: "nats-1",
            clientPort: 4222,
            clusterPort: 6222,
            advertiseHost: "node-1.local",
            clusterName: "test",
            ready: true,
            startedAt: Date.now(),
          },
        },
        true,
      );
      expect(coordinator.isRegistrationComplete()).toBe(false);

      coordinator.handleRegister(
        {
          type: "BLITZ_NODE_REGISTER",
          registration: {
            memberId: "node-2",
            memberListVersion: 1,
            serverName: "nats-2",
            clientPort: 4223,
            clusterPort: 6223,
            advertiseHost: "node-2.local",
            clusterName: "test",
            ready: true,
            startedAt: Date.now(),
          },
        },
        true,
      );
      expect(coordinator.isRegistrationComplete()).toBe(false);

      coordinator.handleRegister(
        {
          type: "BLITZ_NODE_REGISTER",
          registration: {
            memberId: "node-3",
            memberListVersion: 1,
            serverName: "nats-3",
            clientPort: 4224,
            clusterPort: 6224,
            advertiseHost: "node-3.local",
            clusterName: "test",
            ready: true,
            startedAt: Date.now(),
          },
        },
        true,
      );
      expect(coordinator.isRegistrationComplete()).toBe(true);
    });

    test("getExpectedRegistrants returns set of all joined member IDs with distributed-auto enabled", () => {
      const expectedMembers = new Set([
        "node-1",
        "node-2",
        "node-3",
        "node-4",
      ]);

      coordinator.setExpectedRegistrants(expectedMembers);

      const retrieved = coordinator.getExpectedRegistrants();

      expect(retrieved.size).toBe(4);
      expect(retrieved.has("node-1")).toBe(true);
      expect(retrieved.has("node-2")).toBe(true);
      expect(retrieved.has("node-3")).toBe(true);
      expect(retrieved.has("node-4")).toBe(true);
      expect(retrieved.has("node-5")).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Announce semantics (1 test)
  // ──────────────────────────────────────────────────────────────────────────

  describe("Announce semantics", () => {
    test("generateTopologyAnnounce produces BLITZ_TOPOLOGY_ANNOUNCE with current topology snapshot", () => {
      const coordinator = new HeliosBlitzCoordinator();
      coordinator.setMasterMemberId("master-node");
      coordinator.setMemberListVersion(5);

      coordinator.handleRegister(
        {
          type: "BLITZ_NODE_REGISTER",
          registration: {
            memberId: "node-1",
            memberListVersion: 5,
            serverName: "nats-1",
            clientPort: 4222,
            clusterPort: 6222,
            advertiseHost: "node-1.cluster.local",
            clusterName: "test",
            ready: true,
            startedAt: Date.now(),
          },
        },
        true,
      );

      coordinator.handleRegister(
        {
          type: "BLITZ_NODE_REGISTER",
          registration: {
            memberId: "node-2",
            memberListVersion: 5,
            serverName: "nats-2",
            clientPort: 4223,
            clusterPort: 6223,
            advertiseHost: "node-2.cluster.local",
            clusterName: "test",
            ready: true,
            startedAt: Date.now(),
          },
        },
        true,
      );

      const announce = coordinator.generateTopologyAnnounce();

      expect(announce).not.toBeNull();
      expect(announce?.type).toBe("BLITZ_TOPOLOGY_ANNOUNCE");
      expect(announce?.memberListVersion).toBe(5);
      expect(announce?.masterMemberId).toBe("master-node");
      expect(announce?.routes).toHaveLength(2);
      expect(announce?.routes).toContain("nats://node-1.cluster.local:6222");
      expect(announce?.routes).toContain("nats://node-2.cluster.local:6223");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 7. Authority tuple fencing with fenceToken (4 tests)
  // ──────────────────────────────────────────────────────────────────────────

  describe("Authority tuple fencing", () => {
    let coordinator: HeliosBlitzCoordinator;

    beforeEach(() => {
      coordinator = new HeliosBlitzCoordinator();
    });

    test("fenceToken is generated on master epoch change and rotates on each new epoch", () => {
      coordinator.setMasterMemberId("master-1");
      coordinator.setMemberListVersion(1);

      const token1 = coordinator.getFenceToken();
      expect(token1).toBeString();
      expect(token1!.length).toBeGreaterThan(0);

      // Same epoch → same token
      expect(coordinator.getFenceToken()).toBe(token1);

      // New epoch (new master or new version) → new token
      coordinator.setMasterMemberId("master-2");
      coordinator.setMemberListVersion(2);

      const token2 = coordinator.getFenceToken();
      expect(token2).toBeString();
      expect(token2).not.toBe(token1);
    });

    test("authoritative topology response carries fenceToken in authority tuple", () => {
      coordinator.setMasterMemberId("master-node");
      coordinator.setMemberListVersion(3);

      coordinator.handleRegister(
        {
          type: "BLITZ_NODE_REGISTER",
          registration: {
            memberId: "node-1",
            memberListVersion: 3,
            serverName: "nats-1",
            clientPort: 4222,
            clusterPort: 6222,
            advertiseHost: "node-1.local",
            clusterName: "test",
            ready: true,
            startedAt: Date.now(),
          },
        },
        true,
      );

      const response = coordinator.handleTopologyRequest(
        { type: "BLITZ_TOPOLOGY_REQUEST", requestId: "req-fence-1" },
        true,
      );

      expect(response).not.toBeNull();
      expect(response!.fenceToken).toBe(coordinator.getFenceToken()!);
      expect(response!.masterMemberId).toBe("master-node");
      expect(response!.memberListVersion).toBe(3);
    });

    test("authoritative topology announce carries fenceToken in authority tuple", () => {
      coordinator.setMasterMemberId("master-node");
      coordinator.setMemberListVersion(5);

      coordinator.handleRegister(
        {
          type: "BLITZ_NODE_REGISTER",
          registration: {
            memberId: "node-1",
            memberListVersion: 5,
            serverName: "nats-1",
            clientPort: 4222,
            clusterPort: 6222,
            advertiseHost: "node-1.local",
            clusterName: "test",
            ready: true,
            startedAt: Date.now(),
          },
        },
        true,
      );

      const announce = coordinator.generateTopologyAnnounce();

      expect(announce).not.toBeNull();
      expect(announce!.fenceToken).toBe(coordinator.getFenceToken()!);
      expect(announce!.masterMemberId).toBe("master-node");
      expect(announce!.memberListVersion).toBe(5);
    });

    test("validateAuthority rejects stale authority tuples from pre-demotion masters", () => {
      coordinator.setMasterMemberId("master-1");
      coordinator.setMemberListVersion(1);

      const validToken = coordinator.getFenceToken()!;

      // Valid authority tuple accepted
      expect(
        coordinator.validateAuthority("master-1", 1, validToken),
      ).toBe(true);

      // Simulate master change (epoch rotation)
      coordinator.setMasterMemberId("master-2");
      coordinator.setMemberListVersion(2);

      const newToken = coordinator.getFenceToken()!;

      // Old master tuple rejected
      expect(
        coordinator.validateAuthority("master-1", 1, validToken),
      ).toBe(false);

      // Wrong fenceToken with correct master/version rejected
      expect(
        coordinator.validateAuthority("master-2", 2, validToken),
      ).toBe(false);

      // Correct tuple accepted
      expect(
        coordinator.validateAuthority("master-2", 2, newToken),
      ).toBe(true);

      // Wrong master with correct version/token rejected
      expect(
        coordinator.validateAuthority("master-1", 2, newToken),
      ).toBe(false);

      // Correct master with wrong version rejected
      expect(
        coordinator.validateAuthority("master-2", 1, newToken),
      ).toBe(false);
    });
  });
});
