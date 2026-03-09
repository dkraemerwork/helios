/**
 * Central defaults registry for Hazelcast OSS 5.5.x.
 *
 * Every constant in this file is sourced from the Hazelcast 5.5.x open-source
 * codebase. The originating Java class is cited in each JSDoc comment.
 * Helios config classes import from here rather than embedding magic numbers.
 */

// ── Cluster identity ──────────────────────────────────────────────────────────

/**
 * Default cluster group name.
 * @source {@code com.hazelcast.config.Config.DEFAULT_CLUSTER_NAME = "dev"}
 */
export const DEFAULT_CLUSTER_NAME = "dev";

// ── Network / ports ───────────────────────────────────────────────────────────

/**
 * Default Hazelcast member port.
 * @source {@code com.hazelcast.config.NetworkConfig.DEFAULT_PORT = 5701}
 */
export const DEFAULT_PORT = 5701;

/**
 * Number of ports to try when auto-incrementing is enabled.
 * @source {@code com.hazelcast.config.NetworkConfig.PORT_COUNT = 100}
 */
export const DEFAULT_PORT_COUNT = 100;

// ── Socket options ────────────────────────────────────────────────────────────

/**
 * TCP_NODELAY enabled by default to reduce latency.
 * @source {@code com.hazelcast.config.SocketInterceptorConfig} / Hazelcast socket defaults
 */
export const DEFAULT_SOCKET_TCP_NODELAY = true;

/**
 * SO_KEEPALIVE enabled by default to detect dead connections.
 * @source {@code com.hazelcast.internal.nio.tcp.TcpIpConnection} socket init
 */
export const DEFAULT_SOCKET_KEEP_ALIVE = true;

// ── Client connection ─────────────────────────────────────────────────────────

/**
 * Maximum time (ms) allowed for a single TCP connection attempt to a member.
 * @source {@code com.hazelcast.client.config.ClientNetworkConfig.DEFAULT_CONNECTION_TIMEOUT = 5000}
 */
export const DEFAULT_CLIENT_CONNECTION_TIMEOUT_MS = 5_000;

/**
 * Maximum time (ms) the client will keep trying to connect to the cluster
 * before giving up entirely.  -1 means try forever.
 * @source {@code com.hazelcast.client.config.ConnectionRetryConfig} —
 *   {@code hazelcast.client.cluster.connect.timeout.millis = -1}
 */
export const DEFAULT_CLUSTER_CONNECT_TIMEOUT_MS = -1;

// ── Retry / backoff ───────────────────────────────────────────────────────────

/**
 * Initial delay before the first retry attempt.
 * @source {@code com.hazelcast.client.config.ConnectionRetryConfig.INITIAL_BACKOFF_MILLIS = 1000}
 */
export const DEFAULT_RETRY_INITIAL_BACKOFF_MS = 1_000;

/**
 * Maximum delay cap for exponential backoff.
 * @source {@code com.hazelcast.client.config.ConnectionRetryConfig.MAX_BACKOFF_MILLIS = 30000}
 */
export const DEFAULT_RETRY_MAX_BACKOFF_MS = 30_000;

/**
 * Exponential backoff multiplier applied on each retry.
 * @source {@code com.hazelcast.client.config.ConnectionRetryConfig.MULTIPLIER = 1.05}
 */
export const DEFAULT_RETRY_MULTIPLIER = 1.05;

/**
 * Jitter factor applied to backoff interval [0, 1].
 * 0 means no randomisation.
 * @source {@code com.hazelcast.client.config.ConnectionRetryConfig.JITTER = 0}
 */
export const DEFAULT_RETRY_JITTER = 0;

// ── Invocation ────────────────────────────────────────────────────────────────

/**
 * Maximum time (ms) an invocation is allowed to run before being timed-out.
 * @source {@code com.hazelcast.spi.properties.ClusterProperty.INVOCATION_TIMEOUT_SECONDS = 120}
 */
export const DEFAULT_INVOCATION_TIMEOUT_MS = 120_000;

/**
 * Pause (ms) between retry attempts of a failed invocation.
 * @source {@code com.hazelcast.spi.properties.ClusterProperty.INVOCATION_RETRY_PAUSE_MILLIS = 1000}
 */
export const DEFAULT_INVOCATION_RETRY_PAUSE_MS = 1_000;

// ── Heartbeat ─────────────────────────────────────────────────────────────────

/**
 * Interval (ms) between heartbeat ping messages sent to a member.
 * @source {@code com.hazelcast.spi.properties.ClusterProperty.CLIENT_HEARTBEAT_INTERVAL_SECONDS = 5}
 */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;

/**
 * Maximum time (ms) without receiving a heartbeat before the connection is
 * considered dead.
 * @source {@code com.hazelcast.spi.properties.ClusterProperty.CLIENT_HEARTBEAT_TIMEOUT_SECONDS = 60}
 */
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 60_000;

// ── Reconnect / connection strategy ───────────────────────────────────────────

/**
 * Default reconnect mode — the client automatically reconnects after losing
 * cluster connectivity.
 * @source {@code com.hazelcast.client.config.ClientConnectionStrategyConfig.ReconnectMode.ON}
 */
export const DEFAULT_RECONNECT_MODE = "ON" as const;

/**
 * Whether client start is synchronous (false = wait for connection before
 * returning from connect()).
 * @source {@code com.hazelcast.client.config.ClientConnectionStrategyConfig.asyncStart = false}
 */
export const DEFAULT_ASYNC_START = false;

