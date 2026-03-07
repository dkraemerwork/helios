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
 *     .setSampleIntervalMs(2_000);
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

    private _enabled = false;
    private _sampleIntervalMs = MonitorConfig.DEFAULT_SAMPLE_INTERVAL_MS;
    private _maxSamples = MonitorConfig.DEFAULT_MAX_SAMPLES;
    private _sseKeepaliveMs = MonitorConfig.DEFAULT_SSE_KEEPALIVE_MS;
    private _collectGcMetrics = true;

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
}
