/**
 * Configuration for the Helios Blitz stream processing engine.
 *
 * Controls NATS server connection, KV bucket naming, JetStream stream defaults,
 * and checkpoint / fault-tolerance settings.
 */

/**
 * Configuration for an embedded nats-server instance.
 * Mutually exclusive with providing `servers` directly in BlitzConfig.
 */
export interface EmbeddedNatsConfig {
    /**
     * TCP port for client connections.
     * @default 4222
     */
    readonly port?: number;

    /**
     * Directory for JetStream persistent file storage.
     * Omit for in-memory mode (ephemeral — data lost on shutdown).
     * Provide an absolute path for persistence across restarts.
     */
    readonly dataDir?: string;

    /**
     * Override the resolved nats-server binary path.
     * Useful for air-gapped environments or custom builds.
     * Default: resolved via npm package → system PATH.
     */
    readonly binaryPath?: string;

    /**
     * Maximum time to wait for the embedded server to become reachable (ms).
     * @default 10_000
     */
    readonly startTimeoutMs?: number;

    /**
     * Extra arguments passed verbatim to the nats-server process.
     * Use for advanced tuning not covered by typed options.
     */
    readonly extraArgs?: string[];
}

/**
 * Configuration for a multi-node embedded NATS JetStream cluster.
 * When provided, BlitzService.start() spawns `nodes` nats-server processes
 * and links them via Raft-based cluster routing.
 *
 * Mutually exclusive with `embedded` (use one or the other).
 */
export interface NatsClusterConfig {
    /**
     * Number of cluster nodes to spawn.
     * Must be odd (1, 3, 5) for correct Raft quorum.
     * @default 1
     */
    readonly nodes?: number;

    /**
     * Cluster name shared across all nodes.
     * @default 'helios-blitz-cluster'
     */
    readonly name?: string;

    /**
     * Base client port. Node i listens on `basePort + i`.
     * @default 4222
     */
    readonly basePort?: number;

    /**
     * Base intra-cluster routing port. Node i listens on `baseClusterPort + i`.
     * @default 6222
     */
    readonly baseClusterPort?: number;

    /**
     * Base directory for JetStream file storage.
     * Each node writes to `<dataDir>/node-<i>/`.
     * Omit for in-memory mode.
     */
    readonly dataDir?: string;

    /**
     * Override the nats-server binary path (same as EmbeddedNatsConfig.binaryPath).
     */
    readonly binaryPath?: string;

    /**
     * Maximum time to wait for ALL nodes to become reachable (ms).
     * @default 15_000
     */
    readonly startTimeoutMs?: number;
}

export interface BlitzConfig {
    /**
     * NATS server URL(s) for connecting to an external cluster.
     * Omit when using `embedded` or `cluster` (embedded mode).
     * Mutually exclusive with `embedded` and `cluster`.
     */
    readonly servers?: string | string[];

    /** Embed a single nats-server process. Mutually exclusive with `servers` and `cluster`. */
    readonly embedded?: EmbeddedNatsConfig;

    /** Embed a multi-node nats-server cluster. Mutually exclusive with `servers` and `embedded`. */
    readonly cluster?: NatsClusterConfig;

    /**
     * Prefix applied to all KV bucket names created by Blitz (e.g. window state buckets).
     * @default 'helios-blitz'
     */
    readonly kvBucketPrefix?: string;

    /**
     * Default stream retention policy for intermediate pipeline subjects.
     * 'limits' = retain by message count/age limits (JetStream default)
     * 'workqueue' = remove messages after single consumption
     * 'interest' = retain while there are active consumers
     * @default 'workqueue'
     */
    readonly streamRetention?: 'limits' | 'workqueue' | 'interest';

    /**
     * Default maximum age (milliseconds) for intermediate pipeline messages.
     * 0 = no age limit.
     * @default 0
     */
    readonly streamMaxAgeMs?: number;

    /**
     * Connection timeout in milliseconds.
     * @default 5000
     */
    readonly connectTimeoutMs?: number;

    /**
     * Reconnect wait time in milliseconds between reconnect attempts.
     * @default 2000
     */
    readonly reconnectWaitMs?: number;

    /**
     * Maximum number of reconnect attempts. -1 = unlimited.
     * @default -1
     */
    readonly maxReconnectAttempts?: number;

    /**
     * Pending outbound message limit in bytes for core NATS publishes during reconnect.
     * The NATS client buffers outbound messages during reconnect up to this limit.
     * @default 536870912  (512 MiB)
     */
    readonly natsPendingLimit?: number;

    /**
     * Number of acks between checkpoint writes (CheckpointManager).
     * A lower value = more frequent checkpoints = less replay on restart.
     * @default 100
     */
    readonly checkpointIntervalAcks?: number;

    /**
     * Time interval in milliseconds between checkpoint writes (CheckpointManager).
     * Whichever of acks or ms fires first triggers a checkpoint.
     * @default 5000
     */
    readonly checkpointIntervalMs?: number;
}

