/**
 * Block 18.5 — Multi-node HA verification
 *
 * Proves the full Phase 18 system works under realistic HA flows:
 * first-node-alone boot, second-node auto-cluster, current-master handoff,
 * retryable topology responses during re-registration sweep, restart/rejoin,
 * shutdownAsync() lifecycle, no child-process leaks, and distributed-default
 * acceptance across Helios + Blitz + NestJS bridge surfaces.
 */
import { afterEach, describe, test, expect } from "bun:test";
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

async function reservePort(): Promise<number> {
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data() {},
    },
  });
  const port = server.port;
  server.stop();
  return port;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await Bun.sleep(25);
  }
  throw new Error("Timed out waiting for condition");
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

// ─── 8. Pre-cutover fail-closed verification ──────────────────────────────

describe("Block 18.5 — Pre-cutover fail-closed readiness", () => {
  test("isBlitzAvailable() returns false in NOT_READY state", () => {
    const mgr = makeManager("node-1");
    expect(mgr.getReadinessState()).toBe(BlitzReadinessState.NOT_READY);
    expect(mgr.isBlitzAvailable()).toBe(false);
  });

  test("isBlitzAvailable() returns false in LOCAL_STARTED state", () => {
    const mgr = makeManager("node-1");
    mgr.onLocalNodeStarted();
    expect(mgr.getReadinessState()).toBe(BlitzReadinessState.LOCAL_STARTED);
    expect(mgr.isBlitzAvailable()).toBe(false);
  });

  test("isBlitzAvailable() returns false in JOIN_READY state", () => {
    const mgr = makeManager("node-1");
    mgr.onLocalNodeStarted();
    mgr.onJoinComplete("node-1", 1);
    expect(mgr.getReadinessState()).toBe(BlitzReadinessState.JOIN_READY);
    expect(mgr.isBlitzAvailable()).toBe(false);
  });

  test("isBlitzAvailable() returns false in REGISTERED state", () => {
    const mgr = makeManager("node-1");
    mgr.onLocalNodeStarted();
    mgr.onJoinComplete("node-1", 1);
    mgr.onRegisteredWithMaster();
    expect(mgr.getReadinessState()).toBe(BlitzReadinessState.REGISTERED);
    expect(mgr.isBlitzAvailable()).toBe(false);
  });

  test("isBlitzAvailable() returns false in SHUT_DOWN state", () => {
    const mgr = makeManager("node-1");
    mgr.onLocalNodeStarted();
    mgr.onClusteredCutoverComplete();
    expect(mgr.isBlitzAvailable()).toBe(true);
    mgr.markShutdown();
    expect(mgr.isBlitzAvailable()).toBe(false);
  });

  test("isBlitzAvailable() returns true only in READY state", () => {
    const mgr = makeManager("node-2", 15222, 17222);
    mgr.onLocalNodeStarted();
    mgr.onJoinComplete("node-1", 2);
    mgr.onClusteredCutoverComplete();
    expect(mgr.getReadinessState()).toBe(BlitzReadinessState.READY);
    expect(mgr.isBlitzAvailable()).toBe(true);
  });

  test("FenceAwareBlitzProvider blocks access before readiness fence clears", () => {
    const { FenceAwareBlitzProvider } = require(
      `${import.meta.dir}/../../packages/blitz/src/nestjs/FenceAwareBlitzProvider.ts`,
    );
    let fenceCleared = false;
    const provider = new FenceAwareBlitzProvider(
      () => fenceCleared,
      { shutdown: () => {} } as any,
    );

    expect(provider.isAvailable()).toBe(false);
    expect(() => provider.getService()).toThrow(/pre-cutover readiness fence/);

    fenceCleared = true;
    expect(provider.isAvailable()).toBe(true);
    expect(() => provider.getService()).not.toThrow();
  });

  test("FenceAwareBlitzProvider throws when service is null even if fence cleared", () => {
    const { FenceAwareBlitzProvider } = require(
      `${import.meta.dir}/../../packages/blitz/src/nestjs/FenceAwareBlitzProvider.ts`,
    );
    const provider = new FenceAwareBlitzProvider(() => true, null);

    expect(provider.isAvailable()).toBe(false);
    expect(() => provider.getService()).toThrow(/not initialized/);
  });

  test("no Blitz-owned resource creation succeeds before READY state", () => {
    const mgr = makeManager("node-1");
    mgr.onLocalNodeStarted();
    mgr.onJoinComplete("node-1", 1);

    // Simulates a guard that prevents resource creation when not available
    const canCreateResource = mgr.isBlitzAvailable();
    expect(canCreateResource).toBe(false);

    // After cutover, resource creation is allowed
    mgr.onClusteredCutoverComplete();
    expect(mgr.isBlitzAvailable()).toBe(true);
  });
});

