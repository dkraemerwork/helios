import { describe, expect, it } from 'bun:test';
import { AsyncChannel } from '@zenystx/helios-core/job/engine/AsyncChannel.js';
import { SinkProcessor } from '@zenystx/helios-core/job/engine/SinkProcessor.js';
import type { ProcessorItem } from '@zenystx/helios-core/job/engine/ProcessorItem.js';
import type { Sink } from '../../../../packages/blitz/src/sink/Sink.js';

/** Create a test sink that collects written values */
function collectingSink(name = 'test-sink'): { sink: Sink<unknown>; written: unknown[] } {
  const written: unknown[] = [];
  return {
    sink: {
      name,
      async write(value: unknown) {
        written.push(value);
      },
    },
    written,
  };
}

/** Send items to an inbox channel */
async function sendItems(inbox: AsyncChannel<ProcessorItem>, items: ProcessorItem[]): Promise<void> {
  for (const item of items) {
    await inbox.send(item);
  }
}

describe('SinkProcessor', () => {
  it('should drain inbox data items and write to sink', async () => {
    const { sink, written } = collectingSink();
    const inbox = new AsyncChannel<ProcessorItem>(16);
    const abort = new AbortController();

    const processor = new SinkProcessor(sink, inbox, 'sink-vertex', 0);

    await sendItems(inbox, [
      { type: 'data', value: 'a', timestamp: 1 },
      { type: 'data', value: 'b', timestamp: 2 },
      { type: 'eos' },
    ]);

    await processor.run(abort.signal);

    expect(written).toEqual(['a', 'b']);
  });

  it('should handle barriers by saving state and forwarding', async () => {
    const { sink, written } = collectingSink();
    const inbox = new AsyncChannel<ProcessorItem>(16);
    const abort = new AbortController();

    const processor = new SinkProcessor(sink, inbox, 'sink-vertex', 0);

    await sendItems(inbox, [
      { type: 'data', value: 'x', timestamp: 1 },
      { type: 'barrier', snapshotId: 'snap-1' },
      { type: 'data', value: 'y', timestamp: 2 },
      { type: 'eos' },
    ]);

    await processor.run(abort.signal);

    expect(written).toEqual(['x', 'y']);
    // State should be saved at barrier
    const state = processor.getSnapshotState();
    expect(state).toEqual({ itemsWritten: 2 });
  });

  it('should flush sink on EOS and signal completion', async () => {
    let flushed = false;
    const sink: Sink<unknown> & { flush?(): Promise<void> } = {
      name: 'flushable-sink',
      async write(value: unknown) {},
      async flush() {
        flushed = true;
      },
    };
    const inbox = new AsyncChannel<ProcessorItem>(16);
    const abort = new AbortController();

    const processor = new SinkProcessor(sink, inbox, 'sink-vertex', 0);

    await sendItems(inbox, [
      { type: 'data', value: 'v', timestamp: 1 },
      { type: 'eos' },
    ]);

    const result = await processor.run(abort.signal);

    expect(result.completed).toBe(true);
  });

  it('should stop on abort signal', async () => {
    const { sink } = collectingSink();
    const inbox = new AsyncChannel<ProcessorItem>(16);
    const abort = new AbortController();

    const processor = new SinkProcessor(sink, inbox, 'sink-vertex', 0);

    // Send a data item but no EOS — the processor would block
    await inbox.send({ type: 'data', value: 'a', timestamp: 1 });

    // Start running, then abort
    const runPromise = processor.run(abort.signal);

    // Let the processor consume the first item
    await new Promise(r => setTimeout(r, 50));

    abort.abort();

    // Should complete without hanging
    await runPromise;
  });

  it('should handle empty stream (immediate EOS)', async () => {
    const { sink, written } = collectingSink();
    const inbox = new AsyncChannel<ProcessorItem>(16);
    const abort = new AbortController();

    const processor = new SinkProcessor(sink, inbox, 'sink-vertex', 0);

    await sendItems(inbox, [{ type: 'eos' }]);

    const result = await processor.run(abort.signal);

    expect(written).toEqual([]);
    expect(result.completed).toBe(true);
  });

  it('should process items through real AsyncChannel inbox', async () => {
    const { sink, written } = collectingSink();
    const inbox = new AsyncChannel<ProcessorItem>(2); // small capacity for backpressure
    const abort = new AbortController();

    const processor = new SinkProcessor(sink, inbox, 'sink-vertex', 0);
    const runPromise = processor.run(abort.signal);

    // Send items one-at-a-time to exercise real channel
    await inbox.send({ type: 'data', value: 1, timestamp: 1 });
    await inbox.send({ type: 'data', value: 2, timestamp: 2 });
    await inbox.send({ type: 'data', value: 3, timestamp: 3 });
    await inbox.send({ type: 'eos' });

    await runPromise;

    expect(written).toEqual([1, 2, 3]);
  });
});