// ── Smart routing ─────────────────────────────────────────────────────────────

/**
 * Smart routing enabled by default: the client routes operations to the member
 * owning the partition for a key.
 * @source {@code com.hazelcast.client.config.ClientNetworkConfig.smartRouting = true}
 */
export const DEFAULT_SMART_ROUTING = true;

// ── Near-cache ────────────────────────────────────────────────────────────────

/**
 * Anti-entropy repair cadence (ms): interval at which near-cache metadata
 * is re-fetched from the server to repair inconsistencies.
 * @source {@code com.hazelcast.client.impl.spi.impl.ClientClusterServiceImpl}
 *   near-cache metadata fetcher period = 60 000 ms
 */
export const DEFAULT_NEAR_CACHE_REPAIR_CADENCE_MS = 60_000;

// ── Serialization ─────────────────────────────────────────────────────────────

/**
 * Network byte order for Hazelcast binary serialization frames.
 * Hazelcast always uses big-endian on the wire.
 * @source {@code com.hazelcast.internal.serialization.impl.SerializationConstants} /
 *   {@code com.hazelcast.internal.nio.Bits} — all reads use BIG_ENDIAN
 */
export const DEFAULT_BYTE_ORDER = "BIG_ENDIAN" as const;

// ── Transaction ───────────────────────────────────────────────────────────────

/**
 * Default transaction timeout (ms) before a transaction is automatically
 * rolled back.
 * @source {@code com.hazelcast.transaction.TransactionOptions.DEFAULT_TIMEOUT_MILLIS = 120000}
 */
export const DEFAULT_TRANSACTION_TIMEOUT_MS = 120_000;

// ── SQL ───────────────────────────────────────────────────────────────────────

/**
 * Default number of rows fetched per cursor page in SQL result sets.
 * @source {@code com.hazelcast.sql.SqlStatement.DEFAULT_CURSOR_BUFFER_SIZE = 4096}
 */
export const DEFAULT_SQL_CURSOR_PAGE_SIZE = 4_096;

// ── Partition count ───────────────────────────────────────────────────────────

/**
 * Number of partitions in a Hazelcast cluster.  This is a compile-time
 * constant; changing it requires a full cluster restart.
 * @source {@code com.hazelcast.spi.properties.ClusterProperty.PARTITION_COUNT = 271}
 */
export const DEFAULT_PARTITION_COUNT = 271;

// ── Operation threads ─────────────────────────────────────────────────────────

/**
 * Number of operation handler threads.  Defaults to the number of logical CPUs
 * with a floor of 2.
 * @source {@code com.hazelcast.spi.properties.ClusterProperty.PARTITION_OPERATION_THREAD_COUNT}
 *   default = max(2, availableProcessors)
 */
export const DEFAULT_OPERATION_THREAD_COUNT = Math.max(2, navigator?.hardwareConcurrency ?? 2);

// ── Map defaults ──────────────────────────────────────────────────────────────

/**
 * Default synchronous backup replica count for IMap.
 * @source {@code com.hazelcast.config.MapConfig.DEFAULT_BACKUP_COUNT = 1}
 */
export const DEFAULT_MAP_BACKUP_COUNT = 1;

/**
 * Default async backup replica count for IMap.
 * @source {@code com.hazelcast.config.MapConfig.DEFAULT_ASYNC_BACKUP_COUNT = 0}
 */
export const DEFAULT_MAP_ASYNC_BACKUP_COUNT = 0;

/**
 * Default TTL (seconds) for IMap entries.  0 means entries never expire.
 * @source {@code com.hazelcast.config.MapConfig.DEFAULT_TTL_SECONDS = 0}
 */
export const DEFAULT_MAP_TTL_SECONDS = 0;

/**
 * Default max-idle time (seconds) for IMap entries.  0 means never idle-expires.
 * @source {@code com.hazelcast.config.MapConfig.DEFAULT_MAX_IDLE_SECONDS = 0}
 */
export const DEFAULT_MAP_MAX_IDLE_SECONDS = 0;

/**
 * Default eviction policy for IMap.
 * @source {@code com.hazelcast.config.MapConfig.DEFAULT_EVICTION_POLICY = EvictionPolicy.NONE}
 */
export const DEFAULT_MAP_EVICTION_POLICY = "NONE" as const;

/**
 * Default max-size entry count for IMap (effectively unlimited).
 * @source {@code com.hazelcast.config.MapConfig.DEFAULT_MAX_SIZE = Integer.MAX_VALUE}
 */
export const DEFAULT_MAP_MAX_SIZE = 2_147_483_647; // Integer.MAX_VALUE

/**
 * Default max-size policy for IMap.
 * @source {@code com.hazelcast.config.MapConfig.DEFAULT_MAX_SIZE_POLICY = MaxSizePolicy.PER_NODE}
 */
export const DEFAULT_MAP_MAX_SIZE_POLICY = "PER_NODE" as const;

// ── Queue defaults ────────────────────────────────────────────────────────────

/**
 * Default synchronous backup replica count for IQueue.
 * @source {@code com.hazelcast.config.QueueConfig.DEFAULT_BACKUP_COUNT = 1}
 */
export const DEFAULT_QUEUE_BACKUP_COUNT = 1;

/**
 * Default maximum number of items in an IQueue.  0 means unbounded.
 * @source {@code com.hazelcast.config.QueueConfig.DEFAULT_MAX_SIZE = 0}
 */
export const DEFAULT_QUEUE_MAX_SIZE = 0;
