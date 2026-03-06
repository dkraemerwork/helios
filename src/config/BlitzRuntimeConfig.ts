/**
 * Helios-level Blitz runtime configuration for distributed-auto mode.
 */
export interface HeliosBlitzRuntimeConfig {
  enabled?: boolean;
  mode?: "embedded-local" | "distributed-auto" | "external";
  localPort?: number;
  localClusterPort?: number;
  clusterName?: string;
  dataDir?: string;
  advertiseHost?: string;
  bindHost?: string;
  startTimeoutMs?: number;
  defaultReplicas?: number;
}