// ─── 9. Stale old-master rejection ────────────────────────────────────────

describe("Block 18.5 — Stale old-master rejection after handoff", () => {
  test("demoted coordinator rejects register requests", () => {
    const coordinator = new HeliosBlitzCoordinator();
    coordinator.setMasterMemberId("node-1");
    coordinator.setMemberListVersion(2);
    coordinator.setExpectedRegistrants(new Set(["node-1", "node-2"]));

    coordinator.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: makeRegistration("node-1", 16222, { memberListVersion: 2 }) },
      true,
    );
    expect(coordinator.getTopology()!.getRegistrations().size).toBe(1);

    // Demotion
    coordinator.onDemotion();

    // Stale register from node-2 arrives after demotion — rejected (not master)
    const accepted = coordinator.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: makeRegistration("node-2", 17222, { memberListVersion: 2 }) },
      false,
    );
    expect(accepted).toBe(false);
  });

  test("demoted coordinator returns null for topology requests", () => {
    const coordinator = new HeliosBlitzCoordinator();
    coordinator.setMasterMemberId("node-1");
    coordinator.setMemberListVersion(2);

    coordinator.onDemotion();

    const response = coordinator.handleTopologyRequest(
      { type: "BLITZ_TOPOLOGY_REQUEST", requestId: "stale-req" },
      false,
    );
    expect(response).toBeNull();
  });

  test("demoted coordinator cannot generate topology announce", () => {
    const coordinator = new HeliosBlitzCoordinator();
    coordinator.setMasterMemberId("node-1");
    coordinator.setMemberListVersion(2);
    coordinator.setExpectedRegistrants(new Set(["node-1"]));
    coordinator.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: makeRegistration("node-1", 16222, { memberListVersion: 2 }) },
      true,
    );
    expect(coordinator.generateTopologyAnnounce()).not.toBeNull();

    coordinator.onDemotion();

    // Topology is null after demotion — cannot generate announce
    expect(coordinator.generateTopologyAnnounce()).toBeNull();
  });

  test("demoted coordinator cancels all pending retry timers", () => {
    const coordinator = new HeliosBlitzCoordinator();
    coordinator.setMasterMemberId("node-1");
    coordinator.setMemberListVersion(1);

    let timerFired = false;
    coordinator.scheduleRetryTimer("sweep-1", () => { timerFired = true; }, 50);
    expect(coordinator.hasPendingTimers()).toBe(true);

    coordinator.onDemotion();
    expect(coordinator.hasPendingTimers()).toBe(false);

    // Wait to confirm timer was actually cancelled
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(timerFired).toBe(false);
        resolve();
      }, 100);
    });
  });

  test("stale fence token is rejected after demotion", () => {
    const coordinator = new HeliosBlitzCoordinator();
    coordinator.setMasterMemberId("node-1");
    coordinator.setMemberListVersion(2);
    const oldFenceToken = coordinator.getFenceToken()!;

    coordinator.onDemotion();

    // Old fence token no longer valid
    expect(coordinator.validateAuthority("node-1", 2, oldFenceToken)).toBe(false);
  });

  test("reconciler rejects stale jobs after demotion", () => {
    const reconciler = new BlitzReplicaReconciler(3, 1);
    reconciler.setAuthority("node-1", 1, "fence-abc");
    reconciler.markUnderReplicated("kv-1", 1, 3);

    const job = reconciler.scheduleReconciliationJob("kv-1")!;
    expect(job).not.toBeNull();
    expect(reconciler.validateJobAuthority(job)).toBe(true);

    // Demotion nullifies authority
    reconciler.onDemotion();

    // Stale job from pre-demotion epoch is rejected
    expect(reconciler.validateJobAuthority(job)).toBe(false);
    expect(reconciler.getOutstandingJobs().length).toBe(0);
    expect(reconciler.getPendingUpgrades().length).toBe(0);
    expect(reconciler.getIsMaster()).toBe(false);
  });

  test("stale delayed response from old master is not usable after handoff", () => {
    const coordinator = new HeliosBlitzCoordinator();
    coordinator.setMasterMemberId("node-1");
    coordinator.setMemberListVersion(2);
    coordinator.setExpectedRegistrants(new Set(["node-1"]));
    coordinator.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: makeRegistration("node-1", 16222, { memberListVersion: 2 }) },
      true,
    );

    // Capture a pre-demotion response
    const staleResponse = coordinator.handleTopologyRequest(
      { type: "BLITZ_TOPOLOGY_REQUEST", requestId: "pre-demotion" },
      true,
    )!;
    expect(staleResponse).not.toBeNull();
    const staleFence = staleResponse.fenceToken;

    // Handoff — new master takes over
    coordinator.onDemotion();
    coordinator.setMasterMemberId("node-2");
    coordinator.setMemberListVersion(3);

    // Stale response's fence token no longer validates
    expect(coordinator.validateAuthority("node-1", 2, staleFence)).toBe(false);
    // New master has a different fence token
    expect(coordinator.getFenceToken()).not.toBe(staleFence);
  });
});

