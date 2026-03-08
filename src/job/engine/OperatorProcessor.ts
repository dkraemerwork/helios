import type { AsyncChannel } from './AsyncChannel.js';
import type { ProcessorItem } from './ProcessorItem.js';

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
 * Stateless transformation processor — cooperative, no blocking I/O.
 */
export class OperatorProcessor {
  private readonly fn: (value: unknown) => unknown;
  private readonly mode: 'map' | 'filter' | 'flatMap';
  private readonly inbox: AsyncChannel<ProcessorItem>;
  private readonly outbox: AsyncChannel<ProcessorItem>;
  private readonly vertexName: string;
  private readonly processorIndex: number;

  private itemsProcessed = 0;

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
    try {
      while (!signal.aborted) {
        const result = await raceAbort(this.inbox.receive(), signal);
        if (result === ABORTED) return;
        const item = result;

        switch (item.type) {
          case 'data': {
            const transformed = this.fn(item.value);
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
            this.itemsProcessed++;
            break;
          }
          case 'barrier':
            await this.outbox.send(item);
            break;
          case 'watermark':
            await this.outbox.send(item);
            break;
          case 'eos':
            await this.outbox.send({ type: 'eos' });
            return;
        }
      }
    } catch (err) {
      if (signal.aborted) return;
      throw err;
    }
  }

  getSnapshotState(): unknown {
    return { itemsProcessed: this.itemsProcessed };
  }
}
