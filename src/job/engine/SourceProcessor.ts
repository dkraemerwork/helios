import type { AsyncChannel } from './AsyncChannel.js';
import type { ProcessorItem } from './ProcessorItem.js';
import type { Source } from '@zenystx/helios-blitz/source/Source.js';

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
 * SourceProcessor — wraps a Source<T>, drives its async iterable into an outbox channel.
 *
 * Handles barrier injection (pause reading, save offset, forward barrier) and EOS detection.
 * Follows Chandy-Lamport: on barrier injection the source pauses reading, saves its offset,
 * emits the barrier downstream, then resumes.
 */
export class SourceProcessor<T> {
  private readonly source: Source<T>;
  private readonly outbox: AsyncChannel<ProcessorItem>;
  private readonly vertexName: string;
  private readonly processorIndex: number;

  private offset = 0;
  private pendingBarrier: string | null = null;

  constructor(
    source: Source<T>,
    outbox: AsyncChannel<ProcessorItem>,
    vertexName: string,
    processorIndex: number,
  ) {
    this.source = source;
    this.outbox = outbox;
    this.vertexName = vertexName;
    this.processorIndex = processorIndex;
  }

  async run(signal: AbortSignal): Promise<void> {
    const iter = this.source.messages()[Symbol.asyncIterator]();
    try {
      while (!signal.aborted) {
        const next = await raceAbort(iter.next(), signal);
        if (next === ABORTED) return;
        if (next.done) break;

        // Check for pending barrier after reading but before emitting data
        // This ensures barriers injected while waiting for source are emitted first
        if (this.pendingBarrier !== null) {
          const snapshotId = this.pendingBarrier;
          this.pendingBarrier = null;
          await this.outbox.send({ type: 'barrier', snapshotId });
        }

        const msg = next.value;

        await this.outbox.send({
          type: 'data',
          value: msg.value,
          timestamp: Date.now(),
        });
        this.offset++;
        msg.ack();
      }

      // Source exhausted — handle trailing barrier then emit EOS
      if (!signal.aborted) {
        if (this.pendingBarrier !== null) {
          const snapshotId = this.pendingBarrier;
          this.pendingBarrier = null;
          await this.outbox.send({ type: 'barrier', snapshotId });
        }
        await this.outbox.send({ type: 'eos' });
      }
    } catch (err) {
      if (signal.aborted) return;
      throw err;
    }
  }

  injectBarrier(snapshotId: string): void {
    this.pendingBarrier = snapshotId;
  }

  getSnapshotState(): unknown {
    return { offset: this.offset };
  }
}