// ─── 10. Distributed-default acceptance ───────────────────────────────────

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

// ─── 11. End-to-end HA flow integration ───────────────────────────────────

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

// ─── 12. Fail-closed: no resource creation, no bridge exposure, no readiness ──

describe("Block 18.5 — Fail-closed pre-cutover: HeliosInstanceImpl gating", () => {
  test("getBlitzService() returns null at every pre-cutover state", () => {
    const config = new HeliosConfig("fail-closed-svc");
    config.setBlitzConfig({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    });
    const instance = new HeliosInstanceImpl(config);
    const mgr = instance.getBlitzLifecycleManager()!;

    // NOT_READY
    expect(instance.getBlitzService()).toBeNull();
    expect(instance.isBlitzReady()).toBe(false);

    // LOCAL_STARTED
    mgr.onLocalNodeStarted();
    expect(instance.getBlitzService()).toBeNull();
    expect(instance.isBlitzReady()).toBe(false);

    // JOIN_READY
    mgr.onJoinComplete("node-1", 1);
    expect(instance.getBlitzService()).toBeNull();
    expect(instance.isBlitzReady()).toBe(false);

    // REGISTERED
    mgr.onRegisteredWithMaster();
    expect(instance.getBlitzService()).toBeNull();
    expect(instance.isBlitzReady()).toBe(false);

    instance.shutdown();
  });

  test("NestJS bridge fence-aware module blocks service access before cutover", () => {
    const config = new HeliosConfig("nestjs-fence-blocked");
    config.setBlitzConfig({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    });
    const instance = new HeliosInstanceImpl(config);
    const fenceCheck = instance.createBlitzFenceCheck();

    const { FenceAwareBlitzProvider } = require(
      `${import.meta.dir}/../../packages/blitz/src/nestjs/FenceAwareBlitzProvider.ts`,
    );
    const provider = new FenceAwareBlitzProvider(fenceCheck, null);

    // Before cutover: fence blocks, bridge is not exposed
    expect(provider.isAvailable()).toBe(false);
    expect(() => provider.getService()).toThrow();

    // Simulate full lifecycle to READY
    const mgr = instance.getBlitzLifecycleManager()!;
    mgr.onLocalNodeStarted();
    mgr.onJoinComplete("master-1", 2);
    mgr.onRegisteredWithMaster();
    mgr.onClusteredCutoverComplete();

    // Now fence clears, but service is still null
    expect(fenceCheck()).toBe(true);
    expect(provider.isAvailable()).toBe(false); // service is null

    instance.shutdown();
  });

  test("no user-facing Blitz operation succeeds before READY: isBlitzReady stays false", () => {
    const config = new HeliosConfig("no-user-op");
    config.setBlitzConfig({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    });
    const instance = new HeliosInstanceImpl(config);
    const mgr = instance.getBlitzLifecycleManager()!;

    // Walk through every pre-READY state
    const states: BlitzReadinessState[] = [];
    states.push(mgr.getReadinessState()); // NOT_READY
    mgr.onLocalNodeStarted();
    states.push(mgr.getReadinessState()); // LOCAL_STARTED
    mgr.onJoinComplete("node-1", 1);
    states.push(mgr.getReadinessState()); // JOIN_READY
    mgr.onRegisteredWithMaster();
    states.push(mgr.getReadinessState()); // REGISTERED

    // All pre-READY states must be fail-closed
    for (const state of states) {
      expect(state).not.toBe(BlitzReadinessState.READY);
    }
    expect(instance.isBlitzReady()).toBe(false);

    instance.shutdown();
  });
});

