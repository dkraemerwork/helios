/**
 * Configuration for the Helios Blitz stream processing engine.
 *
 * Controls NATS server connection, KV bucket naming, JetStream stream defaults,
 * and checkpoint / fault-tolerance settings.
 */
export interface BlitzConfig {
    /**
     * NATS server URL(s). Accepts a single URL string or array of URLs for cluster connections.
     * @default 'nats://localhost:4222'
     */
    readonly servers: string | string[];

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

/**
 * Resolved BlitzConfig with all defaults applied.
 */
export interface ResolvedBlitzConfig extends Required<BlitzConfig> {}

/**
 * Apply defaults to a partial BlitzConfig to produce a ResolvedBlitzConfig.
 */
export function resolveBlitzConfig(config: BlitzConfig): ResolvedBlitzConfig {
    return {
        servers: config.servers,
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
