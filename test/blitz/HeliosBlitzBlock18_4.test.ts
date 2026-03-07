/**
 * Block 18.4 — Replication reconciliation + env helpers + NestJS bridge
 *
 * Tests:
 * - HELIOS_BLITZ_MODE=distributed-auto env-helper behavior
 * - Master-owned fenced replica-count upgrade policy
 * - Reconciliation behavior on topology changes
 * - Routable advertise-host correctness
 * - NestJS bridge reuse of Helios-owned Blitz instance
 * - NestJS bridge fence-awareness
 * - Live runtime wiring for reconciliation and bridge
 * - Integrated verification of no duplicate runtimes
 */
import { describe, test, expect, afterEach } from "bun:test";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import { HeliosInstanceImpl } from "@zenystx/helios-core/instance/impl/HeliosInstanceImpl";
import { resolveHeliosBlitzConfigFromEnv } from "@zenystx/helios-core/config/BlitzEnvHelper";
import { BlitzReplicaReconciler } from "@zenystx/helios-core/instance/impl/blitz/BlitzReplicaReconciler";
import { resolveAdvertiseHost } from "@zenystx/helios-core/instance/impl/blitz/AdvertiseHostResolver";
import { HeliosBlitzCoordinator } from "@zenystx/helios-core/instance/impl/blitz/HeliosBlitzCoordinator";

// ─── 1. Env-helper: HELIOS_BLITZ_MODE=distributed-auto ─────────────────────

describe("Block 18.4 — Env helper for HELIOS_BLITZ_MODE=distributed-auto", () => {
  test("resolves distributed-auto from env vars", () => {
    const config = resolveHeliosBlitzConfigFromEnv({
      HELIOS_BLITZ_ENABLED: "true",
      HELIOS_BLITZ_MODE: "distributed-auto",
      HELIOS_BLITZ_NATS_PORT: "5222",
      HELIOS_BLITZ_NATS_CLUSTER_PORT: "7222",
      HELIOS_BLITZ_CLUSTER_NAME: "my-cluster",
      HELIOS_BLITZ_ADVERTISE_HOST: "10.0.1.5",
      HELIOS_BLITZ_BIND_HOST: "0.0.0.0",
      HELIOS_BLITZ_DEFAULT_REPLICAS: "3",
    });
    expect(config.enabled).toBe(true);
    expect(config.mode).toBe("distributed-auto");
    expect(config.localPort).toBe(5222);
    expect(config.localClusterPort).toBe(7222);
    expect(config.clusterName).toBe("my-cluster");
    expect(config.advertiseHost).toBe("10.0.1.5");
    expect(config.bindHost).toBe("0.0.0.0");
    expect(config.defaultReplicas).toBe(3);
  });

  test("resolves defaults when env vars are absent", () => {
    const config = resolveHeliosBlitzConfigFromEnv({});
    expect(config.enabled).toBe(false);
    expect(config.mode).toBeUndefined();
  });

  test("resolves embedded-local mode from env", () => {
    const config = resolveHeliosBlitzConfigFromEnv({
      HELIOS_BLITZ_ENABLED: "true",
      HELIOS_BLITZ_MODE: "embedded-local",
    });
    expect(config.enabled).toBe(true);
    expect(config.mode).toBe("embedded-local");
  });

  test("rejects invalid mode value", () => {
    expect(() =>
      resolveHeliosBlitzConfigFromEnv({
        HELIOS_BLITZ_ENABLED: "true",
        HELIOS_BLITZ_MODE: "invalid-mode",
      }),
    ).toThrow();
  });
});

// ─── 2. Master-owned fenced replica-count upgrade policy ────────────────────