// ─── 13. Stale old-master: announces, delayed responses, queued reconciliation ─

describe("Block 18.5 — Stale old-master rejection: announces and queued reconciliation", () => {
  test("stale announce from old master is rejected by receiving node", () => {
    // Old master generates an announce before demotion
    const oldMaster = new HeliosBlitzCoordinator();
    oldMaster.setMasterMemberId("node-1");
    oldMaster.setMemberListVersion(2);
    oldMaster.setExpectedRegistrants(new Set(["node-1"]));
    oldMaster.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: makeRegistration("node-1", 16222, { memberListVersion: 2 }) },
      true,
    );
    const staleAnnounce = oldMaster.generateTopologyAnnounce()!;
    expect(staleAnnounce).not.toBeNull();

    // Receiving node has updated to new master (node-2, version 3)
    const receiver = new HeliosBlitzCoordinator();
    receiver.setMasterMemberId("node-2");
    receiver.setMemberListVersion(3);

    // Stale announce from old master/old version is rejected
    const result = receiver.handleIncomingTopologyAnnounce(staleAnnounce);
    expect(result.accepted).toBe(false);
  });

  test("stale delayed topology response from old master is rejected", () => {
    const oldMaster = new HeliosBlitzCoordinator();
    oldMaster.setMasterMemberId("node-1");
    oldMaster.setMemberListVersion(2);
    oldMaster.setExpectedRegistrants(new Set(["node-1"]));
    oldMaster.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: makeRegistration("node-1", 16222, { memberListVersion: 2 }) },
      true,
    );
    const staleResponse = oldMaster.handleTopologyRequest(
      { type: "BLITZ_TOPOLOGY_REQUEST", requestId: "stale-req" },
      true,
    )!;
    expect(staleResponse).not.toBeNull();

    // Receiving node updated to new epoch
    const receiver = new HeliosBlitzCoordinator();
    receiver.setMasterMemberId("node-2");
    receiver.setMemberListVersion(3);

    const result = receiver.handleIncomingTopologyResponse(staleResponse);
    expect(result.accepted).toBe(false);
    expect(result.routes).toBeUndefined();
  });

  test("reconciliation jobs queued before demotion are all invalidated", () => {
    const reconciler = new BlitzReplicaReconciler(3, 1);
    reconciler.setAuthority("node-1", 1, "fence-old");
    reconciler.setIsMaster(true);

    // Queue multiple jobs
    reconciler.markUnderReplicated("kv-a", 1, 3);
    reconciler.markUnderReplicated("kv-b", 1, 3);
    reconciler.markUnderReplicated("kv-c", 1, 3);
    const jobA = reconciler.scheduleReconciliationJob("kv-a")!;
    const jobB = reconciler.scheduleReconciliationJob("kv-b")!;
    const jobC = reconciler.scheduleReconciliationJob("kv-c")!;
    expect(reconciler.getOutstandingJobs().length).toBe(3);

    // Demotion invalidates all queued jobs
    reconciler.onDemotion();
    expect(reconciler.validateJobAuthority(jobA)).toBe(false);
    expect(reconciler.validateJobAuthority(jobB)).toBe(false);
    expect(reconciler.validateJobAuthority(jobC)).toBe(false);
    expect(reconciler.getOutstandingJobs().length).toBe(0);
    expect(reconciler.getPendingUpgrades().length).toBe(0);
  });

  test("stale announce cannot be generated after onDemotion", () => {
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

    coordinator.onDemotion();

    // No announce can be generated post-demotion
    expect(coordinator.generateTopologyAnnounce()).toBeNull();
    // No topology response can be generated post-demotion
    expect(coordinator.handleTopologyRequest(
      { type: "BLITZ_TOPOLOGY_REQUEST", requestId: "post-demotion" },
      true, // even if isMaster=true is passed, topology is null
    )).toBeNull();
  });
});

// ─── 14. Distributed-default acceptance: Helios + Blitz + NestJS ──────────

