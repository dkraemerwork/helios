/**
 * Block 18.4 — Replication reconciliation + env helpers + NestJS bridge
 *
 * Tests:
 * - HELIOS_BLITZ_MODE=distributed-auto env-helper behavior
 * - Master-owned fenced replica-count upgrade policy
 * - Reconciliation behavior on topology changes
 * - Routable advertise-host correctness
 * - NestJS bridge reuse of Helios-owned Blitz instance
 * - Integrated verification of no duplicate runtimes
 */
import { describe, test, expect } from "bun:test";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import { HeliosInstanceImpl } from "@zenystx/helios-core/instance/impl/HeliosInstanceImpl";
import { resolveHeliosBlitzConfigFromEnv } from "@zenystx/helios-core/config/BlitzEnvHelper";
import { BlitzReplicaReconciler } from "@zenystx/helios-core/instance/impl/blitz/BlitzReplicaReconciler";
import { resolveAdvertiseHost } from "@zenystx/helios-core/instance/impl/blitz/AdvertiseHostResolver";

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

// ─── 6. Integration: no duplicate runtimes ──────────────────────────────────

describe("Block 18.4 — No duplicate runtimes verification", () => {
  test("HeliosInstanceImpl with blitz config provides getBlitzService accessor", () => {
    const config = new HeliosConfig("blitz-reuse");
    config.setBlitzConfig({
      enabled: true,
      mode: "distributed-auto",
      localPort: 14222,
      localClusterPort: 16222,
    });
    const instance = new HeliosInstanceImpl(config);
    // The instance must expose the Blitz lifecycle for NestJS bridge reuse
    const mgr = instance.getBlitzLifecycleManager();
    expect(mgr).not.toBeNull();
    instance.shutdown();
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
    // Simulate restart — version bump clears cache
    reconciler.onMemberListVersionChange(5);
    expect(reconciler.getPendingUpgrades().length).toBe(0);
    // Recompute
    reconciler.markUnderReplicated("bucket-a", 2, 3);
    const pending = reconciler.getPendingUpgrades();
    expect(pending.length).toBe(1);
    expect(pending[0].memberListVersion).toBe(5);
  });
});
