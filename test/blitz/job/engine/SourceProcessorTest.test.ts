import { describe, expect, it } from 'bun:test';
import { AsyncChannel } from '@zenystx/helios-core/job/engine/AsyncChannel.js';
import { SourceProcessor } from '@zenystx/helios-core/job/engine/SourceProcessor.js';
import type { ProcessorItem } from '@zenystx/helios-core/job/engine/ProcessorItem.js';
import type { Source, SourceMessage } from '../../../../packages/blitz/src/source/Source.js';
import { StringCodec } from '../../../../packages/blitz/src/codec/BlitzCodec.js';

/** Create a test source from an array of values */
function arraySource(values: string[], name = 'test-source'): Source<string> {
  return {
    name,
    codec: StringCodec(),
    async *messages(): AsyncIterable<SourceMessage<string>> {
      for (const v of values) {
        yield { value: v, ack: () => {}, nak: () => {} };
      }
    },
  };
}

/** Create a test source from an async iterable with external control */
function controllableSource(name = 'ctrl-source'): {
  source: Source<string>;
  push: (v: string) => void;
  end: () => void;
} {
  const queue: string[] = [];
  let resolve: (() => void) | null = null;
  let done = false;

  const source: Source<string> = {
    name,
    codec: StringCodec(),
    async *messages() {
      while (true) {
        if (queue.length > 0) {
          const v = queue.shift()!;
          yield { value: v, ack: () => {}, nak: () => {} };
        } else if (done) {
          return;
        } else {
          await new Promise<void>(r => { resolve = r; });
        }
      }
    },
  };

  return {
    source,
    push(v: string) {
      queue.push(v);
      resolve?.();
      resolve = null;
    },
    end() {
      done = true;
      resolve?.();
      resolve = null;
    },
  };
}

describe('SourceProcessor', () => {
  it('should emit source items as data ProcessorItems to outbox', async () => {
    const src = arraySource(['hello', 'world']);
    const outbox = new AsyncChannel<ProcessorItem>(16);
    const abort = new AbortController();

    const processor = new SourceProcessor(src, outbox, 'src-vertex', 0);
    const runPromise = processor.run(abort.signal);

    // Wait for items to flow
    const item1 = await outbox.receive();
    const item2 = await outbox.receive();

    expect(item1.type).toBe('data');
    if (item1.type === 'data') expect(item1.value).toBe('hello');
    expect(item2.type).toBe('data');
    if (item2.type === 'data') expect(item2.value).toBe('world');

    await runPromise;
  });

  it('should emit EOS when source is exhausted', async () => {
    const src = arraySource(['one']);
    const outbox = new AsyncChannel<ProcessorItem>(16);
    const abort = new AbortController();

    const processor = new SourceProcessor(src, outbox, 'src-vertex', 0);
    const runPromise = processor.run(abort.signal);

    const item1 = await outbox.receive();
    expect(item1.type).toBe('data');

    const eos = await outbox.receive();
    expect(eos.type).toBe('eos');

    await runPromise;
  });

  it('should pause reading on barrier injection and forward the barrier', async () => {
    const { source, push, end } = controllableSource();
    const outbox = new AsyncChannel<ProcessorItem>(16);
    const abort = new AbortController();

    const processor = new SourceProcessor(source, outbox, 'src-vertex', 0);
    const runPromise = processor.run(abort.signal);

    push('a');
    const item1 = await outbox.receive();
    expect(item1.type).toBe('data');

    // Inject a barrier, then push next item to trigger the loop iteration
    processor.injectBarrier('snap-1');
    push('b');

    // The barrier should appear before the data item
    const barrier = await outbox.receive();
    expect(barrier.type).toBe('barrier');
    if (barrier.type === 'barrier') expect(barrier.snapshotId).toBe('snap-1');

    // After barrier, the data item follows
    const item2 = await outbox.receive();
    expect(item2.type).toBe('data');
    if (item2.type === 'data') expect(item2.value).toBe('b');

    end();
    await runPromise;
  });

  it('should save offset state on barrier injection', async () => {
    const { source, push, end } = controllableSource();
    const outbox = new AsyncChannel<ProcessorItem>(16);
    const abort = new AbortController();

    const processor = new SourceProcessor(source, outbox, 'src-vertex', 0);
    const runPromise = processor.run(abort.signal);

    push('x');
    push('y');
    await outbox.receive(); // x
    await outbox.receive(); // y

    processor.injectBarrier('snap-2');
    push('z'); // trigger the loop to process the barrier
    await outbox.receive(); // barrier
    await outbox.receive(); // z data item

    // Offset should reflect items read so far (x, y, z = 3)
    const state = processor.getSnapshotState();
    expect(state).toEqual({ offset: 3 });

    end();
    await runPromise;
  });

  it('should stop on abort signal', async () => {
    const { source, push } = controllableSource();
    const outbox = new AsyncChannel<ProcessorItem>(16);
    const abort = new AbortController();

    const processor = new SourceProcessor(source, outbox, 'src-vertex', 0);
    const runPromise = processor.run(abort.signal);

    push('a');
    await outbox.receive();

    abort.abort();

    // run should complete without hanging
    await runPromise;
  });

  it('should handle empty source (immediate EOS)', async () => {
    const src = arraySource([]);
    const outbox = new AsyncChannel<ProcessorItem>(16);
    const abort = new AbortController();

    const processor = new SourceProcessor(src, outbox, 'src-vertex', 0);
    const runPromise = processor.run(abort.signal);

    const eos = await outbox.receive();
    expect(eos.type).toBe('eos');

    await runPromise;
  });

  it('should write items through real AsyncChannel with backpressure', async () => {
    const { source, push, end } = controllableSource();
    const outbox = new AsyncChannel<ProcessorItem>(2); // small capacity
    const abort = new AbortController();

    const processor = new SourceProcessor(source, outbox, 'src-vertex', 0);
    const runPromise = processor.run(abort.signal);

    // Push items that will fill the outbox
    push('a');
    push('b');
    push('c');

    // Drain to let processor proceed
    const items: ProcessorItem[] = [];
    items.push(await outbox.receive());
    items.push(await outbox.receive());
    items.push(await outbox.receive());

    expect(items.every(i => i.type === 'data')).toBe(true);

    end();
    await runPromise;
  });
});