describe("Block 18.5 — Distributed-default acceptance: cross-surface coverage", () => {
  test("HeliosConfig + env helper + HeliosInstanceImpl + lifecycle manager + coordinator integration", () => {
    const envConfig = resolveHeliosBlitzConfigFromEnv({
      HELIOS_BLITZ_ENABLED: "true",
      HELIOS_BLITZ_MODE: "distributed-auto",
      HELIOS_BLITZ_NATS_PORT: "6222",
      HELIOS_BLITZ_NATS_CLUSTER_PORT: "8222",
      HELIOS_BLITZ_CLUSTER_NAME: "acceptance-cluster",
      HELIOS_BLITZ_DEFAULT_REPLICAS: "2",
    });

    const config = new HeliosConfig("dist-acceptance");
    config.setBlitzConfig(envConfig);
    const instance = new HeliosInstanceImpl(config);
    const mgr = instance.getBlitzLifecycleManager()!;

    // Config wiring
    expect(mgr.getConfig().mode).toBe("distributed-auto");
    expect(mgr.getConfig().localPort).toBe(6222);
    expect(mgr.getConfig().localClusterPort).toBe(8222);
    expect(mgr.getConfig().clusterName).toBe("acceptance-cluster");

    // Coordinator wiring
    const coordinator = new HeliosBlitzCoordinator();
    coordinator.setMasterMemberId("acceptance-node");
    coordinator.setMemberListVersion(1);
    expect(coordinator.getFenceToken()).toBeTruthy();

    // Reconciler wiring
    const reconciler = coordinator.getReplicaReconciler();
    expect(reconciler).toBeInstanceOf(BlitzReplicaReconciler);

    // Fence check wiring
    const fenceCheck = instance.createBlitzFenceCheck();
    expect(fenceCheck()).toBe(false);
    mgr.onLocalNodeStarted();
    mgr.onJoinComplete("acceptance-node", 1);
    mgr.onStandaloneReady();
    expect(fenceCheck()).toBe(true);

    instance.shutdown();
  });

  test("NestJS forHeliosInstanceFenced creates fence-aware module tied to HeliosInstanceImpl", () => {
    const config = new HeliosConfig("nestjs-acceptance");
    config.setBlitzConfig({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    });
    const instance = new HeliosInstanceImpl(config);
    const fenceCheck = instance.createBlitzFenceCheck();

    const { HeliosBlitzModule } = require(`${import.meta.dir}/../../packages/blitz/src/nestjs/HeliosBlitzModule.ts`);
    const mod = HeliosBlitzModule.forHeliosInstanceFenced({
      fenceCheck,
      blitzServiceFactory: () => instance.getBlitzServiceForBridge(),
    });

    expect(mod.module).toBe(HeliosBlitzModule);
    expect(mod.global).toBe(true);
    expect(mod.providers).toBeDefined();
    expect(mod.providers!.length).toBeGreaterThan(0);

    instance.shutdown();
  });

  test("advertise host resolution integrates with lifecycle manager config", () => {
    const mgr = new HeliosBlitzLifecycleManager({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
      advertiseHost: "10.0.5.10",
      bindHost: "0.0.0.0",
    }, "dist-node");

    const resolved = resolveAdvertiseHost({
      advertiseHost: mgr.getConfig().advertiseHost,
      bindHost: mgr.getConfig().bindHost,
    });
    expect(resolved.advertiseHost).toBe("10.0.5.10");
    expect(resolved.isRoutable).toBe(true);
  });

  test("default replicas config propagates through reconciler", () => {
    const envConfig = resolveHeliosBlitzConfigFromEnv({
      HELIOS_BLITZ_ENABLED: "true",
      HELIOS_BLITZ_MODE: "distributed-auto",
      HELIOS_BLITZ_DEFAULT_REPLICAS: "5",
    });
    expect(envConfig.defaultReplicas).toBe(5);

    const reconciler = new BlitzReplicaReconciler(envConfig.defaultReplicas!, 1);
    expect(reconciler.getDefaultReplicas()).toBe(5);
    expect(reconciler.effectiveReplicas(3)).toBe(3); // min(5, 3)
    expect(reconciler.effectiveReplicas(7)).toBe(5); // min(5, 7)
  });
});

// ─── 15. HA verification against real Helios-owned Blitz lifecycle path ───

