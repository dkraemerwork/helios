import { HealthMonitorLevel } from '@zenystx/helios-core/monitor/HealthMonitor';

/**
 * Configuration for the Helios monitoring subsystem.
 *
 * Monitoring is opt-in: call `setEnabled(true)` to activate.
 * When enabled, the monitor collects runtime metrics at a configurable
 * sampling interval and exposes them via the REST endpoint group `MONITOR`
 * at `/helios/monitor`.
 *
 * Usage:
 * ```typescript
 * const config = new HeliosConfig('my-instance');
 * config.getMonitorConfig()
 *     .setEnabled(true)
 *     .setSampleIntervalMs(2_000)
 *     .setHealthMonitorLevel(HealthMonitorLevel.NOISY);
 *
 * config.getNetworkConfig().getRestApiConfig()
 *     .setEnabled(true)
 *     .enableGroups(RestEndpointGroup.MONITOR);
 * ```
 */
export class MonitorConfig {
    /** Default sampling interval: 2 seconds. */
    static readonly DEFAULT_SAMPLE_INTERVAL_MS = 2_000;

    /** Default ring buffer capacity: 300 samples (~10 minutes at 2s interval). */
    static readonly DEFAULT_MAX_SAMPLES = 300;

    /** Default SSE keepalive interval: 15 seconds. */
    static readonly DEFAULT_SSE_KEEPALIVE_MS = 15_000;

    /** Default health monitor level: SILENT (log only when thresholds are exceeded). */
    static readonly DEFAULT_HEALTH_MONITOR_LEVEL = HealthMonitorLevel.SILENT;

    /** Default memory heap usage threshold: 90%. */
    static readonly DEFAULT_THRESHOLD_MEMORY_PERCENT = 90;

    /** Default CPU utilisation threshold: 80%. */
    static readonly DEFAULT_THRESHOLD_CPU_PERCENT = 80;

    /** Default event loop P99 latency threshold: 100 ms. */
    static readonly DEFAULT_THRESHOLD_EVENT_LOOP_P99_MS = 100;

    private _enabled = false;
    private _sampleIntervalMs = MonitorConfig.DEFAULT_SAMPLE_INTERVAL_MS;
    private _maxSamples = MonitorConfig.DEFAULT_MAX_SAMPLES;
    private _sseKeepaliveMs = MonitorConfig.DEFAULT_SSE_KEEPALIVE_MS;
    private _collectGcMetrics = true;
    private _healthMonitorLevel: HealthMonitorLevel = MonitorConfig.DEFAULT_HEALTH_MONITOR_LEVEL;
    private _thresholdMemoryPercent = MonitorConfig.DEFAULT_THRESHOLD_MEMORY_PERCENT;
    private _thresholdCpuPercent = MonitorConfig.DEFAULT_THRESHOLD_CPU_PERCENT;
    private _thresholdEventLoopP99Ms = MonitorConfig.DEFAULT_THRESHOLD_EVENT_LOOP_P99_MS;

    /** Whether monitoring is enabled. Default: false. */
    isEnabled(): boolean { return this._enabled; }
    setEnabled(enabled: boolean): this { this._enabled = enabled; return this; }

    /** Metrics sampling interval in milliseconds. Default: 2000. */
    getSampleIntervalMs(): number { return this._sampleIntervalMs; }
    setSampleIntervalMs(ms: number): this {
        if (ms < 100) throw new Error(`sampleIntervalMs must be >= 100, was: ${ms}`);
        this._sampleIntervalMs = ms;
        return this;
    }

    /** Maximum number of samples retained in the ring buffer. Default: 300. */
    getMaxSamples(): number { return this._maxSamples; }
    setMaxSamples(max: number): this {
        if (max < 10) throw new Error(`maxSamples must be >= 10, was: ${max}`);
        this._maxSamples = max;
        return this;
    }

    /** SSE keepalive interval in milliseconds. Default: 15000. */
    getSseKeepaliveMs(): number { return this._sseKeepaliveMs; }
    setSseKeepaliveMs(ms: number): this { this._sseKeepaliveMs = ms; return this; }

    /** Whether to collect GC/heap statistics via v8. Default: true. */
    isCollectGcMetrics(): boolean { return this._collectGcMetrics; }
    setCollectGcMetrics(collect: boolean): this { this._collectGcMetrics = collect; return this; }

    /**
     * Health monitor logging mode.
     *
     * - `OFF`    — no health logging
     * - `SILENT` — log only when a threshold is exceeded (default)
     * - `NOISY`  — always log the full snapshot on every sample
     */
    getHealthMonitorLevel(): HealthMonitorLevel { return this._healthMonitorLevel; }
    setHealthMonitorLevel(level: HealthMonitorLevel): this {
        this._healthMonitorLevel = level;
        return this;
    }

    /**
     * Memory heap usage threshold percentage (0–100).
     * Logged when `heapUsed / heapTotal * 100` exceeds this value.
     * Default: 90.
     */
    getThresholdMemoryPercent(): number { return this._thresholdMemoryPercent; }
    setThresholdMemoryPercent(percent: number): this {
        if (percent < 0 || percent > 100) {
            throw new Error(`thresholdMemoryPercent must be 0–100, was: ${percent}`);
        }
        this._thresholdMemoryPercent = percent;
        return this;
    }

    /**
     * CPU utilisation threshold percentage (0–100+).
     * Logged when `cpu.percentUsed` exceeds this value.
     * Default: 80.
     */
    getThresholdCpuPercent(): number { return this._thresholdCpuPercent; }
    setThresholdCpuPercent(percent: number): this {
        if (percent < 0) {
            throw new Error(`thresholdCpuPercent must be >= 0, was: ${percent}`);
        }
        this._thresholdCpuPercent = percent;
        return this;
    }

    /**
     * Event loop P99 latency threshold in milliseconds.
     * Logged when `eventLoop.p99Ms` exceeds this value.
     * Default: 100.
     */
    getThresholdEventLoopP99Ms(): number { return this._thresholdEventLoopP99Ms; }
    setThresholdEventLoopP99Ms(ms: number): this {
        if (ms < 0) {
            throw new Error(`thresholdEventLoopP99Ms must be >= 0, was: ${ms}`);
        }
        this._thresholdEventLoopP99Ms = ms;
        return this;
    }
}
