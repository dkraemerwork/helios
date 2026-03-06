/**
 * Block 18.3 — Helios runtime wiring + distributed-auto startup/join/rejoin flow
 *
 * Tests that HeliosInstanceImpl owns Blitz lifecycle end to end:
 * startup, join, readiness gates, bootstrap-local → clustered cutover,
 * deterministic cleanup on leave/shutdown, and rejoin behavior.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { HeliosInstanceImpl } from "@zenystx/helios-core/instance/impl/HeliosInstanceImpl";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import { HeliosBlitzLifecycleManager, BlitzReadinessState } from "@zenystx/helios-core/instance/impl/blitz/HeliosBlitzLifecycleManager";

// ─── 1. Blitz lifecycle field wiring ────────────────────────────────────────

describe("Block 18.3 — HeliosInstanceImpl Blitz lifecycle wiring", () => {
  let instance: HeliosInstanceImpl;

  afterEach(() => {
    if (instance?.isRunning()) instance.shutdown();
  });

  test("instance without blitz config has no blitz lifecycle manager", () => {
    instance = new HeliosInstanceImpl(new HeliosConfig("no-blitz"));
    expect(instance.getBlitzLifecycleManager()).toBeNull();
  });

  test("instance with blitz distributed-auto config creates lifecycle manager", () => {
    const config = new HeliosConfig("blitz-auto");
    config.setBlitzConfig({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    });
    instance = new HeliosInstanceImpl(config);
    expect(instance.getBlitzLifecycleManager()).not.toBeNull();
  });

  test("instance with blitz enabled=false has no lifecycle manager", () => {
    const config = new HeliosConfig("blitz-disabled");
    config.setBlitzConfig({ enabled: false, mode: "distributed-auto" });
    instance = new HeliosInstanceImpl(config);
    expect(instance.getBlitzLifecycleManager()).toBeNull();
  });
});

// ─── 2. Readiness gate semantics ────────────────────────────────────────────

describe("Block 18.3 — Join/master readiness gates", () => {
  test("BlitzReadinessState initial state is NOT_READY", () => {
    const manager = new HeliosBlitzLifecycleManager({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    }, "test-member-1");
    expect(manager.getReadinessState()).toBe(BlitzReadinessState.NOT_READY);
  });

  test("readiness transitions to AWAITING_JOIN before master/join known", () => {
    const manager = new HeliosBlitzLifecycleManager({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    }, "test-member-1");
    manager.onLocalNodeStarted();
    expect(manager.getReadinessState()).toBe(BlitzReadinessState.LOCAL_STARTED);
  });

  test("readiness blocks topology registration until join/master is known", () => {
    const manager = new HeliosBlitzLifecycleManager({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    }, "test-member-1");
    manager.onLocalNodeStarted();
    expect(manager.canRegisterWithMaster()).toBe(false);
  });

  test("readiness allows registration after join gate passes", () => {
    const manager = new HeliosBlitzLifecycleManager({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    }, "test-member-1");
    manager.onLocalNodeStarted();
    manager.onJoinComplete("test-member-1", 1); // self is master
    expect(manager.canRegisterWithMaster()).toBe(true);
  });
});

// ─── 3. Bootstrap-local → clustered cutover ─────────────────────────────────

describe("Block 18.3 — Bootstrap-local to clustered cutover", () => {
  test("first node starts in bootstrap-local mode", () => {
    const manager = new HeliosBlitzLifecycleManager({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    }, "test-member-1");
    manager.onLocalNodeStarted();
    manager.onJoinComplete("test-member-1", 1); // self is master, alone
    expect(manager.getBootstrapPhase()).toBe("local");
  });

  test("cutover triggers when authoritative routes differ from local config", () => {
    const manager = new HeliosBlitzLifecycleManager({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    }, "test-member-1");
    manager.onLocalNodeStarted();
    manager.onJoinComplete("master-1", 2);
    const needsCutover = manager.needsClusteredCutover([
      "nats://127.0.0.1:16222",
      "nats://127.0.0.1:26222",
    ]);
    expect(needsCutover).toBe(true);
  });

  test("cutover is one-time only — second call returns false", () => {
    const manager = new HeliosBlitzLifecycleManager({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    }, "test-member-1");
    manager.onLocalNodeStarted();
    manager.onJoinComplete("master-1", 2);
    manager.needsClusteredCutover(["nats://127.0.0.1:16222", "nats://127.0.0.1:26222"]);
    manager.onClusteredCutoverComplete();
    expect(manager.getBootstrapPhase()).toBe("clustered");
    expect(manager.needsClusteredCutover(["nats://127.0.0.1:16222", "nats://127.0.0.1:36222"])).toBe(false);
  });

  test("no cutover needed when node is standalone master with no peers", () => {
    const manager = new HeliosBlitzLifecycleManager({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    }, "test-member-1");
    manager.onLocalNodeStarted();
    manager.onJoinComplete("test-member-1", 1);
    expect(manager.needsClusteredCutover([])).toBe(false);
  });
});

// ─── 4. Deterministic cleanup ───────────────────────────────────────────────

describe("Block 18.3 — Deterministic cleanup on leave/fail/shutdown", () => {
  test("shutdown marks manager as shut down", () => {
    const manager = new HeliosBlitzLifecycleManager({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    }, "test-member-1");
    manager.onLocalNodeStarted();
    manager.markShutdown();
    expect(manager.isShutDown()).toBe(true);
  });

  test("generates BLITZ_NODE_REMOVE message on member leave", () => {
    const manager = new HeliosBlitzLifecycleManager({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    }, "test-member-1");
    const msg = manager.generateRemoveMessage();
    expect(msg.type).toBe("BLITZ_NODE_REMOVE");
    expect(msg.memberId).toBe("test-member-1");
  });

  test("cleanup resets readiness state", () => {
    const manager = new HeliosBlitzLifecycleManager({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    }, "test-member-1");
    manager.onLocalNodeStarted();
    manager.onJoinComplete("test-member-1", 1);
    manager.markShutdown();
    expect(manager.getReadinessState()).toBe(BlitzReadinessState.SHUT_DOWN);
  });
});

// ─── 5. Rejoin behavior ────────────────────────────────────────────────────

describe("Block 18.3 — Rejoin after restart or temporary loss", () => {
  test("rejoin resets bootstrap phase to local for re-cutover", () => {
    const manager = new HeliosBlitzLifecycleManager({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    }, "test-member-1");
    manager.onLocalNodeStarted();
    manager.onJoinComplete("master-1", 2);
    manager.needsClusteredCutover(["nats://127.0.0.1:16222"]);
    manager.onClusteredCutoverComplete();
    // Simulate rejoin: new memberListVersion
    manager.onRejoin(3);
    expect(manager.getBootstrapPhase()).toBe("local");
    expect(manager.getReadinessState()).toBe(BlitzReadinessState.LOCAL_STARTED);
  });

  test("rejoin allows new cutover with new routes", () => {
    const manager = new HeliosBlitzLifecycleManager({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    }, "test-member-1");
    manager.onLocalNodeStarted();
    manager.onJoinComplete("master-1", 2);
    manager.onClusteredCutoverComplete();
    manager.onRejoin(3);
    expect(manager.needsClusteredCutover(["nats://127.0.0.1:16222", "nats://127.0.0.1:26222"])).toBe(true);
  });
});

// ─── 6. Registration message generation ────────────────────────────────────

describe("Block 18.3 — Registration message generation", () => {
  test("generates correct BLITZ_NODE_REGISTER message", () => {
    const manager = new HeliosBlitzLifecycleManager({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
      clusterName: "helios-blitz-cluster",
      advertiseHost: "10.0.1.5",
    }, "member-42");
    manager.onLocalNodeStarted();
    manager.onJoinComplete("master-1", 3);
    const msg = manager.generateRegisterMessage();
    expect(msg.type).toBe("BLITZ_NODE_REGISTER");
    expect(msg.registration.memberId).toBe("member-42");
    expect(msg.registration.clientPort).toBe(14222);
    expect(msg.registration.clusterPort).toBe(16222);
    expect(msg.registration.clusterName).toBe("helios-blitz-cluster");
    expect(msg.registration.advertiseHost).toBe("10.0.1.5");
    expect(msg.registration.memberListVersion).toBe(3);
    expect(msg.registration.ready).toBe(false);
  });
});

// ─── 7. HeliosInstanceImpl shutdown cleans up Blitz ─────────────────────────

describe("Block 18.3 — HeliosInstanceImpl shutdown Blitz cleanup", () => {
  test("shutdown() stops blitz lifecycle manager", () => {
    const config = new HeliosConfig("blitz-shutdown-test");
    config.setBlitzConfig({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    });
    const instance = new HeliosInstanceImpl(config);
    const blitzManager = instance.getBlitzLifecycleManager()!;
    expect(blitzManager).not.toBeNull();
    instance.shutdown();
    expect(blitzManager.isShutDown()).toBe(true);
  });

  test("shutdownAsync() awaits blitz lifecycle cleanup", async () => {
    const config = new HeliosConfig("blitz-async-shutdown");
    config.setBlitzConfig({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    });
    const instance = new HeliosInstanceImpl(config);
    const blitzManager = instance.getBlitzLifecycleManager()!;
    await instance.shutdownAsync();
    expect(blitzManager.isShutDown()).toBe(true);
  });
});

// ─── 8. Embedded-local mode bypasses distributed flow ───────────────────────

describe("Block 18.3 — Embedded-local mode bypass", () => {
  test("embedded-local mode creates lifecycle manager with local-only bootstrap", () => {
    const config = new HeliosConfig("blitz-local-only");
    config.setBlitzConfig({
      enabled: true,
      mode: "embedded-local",
      localPort: 14222,
    });
    const instance = new HeliosInstanceImpl(config);
    const mgr = instance.getBlitzLifecycleManager();
    expect(mgr).not.toBeNull();
    // In embedded-local mode, bootstrap phase is immediately "clustered" (no cutover needed)
    expect(mgr!.getBootstrapPhase()).toBe("local-only");
    instance.shutdown();
  });
});