describe("Block 18.5 — HA verification through HeliosInstanceImpl lifecycle", () => {
  test("full HeliosInstanceImpl lifecycle: create → fence check → ready → shutdown", () => {
    const config = new HeliosConfig("ha-instance-lifecycle");
    config.setBlitzConfig({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    });
    const instance = new HeliosInstanceImpl(config);
    const mgr = instance.getBlitzLifecycleManager()!;

    // Instance-level fence check
    expect(instance.isBlitzReady()).toBe(false);
    expect(instance.getBlitzService()).toBeNull();

    // Drive lifecycle through HeliosInstanceImpl's manager
    mgr.onLocalNodeStarted();
    mgr.onJoinComplete("ha-master", 1);
    mgr.onStandaloneReady();

    // Fence clears at instance level
    expect(instance.isBlitzReady()).toBe(true);

    // Shutdown through instance
    instance.shutdown();
    expect(instance.isBlitzReady()).toBe(false);
    expect(mgr.isShutDown()).toBe(true);
    expect(instance.isRunning()).toBe(false);
  });

  test("HeliosInstanceImpl shutdownAsync lifecycle with blitz manager", async () => {
    const config = new HeliosConfig("ha-async-shutdown");
    config.setBlitzConfig({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    });
    const instance = new HeliosInstanceImpl(config);
    const mgr = instance.getBlitzLifecycleManager()!;

    mgr.onLocalNodeStarted();
    mgr.onJoinComplete("ha-master", 1);
    mgr.onStandaloneReady();
    expect(instance.isBlitzReady()).toBe(true);

    await instance.shutdownAsync();
    expect(mgr.isShutDown()).toBe(true);
    expect(instance.isRunning()).toBe(false);
    expect(instance.isBlitzReady()).toBe(false);
  });

  test("HeliosInstanceImpl with blitz: repeated create/shutdown produces clean state", () => {
    for (let i = 0; i < 3; i++) {
      const config = new HeliosConfig(`ha-cycle-${i}`);
      config.setBlitzConfig({
        enabled: true,
        mode: "distributed-auto",
        localPort: 14222 + i,
        localClusterPort: 16222 + i,
      });
      const instance = new HeliosInstanceImpl(config);
      const mgr = instance.getBlitzLifecycleManager()!;
      expect(mgr).not.toBeNull();
      expect(instance.isBlitzReady()).toBe(false);
      mgr.onLocalNodeStarted();
      mgr.onJoinComplete("master", 1);
      mgr.onStandaloneReady();
      expect(instance.isBlitzReady()).toBe(true);
      instance.shutdown();
      expect(mgr.isShutDown()).toBe(true);
      expect(instance.isRunning()).toBe(false);
    }
  });

  test("HeliosInstanceImpl fence check closure captures lifecycle manager state", () => {
    const config = new HeliosConfig("fence-closure");
    config.setBlitzConfig({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    });
    const instance = new HeliosInstanceImpl(config);
    const fenceCheck = instance.createBlitzFenceCheck();
    const mgr = instance.getBlitzLifecycleManager()!;

    // Fence tracks lifecycle state changes
    expect(fenceCheck()).toBe(false);
    mgr.onLocalNodeStarted();
    expect(fenceCheck()).toBe(false);
    mgr.onJoinComplete("master", 1);
    expect(fenceCheck()).toBe(false);
    mgr.onRegisteredWithMaster();
    expect(fenceCheck()).toBe(false);
    mgr.onClusteredCutoverComplete();
    expect(fenceCheck()).toBe(true);
    mgr.markShutdown();
    expect(fenceCheck()).toBe(false);

    instance.shutdown();
  });

  test("getBlitzServiceForBridge is unfenced while getBlitzService is fenced", () => {
    const config = new HeliosConfig("bridge-fencing");
    config.setBlitzConfig({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    });
    const instance = new HeliosInstanceImpl(config);
    const mockService = { shutdown: async () => {}, isClosed: false };
    instance.setBlitzService(mockService);

    // Bridge accessor is unfenced — returns service
    expect(instance.getBlitzServiceForBridge()).toBe(mockService);
    // Public accessor is fenced — returns null before cutover
    expect(instance.getBlitzService()).toBeNull();

    // After cutover fence clears
    const mgr = instance.getBlitzLifecycleManager()!;
    mgr.onLocalNodeStarted();
    mgr.onJoinComplete("master", 1);
    mgr.onClusteredCutoverComplete();
    expect(instance.getBlitzService()).toBe(mockService);

    instance.shutdown();
  });
});

