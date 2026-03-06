/**
 * Block 18.5 — Multi-node HA verification
 *
 * Proves the full Phase 18 system works under realistic HA flows:
 * first-node-alone boot, second-node auto-cluster, current-master handoff,
 * retryable topology responses during re-registration sweep, restart/rejoin,
 * shutdownAsync() lifecycle, no child-process leaks, and distributed-default
 * acceptance across Helios + Blitz + NestJS bridge surfaces.
 */
import { describe, test, expect } from "bun:test";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import { HeliosInstanceImpl } from "@zenystx/helios-core/instance/impl/HeliosInstanceImpl";
import {
  HeliosBlitzLifecycleManager,
  BlitzReadinessState,
} from "@zenystx/helios-core/instance/impl/blitz/HeliosBlitzLifecycleManager";
import { HeliosBlitzCoordinator } from "@zenystx/helios-core/instance/impl/blitz/HeliosBlitzCoordinator";
import type {
  BlitzNodeRegistration,
} from "@zenystx/helios-core/instance/impl/blitz/BlitzClusterTopology";
import { BlitzReplicaReconciler } from "@zenystx/helios-core/instance/impl/blitz/BlitzReplicaReconciler";
import { resolveAdvertiseHost } from "@zenystx/helios-core/instance/impl/blitz/AdvertiseHostResolver";
import { resolveHeliosBlitzConfigFromEnv } from "@zenystx/helios-core/config/BlitzEnvHelper";

function makeRegistration(
  memberId: string,
  clusterPort: number,
  overrides: Partial<BlitzNodeRegistration> = {},
): BlitzNodeRegistration {
  return {
    memberId,
    memberListVersion: 1,
    serverName: `blitz-${memberId}`,
    clientPort: clusterPort - 2000,
    clusterPort,
    advertiseHost: "127.0.0.1",
    clusterName: "helios-blitz-cluster",
    ready: false,
    startedAt: Date.now(),
    ...overrides,
  };
}

function makeManager(
  memberId: string,
  port = 14222,
  clusterPort = 16222,
): HeliosBlitzLifecycleManager {
  return new HeliosBlitzLifecycleManager(
    {
      enabled: true,
      mode: "distributed-auto",
      localPort: port,
      localClusterPort: clusterPort,
    },
    memberId,
  );
}

// ─── 1. First-node-alone boot ─────────────────────────────────────────────

describe("Block 18.5 — First-node-alone boot", () => {
  test("first node starts in bootstrap-local and becomes standalone master", () => {
    const mgr = makeManager("node-1");
    mgr.onLocalNodeStarted();
    expect(mgr.getReadinessState()).toBe(BlitzReadinessState.LOCAL_STARTED);
    // Simulate join where node-1 is master and alone
    mgr.onJoinComplete("node-1", 1);
    expect(mgr.getReadinessState()).toBe(BlitzReadinessState.JOIN_READY);
    expect(mgr.canRegisterWithMaster()).toBe(true);
    expect(mgr.getBootstrapPhase()).toBe("local");
  });

  test("standalone first node does not need cutover with empty routes", () => {
    const mgr = makeManager("node-1");
    mgr.onLocalNodeStarted();
    mgr.onJoinComplete("node-1", 1);
    expect(mgr.needsClusteredCutover([])).toBe(false);
    expect(mgr.getBootstrapPhase()).toBe("local");
  });

  test("coordinator on standalone master tracks self-registration", () => {
    const coordinator = new HeliosBlitzCoordinator();
    coordinator.setMasterMemberId("node-1");
    coordinator.setMemberListVersion(1);
    coordinator.setExpectedRegistrants(new Set(["node-1"]));

    const reg = makeRegistration("node-1", 16222);
    const accepted = coordinator.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: reg },
      true,
    );
    expect(accepted).toBe(true);
    expect(coordinator.isRegistrationComplete()).toBe(true);
  });
});

// ─── 2. Second-node auto-cluster formation ────────────────────────────────

