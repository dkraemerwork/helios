/**
 * HealthMonitor — periodic background health logger with configurable thresholds.
 *
 * Mirrors Hazelcast's `HealthMonitor.java`: subscribes to {@link MetricsRegistry} sample
 * events and logs a consolidated health snapshot on each tick.
 *
 * Modes:
 *   - OFF    — silent; no health logging at all
 *   - SILENT — logs only when at least one threshold is exceeded (default)
 *   - NOISY  — always logs the full snapshot on every sample
 *
 * Configurable thresholds:
 *   - Memory heap usage percentage
 *   - CPU utilisation percentage
 *   - Event loop P99 latency (ms)
 *
 * The logged snapshot includes (Hazelcast HealthMonitor parity):
 *   memory, cpu, eventLoop, transport, operation, invocation, migration, cluster
 */

import type { MonitorConfig } from '@zenystx/helios-core/config/MonitorConfig';
import type { MetricsRegistry } from '@zenystx/helios-core/monitor/MetricsRegistry';
import type { MetricsSample } from '@zenystx/helios-core/monitor/MetricsSample';
import type { MonitorStateProvider } from '@zenystx/helios-core/monitor/MonitorStateProvider';
import { HeliosLoggers } from '@zenystx/helios-core/monitor/StructuredLogger';

// ── Health monitor level ──────────────────────────────────────────────────────

export enum HealthMonitorLevel {
    /** Health logging is completely disabled. */
    OFF = 'OFF',
    /** Logs only when at least one threshold is exceeded. */
    SILENT = 'SILENT',
    /** Always logs the full snapshot on every sample. */
    NOISY = 'NOISY',
}

// ── Threshold evaluation ──────────────────────────────────────────────────────

interface ThresholdViolation {
    field: string;
    value: number;
    threshold: number;
    unit: string;
}

function collectViolations(
    sample: MetricsSample,
    thresholdMemoryPercent: number,
    thresholdCpuPercent: number,
    thresholdEventLoopP99Ms: number,
): ThresholdViolation[] {
    const violations: ThresholdViolation[] = [];

    const memPercent = sample.memory.heapTotal > 0
        ? (sample.memory.heapUsed / sample.memory.heapTotal) * 100
        : 0;

    if (memPercent > thresholdMemoryPercent) {
        violations.push({
            field: 'memory.heapPercent',
            value: round2(memPercent),
            threshold: thresholdMemoryPercent,
            unit: '%',
        });
    }

    if (sample.cpu.percentUsed > thresholdCpuPercent) {
        violations.push({
            field: 'cpu.percentUsed',
            value: sample.cpu.percentUsed,
            threshold: thresholdCpuPercent,
            unit: '%',
        });
    }

    if (sample.eventLoop.p99Ms > thresholdEventLoopP99Ms) {
        violations.push({
            field: 'eventLoop.p99Ms',
            value: sample.eventLoop.p99Ms,
            threshold: thresholdEventLoopP99Ms,
            unit: 'ms',
        });
    }

    return violations;
}

/** Round to 2 decimal places. */
function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

/** Format bytes as a human-readable string (e.g. 128.00 MB). */
function fmtBytes(bytes: number): string {
    if (bytes >= 1_073_741_824) return `${round2(bytes / 1_073_741_824)} GB`;
    if (bytes >= 1_048_576) return `${round2(bytes / 1_048_576)} MB`;
    if (bytes >= 1_024) return `${round2(bytes / 1_024)} KB`;
    return `${bytes} B`;
}

// ── HealthMonitor ─────────────────────────────────────────────────────────────

export class HealthMonitor {
    private readonly _config: MonitorConfig;
    private readonly _registry: MetricsRegistry;
    private readonly _provider: MonitorStateProvider;
    private _unsubscribe: (() => void) | null = null;

    constructor(
        config: MonitorConfig,
        registry: MetricsRegistry,
        provider: MonitorStateProvider,
    ) {
        this._config = config;
        this._registry = registry;
        this._provider = provider;
    }

