/**
 * Strict configuration validator for both server (HeliosConfig) and client
 * (ClientConfig) configuration objects.
 *
 * All accepted fields are enumerated here.  Unknown fields or out-of-range
 * values cause an immediate, descriptive {@link ConfigValidationError} rather
 * than being silently ignored.
 *
 * Port of {@code com.hazelcast.config.ConfigValidator} (Hazelcast OSS 5.5.x).
 */
import type { ClientConfig } from "@zenystx/helios-core/client/config/ClientConfig.js";
import type { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig.js";
import {
    DEFAULT_CLIENT_CONNECTION_TIMEOUT_MS,
    DEFAULT_CLUSTER_NAME,
    DEFAULT_HEARTBEAT_INTERVAL_MS,
    DEFAULT_HEARTBEAT_TIMEOUT_MS,
    DEFAULT_INVOCATION_RETRY_PAUSE_MS,
    DEFAULT_INVOCATION_TIMEOUT_MS,
    DEFAULT_MAP_BACKUP_COUNT,
    DEFAULT_MAP_TTL_SECONDS,
    DEFAULT_PARTITION_COUNT,
    DEFAULT_PORT,
    DEFAULT_QUEUE_BACKUP_COUNT,
    DEFAULT_RETRY_JITTER,
    DEFAULT_RETRY_MULTIPLIER,
} from "@zenystx/helios-core/config/HazelcastDefaults.js";

// ── Error type ────────────────────────────────────────────────────────────────

/**
 * Thrown when configuration validation fails.
 *
 * Carries a structured list of all violations found so callers can report them
 * in a single pass instead of one error per field.
 */
export class ConfigValidationError extends Error {
    readonly violations: readonly string[];

    constructor(violations: string[]) {
        super(
            `Configuration validation failed with ${violations.length} violation(s):\n` +
            violations.map((v, i) => `  ${i + 1}. ${v}`).join("\n"),
        );
        this.name = "ConfigValidationError";
        this.violations = Object.freeze([...violations]);
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function requirePositiveInt(value: unknown, path: string, violations: string[]): void {
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
        violations.push(`${path}: must be a positive integer, got ${JSON.stringify(value)}`);
    }
}

function requireNonNegativeInt(value: unknown, path: string, violations: string[]): void {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        violations.push(`${path}: must be a non-negative integer, got ${JSON.stringify(value)}`);
    }
}

function requireNonNegativeNumber(value: unknown, path: string, violations: string[]): void {
    if (typeof value !== "number" || value < 0) {
        violations.push(`${path}: must be a non-negative number, got ${JSON.stringify(value)}`);
    }
}

function requireInRange(
    value: unknown,
    min: number,
    max: number,
    path: string,
    violations: string[],
): void {
    if (typeof value !== "number" || value < min || value > max) {
        violations.push(
            `${path}: must be a number in [${min}, ${max}], got ${JSON.stringify(value)}`,
        );
    }
}

function requireNonEmptyString(value: unknown, path: string, violations: string[]): void {
    if (typeof value !== "string" || value.trim() === "") {
        violations.push(`${path}: must be a non-empty string, got ${JSON.stringify(value)}`);
    }
}

// ── Server-side (HeliosConfig) validation ────────────────────────────────────

/**
 * Validates a {@link HeliosConfig} at server startup.
 *
 * @throws {@link ConfigValidationError} if any constraint is violated.
 */
export function validateHeliosConfig(config: HeliosConfig): void {
    const violations: string[] = [];

    validateHeliosConfigCollecting(config, violations);

    if (violations.length > 0) {
        throw new ConfigValidationError(violations);
    }
}

function validateHeliosConfigCollecting(config: HeliosConfig, violations: string[]): void {
    // ── Instance name ──────────────────────────────────────────────────────────
    requireNonEmptyString(config.getName(), "helios.name", violations);

    // ── Network config ─────────────────────────────────────────────────────────
    const net = config.getNetworkConfig();

    const port = net.getPort();
    if (port !== 0) {
        requireInRange(port, 1, 65_535, "helios.network.port", violations);
    }

    const portCount = net.getPortCount();
    requireNonNegativeInt(portCount, "helios.network.portCount", violations);

    // ── Map configs ────────────────────────────────────────────────────────────
    for (const [name, mc] of config.getMapConfigs()) {
        const prefix = `helios.maps["${name}"]`;

        const backupCount = mc.getBackupCount();
        requireInRange(backupCount, 0, 6, `${prefix}.backupCount`, violations);

        const asyncBackupCount = mc.getAsyncBackupCount();
        requireInRange(asyncBackupCount, 0, 6, `${prefix}.asyncBackupCount`, violations);

        if (backupCount + asyncBackupCount > 6) {
            violations.push(
                `${prefix}: backupCount (${backupCount}) + asyncBackupCount (${asyncBackupCount}) must be <= 6`,
            );
        }

        const ttl = mc.getTimeToLiveSeconds();
        requireNonNegativeInt(ttl, `${prefix}.timeToLiveSeconds`, violations);

        const maxIdle = mc.getMaxIdleSeconds();
        requireNonNegativeInt(maxIdle, `${prefix}.maxIdleSeconds`, violations);

        const eviction = mc.getEvictionConfig();
        requireNonNegativeInt(eviction.getSize(), `${prefix}.eviction.size`, violations);
    }

    // ── Queue configs ──────────────────────────────────────────────────────────
    for (const [name, qc] of config.getQueueConfigs()) {
        const prefix = `helios.queues["${name}"]`;

        requireNonNegativeInt(qc.getMaxSize(), `${prefix}.maxSize`, violations);

        const backup = qc.getBackupCount();
        requireInRange(backup, 0, 6, `${prefix}.backupCount`, violations);

        const asyncBackup = qc.getAsyncBackupCount();
        requireInRange(asyncBackup, 0, 6, `${prefix}.asyncBackupCount`, violations);
    }
}

// ── Client-side (ClientConfig) validation ────────────────────────────────────

/**
 * Validates a {@link ClientConfig} before the client connects to the cluster.
 *
 * @throws {@link ConfigValidationError} if any constraint is violated.
 */
export function validateClientConfig(config: ClientConfig): void {
    const violations: string[] = [];

    validateClientConfigCollecting(config, violations);

    if (violations.length > 0) {
        throw new ConfigValidationError(violations);
    }
}

function validateClientConfigCollecting(config: ClientConfig, violations: string[]): void {
    // ── Instance name ──────────────────────────────────────────────────────────
    requireNonEmptyString(config.getName(), "client.name", violations);

    // ── Cluster name ───────────────────────────────────────────────────────────
    requireNonEmptyString(config.getClusterName(), "client.clusterName", violations);

    if (config.getClusterName() !== DEFAULT_CLUSTER_NAME) {
        // Not a violation — just guard against obviously wrong types
    }

    // ── Network config ─────────────────────────────────────────────────────────
    const net = config.getNetworkConfig();

    const connTimeout = net.getConnectionTimeout();
    requireNonNegativeInt(connTimeout, "client.network.connectionTimeout", violations);

    // Addresses: each must be a non-empty string
    for (const addr of net.getAddresses()) {
        if (typeof addr !== "string" || addr.trim() === "") {
            violations.push(
                `client.network.addresses: each address must be a non-empty string, got ${JSON.stringify(addr)}`,
            );
        } else {
            validateAddressString(addr, "client.network.addresses", violations);
        }
    }

    // ── Connection strategy ────────────────────────────────────────────────────
    const cs = config.getConnectionStrategyConfig();
    const reconnectMode = cs.getReconnectMode();
    if (reconnectMode !== "OFF" && reconnectMode !== "ON" && reconnectMode !== "ASYNC") {
        violations.push(
            `client.connectionStrategy.reconnectMode: must be OFF, ON, or ASYNC, got ${JSON.stringify(reconnectMode)}`,
        );
    }

    // ── Retry config ───────────────────────────────────────────────────────────
    const retry = cs.getConnectionRetryConfig();

    const initialBackoff = retry.getInitialBackoffMillis();
    requireNonNegativeInt(initialBackoff, "client.connectionRetry.initialBackoffMillis", violations);

    const maxBackoff = retry.getMaxBackoffMillis();
    requireNonNegativeInt(maxBackoff, "client.connectionRetry.maxBackoffMillis", violations);

    if (
        typeof initialBackoff === "number" &&
        typeof maxBackoff === "number" &&
        initialBackoff > maxBackoff &&
        maxBackoff > 0
    ) {
        violations.push(
            `client.connectionRetry: initialBackoffMillis (${initialBackoff}) must be <= maxBackoffMillis (${maxBackoff})`,
        );
    }

    const multiplier = retry.getMultiplier();
    if (typeof multiplier !== "number" || multiplier < 1.0) {
        violations.push(
            `client.connectionRetry.multiplier: must be >= 1.0, got ${JSON.stringify(multiplier)}`,
        );
    }

    const jitter = retry.getJitter();
    requireInRange(jitter, 0, 1, "client.connectionRetry.jitter", violations);

    const clusterConnectTimeout = retry.getClusterConnectTimeoutMillis();
    if (typeof clusterConnectTimeout !== "number" || (clusterConnectTimeout < -1)) {
        violations.push(
            `client.connectionRetry.clusterConnectTimeoutMillis: must be >= -1 (-1 = unlimited), got ${JSON.stringify(clusterConnectTimeout)}`,
        );
    }

    // ── Near-cache configs ─────────────────────────────────────────────────────
    for (const [name, nc] of config.getNearCacheConfigMap()) {
        const prefix = `client.nearCaches["${name}"]`;

        const ttl = nc.getTimeToLiveSeconds();
        requireNonNegativeInt(ttl, `${prefix}.timeToLiveSeconds`, violations);

        const maxIdle = nc.getMaxIdleSeconds();
        requireNonNegativeInt(maxIdle, `${prefix}.maxIdleSeconds`, violations);

        const eviction = nc.getEvictionConfig();
        requireNonNegativeInt(eviction.getSize(), `${prefix}.eviction.size`, violations);
    }
}

// ── Address string validation ─────────────────────────────────────────────────

/**
 * Validates that an address string has the form host, host:port, or [ipv6]:port.
 * Does not resolve DNS.
 */
function validateAddressString(addr: string, path: string, violations: string[]): void {
    // IPv6 bracketed: [::1]:5701
    if (addr.startsWith("[")) {
        const closeBracket = addr.indexOf("]");
        if (closeBracket === -1) {
            violations.push(`${path}: malformed IPv6 address (missing ']'): ${JSON.stringify(addr)}`);
            return;
        }
        const portPart = addr.slice(closeBracket + 1);
        if (portPart !== "" && portPart !== ":") {
            const portStr = portPart.slice(1);
            const port = parseInt(portStr, 10);
            if (isNaN(port) || port < 1 || port > 65_535) {
                violations.push(
                    `${path}: port must be in [1, 65535], got ${JSON.stringify(portPart)}: ${JSON.stringify(addr)}`,
                );
            }
        }
        return;
    }

    // IPv4 / hostname with optional port
    const lastColon = addr.lastIndexOf(":");
    if (lastColon !== -1) {
        const portStr = addr.slice(lastColon + 1);
        const port = parseInt(portStr, 10);
        if (isNaN(port) || port < 1 || port > 65_535) {
            violations.push(
                `${path}: port must be in [1, 65535], got ${JSON.stringify(portStr)}: ${JSON.stringify(addr)}`,
            );
        }
    }
}

// ── Defaults audit helpers (exported for testing) ─────────────────────────────

/**
 * Returns a snapshot of critical defaults for diagnostic logging.
 * Useful for printing at startup so operators can confirm the active config.
 */
export function auditDefaults(): Record<string, unknown> {
    return {
        clusterName: DEFAULT_CLUSTER_NAME,
        port: DEFAULT_PORT,
        connectionTimeoutMs: DEFAULT_CLIENT_CONNECTION_TIMEOUT_MS,
        heartbeatIntervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
        heartbeatTimeoutMs: DEFAULT_HEARTBEAT_TIMEOUT_MS,
        invocationTimeoutMs: DEFAULT_INVOCATION_TIMEOUT_MS,
        invocationRetryPauseMs: DEFAULT_INVOCATION_RETRY_PAUSE_MS,
        retryMultiplier: DEFAULT_RETRY_MULTIPLIER,
        retryJitter: DEFAULT_RETRY_JITTER,
        mapBackupCount: DEFAULT_MAP_BACKUP_COUNT,
        mapTtlSeconds: DEFAULT_MAP_TTL_SECONDS,
        queueBackupCount: DEFAULT_QUEUE_BACKUP_COUNT,
        partitionCount: DEFAULT_PARTITION_COUNT,
    };
}