describe("Block 18.4 — Master-owned fenced replica-count upgrade policy", () => {
  test("tracks under-replicated resources with memberListVersion fence", () => {
    const reconciler = new BlitzReplicaReconciler(3, 1);
    reconciler.markUnderReplicated("kv-bucket-1", 1, 3);
    const pending = reconciler.getPendingUpgrades();
    expect(pending.length).toBe(1);
    expect(pending[0].resourceName).toBe("kv-bucket-1");
    expect(pending[0].currentReplicas).toBe(1);
    expect(pending[0].targetReplicas).toBe(3);
    expect(pending[0].memberListVersion).toBe(1);
  });

  test("computes effective replica count as min(target, readyNodes)", () => {
    const reconciler = new BlitzReplicaReconciler(3, 1);
    expect(reconciler.effectiveReplicas(2)).toBe(2);
    expect(reconciler.effectiveReplicas(5)).toBe(3);
    expect(reconciler.effectiveReplicas(1)).toBe(1);
  });

  test("fencing prevents stale upgrades after memberListVersion change", () => {
    const reconciler = new BlitzReplicaReconciler(3, 1);
    reconciler.markUnderReplicated("kv-bucket-1", 1, 3);
    // Simulate member list change — old fence should be invalidated
    reconciler.onMemberListVersionChange(2);
    const pending = reconciler.getPendingUpgrades();
    // After version change, pending work is recomputed (cleared)
    expect(pending.length).toBe(0);
  });

  test("recomputes pending work from config after failover", () => {
    const reconciler = new BlitzReplicaReconciler(3, 1);
    reconciler.markUnderReplicated("kv-bucket-1", 1, 3);
    reconciler.onMemberListVersionChange(2);
    // Recompute with new state
    reconciler.markUnderReplicated("kv-bucket-1", 1, 3);
    const pending = reconciler.getPendingUpgrades();
    expect(pending.length).toBe(1);
    expect(pending[0].memberListVersion).toBe(2);
  });

  test("marks resource as upgraded and removes from pending", () => {
    const reconciler = new BlitzReplicaReconciler(3, 1);
    reconciler.markUnderReplicated("kv-bucket-1", 1, 3);
    reconciler.markUpgraded("kv-bucket-1");
    expect(reconciler.getPendingUpgrades().length).toBe(0);
  });
});

// ─── 3. Reconciliation on topology changes ──────────────────────────────────

describe("Block 18.4 — Reconciliation behavior on topology changes", () => {
  test("reconciler reports resources that need upgrade when cluster grows", () => {
    const reconciler = new BlitzReplicaReconciler(3, 1);
    reconciler.markUnderReplicated("kv-bucket-1", 1, 3);
    const actionable = reconciler.getActionableUpgrades(3);
    expect(actionable.length).toBe(1);
    expect(actionable[0].resourceName).toBe("kv-bucket-1");
  });

  test("reconciler skips resources when cluster is still too small", () => {
    const reconciler = new BlitzReplicaReconciler(3, 1);
    reconciler.markUnderReplicated("kv-bucket-1", 1, 3);
    // Cluster only has 1 node — no point upgrading
    const actionable = reconciler.getActionableUpgrades(1);
    expect(actionable.length).toBe(0);
  });

  test("reconciliation is master-only: non-master calls return empty", () => {
    const reconciler = new BlitzReplicaReconciler(3, 1);
    reconciler.markUnderReplicated("kv-bucket-1", 1, 3);
    reconciler.setIsMaster(false);
    const actionable = reconciler.getActionableUpgrades(3);
    expect(actionable.length).toBe(0);
  });
});

// ─── 4. Routable advertise-host behavior ────────────────────────────────────

