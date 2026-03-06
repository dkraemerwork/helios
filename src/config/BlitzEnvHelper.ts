/**
 * Environment variable helper for Helios Blitz runtime configuration.
 *
 * Resolves `HeliosBlitzRuntimeConfig` from env vars, enabling
 * `HELIOS_BLITZ_MODE=distributed-auto` deployments without programmatic config.
 *
 * Env contract:
 *   HELIOS_BLITZ_ENABLED           — "true" to enable (default: false)
 *   HELIOS_BLITZ_MODE              — "distributed-auto" | "embedded-local" | "external"
 *   HELIOS_BLITZ_NATS_PORT         — client-facing port (default: 4222)
 *   HELIOS_BLITZ_NATS_CLUSTER_PORT — intra-cluster port (default: 6222)
 *   HELIOS_BLITZ_CLUSTER_NAME      — cluster name
 *   HELIOS_BLITZ_ADVERTISE_HOST    — routable host for multi-node
 *   HELIOS_BLITZ_BIND_HOST         — local bind host
 *   HELIOS_BLITZ_DATA_DIR          — JetStream storage directory
 *   HELIOS_BLITZ_DEFAULT_REPLICAS  — target replica count
 *   HELIOS_BLITZ_START_TIMEOUT_MS  — startup timeout in ms
 */
import type { HeliosBlitzRuntimeConfig } from "@zenystx/helios-core/config/BlitzRuntimeConfig";

const VALID_MODES = new Set(["distributed-auto", "embedded-local", "external"]);

export function resolveHeliosBlitzConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): HeliosBlitzRuntimeConfig {
  const enabled = env.HELIOS_BLITZ_ENABLED === "true";
  const mode = env.HELIOS_BLITZ_MODE;

  if (mode !== undefined && !VALID_MODES.has(mode)) {
    throw new Error(
      `Invalid HELIOS_BLITZ_MODE: '${mode}'. Must be one of: ${[...VALID_MODES].join(", ")}`,
    );
  }

  const config: HeliosBlitzRuntimeConfig = {
    enabled,
    mode: mode as HeliosBlitzRuntimeConfig["mode"],
    localPort: env.HELIOS_BLITZ_NATS_PORT
      ? parseInt(env.HELIOS_BLITZ_NATS_PORT, 10)
      : undefined,
    localClusterPort: env.HELIOS_BLITZ_NATS_CLUSTER_PORT
      ? parseInt(env.HELIOS_BLITZ_NATS_CLUSTER_PORT, 10)
      : undefined,
    clusterName: env.HELIOS_BLITZ_CLUSTER_NAME,
    advertiseHost: env.HELIOS_BLITZ_ADVERTISE_HOST,
    bindHost: env.HELIOS_BLITZ_BIND_HOST,
    dataDir: env.HELIOS_BLITZ_DATA_DIR,
    defaultReplicas: env.HELIOS_BLITZ_DEFAULT_REPLICAS
      ? parseInt(env.HELIOS_BLITZ_DEFAULT_REPLICAS, 10)
      : undefined,
    startTimeoutMs: env.HELIOS_BLITZ_START_TIMEOUT_MS
      ? parseInt(env.HELIOS_BLITZ_START_TIMEOUT_MS, 10)
      : undefined,
  };

  return config;
}
