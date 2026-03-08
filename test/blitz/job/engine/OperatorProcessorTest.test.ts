import { describe, expect, it } from 'bun:test';
import { AsyncChannel } from '@zenystx/helios-core/job/engine/AsyncChannel.js';
import { OperatorProcessor } from '@zenystx/helios-core/job/engine/OperatorProcessor.js';
import type { ProcessorItem } from '@zenystx/helios-core/job/engine/ProcessorItem.js';

/** Drain all items from a channel until EOS or timeout */
async function drainUntilEos(ch: AsyncChannel<ProcessorItem>, timeoutMs = 2000): Promise<ProcessorItem[]> {
  const items: ProcessorItem[] = [];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const item = await Promise.race([
      ch.receive(),
      new Promise<null>(r => setTimeout(() => r(null), Math.max(0, deadline - Date.now()))),
    ]);
    if (item === null) break;
    items.push(item);
    if (item.type === 'eos') break;
  }
  return items;
}

describe('OperatorProcessor', () => {
  it('should apply map function to data items', async () => {
    const inbox = new AsyncChannel<ProcessorItem>(16);
    const outbox = new AsyncChannel<ProcessorItem>(16);
    const abort = new AbortController();

    const processor = new OperatorProcessor(
      (v: unknown) => (v as string).toUpperCase(),
      'map',
      inbox,
      outbox,
      'map-vertex',
      0,
    );

    await inbox.send({ type: 'data', value: 'hello', timestamp: 1 });
    await inbox.send({ type: 'data', value: 'world', timestamp: 2 });
    await inbox.send({ type: 'eos' });

    await processor.run(abort.signal);

    const items = await drainUntilEos(outbox);
    const dataItems = items.filter(i => i.type === 'data');
    expect(dataItems).toHaveLength(2);
    expect((dataItems[0] as any).value).toBe('HELLO');
    expect((dataItems[1] as any).value).toBe('WORLD');
    expect(items[items.length - 1].type).toBe('eos');
  });

  it('should apply filter function to data items', async () => {
    const inbox = new AsyncChannel<ProcessorItem>(16);
    const outbox = new AsyncChannel<ProcessorItem>(16);
    const abort = new AbortController();

    const processor = new OperatorProcessor(
      (v: unknown) => (v as number) > 2 ? v : undefined,
      'filter',
      inbox,
      outbox,
      'filter-vertex',
      0,
    );

    await inbox.send({ type: 'data', value: 1, timestamp: 1 });
    await inbox.send({ type: 'data', value: 3, timestamp: 2 });
    await inbox.send({ type: 'data', value: 5, timestamp: 3 });
    await inbox.send({ type: 'eos' });

    await processor.run(abort.signal);

    const items = await drainUntilEos(outbox);
    const dataItems = items.filter(i => i.type === 'data');
    expect(dataItems).toHaveLength(2);
    expect((dataItems[0] as any).value).toBe(3);
    expect((dataItems[1] as any).value).toBe(5);
  });

  it('should apply flatMap function to data items', async () => {
    const inbox = new AsyncChannel<ProcessorItem>(16);
    const outbox = new AsyncChannel<ProcessorItem>(16);
    const abort = new AbortController();

    const processor = new OperatorProcessor(
      (v: unknown) => [(v as string) + '1', (v as string) + '2'],
      'flatMap',
      inbox,
      outbox,
      'flatmap-vertex',
      0,
    );

    await inbox.send({ type: 'data', value: 'a', timestamp: 1 });
    await inbox.send({ type: 'eos' });

    await processor.run(abort.signal);

    const items = await drainUntilEos(outbox);
    const dataItems = items.filter(i => i.type === 'data');
    expect(dataItems).toHaveLength(2);
    expect((dataItems[0] as any).value).toBe('a1');
    expect((dataItems[1] as any).value).toBe('a2');
  });

  it('should pass through barriers and save state', async () => {
    const inbox = new AsyncChannel<ProcessorItem>(16);
    const outbox = new AsyncChannel<ProcessorItem>(16);
    const abort = new AbortController();

    const processor = new OperatorProcessor(
      (v: unknown) => v,
      'map',
      inbox,
      outbox,
      'op-vertex',
      0,
    );

    await inbox.send({ type: 'data', value: 'a', timestamp: 1 });
    await inbox.send({ type: 'barrier', snapshotId: 'snap-1' });
    await inbox.send({ type: 'data', value: 'b', timestamp: 2 });
    await inbox.send({ type: 'eos' });

    await processor.run(abort.signal);

    const items = await drainUntilEos(outbox);
    expect(items).toHaveLength(4); // data, barrier, data, eos

    const barrier = items.find(i => i.type === 'barrier');
    expect(barrier).toBeDefined();
    if (barrier?.type === 'barrier') expect(barrier.snapshotId).toBe('snap-1');

    const state = processor.getSnapshotState();
    expect(state).toEqual({ itemsProcessed: 2 });
  });

  it('should forward watermarks', async () => {
    const inbox = new AsyncChannel<ProcessorItem>(16);
    const outbox = new AsyncChannel<ProcessorItem>(16);
    const abort = new AbortController();

    const processor = new OperatorProcessor(
      (v: unknown) => v,
      'map',
      inbox,
      outbox,
      'op-vertex',
      0,
    );

    await inbox.send({ type: 'watermark', timestamp: 100 });
    await inbox.send({ type: 'data', value: 'x', timestamp: 1 });
    await inbox.send({ type: 'eos' });

    await processor.run(abort.signal);

    const items = await drainUntilEos(outbox);
    const wm = items.find(i => i.type === 'watermark');
    expect(wm).toBeDefined();
    if (wm?.type === 'watermark') expect(wm.timestamp).toBe(100);
  });

  it('should stop on abort signal', async () => {
    const inbox = new AsyncChannel<ProcessorItem>(16);
    const outbox = new AsyncChannel<ProcessorItem>(16);
    const abort = new AbortController();

    const processor = new OperatorProcessor(
      (v: unknown) => v,
      'map',
      inbox,
      outbox,
      'op-vertex',
      0,
    );

    await inbox.send({ type: 'data', value: 'a', timestamp: 1 });

    const runPromise = processor.run(abort.signal);

    await new Promise(r => setTimeout(r, 50));
    abort.abort();

    await runPromise;
  });

  it('should drive data through real AsyncChannel inboxes and outboxes', async () => {
    const inbox = new AsyncChannel<ProcessorItem>(2); // small for backpressure
    const outbox = new AsyncChannel<ProcessorItem>(2);
    const abort = new AbortController();

    const processor = new OperatorProcessor(
      (v: unknown) => (v as number) * 10,
      'map',
      inbox,
      outbox,
      'op-vertex',
      0,
    );

    const runPromise = processor.run(abort.signal);

    // Send items interleaved with receiving to exercise backpressure
    await inbox.send({ type: 'data', value: 1, timestamp: 1 });
    const item1 = await outbox.receive();
    expect(item1.type).toBe('data');
    if (item1.type === 'data') expect(item1.value).toBe(10);

    await inbox.send({ type: 'data', value: 2, timestamp: 2 });
    const item2 = await outbox.receive();
    if (item2.type === 'data') expect(item2.value).toBe(20);

    await inbox.send({ type: 'eos' });
    const eos = await outbox.receive();
    expect(eos.type).toBe('eos');

    await runPromise;
  });
});