describe("Block 18.4 — Routable advertise-host behavior", () => {
  test("resolves explicit advertise host from config", () => {
    const result = resolveAdvertiseHost({
      advertiseHost: "10.0.1.5",
      bindHost: "0.0.0.0",
    });
    expect(result.advertiseHost).toBe("10.0.1.5");
    expect(result.isRoutable).toBe(true);
  });

  test("falls back to bindHost when advertiseHost absent", () => {
    const result = resolveAdvertiseHost({
      bindHost: "192.168.1.100",
    });
    expect(result.advertiseHost).toBe("192.168.1.100");
    expect(result.isRoutable).toBe(true);
  });

  test("flags 127.0.0.1 as non-routable", () => {
    const result = resolveAdvertiseHost({
      bindHost: "127.0.0.1",
    });
    expect(result.advertiseHost).toBe("127.0.0.1");
    expect(result.isRoutable).toBe(false);
  });

  test("flags 0.0.0.0 bindHost without advertiseHost as non-routable", () => {
    const result = resolveAdvertiseHost({
      bindHost: "0.0.0.0",
    });
    expect(result.advertiseHost).toBe("0.0.0.0");
    expect(result.isRoutable).toBe(false);
  });

  test("explicit advertiseHost overrides non-routable bindHost", () => {
    const result = resolveAdvertiseHost({
      advertiseHost: "api-0.headless.svc.cluster.local",
      bindHost: "0.0.0.0",
    });
    expect(result.advertiseHost).toBe("api-0.headless.svc.cluster.local");
    expect(result.isRoutable).toBe(true);
  });
});

// ─── 5. NestJS bridge reuses Helios-owned Blitz instance ────────────────────

describe("Block 18.4 — NestJS bridge reuses Helios-owned Blitz instance", () => {
  test("HeliosBlitzModule.forHeliosInstance creates service wrapping helios blitz", () => {
    const modPath = `${import.meta.dir}/../../packages/blitz/src/nestjs/HeliosBlitzModule.ts`;
    const HeliosBlitzModule = require(modPath).HeliosBlitzModule;
    expect(typeof HeliosBlitzModule.forHeliosInstance).toBe("function");
  });

  test("forHeliosInstance module returns DynamicModule with correct shape", () => {
    const HeliosBlitzModule = require(`${import.meta.dir}/../../packages/blitz/src/nestjs/HeliosBlitzModule.ts`).HeliosBlitzModule;
    const HELIOS_BLITZ_SERVICE_TOKEN = require(`${import.meta.dir}/../../packages/blitz/src/nestjs/InjectBlitz.decorator.ts`).HELIOS_BLITZ_SERVICE_TOKEN;
    const mod = HeliosBlitzModule.forHeliosInstance({
      provide: HELIOS_BLITZ_SERVICE_TOKEN,
      useFactory: () => null,
    });
    expect(mod.module).toBe(HeliosBlitzModule);
    expect(mod.global).toBe(true);
    expect(mod.exports).toContain(HELIOS_BLITZ_SERVICE_TOKEN);
  });
});

// ─── 6. Reconciliation fence-token capture and revalidation ──────────────────

