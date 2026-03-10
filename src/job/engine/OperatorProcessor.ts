import type { AsyncChannel } from './AsyncChannel.js';
import type { ProcessorItem } from './ProcessorItem.js';
import { LatencyTracker } from '../metrics/LatencyTracker.js';
import { WatermarkTracker } from '../metrics/WatermarkTracker.js';
import { processorMetricStore } from '../metrics/Metrics.js';

const ABORTED = Symbol('aborted');

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | typeof ABORTED> {
  if (signal.aborted) return Promise.resolve(ABORTED);
  return new Promise<T | typeof ABORTED>((resolve, reject) => {
    const onAbort = () => resolve(ABORTED);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      v => { signal.removeEventListener('abort', onAbort); resolve(v); },
      e => { signal.removeEventListener('abort', onAbort); reject(e); },
    );
  });
}

/**
 * OperatorProcessor — wraps a vertex function (map/filter/flatMap).
 *
 * Reads inbox → applies fn → writes outbox. Passes barriers and watermarks through.
 * Tracks watermark progression via WatermarkTracker and exposes user-defined metrics
 * via AsyncLocalStorage-bound ProcessorMetricContext.
 */
export class OperatorProcessor {
  private readonly fn: (value: unknown) => unknown;
  private readonly mode: 'map' | 'filter' | 'flatMap';
  private readonly inbox: AsyncChannel<ProcessorItem>;
  private readonly outbox: AsyncChannel<ProcessorItem>;
  private readonly vertexName: string;
  private readonly processorIndex: number;

  private itemsProcessed = 0;
  private readonly latencyTracker = new LatencyTracker(1024);

  /** Single-input watermark tracker (edgeCount = 1 for operator vertices). */
  private readonly watermarkTracker = new WatermarkTracker(1);

  /** User-defined metrics registered by pipeline code via Metrics.metric(). */
  private readonly userMetricRegistry = new Map<string, import('../metrics/UserMetric.js').UserMetric>();

  constructor(
    fn: (value: unknown) => unknown,
    mode: 'map' | 'filter' | 'flatMap',
    inbox: AsyncChannel<ProcessorItem>,
    outbox: AsyncChannel<ProcessorItem>,
    vertexName: string,
    processorIndex: number,
  ) {
    this.fn = fn;
    this.mode = mode;
    this.inbox = inbox;
    this.outbox = outbox;
    this.vertexName = vertexName;
    this.processorIndex = processorIndex;
  }

  async run(signal: AbortSignal): Promise<void> {
    const ctx = { metrics: this.userMetricRegistry };

    try {
      // Run the entire processing loop inside the processor's metric context so
      // that `Metrics.metric()` calls in the user function bind here automatically.
      await processorMetricStore.run(ctx, () => this.runLoop(signal));
    } catch (err) {
      if (signal.aborted) return;
      throw err;
    }
  }

  private async runLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const result = await raceAbort(this.inbox.receive(), signal);
      if (result === ABORTED) return;
      const item = result;

        switch (item.type) {
        case 'data': {
          const transformed = await this.fn(item.value);
          if (this.mode === 'flatMap' && Array.isArray(transformed)) {
            for (const v of transformed) {
              await this.outbox.send({
                type: 'data',
                value: v,
                timestamp: item.timestamp,
              });
            }
          } else if (this.mode === 'filter') {
            if (transformed !== undefined && transformed !== null) {
              await this.outbox.send({
                type: 'data',
                value: transformed,
                timestamp: item.timestamp,
              });
            }
          } else {
            await this.outbox.send({
              type: 'data',
              value: transformed,
              timestamp: item.timestamp,
            });
          }
          this.latencyTracker.record(Date.now() - item.timestamp);
          this.itemsProcessed++;
          break;
        }
        case 'barrier':
          await this.outbox.send(item);
          break;
        case 'watermark':
          // Observe the incoming watermark before forwarding
          this.watermarkTracker.observeWatermark(item.timestamp, 0);
          await this.outbox.send(item);
          // Record that we forwarded it downstream
          this.watermarkTracker.forwardWatermark(item.timestamp);
          break;
        case 'eos':
          await this.outbox.send({ type: 'eos' });
          return;
      }
    }
  }

  getLatencyMetrics(): {
    latencyP50Ms: number;
    latencyP99Ms: number;
    latencyMaxMs: number;
    topObservedWm: number;
    coalescedWm: number;
    lastForwardedWm: number;
    lastForwardedWmLatency: number;
    userMetrics: ReadonlyMap<string, number>;
  } {
    const userMetricsSnapshot = new Map<string, number>();
    for (const [name, metric] of this.userMetricRegistry) {
      userMetricsSnapshot.set(name, metric.get());
    }

    return {
      latencyP50Ms: this.latencyTracker.getP50(),
      latencyP99Ms: this.latencyTracker.getP99(),
      latencyMaxMs: this.latencyTracker.getMax(),
      topObservedWm: this.watermarkTracker.topObservedWm,
      coalescedWm: this.watermarkTracker.coalescedWm,
      lastForwardedWm: this.watermarkTracker.lastForwardedWm,
      lastForwardedWmLatency: this.watermarkTracker.lastForwardedWmLatency,
      userMetrics: userMetricsSnapshot,
    };
  }

  getSnapshotState(): unknown {
    return { itemsProcessed: this.itemsProcessed };
  }
}
