import type { AsyncChannel } from './AsyncChannel.js';
import type { ProcessorItem } from './ProcessorItem.js';
import type { VertexMetrics } from '../metrics/BlitzJobMetrics.js';
import type { SnapshotStore } from '../snapshot/SnapshotStore.js';
import { LatencyTracker } from '../metrics/LatencyTracker.js';
import { ProcessingGuarantee } from '../JobConfig.js';

const ABORTED = Symbol('aborted');

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | typeof ABORTED> {
  if (signal.aborted) return Promise.resolve(ABORTED);
  return new Promise<T | typeof ABORTED>((resolve, reject) => {
    const onAbort = (): void => resolve(ABORTED);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      v => { signal.removeEventListener('abort', onAbort); resolve(v); },
      e => { signal.removeEventListener('abort', onAbort); reject(e); },
    );
  });
}

export interface ProcessorTaskletConfig {
  readonly vertexName: string;
  readonly processorIndex: number;
  readonly inboxes: AsyncChannel<ProcessorItem>[];
  readonly outbox: AsyncChannel<ProcessorItem>;
  readonly operator: (item: ProcessorItem) => ProcessorItem[];
  readonly guarantee: ProcessingGuarantee;
}

interface TaskletState {
  itemsIn: number;
  itemsOut: number;
}

/**
 * ProcessorTasklet — per-vertex processing loop with Chandy-Lamport barrier alignment.
 *
 * Wraps an operator function, manages one or more inboxes and a single outbox.
 * Implements barrier alignment for multi-input vertices:
 *   - EXACTLY_ONCE: buffers post-barrier items from an input until all inputs have barriers
 *   - AT_LEAST_ONCE: immediate save on first barrier (no alignment)
 *   - NONE: barriers are dropped entirely
 *
 * Tracks per-vertex metrics: itemsIn, itemsOut, queueSize, latency.
 */
export class ProcessorTasklet {
  private readonly config: ProcessorTaskletConfig;
  private readonly latencyTracker = new LatencyTracker(1024);

  private _itemsIn = 0;
  private _itemsOut = 0;

  /** Pending barrier injected externally via injectBarrier(). */
  private _pendingInjectedBarrier: string | null = null;

  constructor(config: ProcessorTaskletConfig) {
    this.config = config;
  }

  /**
   * Run the processing loop. Reads from all inboxes, applies the operator,
   * writes results to outbox. Handles barriers and EOS according to the
   * processing guarantee.
   */
  async run(signal: AbortSignal): Promise<void> {
    const { inboxes, outbox, operator, guarantee } = this.config;
    const inputCount = inboxes.length;

    // Barrier alignment state (exactly-once only)
    const receivedBarriers = new Set<number>(); // ordinals that have sent barrier
    const postBarrierBuffers: ProcessorItem[][] = Array.from({ length: inputCount }, () => []);
    let currentBarrierSnapshotId: string | null = null;
    const eosReceived = new Set<number>();

    // Round-robin cursor for multi-input
    let cursor = 0;

    try {
      while (!signal.aborted) {
        // Check for externally injected barrier
        if (this._pendingInjectedBarrier !== null) {
          const snapshotId = this._pendingInjectedBarrier;
          this._pendingInjectedBarrier = null;

          if (guarantee !== ProcessingGuarantee.NONE) {
            // For single-input, just forward the barrier
            // For multi-input, treat as barrier on all inputs simultaneously
            if (inputCount === 1) {
              await outbox.send({ type: 'barrier', snapshotId });
            } else {
              // Inject barrier: emit immediately since it's an external injection
              await outbox.send({ type: 'barrier', snapshotId });
            }
          }
        }

        // All inputs exhausted
        if (eosReceived.size === inputCount) {
          await outbox.send({ type: 'eos' });
          return;
        }

        // Find next active input (skip completed ones)
        let attempts = 0;
        while (eosReceived.has(cursor) && attempts < inputCount) {
          cursor = (cursor + 1) % inputCount;
          attempts++;
        }
        if (attempts >= inputCount) {
          // All done
          await outbox.send({ type: 'eos' });
          return;
        }

        const ordinal = cursor;
        cursor = (cursor + 1) % inputCount;

        const inbox = inboxes[ordinal];
        const result = await raceAbort(inbox.receive(), signal);
        if (result === ABORTED) return;
        const item = result;

        switch (item.type) {
          case 'barrier': {
            if (guarantee === ProcessingGuarantee.NONE) {
              // Drop barriers in NONE mode
              break;
            }

            if (guarantee === ProcessingGuarantee.AT_LEAST_ONCE) {
              // At-least-once: emit barrier immediately on first input's barrier
              if (!receivedBarriers.has(ordinal)) {
                receivedBarriers.add(ordinal);
                if (receivedBarriers.size === 1) {
                  // First barrier from any input: emit immediately
                  await outbox.send(item);
                }
                if (receivedBarriers.size === inputCount) {
                  // All inputs have barriers — reset for next cycle
                  receivedBarriers.clear();
                }
              }
              break;
            }

            // EXACTLY_ONCE: barrier alignment
            receivedBarriers.add(ordinal);
            currentBarrierSnapshotId = item.snapshotId;

            if (receivedBarriers.size === inputCount) {
              // All inputs have reported barrier — emit barrier and flush buffers
              await outbox.send({ type: 'barrier', snapshotId: currentBarrierSnapshotId });

              // Flush post-barrier buffers
              for (let i = 0; i < inputCount; i++) {
                for (const buffered of postBarrierBuffers[i]) {
                  await this.processAndEmit(buffered, operator, outbox);
                }
                postBarrierBuffers[i].length = 0;
              }

              receivedBarriers.clear();
              currentBarrierSnapshotId = null;
            }
            break;
          }

          case 'data': {
            // In exactly-once mode, if this ordinal already sent its barrier,
            // buffer the data until all inputs have barriers
            if (
              guarantee === ProcessingGuarantee.EXACTLY_ONCE &&
              receivedBarriers.has(ordinal)
            ) {
              postBarrierBuffers[ordinal].push(item);
              break;
            }

            await this.processAndEmit(item, operator, outbox);
            break;
          }

          case 'watermark':
            await outbox.send(item);
            break;

          case 'eos':
            eosReceived.add(ordinal);
            break;
        }
      }
    } catch (err) {
      if (signal.aborted) return;
      throw err;
    }
  }