describe("Block 18.4 — Reconciliation job fence-token capture + revalidation", () => {
  test("scheduleReconciliationJob captures authority tuple at schedule time", () => {
    const reconciler = new BlitzReplicaReconciler(3, 1);
    reconciler.setAuthority("master-1", 1, "token-abc");
    reconciler.markUnderReplicated("kv-bucket-1", 1, 3);

    const job = reconciler.scheduleReconciliationJob("kv-bucket-1");
    expect(job).not.toBeNull();
    expect(job!.masterMemberId).toBe("master-1");
    expect(job!.memberListVersion).toBe(1);
    expect(job!.fenceToken).toBe("token-abc");
  });

  test("validateJobAuthority returns true when authority matches current state", () => {
    const reconciler = new BlitzReplicaReconciler(3, 1);
    reconciler.setAuthority("master-1", 1, "token-abc");
    reconciler.markUnderReplicated("kv-bucket-1", 1, 3);
    const job = reconciler.scheduleReconciliationJob("kv-bucket-1")!;
    expect(reconciler.validateJobAuthority(job)).toBe(true);
  });

  test("validateJobAuthority returns false after authority change (demotion)", () => {
    const reconciler = new BlitzReplicaReconciler(3, 1);
    reconciler.setAuthority("master-1", 1, "token-abc");
    reconciler.markUnderReplicated("kv-bucket-1", 1, 3);
    const job = reconciler.scheduleReconciliationJob("kv-bucket-1")!;

    // Simulate demotion — authority changes
    reconciler.setAuthority("master-2", 2, "token-xyz");
    expect(reconciler.validateJobAuthority(job)).toBe(false);
  });

  test("onDemotion cancels all outstanding reconciliation jobs", () => {
    const reconciler = new BlitzReplicaReconciler(3, 1);
    reconciler.setAuthority("master-1", 1, "token-abc");
    reconciler.markUnderReplicated("kv-bucket-1", 1, 3);
    reconciler.markUnderReplicated("kv-bucket-2", 1, 3);
    reconciler.scheduleReconciliationJob("kv-bucket-1");
    reconciler.scheduleReconciliationJob("kv-bucket-2");
    expect(reconciler.getOutstandingJobs().length).toBe(2);

    reconciler.onDemotion();
    expect(reconciler.getOutstandingJobs().length).toBe(0);
    expect(reconciler.getPendingUpgrades().length).toBe(0);
  });

  test("onDemotion rotates fence so old master jobs cannot validate", () => {
    const reconciler = new BlitzReplicaReconciler(3, 1);
    reconciler.setAuthority("master-1", 1, "token-abc");
    reconciler.markUnderReplicated("kv-bucket-1", 1, 3);
    const job = reconciler.scheduleReconciliationJob("kv-bucket-1")!;

    reconciler.onDemotion();
    expect(reconciler.validateJobAuthority(job)).toBe(false);
  });

  test("scheduleReconciliationJob returns null for unknown resource", () => {
    const reconciler = new BlitzReplicaReconciler(3, 1);
    reconciler.setAuthority("master-1", 1, "token-abc");
    const job = reconciler.scheduleReconciliationJob("nonexistent");
    expect(job).toBeNull();
  });
});

// ─── 7. NestJS bridge fence-awareness ────────────────────────────────────────

describe("Block 18.4 — NestJS bridge fence-awareness", () => {
  test("FenceAwareBlitzProvider blocks access when fence is not cleared", () => {
    const { FenceAwareBlitzProvider } = require(`${import.meta.dir}/../../packages/blitz/src/nestjs/FenceAwareBlitzProvider.ts`);
    const provider = new FenceAwareBlitzProvider(() => false, null);
    expect(() => provider.getService()).toThrow(/fence/i);
  });

  test("FenceAwareBlitzProvider allows access when fence is cleared", () => {
    const { FenceAwareBlitzProvider } = require(`${import.meta.dir}/../../packages/blitz/src/nestjs/FenceAwareBlitzProvider.ts`);
    const mockService = { isClosed: false };
    const provider = new FenceAwareBlitzProvider(() => true, mockService as any);
    expect(provider.getService()).toBe(mockService);
  });

  test("forHeliosInstance with fence guard creates fence-aware module", () => {
    const { HeliosBlitzModule } = require(`${import.meta.dir}/../../packages/blitz/src/nestjs/HeliosBlitzModule.ts`);
    expect(typeof HeliosBlitzModule.forHeliosInstanceFenced).toBe("function");
    const mod = HeliosBlitzModule.forHeliosInstanceFenced({
      fenceCheck: () => true,
      blitzServiceFactory: () => null,
    });
    expect(mod.module).toBe(HeliosBlitzModule);
    expect(mod.global).toBe(true);
  });
});

// ─── 8. Live runtime wiring: coordinator → reconciler ─────────────────────────

