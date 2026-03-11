import type { AsyncChannel } from './AsyncChannel.js';
import type { ProcessorItem } from './ProcessorItem.js';
import type { Sink } from '@zenystx/helios-blitz/sink/Sink.js';

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
 * SinkProcessor — wraps a Sink<T>, drains inbox channel items.
 *
 * Handles barriers (save state), EOS (flush sink, signal completion).
 * Terminal vertex in the DAG — no outbox.
 */
export class SinkProcessor<T> {
  private readonly sink: Sink<T>;
  private readonly inbox: AsyncChannel<ProcessorItem>;
  private readonly vertexName: string;
  private readonly processorIndex: number;

  private itemsWritten = 0;

  constructor(
    sink: Sink<T>,
    inbox: AsyncChannel<ProcessorItem>,
    vertexName: string,
    processorIndex: number,
  ) {
    this.sink = sink;
    this.inbox = inbox;
    this.vertexName = vertexName;
    this.processorIndex = processorIndex;
  }

  async run(signal: AbortSignal): Promise<{ completed: boolean }> {
    try {
      while (!signal.aborted) {
        const result = await raceAbort(this.inbox.receive(), signal);
        if (result === ABORTED) break;
        const item = result;

        switch (item.type) {
          case 'data':
            await this.sink.write(item.value as T);
            this.itemsWritten++;
            break;
          case 'barrier':
            break;
          case 'watermark':
            break;
          case 'eos':
            if ('flush' in this.sink && typeof (this.sink as any).flush === 'function') {
              await (this.sink as any).flush();
            }
            return { completed: true };
        }
      }

      return { completed: false };
    } catch (err) {
      if (signal.aborted) return { completed: false };
      throw err;
    }
  }

  getSnapshotState(): unknown {
    return { itemsWritten: this.itemsWritten };
  }

  getItemsWritten(): number {
    return this.itemsWritten;
  }
}