  /**
   * Inject a snapshot barrier into the tasklet externally.
   * The barrier will be emitted on the next processing cycle.
   */
  injectBarrier(snapshotId: string): void {
    this._pendingInjectedBarrier = snapshotId;
  }

  /**
   * Save tasklet state to a SnapshotStore. Returns the size in bytes.
   */
  async saveSnapshot(snapshotId: string, store: SnapshotStore): Promise<number> {
    const state: TaskletState = {
      itemsIn: this._itemsIn,
      itemsOut: this._itemsOut,
    };
    await store.saveProcessorState(
      snapshotId,
      this.config.vertexName,
      this.config.processorIndex,
      state,
    );
    const encoded = new TextEncoder().encode(JSON.stringify(state));
    return encoded.byteLength;
  }

  /**
   * Restore tasklet state from a SnapshotStore.
   */
  async restoreSnapshot(snapshotId: string, store: SnapshotStore): Promise<void> {
    const state = await store.loadProcessorState(
      snapshotId,
      this.config.vertexName,
      this.config.processorIndex,
    ) as TaskletState | null;
    if (state !== null) {
      this._itemsIn = state.itemsIn;
      this._itemsOut = state.itemsOut;
    }
  }

  /**
   * Get current per-vertex metrics.
   */
  getMetrics(): VertexMetrics {
    const totalQueueSize = this.config.inboxes.reduce((sum, ch) => sum + ch.size, 0);
    return {
      name: this.config.vertexName,
      type: 'operator',
      itemsIn: this._itemsIn,
      itemsOut: this._itemsOut,
      queueSize: totalQueueSize,
      latencyP50Ms: this.latencyTracker.getP50(),
      latencyP99Ms: this.latencyTracker.getP99(),
      latencyMaxMs: this.latencyTracker.getMax(),
    };
  }

  private async processAndEmit(
    item: ProcessorItem,
    operator: (item: ProcessorItem) => ProcessorItem[],
    outbox: AsyncChannel<ProcessorItem>,
  ): Promise<void> {
    if (item.type === 'data') {
      this._itemsIn++;

      const results = operator(item);
      for (const out of results) {
        await outbox.send(out);
        this._itemsOut++;
      }

      const latency = Date.now() - item.timestamp;
      this.latencyTracker.record(latency);
    }
  }
}