    /** Start listening for samples. No-op if level is OFF or already started. */
    start(): void {
        if (this._config.getHealthMonitorLevel() === HealthMonitorLevel.OFF) return;
        if (this._unsubscribe !== null) return;

        this._unsubscribe = this._registry.subscribe((sample) => {
            this._onSample(sample);
        });
    }

    /** Stop listening. Safe to call multiple times. */
    stop(): void {
        this._unsubscribe?.();
        this._unsubscribe = null;
    }

    /** Whether the monitor is actively subscribed to samples. */
    get isRunning(): boolean {
        return this._unsubscribe !== null;
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private _onSample(sample: MetricsSample): void {
        const level = this._config.getHealthMonitorLevel();
        if (level === HealthMonitorLevel.OFF) return;

        const violations = collectViolations(
            sample,
            this._config.getThresholdMemoryPercent(),
            this._config.getThresholdCpuPercent(),
            this._config.getThresholdEventLoopP99Ms(),
        );

        if (level === HealthMonitorLevel.SILENT && violations.length === 0) return;

        this._logSnapshot(sample, violations);
    }

    private _logSnapshot(sample: MetricsSample, violations: ThresholdViolation[]): void {
        const memPercent = sample.memory.heapTotal > 0
            ? round2((sample.memory.heapUsed / sample.memory.heapTotal) * 100)
            : 0;

        const clusterSize = this._provider.getClusterSize();
        const clusterState = this._provider.getClusterState();
        const clusterSafe = this._provider.isClusterSafe();
        const nodeState = this._provider.getNodeState();

        const hasViolations = violations.length > 0;
        const message = hasViolations
            ? 'Health threshold exceeded'
            : 'Health snapshot';

        const context = {
            event: 'health.snapshot',
            timestamp: sample.timestamp,
            // Memory
            'memory.heapUsed': fmtBytes(sample.memory.heapUsed),
            'memory.heapTotal': fmtBytes(sample.memory.heapTotal),
            'memory.heapPercent': memPercent,
            'memory.rss': fmtBytes(sample.memory.rss),
            // CPU
            'cpu.percentUsed': sample.cpu.percentUsed,
            'cpu.userUs': sample.cpu.userUs,
            'cpu.systemUs': sample.cpu.systemUs,
            // Event loop
            'eventLoop.p99Ms': sample.eventLoop.p99Ms,
            'eventLoop.meanMs': sample.eventLoop.meanMs,
            'eventLoop.maxMs': sample.eventLoop.maxMs,
            // Transport
            'transport.bytesRead': sample.transport.bytesRead,
            'transport.bytesWritten': sample.transport.bytesWritten,
            'transport.openChannels': sample.transport.openChannels,
            'transport.peerCount': sample.transport.peerCount,
            // Operations
            'operation.queueSize': sample.operation.queueSize,
            'operation.runningCount': sample.operation.runningCount,
            // Invocations
            'invocation.pendingCount': sample.invocation.pendingCount,
            'invocation.usedPercentage': sample.invocation.usedPercentage,
            'invocation.maxConcurrent': sample.invocation.maxConcurrent,
            // Migrations
            'migration.queueSize': sample.migration.migrationQueueSize,
            'migration.activeMigrations': sample.migration.activeMigrations,
            // Cluster
            'cluster.size': clusterSize,
            'cluster.state': clusterState,
            'cluster.safe': clusterSafe,
            'cluster.nodeState': nodeState,
            ...(hasViolations && {
                violations: violations.map(
                    (v) => `${v.field}=${v.value}${v.unit} (threshold=${v.threshold}${v.unit})`,
                ),
            }),
        };

        if (hasViolations) {
            HeliosLoggers.healthMonitor.warn(message, context);
        } else {
            HeliosLoggers.healthMonitor.info(message, context);
        }
    }
}