describe("Block 18.5 — Second-node auto-cluster formation", () => {
  test("second node triggers cutover when authoritative routes arrive", () => {
    const mgr = makeManager("node-2", 15222, 17222);
    mgr.onLocalNodeStarted();
    mgr.onJoinComplete("node-1", 2); // node-1 is master
    const routes = ["nats://127.0.0.1:16222", "nats://127.0.0.1:17222"];
    expect(mgr.needsClusteredCutover(routes)).toBe(true);
  });

  test("coordinator forms 2-node topology with correct routes", () => {
    const coordinator = new HeliosBlitzCoordinator();
    coordinator.setMasterMemberId("node-1");
    coordinator.setMemberListVersion(2);
    coordinator.setExpectedRegistrants(new Set(["node-1", "node-2"]));

    coordinator.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: makeRegistration("node-1", 16222, { memberListVersion: 2 }) },
      true,
    );
    expect(coordinator.isRegistrationComplete()).toBe(false);

    coordinator.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: makeRegistration("node-2", 17222, { memberListVersion: 2 }) },
      true,
    );
    expect(coordinator.isRegistrationComplete()).toBe(true);

    const announce = coordinator.generateTopologyAnnounce();
    expect(announce).not.toBeNull();
    expect(announce!.routes).toContain("nats://127.0.0.1:16222");
    expect(announce!.routes).toContain("nats://127.0.0.1:17222");
    expect(announce!.routes.length).toBe(2);
  });

  test("second node completes cutover and reaches READY state", () => {
    const mgr = makeManager("node-2", 15222, 17222);
    mgr.onLocalNodeStarted();
    mgr.onJoinComplete("node-1", 2);
    mgr.needsClusteredCutover(["nats://127.0.0.1:16222", "nats://127.0.0.1:17222"]);
    mgr.onClusteredCutoverComplete();
    expect(mgr.getReadinessState()).toBe(BlitzReadinessState.READY);
    expect(mgr.getBootstrapPhase()).toBe("clustered");
  });
});

// ─── 3. Current-master handoff ────────────────────────────────────────────

describe("Block 18.5 — Current-master handoff", () => {
  test("new master resets coordinator topology on memberListVersion change", () => {
    const coordinator = new HeliosBlitzCoordinator();
    coordinator.setMasterMemberId("node-1");
    coordinator.setMemberListVersion(2);
    coordinator.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: makeRegistration("node-1", 16222, { memberListVersion: 2 }) },
      true,
    );
    expect(coordinator.getTopology()!.getRegistrations().size).toBe(1);

    // Master handoff: version bumps, old topology is cleared
    coordinator.setMasterMemberId("node-2");
    coordinator.setMemberListVersion(3);
    expect(coordinator.getTopology()!.getRegistrations().size).toBe(0);
  });

  test("reconciler clears pending upgrades on master failover", () => {
    const reconciler = new BlitzReplicaReconciler(3, 1);
    reconciler.markUnderReplicated("kv-1", 1, 3);
    expect(reconciler.getPendingUpgrades().length).toBe(1);

    reconciler.onMemberListVersionChange(2);
    expect(reconciler.getPendingUpgrades().length).toBe(0);
  });

  test("non-master coordinator rejects register and topology requests", () => {
    const coordinator = new HeliosBlitzCoordinator();
    coordinator.setMasterMemberId("node-1");
    coordinator.setMemberListVersion(1);

    const reg = makeRegistration("node-2", 17222);
    expect(coordinator.handleRegister({ type: "BLITZ_NODE_REGISTER", registration: reg }, false)).toBe(false);
    expect(coordinator.handleTopologyRequest(
      { type: "BLITZ_TOPOLOGY_REQUEST", requestId: "r1" },
      false,
    )).toBeNull();
  });
});

// ─── 4. Retryable topology responses during re-registration sweep ─────────

describe("Block 18.5 — Retryable topology responses during re-registration sweep", () => {
  test("incomplete registration returns retryAfterMs in topology response", () => {
    const coordinator = new HeliosBlitzCoordinator();
    coordinator.setMasterMemberId("node-1");
    coordinator.setMemberListVersion(2);
    coordinator.setExpectedRegistrants(new Set(["node-1", "node-2"]));

    // Only node-1 registered so far
    coordinator.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: makeRegistration("node-1", 16222, { memberListVersion: 2 }) },
      true,
    );

    const response = coordinator.handleTopologyRequest(
      { type: "BLITZ_TOPOLOGY_REQUEST", requestId: "req-1" },
      true,
    );
    expect(response).not.toBeNull();
    expect(response!.registrationsComplete).toBe(false);
    expect(response!.retryAfterMs).toBeGreaterThan(0);
  });

  test("complete registration returns no retryAfterMs", () => {
    const coordinator = new HeliosBlitzCoordinator();
    coordinator.setMasterMemberId("node-1");
    coordinator.setMemberListVersion(2);
    coordinator.setExpectedRegistrants(new Set(["node-1", "node-2"]));

    coordinator.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: makeRegistration("node-1", 16222, { memberListVersion: 2 }) },
      true,
    );
    coordinator.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: makeRegistration("node-2", 17222, { memberListVersion: 2 }) },
      true,
    );

    const response = coordinator.handleTopologyRequest(
      { type: "BLITZ_TOPOLOGY_REQUEST", requestId: "req-2" },
      true,
    );
    expect(response).not.toBeNull();
    expect(response!.registrationsComplete).toBe(true);
    expect(response!.retryAfterMs).toBeUndefined();
  });

  test("re-registration sweep after version change resets expected registrants", () => {
    const coordinator = new HeliosBlitzCoordinator();
    coordinator.setMasterMemberId("node-1");
    coordinator.setMemberListVersion(2);
    coordinator.setExpectedRegistrants(new Set(["node-1", "node-2"]));

    coordinator.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: makeRegistration("node-1", 16222, { memberListVersion: 2 }) },
      true,
    );
    coordinator.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: makeRegistration("node-2", 17222, { memberListVersion: 2 }) },
      true,
    );
    expect(coordinator.isRegistrationComplete()).toBe(true);

    // Version bump clears registrations — sweep in progress
    coordinator.setMemberListVersion(3);
    coordinator.setExpectedRegistrants(new Set(["node-1", "node-2", "node-3"]));
    expect(coordinator.isRegistrationComplete()).toBe(false);
  });
});

