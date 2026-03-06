/**
 * Internal typed configuration for a single nats-server node.
 * Produced by `resolveEmbeddedConfig()` — not exposed to users directly.
 */
export interface NatsServerNodeConfig {
    /** Resolved path to the nats-server binary. */
    readonly binaryPath: string;
    /** Client-facing port (default: 4222). */
    readonly port: number;
    /** Intra-cluster routing port (default: 6222). Only used in cluster mode. 0 = disabled. */
    readonly clusterPort: number;
    /** Directory for JetStream file store. Undefined → in-memory mode. */
    readonly dataDir: string | undefined;
    /** Server name (must be unique per node). */
    readonly serverName: string;
    /** Cluster name shared by all nodes. Only used in cluster mode. */
    readonly clusterName: string | undefined;
    /** `-routes` URLs for all other cluster nodes. Empty array → single-node. */
    readonly routes: string[];
    /** Extra args passed verbatim to nats-server. */
    readonly extraArgs: string[];
    /** How long to wait for the server to become reachable (ms). */
    readonly startTimeoutMs: number;
    /** Host to bind listeners to. @default '0.0.0.0' (legacy) or '127.0.0.1' (cluster-node). */
    readonly bindHost?: string;
    /** Host advertised to other cluster members. When set and different from bindHost, adds --client_advertise / --cluster_advertise. */
    readonly advertiseHost?: string;
}