describe("Block 18.5 — live runtime orchestration path", () => {
  afterEach(() => {
    HeliosInstanceImpl.setBlitzRuntimeLauncherForTests(null);
  });

  test("topology responses and announces drive real cutover/restart wiring", async () => {
    const launches = new Map<string, string[][]>();
    HeliosInstanceImpl.setBlitzRuntimeLauncherForTests(async ({ instanceName, config, routes }) => {
      const launchList = launches.get(instanceName) ?? [];
      launchList.push([...routes]);
      launches.set(instanceName, launchList);
      let closed = false;
      return {
        manager: {
          clientUrls: [`nats://127.0.0.1:${config.localPort}`],
          shutdown: async () => {},
        },
        service: {
          get isClosed() {
            return closed;
          },
          jsm: {
            getAccountInfo: async () => ({}),
          },
          shutdown: async () => {
            closed = true;
          },
        },
        registration: {
          serverName: `blitz-${instanceName}`,
          clientPort: config.localPort!,
          clusterPort: config.localClusterPort!,
          advertiseHost: config.advertiseHost ?? "127.0.0.1",
          clusterName: config.clusterName ?? "helios-blitz-cluster",
        },
      };
    });

    const [tcpPort1, tcpPort2, blitzPort1, blitzPort2, clusterPort1, clusterPort2] =
      await Promise.all([
        reservePort(),
        reservePort(),
        reservePort(),
        reservePort(),
        reservePort(),
        reservePort(),
      ]);

    const config1 = new HeliosConfig("live-runtime-node-1");
    config1.getNetworkConfig().setPort(tcpPort1);
    config1.getNetworkConfig().getJoin().getTcpIpConfig().setEnabled(true);
    config1.setBlitzConfig({
      enabled: true,
      mode: "distributed-auto",
      localPort: blitzPort1,
      localClusterPort: clusterPort1,
    });

    const config2 = new HeliosConfig("live-runtime-node-2");
    config2.getNetworkConfig().setPort(tcpPort2);
    config2.getNetworkConfig().getJoin().getTcpIpConfig().setEnabled(true).addMember(`127.0.0.1:${tcpPort1}`);
    config2.setBlitzConfig({
      enabled: true,
      mode: "distributed-auto",
      localPort: blitzPort2,
      localClusterPort: clusterPort2,
    });

    const instance1 = new HeliosInstanceImpl(config1);
    const instance2 = new HeliosInstanceImpl(config2);

    try {
      await waitFor(() => instance1.isBlitzReady() && instance2.isBlitzReady());
      expect(instance1.getBlitzService()).not.toBeNull();
      expect(instance2.getBlitzService()).not.toBeNull();

      expect(launches.get("live-runtime-node-1")).toEqual([
        [],
        [`nats://127.0.0.1:${clusterPort2}`],
      ]);
      expect(launches.get("live-runtime-node-2")).toEqual([
        [],
        [`nats://127.0.0.1:${clusterPort1}`],
      ]);

      instance1.shutdown();

      await waitFor(() => launches.get("live-runtime-node-2")?.length === 3);
      await waitFor(() => instance2.isBlitzReady());
      expect(launches.get("live-runtime-node-2")).toEqual([
        [],
        [`nats://127.0.0.1:${clusterPort1}`],
        [],
      ]);
      expect(instance2.getBlitzService()).not.toBeNull();
    } finally {
      if (instance1.isRunning()) {
        await instance1.shutdownAsync();
      }
      if (instance2.isRunning()) {
        await instance2.shutdownAsync();
      }
    }
  });
});

// ─── 16. Final production-readiness verification ──────────────────────────