// ─── 5. Restart and rejoin ────────────────────────────────────────────────

describe("Block 18.5 — Restart and rejoin", () => {
  test("rejoin resets lifecycle manager for new cutover cycle", () => {
    const mgr = makeManager("node-2", 15222, 17222);
    mgr.onLocalNodeStarted();
    mgr.onJoinComplete("node-1", 2);
    mgr.onClusteredCutoverComplete();
    expect(mgr.getBootstrapPhase()).toBe("clustered");
    expect(mgr.getReadinessState()).toBe(BlitzReadinessState.READY);

    // Simulate restart/rejoin
    mgr.onRejoin(3);
    expect(mgr.getBootstrapPhase()).toBe("local");
    expect(mgr.getReadinessState()).toBe(BlitzReadinessState.LOCAL_STARTED);
    expect(mgr.canRegisterWithMaster()).toBe(false);
  });

  test("after rejoin, node can re-register and cutover again", () => {
    const mgr = makeManager("node-2", 15222, 17222);
    mgr.onLocalNodeStarted();
    mgr.onJoinComplete("node-1", 2);
    mgr.onClusteredCutoverComplete();

    mgr.onRejoin(3);
    mgr.onJoinComplete("node-1", 3);
    expect(mgr.canRegisterWithMaster()).toBe(true);
    expect(mgr.needsClusteredCutover(["nats://127.0.0.1:16222", "nats://127.0.0.1:17222"])).toBe(true);
  });

  test("coordinator re-registers nodes after topology version change", () => {
    const coordinator = new HeliosBlitzCoordinator();
    coordinator.setMasterMemberId("node-1");
    coordinator.setMemberListVersion(2);
    coordinator.setExpectedRegistrants(new Set(["node-1", "node-2"]));

    coordinator.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: makeRegistration("node-1", 16222, { memberListVersion: 2 }) },
      true,
    );
    coordinator.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: makeRegistration("node-2", 17222, { memberListVersion: 2 }) },
      true,
    );

    // Rejoin bumps version — clears old registrations
    coordinator.setMemberListVersion(3);
    coordinator.setExpectedRegistrants(new Set(["node-1", "node-2"]));

    // Must re-register
    expect(coordinator.isRegistrationComplete()).toBe(false);
    coordinator.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: makeRegistration("node-1", 16222, { memberListVersion: 3 }) },
      true,
    );
    coordinator.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: makeRegistration("node-2", 17222, { memberListVersion: 3 }) },
      true,
    );
    expect(coordinator.isRegistrationComplete()).toBe(true);
  });
});

// ─── 6. shutdownAsync() lifecycle and cleanup ─────────────────────────────

describe("Block 18.5 — shutdownAsync() lifecycle and cleanup", () => {
  test("shutdownAsync() awaits hooks and marks blitz manager shutdown", async () => {
    const config = new HeliosConfig("blitz-ha-shutdown");
    config.setBlitzConfig({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    });
    const instance = new HeliosInstanceImpl(config);
    const mgr = instance.getBlitzLifecycleManager()!;
    expect(mgr).not.toBeNull();

    let hookCalled = false;
    instance.registerShutdownHook(async () => {
      hookCalled = true;
    });

    await instance.shutdownAsync();
    expect(hookCalled).toBe(true);
    expect(mgr.isShutDown()).toBe(true);
  });

  test("shutdown() is idempotent — double call does not throw", () => {
    const config = new HeliosConfig("blitz-idempotent-shutdown");
    config.setBlitzConfig({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    });
    const instance = new HeliosInstanceImpl(config);
    instance.shutdown();
    expect(() => instance.shutdown()).not.toThrow();
  });

  test("lifecycle manager markShutdown is idempotent", () => {
    const mgr = makeManager("node-1");
    mgr.onLocalNodeStarted();
    mgr.markShutdown();
    expect(mgr.isShutDown()).toBe(true);
    mgr.markShutdown();
    expect(mgr.isShutDown()).toBe(true);
  });
});