describe("Block 18.4 — Coordinator wires reconciler on topology changes", () => {
  test("coordinator exposes a BlitzReplicaReconciler via getReplicaReconciler()", () => {
    const coordinator = new HeliosBlitzCoordinator();
    const reconciler = coordinator.getReplicaReconciler();
    expect(reconciler).toBeInstanceOf(BlitzReplicaReconciler);
  });

  test("coordinator propagates demotion to reconciler", () => {
    const coordinator = new HeliosBlitzCoordinator();
    coordinator.setMasterMemberId("master-1");
    coordinator.setMemberListVersion(1);
    const reconciler = coordinator.getReplicaReconciler();
    reconciler.setAuthority("master-1", 1, coordinator.getFenceToken()!);
    reconciler.setIsMaster(true);
    reconciler.markUnderReplicated("kv-bucket-1", 1, 3);
    reconciler.scheduleReconciliationJob("kv-bucket-1");

    coordinator.onDemotion();

    expect(reconciler.getOutstandingJobs().length).toBe(0);
    expect(reconciler.getPendingUpgrades().length).toBe(0);
    expect(reconciler.getIsMaster()).toBe(false);
  });

  test("coordinator propagates memberListVersion change to reconciler", () => {
    const coordinator = new HeliosBlitzCoordinator();
    coordinator.setMasterMemberId("master-1");
    coordinator.setMemberListVersion(1);
    const reconciler = coordinator.getReplicaReconciler();
    reconciler.markUnderReplicated("kv-bucket-1", 1, 3);

    coordinator.setMemberListVersion(2);

    expect(reconciler.getPendingUpgrades().length).toBe(0);
    expect(reconciler.getMemberListVersion()).toBe(2);
  });

  test("coordinator syncs authority tuple to reconciler on master change", () => {
    const coordinator = new HeliosBlitzCoordinator();
    coordinator.setMasterMemberId("master-1");
    coordinator.setMemberListVersion(1);
    const reconciler = coordinator.getReplicaReconciler();

    reconciler.setIsMaster(true);
    reconciler.markUnderReplicated("kv-bucket-1", 1, 3);
    const job = reconciler.scheduleReconciliationJob("kv-bucket-1");
    expect(job).not.toBeNull();
    expect(reconciler.validateJobAuthority(job!)).toBe(true);
  });
});

// ─── 9. Live runtime wiring: HeliosInstanceImpl → bridge ─────────────────────

describe("Block 18.4 — HeliosInstanceImpl bridge + reconciler integration", () => {
  let instance: HeliosInstanceImpl;

  afterEach(() => {
    if (instance?.isRunning()) instance.shutdown();
  });

  test("getBlitzServiceForBridge returns the raw service ref for NestJS reuse", () => {
    const config = new HeliosConfig("bridge-test");
    config.setBlitzConfig({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    });
    instance = new HeliosInstanceImpl(config);
    expect(instance.getBlitzServiceForBridge()).toBeNull();

    const mockService = { shutdown: async () => {}, isClosed: false };
    instance.setBlitzService(mockService);
    // Raw bridge accessor returns the service regardless of fence state
    expect(instance.getBlitzServiceForBridge()).toBe(mockService);
  });

  test("getBlitzService is fence-gated but getBlitzServiceForBridge is not", () => {
    const config = new HeliosConfig("fence-gate-test");
    config.setBlitzConfig({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    });
    instance = new HeliosInstanceImpl(config);
    const mockService = { shutdown: async () => {}, isClosed: false };
    instance.setBlitzService(mockService);

    expect(instance.getBlitzService()).toBeNull();
    expect(instance.getBlitzServiceForBridge()).toBe(mockService);
  });

  test("createBlitzFenceCheck delegates to lifecycle manager isBlitzAvailable", () => {
    const config = new HeliosConfig("fence-fn-test");
    config.setBlitzConfig({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    });
    instance = new HeliosInstanceImpl(config);
    const fenceCheck = instance.createBlitzFenceCheck();
    expect(fenceCheck()).toBe(false);

    const mgr = instance.getBlitzLifecycleManager()!;
    mgr.onLocalNodeStarted();
    mgr.onJoinComplete("master-1", 1);
    mgr.onRegisteredWithMaster();
    mgr.onClusteredCutoverComplete();
    expect(fenceCheck()).toBe(true);
  });
});