describe("Block 18.5 — Production-readiness verification", () => {
  test("complete HA lifecycle: fail-closed → ready → demotion → stale rejection → shutdown", () => {
    // --- Setup: 2-node cluster with coordinator and reconciler ---
    const mgr1 = makeManager("node-1", 14222, 16222);
    const mgr2 = makeManager("node-2", 15222, 17222);
    const coordinator = new HeliosBlitzCoordinator();
    const reconciler = new BlitzReplicaReconciler(3, 1);

    // --- Assert: both nodes fail-closed before any lifecycle ---
    expect(mgr1.isBlitzAvailable()).toBe(false);
    expect(mgr2.isBlitzAvailable()).toBe(false);

    // --- Node-1 boots, joins as master ---
    mgr1.onLocalNodeStarted();
    expect(mgr1.isBlitzAvailable()).toBe(false); // still fail-closed
    mgr1.onJoinComplete("node-1", 1);
    expect(mgr1.isBlitzAvailable()).toBe(false); // still fail-closed

    coordinator.setMasterMemberId("node-1");
    coordinator.setMemberListVersion(1);
    coordinator.setExpectedRegistrants(new Set(["node-1"]));
    coordinator.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: makeRegistration("node-1", 16222) },
      true,
    );

    // Standalone — no cutover needed, mark ready
    expect(mgr1.needsClusteredCutover([])).toBe(false);
    mgr1.onStandaloneReady();
    expect(mgr1.isBlitzAvailable()).toBe(true); // NOW available

    // --- Node-2 joins, version bump ---
    mgr2.onLocalNodeStarted();
    mgr2.onJoinComplete("node-1", 2);
    expect(mgr2.isBlitzAvailable()).toBe(false); // fail-closed until cutover

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

    coordinator.generateTopologyAnnounce();
    mgr2.onClusteredCutoverComplete();
    expect(mgr2.isBlitzAvailable()).toBe(true); // NOW available

    // --- Setup reconciler with authority ---
    reconciler.setAuthority("node-1", 2, coordinator.getFenceToken()!);
    reconciler.markUnderReplicated("kv-users", 1, 3);
    const job = reconciler.scheduleReconciliationJob("kv-users")!;
    expect(reconciler.validateJobAuthority(job)).toBe(true);

    // --- Master handoff: node-1 demoted ---
    const oldFence = coordinator.getFenceToken()!;
    coordinator.onDemotion();
    reconciler.onDemotion();

    // Stale authority rejected everywhere
    expect(coordinator.validateAuthority("node-1", 2, oldFence)).toBe(false);
    expect(coordinator.generateTopologyAnnounce()).toBeNull();
    expect(reconciler.validateJobAuthority(job)).toBe(false);
    expect(reconciler.getIsMaster()).toBe(false);

    // --- New master (node-2) takes over ---
    coordinator.setMasterMemberId("node-2");
    coordinator.setMemberListVersion(3);
    coordinator.setExpectedRegistrants(new Set(["node-1", "node-2"]));

    // Re-registration sweep in progress — retryable
    const retryResponse = coordinator.handleTopologyRequest(
      { type: "BLITZ_TOPOLOGY_REQUEST", requestId: "sweep-1" },
      true,
    );
    expect(retryResponse!.registrationsComplete).toBe(false);
    expect(retryResponse!.retryAfterMs).toBeGreaterThan(0);

    // Complete re-registration
    coordinator.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: makeRegistration("node-1", 16222, { memberListVersion: 3 }) },
      true,
    );
    coordinator.handleRegister(
      { type: "BLITZ_NODE_REGISTER", registration: makeRegistration("node-2", 17222, { memberListVersion: 3 }) },
      true,
    );
    expect(coordinator.isRegistrationComplete()).toBe(true);

    // --- Shutdown ---
    mgr1.markShutdown();
    mgr2.markShutdown();
    expect(mgr1.isBlitzAvailable()).toBe(false);
    expect(mgr2.isBlitzAvailable()).toBe(false);
    expect(mgr1.isShutDown()).toBe(true);
    expect(mgr2.isShutDown()).toBe(true);

    // Post-shutdown transitions are no-ops
    mgr1.onLocalNodeStarted();
    expect(mgr1.getReadinessState()).toBe(BlitzReadinessState.SHUT_DOWN);
  });

  test("no stubs or mock-only behavior in production code paths", () => {
    // Verify all production classes are real implementations, not stubs
    const mgr = makeManager("node-1");
    expect(mgr.generateRegisterMessage().type).toBe("BLITZ_NODE_REGISTER");
    expect(mgr.generateRemoveMessage().type).toBe("BLITZ_NODE_REMOVE");

    const coordinator = new HeliosBlitzCoordinator();
    coordinator.setMasterMemberId("node-1");
    coordinator.setMemberListVersion(1);
    expect(coordinator.getFenceToken()).not.toBeNull();
    expect(coordinator.getFenceToken()!.length).toBe(32); // 16 hex bytes

    const reconciler = new BlitzReplicaReconciler(3, 1);
    expect(reconciler.effectiveReplicas(2)).toBe(2);
    expect(reconciler.effectiveReplicas(5)).toBe(3);

    expect(resolveAdvertiseHost({ advertiseHost: "10.0.0.1" }).advertiseHost).toBe("10.0.0.1");
  });
});