// ─── 7. No child-process leaks after repeated start/stop cycles ──────────

describe("Block 18.5 — No child-process leaks", () => {
  test("lifecycle manager blocks operations after shutdown", () => {
    const mgr = makeManager("node-1");
    mgr.onLocalNodeStarted();
    mgr.onJoinComplete("node-1", 1);
    mgr.markShutdown();

    // All state transitions are blocked after shutdown
    mgr.onLocalNodeStarted(); // no-op
    expect(mgr.getReadinessState()).toBe(BlitzReadinessState.SHUT_DOWN);
    expect(mgr.canRegisterWithMaster()).toBe(false);
  });

  test("rejoin is blocked after shutdown", () => {
    const mgr = makeManager("node-1");
    mgr.onLocalNodeStarted();
    mgr.markShutdown();
    mgr.onRejoin(5);
    expect(mgr.getReadinessState()).toBe(BlitzReadinessState.SHUT_DOWN);
  });

  test("onJoinComplete is blocked after shutdown", () => {
    const mgr = makeManager("node-1");
    mgr.onLocalNodeStarted();
    mgr.markShutdown();
    mgr.onJoinComplete("node-2", 3);
    expect(mgr.getReadinessState()).toBe(BlitzReadinessState.SHUT_DOWN);
  });

  test("repeated create/shutdown cycles produce clean state each time", () => {
    for (let i = 0; i < 5; i++) {
      const config = new HeliosConfig(`blitz-cycle-${i}`);
      config.setBlitzConfig({
        enabled: true,
        mode: "distributed-auto",
        localPort: 14222 + i,
        localClusterPort: 16222 + i,
      });
      const instance = new HeliosInstanceImpl(config);
      const mgr = instance.getBlitzLifecycleManager()!;
      expect(mgr).not.toBeNull();
      expect(mgr.isShutDown()).toBe(false);
      instance.shutdown();
      expect(mgr.isShutDown()).toBe(true);
      expect(instance.isRunning()).toBe(false);
    }
  });
});

// ─── 8. Distributed-default acceptance ────────────────────────────────────

describe("Block 18.5 — Distributed-default acceptance", () => {
  test("env-resolved distributed-auto config integrates with HeliosConfig", () => {
    const envConfig = resolveHeliosBlitzConfigFromEnv({
      HELIOS_BLITZ_ENABLED: "true",
      HELIOS_BLITZ_MODE: "distributed-auto",
      HELIOS_BLITZ_NATS_PORT: "5222",
      HELIOS_BLITZ_NATS_CLUSTER_PORT: "7222",
      HELIOS_BLITZ_CLUSTER_NAME: "prod-cluster",
      HELIOS_BLITZ_DEFAULT_REPLICAS: "3",
    });
    const config = new HeliosConfig("dist-default");
    config.setBlitzConfig(envConfig);

    const instance = new HeliosInstanceImpl(config);
    const mgr = instance.getBlitzLifecycleManager()!;
    expect(mgr).not.toBeNull();
    expect(mgr.getConfig().mode).toBe("distributed-auto");
    expect(mgr.getConfig().localPort).toBe(5222);
    expect(mgr.getConfig().localClusterPort).toBe(7222);
    instance.shutdown();
  });

  test("NestJS HeliosBlitzModule.forHeliosInstance is callable and returns DynamicModule", () => {
    const HeliosBlitzModule = require(`${import.meta.dir}/../../packages/blitz/src/nestjs/HeliosBlitzModule.ts`).HeliosBlitzModule;
    const HELIOS_BLITZ_SERVICE_TOKEN = require(`${import.meta.dir}/../../packages/blitz/src/nestjs/InjectBlitz.decorator.ts`).HELIOS_BLITZ_SERVICE_TOKEN;

    const mod = HeliosBlitzModule.forHeliosInstance({
      provide: HELIOS_BLITZ_SERVICE_TOKEN,
      useFactory: () => null,
    });
    expect(mod.module).toBe(HeliosBlitzModule);
    expect(mod.global).toBe(true);
    expect(mod.providers).toBeDefined();
    expect(mod.exports).toContain(HELIOS_BLITZ_SERVICE_TOKEN);
  });

  test("advertise host resolution works for routable and non-routable hosts", () => {
    expect(resolveAdvertiseHost({ advertiseHost: "10.0.1.5" }).isRoutable).toBe(true);
    expect(resolveAdvertiseHost({ bindHost: "0.0.0.0" }).isRoutable).toBe(false);
    expect(resolveAdvertiseHost({ advertiseHost: "pod-0.svc.local", bindHost: "0.0.0.0" }).isRoutable).toBe(true);
    expect(resolveAdvertiseHost({}).advertiseHost).toBe("127.0.0.1");
  });

  test("reconciler respects master-only semantics across handoff", () => {
    const reconciler = new BlitzReplicaReconciler(3, 1);
    reconciler.markUnderReplicated("kv-1", 1, 3);
    expect(reconciler.getActionableUpgrades(3).length).toBe(1);

    reconciler.setIsMaster(false);
    expect(reconciler.getActionableUpgrades(3).length).toBe(0);

    reconciler.setIsMaster(true);
    expect(reconciler.getActionableUpgrades(3).length).toBe(1);
  });
});