/** Resolved embedded config with numeric defaults applied but optional strings preserved. */
export interface ResolvedEmbeddedNatsConfig {
    readonly port: number;
    readonly dataDir: string | undefined;
    readonly binaryPath: string | undefined;
    readonly startTimeoutMs: number;
    readonly extraArgs: string[];
}

/** Resolved cluster config with numeric defaults applied but optional strings preserved. */
export interface ResolvedNatsClusterConfig {
    readonly nodes: number;
    readonly name: string;
    readonly basePort: number;
    readonly baseClusterPort: number;
    readonly dataDir: string | undefined;
    readonly binaryPath: string | undefined;
    readonly startTimeoutMs: number;
}

/**
 * Resolved BlitzConfig with all defaults applied.
 */
export interface ResolvedBlitzConfig {
    readonly servers: string | string[] | undefined;
    readonly embedded: ResolvedEmbeddedNatsConfig | undefined;
    readonly cluster: ResolvedNatsClusterConfig | undefined;
    readonly kvBucketPrefix: string;
    readonly streamRetention: 'limits' | 'workqueue' | 'interest';
    readonly streamMaxAgeMs: number;
    readonly connectTimeoutMs: number;
    readonly reconnectWaitMs: number;
    readonly maxReconnectAttempts: number;
    readonly natsPendingLimit: number;
    readonly checkpointIntervalAcks: number;
    readonly checkpointIntervalMs: number;
}

/**
 * Apply defaults to a partial BlitzConfig to produce a ResolvedBlitzConfig.
 */
export function resolveBlitzConfig(config: BlitzConfig): ResolvedBlitzConfig {
    const modes = [config.servers, config.embedded, config.cluster].filter(Boolean).length;

    if (modes === 0) {
        // Default: embedded single-node in-memory
        return resolveBlitzConfig({ ...config, embedded: {} });
    }

    if (modes > 1) {
        throw new Error(
            'BlitzConfig: specify exactly one of `servers`, `embedded`, or `cluster` — not multiple.',
        );
    }

    // Validate cluster config
    if (config.cluster) {
        const nodes = config.cluster.nodes ?? 1;
        if (nodes > 1 && nodes % 2 === 0) {
            throw new Error(
                `BlitzConfig cluster: nodes must be odd for correct Raft quorum (got ${nodes}).`,
            );
        }

        // N7 FIX: Validate port overlap
        const basePort = config.cluster.basePort ?? 4222;
        const baseClusterPort = config.cluster.baseClusterPort ?? 6222;
        const clientPorts = new Set(Array.from({ length: nodes }, (_, i) => basePort + i));
        const clusterPorts = new Set(Array.from({ length: nodes }, (_, i) => baseClusterPort + i));
        const overlapping = [...clientPorts].filter(p => clusterPorts.has(p));
        if (overlapping.length > 0) {
            throw new Error(
                `BlitzConfig cluster: client ports and cluster routing ports overlap at [${overlapping.join(', ')}]. ` +
                `Ensure basePort (${basePort}) and baseClusterPort (${baseClusterPort}) ranges do not intersect.`,
            );
        }
    }

    // Resolve embedded defaults
    const resolvedEmbedded = config.embedded
        ? {
            port: config.embedded.port ?? 4222,
            dataDir: config.embedded.dataDir,
            binaryPath: config.embedded.binaryPath,
            startTimeoutMs: config.embedded.startTimeoutMs ?? 10_000,
            extraArgs: config.embedded.extraArgs ?? [],
        } satisfies ResolvedEmbeddedNatsConfig
        : undefined;

    // Resolve cluster defaults
    const resolvedCluster = config.cluster
        ? {
            nodes: config.cluster.nodes ?? 1,
            name: config.cluster.name ?? 'helios-blitz-cluster',
            basePort: config.cluster.basePort ?? 4222,
            baseClusterPort: config.cluster.baseClusterPort ?? 6222,
            dataDir: config.cluster.dataDir,
            binaryPath: config.cluster.binaryPath,
            startTimeoutMs: config.cluster.startTimeoutMs ?? 15_000,
        } satisfies ResolvedNatsClusterConfig
        : undefined;

    return {
        servers: config.servers,
        embedded: resolvedEmbedded,
        cluster: resolvedCluster,
        kvBucketPrefix: config.kvBucketPrefix ?? 'helios-blitz',
        streamRetention: config.streamRetention ?? 'workqueue',
        streamMaxAgeMs: config.streamMaxAgeMs ?? 0,
        connectTimeoutMs: config.connectTimeoutMs ?? 5000,
        reconnectWaitMs: config.reconnectWaitMs ?? 2000,
        maxReconnectAttempts: config.maxReconnectAttempts ?? -1,
        natsPendingLimit: config.natsPendingLimit ?? 536_870_912,
        checkpointIntervalAcks: config.checkpointIntervalAcks ?? 100,
        checkpointIntervalMs: config.checkpointIntervalMs ?? 5000,
    };
}
