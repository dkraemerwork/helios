import { Inject, Injectable } from '@nestjs/common';
import type { HeliosInstance } from '@zenystx/helios-core/core/HeliosInstance';
import type { MetricsRegistry, SampleListener } from '@zenystx/helios-core/monitor/MetricsRegistry';
import type { MetricsSample, MonitorPayload } from '@zenystx/helios-core/monitor/MetricsSample';
import { HELIOS_INSTANCE_TOKEN } from '../HeliosInstanceDefinition';

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
    private readonly _helios: HeliosInstance;
    private readonly _registry: MetricsRegistry | null;

    constructor(@Inject(HELIOS_INSTANCE_TOKEN) helios: HeliosInstance) {
        this._helios = helios;
        // HeliosInstance exposes getMetricsRegistry() on the concrete impl;
        // cast through unknown to avoid a direct impl dependency.
        this._registry = (helios as unknown as { getMetricsRegistry(): MetricsRegistry | null }).getMetricsRegistry();
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
     * Builds a {@link MonitorPayload} snapshot combining available cluster state
     * from the Helios instance with the current time-series samples from the registry.
     *
     * Returns `null` when monitoring is disabled — callers should guard on
     * {@link isEnabled()} or null-check the return value.
     */
    getPayload(): MonitorPayload | null {
        if (!this._registry) return null;

        const samples = [...this._registry.getSamples()];
        const latest = this._registry.getLatest();

        return {
            instanceName: this._helios.getName(),
            nodeState: '',
            clusterState: '',
            clusterSize: this._helios.getCluster().getMembers().length,
            clusterSafe: false,
            memberVersion: '',
            partitionCount: 0,
            members: [],
            objects: { maps: [], queues: [], topics: [], executors: [] },
            samples,
            latest,
        };
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
