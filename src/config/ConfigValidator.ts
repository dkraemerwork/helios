/**
 * Strict configuration validator for server-side Helios configuration objects.
 *
 * All accepted fields are enumerated here.  Unknown fields or out-of-range
 * values cause an immediate, descriptive {@link ConfigValidationError} rather
 * than being silently ignored.
 *
 * Port of {@code com.hazelcast.config.ConfigValidator} (Hazelcast OSS 5.5.x).
 */
import type { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig.js";
import {
    DEFAULT_CLUSTER_NAME,
    DEFAULT_MAP_BACKUP_COUNT,
    DEFAULT_MAP_TTL_SECONDS,
    DEFAULT_PARTITION_COUNT,
    DEFAULT_PORT,
    DEFAULT_QUEUE_BACKUP_COUNT,
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

// ── Defaults audit helpers (exported for testing) ─────────────────────────────

/**
 * Returns a snapshot of critical defaults for diagnostic logging.
 * Useful for printing at startup so operators can confirm the active config.
 */
export function auditDefaults(): Record<string, unknown> {
        return {
            clusterName: DEFAULT_CLUSTER_NAME,
            port: DEFAULT_PORT,
            mapBackupCount: DEFAULT_MAP_BACKUP_COUNT,
            mapTtlSeconds: DEFAULT_MAP_TTL_SECONDS,
            queueBackupCount: DEFAULT_QUEUE_BACKUP_COUNT,
            partitionCount: DEFAULT_PARTITION_COUNT,
        };
}