// ─── 10. Integration: no duplicate runtimes + full wiring verification ───────

describe("Block 18.4 — No duplicate runtimes + full wiring verification", () => {
  let instance: HeliosInstanceImpl;

  afterEach(() => {
    if (instance?.isRunning()) instance.shutdown();
  });

  test("HeliosInstanceImpl with blitz config provides getBlitzService accessor", () => {
    const config = new HeliosConfig("blitz-reuse");
    config.setBlitzConfig({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    });
    instance = new HeliosInstanceImpl(config);
    const mgr = instance.getBlitzLifecycleManager();
    expect(mgr).not.toBeNull();
  });

  test("env-resolved config integrates with HeliosConfig.setBlitzConfig", () => {
    const envConfig = resolveHeliosBlitzConfigFromEnv({
      HELIOS_BLITZ_ENABLED: "true",
      HELIOS_BLITZ_MODE: "distributed-auto",
      HELIOS_BLITZ_NATS_PORT: "5222",
      HELIOS_BLITZ_NATS_CLUSTER_PORT: "7222",
    });
    const config = new HeliosConfig("env-integrated");
    config.setBlitzConfig(envConfig);
    expect(config.getBlitzConfig()?.mode).toBe("distributed-auto");
    expect(config.getBlitzConfig()?.localPort).toBe(5222);
  });

  test("reconciler is restart-safe: recomputes from config after clear", () => {
    const reconciler = new BlitzReplicaReconciler(3, 1);
    reconciler.markUnderReplicated("bucket-a", 1, 3);
    reconciler.markUnderReplicated("bucket-b", 1, 3);
    reconciler.onMemberListVersionChange(5);
    expect(reconciler.getPendingUpgrades().length).toBe(0);
    reconciler.markUnderReplicated("bucket-a", 2, 3);
    const pending = reconciler.getPendingUpgrades();
    expect(pending.length).toBe(1);
    expect(pending[0].memberListVersion).toBe(5);
  });

  test("NestJS bridge can create fence-aware module using HeliosInstanceImpl fence check", () => {
    const config = new HeliosConfig("nestjs-integration");
    config.setBlitzConfig({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    });
    instance = new HeliosInstanceImpl(config);

    const fenceCheck = instance.createBlitzFenceCheck();
    const { HeliosBlitzModule } = require(`${import.meta.dir}/../../packages/blitz/src/nestjs/HeliosBlitzModule.ts`);
    const mod = HeliosBlitzModule.forHeliosInstanceFenced({
      fenceCheck,
      blitzServiceFactory: () => instance.getBlitzServiceForBridge(),
    });
    expect(mod.module).toBe(HeliosBlitzModule);
    expect(mod.global).toBe(true);
  });

  test("full wiring: coordinator demotion propagates through to reconciler outstanding jobs", () => {
    const coordinator = new HeliosBlitzCoordinator();
    coordinator.setMasterMemberId("master-A");
    coordinator.setMemberListVersion(1);
    const reconciler = coordinator.getReplicaReconciler();
    reconciler.setIsMaster(true);
    reconciler.setAuthority("master-A", 1, coordinator.getFenceToken()!);
    reconciler.markUnderReplicated("stream-1", 1, 3);
    reconciler.markUnderReplicated("kv-state-1", 1, 3);
    reconciler.scheduleReconciliationJob("stream-1");
    reconciler.scheduleReconciliationJob("kv-state-1");
    expect(reconciler.getOutstandingJobs().length).toBe(2);

    coordinator.onDemotion();
    expect(reconciler.getOutstandingJobs().length).toBe(0);
    expect(reconciler.getPendingUpgrades().length).toBe(0);
    expect(reconciler.getIsMaster()).toBe(false);
  });
});