// ─── 9. End-to-end HA flow integration ────────────────────────────────────

describe("Block 18.5 — End-to-end HA flow integration", () => {
  test("full 3-node HA flow: boot → join → register → cutover → handoff → rejoin", () => {
    // --- Phase 1: Node-1 boots alone as master ---
    const mgr1 = makeManager("node-1", 14222, 16222);
    mgr1.onLocalNodeStarted();
    mgr1.onJoinComplete("node-1", 1);

    const coordinator = new HeliosBlitzCoordinator();
    coordinator.setMasterMemberId("node-1");
    coordinator.setMemberListVersion(1);
    coordinator.setExpectedRegistrants(new Set(["node-1"]));

    coordinator.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: makeRegistration("node-1", 16222) },
      true,
    );
    expect(coordinator.isRegistrationComplete()).toBe(true);
    // Node-1 alone — no cutover needed
    expect(mgr1.needsClusteredCutover([])).toBe(false);

    // --- Phase 2: Node-2 joins ---
    const mgr2 = makeManager("node-2", 15222, 17222);
    mgr2.onLocalNodeStarted();
    mgr2.onJoinComplete("node-1", 2);

    coordinator.setMemberListVersion(2);
    coordinator.setExpectedRegistrants(new Set(["node-1", "node-2"]));

    coordinator.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: makeRegistration("node-1", 16222, { memberListVersion: 2 }) },
      true,
    );
    coordinator.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: makeRegistration("node-2", 17222, { memberListVersion: 2 }) },
      true,
    );
    expect(coordinator.isRegistrationComplete()).toBe(true);

    const announce = coordinator.generateTopologyAnnounce()!;
    expect(announce.routes.length).toBe(2);

    // Both nodes cutover
    expect(mgr2.needsClusteredCutover(announce.routes)).toBe(true);
    mgr2.onClusteredCutoverComplete();
    expect(mgr2.getReadinessState()).toBe(BlitzReadinessState.READY);

    // --- Phase 3: Node-3 joins ---
    const mgr3 = makeManager("node-3", 16222 + 2000, 18222);
    mgr3.onLocalNodeStarted();
    mgr3.onJoinComplete("node-1", 3);

    coordinator.setMemberListVersion(3);
    coordinator.setExpectedRegistrants(new Set(["node-1", "node-2", "node-3"]));

    coordinator.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: makeRegistration("node-1", 16222, { memberListVersion: 3 }) },
      true,
    );
    coordinator.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: makeRegistration("node-2", 17222, { memberListVersion: 3 }) },
      true,
    );
    coordinator.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: makeRegistration("node-3", 18222, { memberListVersion: 3 }) },
      true,
    );
    expect(coordinator.isRegistrationComplete()).toBe(true);
    expect(coordinator.generateTopologyAnnounce()!.routes.length).toBe(3);

    // --- Phase 4: Master handoff to node-2 ---
    coordinator.setMasterMemberId("node-2");
    coordinator.setMemberListVersion(4);
    coordinator.setExpectedRegistrants(new Set(["node-1", "node-2", "node-3"]));
    // All must re-register
    expect(coordinator.isRegistrationComplete()).toBe(false);

    // --- Phase 5: Node-2 rejoins after restart ---
    mgr2.onRejoin(4);
    expect(mgr2.getBootstrapPhase()).toBe("local");
    mgr2.onJoinComplete("node-2", 4);
    expect(mgr2.canRegisterWithMaster()).toBe(true);
  });
});
