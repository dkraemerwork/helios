import { Inject, Injectable } from '@nestjs/common';
import type { HeliosInstance } from '@zenystx/helios-core/core/HeliosInstance';
import type { MetricsRegistry, SampleListener } from '@zenystx/helios-core/monitor/MetricsRegistry';
import type { MetricsSample, MonitorPayload } from '@zenystx/helios-core/monitor/MetricsSample';
import type { MonitorStateProvider } from '@zenystx/helios-core/monitor/MonitorStateProvider';
import { HELIOS_INSTANCE_TOKEN } from '../HeliosInstanceDefinition';

type HeliosInstanceInternals = {
    getMetricsRegistry(): MetricsRegistry | null;
    getMonitorStateProvider(): MonitorStateProvider | null;
};

/**
 * HeliosMonitorService — NestJS injectable service for programmatic access
 * to Helios runtime metrics.
 *
 * Provides type-safe access to the MetricsRegistry for:
 * - Querying the latest sample
 * - Reading the full sample history
 * - Building a MonitorPayload snapshot
 * - Subscribing to real-time sample events
 *
 * Usage:
 * ```typescript
 * @Injectable()
 * export class MyService {
 *     constructor(private readonly monitor: HeliosMonitorService) {}
 *
 *     getHeapUsed(): number | null {
 *         return this.monitor.getLatest()?.memory.heapUsed ?? null;
 *     }
 * }
 * ```
 */
@Injectable()
export class HeliosMonitorService {
    private readonly _registry: MetricsRegistry | null;
    private readonly _provider: MonitorStateProvider | null;

    constructor(@Inject(HELIOS_INSTANCE_TOKEN) helios: HeliosInstance) {
        // HeliosInstance exposes monitoring internals on the concrete impl;
        // cast through unknown to avoid a direct impl dependency.
        const internals = helios as unknown as HeliosInstanceInternals;
        this._registry = internals.getMetricsRegistry();
        this._provider = internals.getMonitorStateProvider();
    }

    /** Whether the monitoring subsystem is active (i.e. enabled in config). */
    isEnabled(): boolean {
        return this._registry !== null;
    }

    /**
     * Returns the most recent {@link MetricsSample}, or `null` if monitoring
     * is disabled or no samples have been collected yet.
     */
    getLatest(): MetricsSample | null {
        return this._registry?.getLatest() ?? null;
    }

    /**
     * Returns all samples currently held in the ring buffer (oldest first).
     * Returns an empty array when monitoring is disabled.
     */
    getSamples(): readonly MetricsSample[] {
        return this._registry?.getSamples() ?? [];
    }

    /**
     * Builds a {@link MonitorPayload} snapshot with all cluster state fields
     * fully populated via the MetricsRegistry and MonitorStateProvider.
     *
     * Returns `null` when monitoring is disabled — callers should guard on
     * {@link isEnabled()} or null-check the return value.
     */
    getPayload(): MonitorPayload | null {
        if (!this._registry || !this._provider) return null;
        return this._registry.buildPayload(this._provider);
    }

    /**
     * Registers a listener that is invoked whenever a new sample is pushed into
     * the registry. Has no effect when monitoring is disabled.
     *
     * @param listener - Callback invoked with each new {@link MetricsSample}.
     * @returns An unsubscribe function. Call it to stop receiving events.
     */
    subscribe(listener: SampleListener): () => void {
        if (!this._registry) return () => { /* no-op — monitoring disabled */ };
        return this._registry.subscribe(listener);
    }
}
