/**
 * MetricsRegistry — central time-series sample store and SSE subscriber manager.
 *
 * Maintains a fixed-size ring buffer of {@link MetricsSample} snapshots.
 * SSE clients register via {@link subscribe()} and receive samples as they arrive.
 *
 * Thread-safe: all mutations happen on the main event loop (no worker interaction).
 */

import type { MonitorConfig } from '@zenystx/helios-core/config/MonitorConfig';
import type { MetricsSample, MonitorPayload } from '@zenystx/helios-core/monitor/MetricsSample';
import type { MonitorStateProvider } from '@zenystx/helios-core/monitor/MonitorStateProvider';

/** Callback invoked when a new sample is available. */
export type SampleListener = (sample: MetricsSample) => void;

export class MetricsRegistry {
    private readonly _maxSamples: number;
    private readonly _samples: MetricsSample[] = [];
    private readonly _listeners = new Set<SampleListener>();

    constructor(config: MonitorConfig) {
        this._maxSamples = config.getMaxSamples();
    }

    /** Push a new sample into the ring buffer and notify all SSE subscribers. */
    push(sample: MetricsSample): void {
        this._samples.push(sample);

        // Trim ring buffer from front
        if (this._samples.length > this._maxSamples) {
            this._samples.splice(0, this._samples.length - this._maxSamples);
        }

        // Notify all listeners
        for (const listener of this._listeners) {
            try {
                listener(sample);
            } catch {
                // Swallow listener errors — don't let a broken SSE client kill sampling
            }
        }
    }

    /** Returns all samples in the ring buffer (oldest first). */
    getSamples(): readonly MetricsSample[] {
        return this._samples;
    }

    /** Returns the most recent sample, or null if no samples yet. */
    getLatest(): MetricsSample | null {
        return this._samples.length > 0
            ? this._samples[this._samples.length - 1]!
            : null;
    }

    /** Number of samples currently stored. */
    get size(): number {
        return this._samples.length;
    }

    /** Register a listener for new samples. Returns an unsubscribe function. */
    subscribe(listener: SampleListener): () => void {
        this._listeners.add(listener);
        return () => { this._listeners.delete(listener); };
    }

    /** Number of active SSE subscribers. */
    get subscriberCount(): number {
        return this._listeners.size;
    }

    /**
     * Build a full {@link MonitorPayload} from the current state.
     * Combines the time-series samples with cluster state from the provider.
     */
    buildPayload(provider: MonitorStateProvider): MonitorPayload {
        return {
            instanceName: provider.getInstanceName(),
            nodeState: provider.getNodeState(),
            clusterState: provider.getClusterState(),
            clusterSize: provider.getClusterSize(),
            clusterSafe: provider.isClusterSafe(),
            memberVersion: provider.getMemberVersion(),
            partitionCount: provider.getPartitionCount(),
            members: provider.getMemberPartitionInfo(),
            objects: provider.getObjectInventory(),
            samples: [...this._samples],
            latest: this.getLatest(),
        };
    }

    /** Clear all samples (test use). */
    clear(): void {
        this._samples.length = 0;
    }
}
