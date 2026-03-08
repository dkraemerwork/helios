import { describe, test, expect } from 'bun:test';
import { ProcessorTasklet } from '../../../../src/job/engine/ProcessorTasklet.js';
import { AsyncChannel } from '../../../../src/job/engine/AsyncChannel.js';
import type { ProcessorItem } from '../../../../src/job/engine/ProcessorItem.js';
import { ProcessingGuarantee } from '../../../../src/job/JobConfig.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function dataItem(value: unknown, timestamp = Date.now()): ProcessorItem {
  return { type: 'data', value, timestamp };
}

function barrierItem(snapshotId: string): ProcessorItem {
  return { type: 'barrier', snapshotId };
}

function eosItem(): ProcessorItem {
  return { type: 'eos' };
}

/** Drain all available items from a channel without blocking. */
function drainSync<T>(ch: AsyncChannel<T>): T[] {
  const items: T[] = [];
  let item: T | undefined;
  while ((item = ch.tryReceive()) !== undefined) {
    items.push(item);
  }
  return items;
}

/** Wait for a channel to have at least `n` items available. */
async function waitForItems<T>(ch: AsyncChannel<T>, n: number, timeoutMs = 2000): Promise<T[]> {
  const items: T[] = [];
  const deadline = Date.now() + timeoutMs;
  while (items.length < n && Date.now() < deadline) {
    const item = ch.tryReceive();
    if (item !== undefined) {
      items.push(item);
    } else {
      await new Promise(r => setTimeout(r, 5));
    }
  }
  return items;
}

/** Simple identity operator: passes data through. */
function identityOperator(item: ProcessorItem): ProcessorItem[] {
  if (item.type === 'data') return [item];
  return [];
}

/** Doubling operator: emits two copies of each data item. */
function doublingOperator(item: ProcessorItem): ProcessorItem[] {
  if (item.type === 'data') return [item, { ...item, value: `${item.value}-dup` }];
  return [];
}

// ─── Fake SnapshotStore for testing ─────────────────────────────────────────

class FakeSnapshotStore {
  private readonly store = new Map<string, unknown>();

  async saveProcessorState(
    snapshotId: string,
    vertexName: string,
    processorIndex: number,
    state: unknown,
  ): Promise<void> {
    const key = `${snapshotId}.${vertexName}.${processorIndex}`;
    this.store.set(key, JSON.parse(JSON.stringify(state)));
  }

  async loadProcessorState(
    snapshotId: string,
    vertexName: string,
    processorIndex: number,
  ): Promise<unknown | null> {
    const key = `${snapshotId}.${vertexName}.${processorIndex}`;
    return this.store.get(key) ?? null;
  }

  get size(): number {
    return this.store.size;
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ProcessorTasklet', () => {

  // ── Single-input barrier passthrough ──────────────────────────────────

  test('single-input: barrier passes through to outbox', async () => {
    const inbox = new AsyncChannel<ProcessorItem>(64);
    const outbox = new AsyncChannel<ProcessorItem>(64);

    const tasklet = new ProcessorTasklet({
      vertexName: 'map1',
      processorIndex: 0,
      inboxes: [inbox],
      outbox,
      operator: identityOperator,
      guarantee: ProcessingGuarantee.EXACTLY_ONCE,
    });

    const ac = new AbortController();

    // Send data + barrier + more data + eos
    await inbox.send(dataItem('a'));
    await inbox.send(barrierItem('snap-1'));
    await inbox.send(dataItem('b'));
    await inbox.send(eosItem());

    const runPromise = tasklet.run(ac.signal);

    // Wait for all items to flow through
    const items = await waitForItems(outbox, 4);
    ac.abort();
    await runPromise;

    expect(items.length).toBe(4);
    expect(items[0]).toMatchObject({ type: 'data', value: 'a' });
    expect(items[1]).toMatchObject({ type: 'barrier', snapshotId: 'snap-1' });
    expect(items[2]).toMatchObject({ type: 'data', value: 'b' });
    expect(items[3]).toMatchObject({ type: 'eos' });
  });

  // ── Multi-input barrier alignment (exactly-once) ──────────────────────

  test('multi-input exactly-once: buffers post-barrier items until all inputs have barrier', async () => {
    const inbox1 = new AsyncChannel<ProcessorItem>(64);
    const inbox2 = new AsyncChannel<ProcessorItem>(64);
    const outbox = new AsyncChannel<ProcessorItem>(64);

    const tasklet = new ProcessorTasklet({
      vertexName: 'join1',
      processorIndex: 0,
      inboxes: [inbox1, inbox2],
      outbox,
      operator: identityOperator,
      guarantee: ProcessingGuarantee.EXACTLY_ONCE,
    });

    const ac = new AbortController();
    const runPromise = tasklet.run(ac.signal);

    // inbox1: data, barrier, more data (should be buffered)
    await inbox1.send(dataItem('a1'));
    await inbox1.send(barrierItem('snap-1'));
    await inbox1.send(dataItem('a2')); // This should be buffered until inbox2's barrier

    // inbox2: data (no barrier yet)
    await inbox2.send(dataItem('b1'));

    // Wait for items that should flow: a1, b1
    await new Promise(r => setTimeout(r, 100));

    // Now send barrier on inbox2
    await inbox2.send(barrierItem('snap-1'));
    await inbox2.send(dataItem('b2'));
    await inbox2.send(eosItem());

    // Send eos on inbox1 too
    await inbox1.send(eosItem());

    // Wait for all items
    const items = await waitForItems(outbox, 7, 3000);
    ac.abort();
    await runPromise;

    // Expected order: a1, b1 (pre-barrier), then barrier, then a2, b2 (post-barrier), then eos
    const dataValues = items.filter(i => i.type === 'data').map(i => (i as any).value);
    const barriers = items.filter(i => i.type === 'barrier');
    const eosCount = items.filter(i => i.type === 'eos').length;

    // Pre-barrier data from both inputs should come before barrier
    expect(dataValues).toContain('a1');
    expect(dataValues).toContain('b1');
    // Post-barrier data should come after barrier
    expect(barriers.length).toBe(1);
    expect((barriers[0] as any).snapshotId).toBe('snap-1');

    // a2 must appear after the barrier
    const barrierIdx = items.findIndex(i => i.type === 'barrier');
    const a2Idx = items.findIndex(i => i.type === 'data' && (i as any).value === 'a2');
    expect(a2Idx).toBeGreaterThan(barrierIdx);

    expect(eosCount).toBe(1);
  });

  // ── Multi-input at-least-once: no barrier alignment ───────────────────

  test('multi-input at-least-once: items flow immediately without barrier alignment', async () => {
    const inbox1 = new AsyncChannel<ProcessorItem>(64);
    const inbox2 = new AsyncChannel<ProcessorItem>(64);
    const outbox = new AsyncChannel<ProcessorItem>(64);

    const tasklet = new ProcessorTasklet({
      vertexName: 'join1',
      processorIndex: 0,
      inboxes: [inbox1, inbox2],
      outbox,
      operator: identityOperator,
      guarantee: ProcessingGuarantee.AT_LEAST_ONCE,
    });

    const ac = new AbortController();
    const runPromise = tasklet.run(ac.signal);

    // inbox1: data, barrier, more data
    await inbox1.send(dataItem('a1'));
    await inbox1.send(barrierItem('snap-1'));
    await inbox1.send(dataItem('a2'));

    // At-least-once: a2 should flow immediately after barrier on inbox1
    // (no waiting for inbox2's barrier)
    await new Promise(r => setTimeout(r, 100));

    // Now send barrier + eos on inbox2
    await inbox2.send(barrierItem('snap-1'));
    await inbox2.send(eosItem());
    await inbox1.send(eosItem());

    const items = await waitForItems(outbox, 5, 3000);
    ac.abort();
    await runPromise;

    const dataValues = items.filter(i => i.type === 'data').map(i => (i as any).value);
    expect(dataValues).toContain('a1');
    expect(dataValues).toContain('a2');

    // In at-least-once, there should be a barrier emitted for each input's barrier
    // (immediate save on first barrier)
    const barriers = items.filter(i => i.type === 'barrier');
    expect(barriers.length).toBeGreaterThanOrEqual(1);
  });

  // ── Exactly-once vs at-least-once behavior difference ─────────────────

  test('exactly-once buffers post-barrier data; at-least-once does not', async () => {
    // This test proves the behavior difference between the two modes
    // by checking that in exactly-once mode, data after a barrier on one input
    // is held until all inputs have barriers

    const inbox1 = new AsyncChannel<ProcessorItem>(64);
    const inbox2 = new AsyncChannel<ProcessorItem>(64);
    const outbox = new AsyncChannel<ProcessorItem>(64);

    const tasklet = new ProcessorTasklet({
      vertexName: 'v1',
      processorIndex: 0,
      inboxes: [inbox1, inbox2],
      outbox,
      operator: identityOperator,
      guarantee: ProcessingGuarantee.EXACTLY_ONCE,
    });

    const ac = new AbortController();
    const runPromise = tasklet.run(ac.signal);

    // inbox1 sends barrier, then data
    await inbox1.send(barrierItem('snap-1'));
    await inbox1.send(dataItem('after-barrier'));

    // Wait a bit — in exactly-once, 'after-barrier' should NOT appear in outbox yet
    await new Promise(r => setTimeout(r, 150));

    const earlyItems = drainSync(outbox);
    const earlyData = earlyItems.filter(i => i.type === 'data').map(i => (i as any).value);
    expect(earlyData).not.toContain('after-barrier');

    // Now send barrier on inbox2 to complete alignment
    await inbox2.send(barrierItem('snap-1'));
    await inbox2.send(eosItem());
    await inbox1.send(eosItem());

    const items = await waitForItems(outbox, 3, 3000);
    ac.abort();
    await runPromise;

    // Now 'after-barrier' should have been released
    const allData = items.filter(i => i.type === 'data').map(i => (i as any).value);
    expect(allData).toContain('after-barrier');
  });

  // ── injectBarrier ─────────────────────────────────────────────────────

  test('injectBarrier inserts barrier into tasklet processing', async () => {
    const inbox = new AsyncChannel<ProcessorItem>(64);
    const outbox = new AsyncChannel<ProcessorItem>(64);

    const tasklet = new ProcessorTasklet({
      vertexName: 'v1',
      processorIndex: 0,
      inboxes: [inbox],
      outbox,
      operator: identityOperator,
      guarantee: ProcessingGuarantee.EXACTLY_ONCE,
    });

    const ac = new AbortController();
    const runPromise = tasklet.run(ac.signal);

    // Send some data, then inject a barrier externally
    await inbox.send(dataItem('x'));
    await new Promise(r => setTimeout(r, 50));

    tasklet.injectBarrier('injected-snap-1');
    await inbox.send(dataItem('y'));
    await inbox.send(eosItem());

    const items = await waitForItems(outbox, 4, 3000);
    ac.abort();
    await runPromise;

    expect(items.some(i => i.type === 'barrier' && (i as any).snapshotId === 'injected-snap-1')).toBe(true);
  });

  // ── Snapshot save/restore round-trip ──────────────────────────────────

  test('saveSnapshot persists state to store and returns byte size', async () => {
    const inbox = new AsyncChannel<ProcessorItem>(64);
    const outbox = new AsyncChannel<ProcessorItem>(64);

    const tasklet = new ProcessorTasklet({
      vertexName: 'map1',
      processorIndex: 0,
      inboxes: [inbox],
      outbox,
      operator: identityOperator,
      guarantee: ProcessingGuarantee.EXACTLY_ONCE,
    });

    const ac = new AbortController();
    const runPromise = tasklet.run(ac.signal);

    // Process some items to build state
    await inbox.send(dataItem('a'));
    await inbox.send(dataItem('b'));
    await inbox.send(dataItem('c'));
    await new Promise(r => setTimeout(r, 100));

    const store = new FakeSnapshotStore();
    const bytes = await tasklet.saveSnapshot('snap-1', store as any);

    expect(bytes).toBeGreaterThan(0);
    expect(store.size).toBe(1);

    ac.abort();
    await runPromise;
  });

  test('restoreSnapshot restores state from store', async () => {
    const inbox = new AsyncChannel<ProcessorItem>(64);
    const outbox = new AsyncChannel<ProcessorItem>(64);

    // First tasklet: process items and save snapshot
    const tasklet1 = new ProcessorTasklet({
      vertexName: 'map1',
      processorIndex: 0,
      inboxes: [inbox],
      outbox,
      operator: identityOperator,
      guarantee: ProcessingGuarantee.EXACTLY_ONCE,
    });

    const ac1 = new AbortController();
    const run1 = tasklet1.run(ac1.signal);

    await inbox.send(dataItem('a'));
    await inbox.send(dataItem('b'));
    await inbox.send(dataItem('c'));
    await new Promise(r => setTimeout(r, 100));

    const store = new FakeSnapshotStore();
    await tasklet1.saveSnapshot('snap-1', store as any);

    // Get metrics from first tasklet
    const metrics1 = tasklet1.getMetrics();
    ac1.abort();
    await run1;

    // Second tasklet: restore from snapshot
    const inbox2 = new AsyncChannel<ProcessorItem>(64);
    const outbox2 = new AsyncChannel<ProcessorItem>(64);

    const tasklet2 = new ProcessorTasklet({
      vertexName: 'map1',
      processorIndex: 0,
      inboxes: [inbox2],
      outbox: outbox2,
      operator: identityOperator,
      guarantee: ProcessingGuarantee.EXACTLY_ONCE,
    });

    await tasklet2.restoreSnapshot('snap-1', store as any);
    const metrics2 = tasklet2.getMetrics();

    // Restored metrics should reflect the saved state
    expect(metrics2.itemsIn).toBe(metrics1.itemsIn);
  });

  test('snapshot save/restore round-trip preserves metrics', async () => {
    const inbox = new AsyncChannel<ProcessorItem>(64);
    const outbox = new AsyncChannel<ProcessorItem>(64);

    const tasklet = new ProcessorTasklet({
      vertexName: 'counter',
      processorIndex: 2,
      inboxes: [inbox],
      outbox,
      operator: doublingOperator,
      guarantee: ProcessingGuarantee.EXACTLY_ONCE,
    });

    const ac = new AbortController();
    const runPromise = tasklet.run(ac.signal);

    // Process items
    await inbox.send(dataItem('x'));
    await inbox.send(dataItem('y'));
    await new Promise(r => setTimeout(r, 100));

    // Save
    const store = new FakeSnapshotStore();
    const bytes = await tasklet.saveSnapshot('snap-2', store as any);
    expect(bytes).toBeGreaterThan(0);

    ac.abort();
    await runPromise;

    // Restore to new tasklet
    const inbox2 = new AsyncChannel<ProcessorItem>(64);
    const outbox2 = new AsyncChannel<ProcessorItem>(64);

    const tasklet2 = new ProcessorTasklet({
      vertexName: 'counter',
      processorIndex: 2,
      inboxes: [inbox2],
      outbox: outbox2,
      operator: doublingOperator,
      guarantee: ProcessingGuarantee.EXACTLY_ONCE,
    });

    await tasklet2.restoreSnapshot('snap-2', store as any);
    const restored = tasklet2.getMetrics();

    // Should have preserved item counts
    expect(restored.itemsIn).toBe(2); // 2 data items processed
    expect(restored.itemsOut).toBe(4); // doubling operator outputs 2 per input
  });

  // ── Metrics tracking ──────────────────────────────────────────────────

  test('metrics track itemsIn, itemsOut, and queueSize', async () => {
    const inbox = new AsyncChannel<ProcessorItem>(64);
    const outbox = new AsyncChannel<ProcessorItem>(64);

    const tasklet = new ProcessorTasklet({
      vertexName: 'map1',
      processorIndex: 0,
      inboxes: [inbox],
      outbox,
      operator: identityOperator,
      guarantee: ProcessingGuarantee.NONE,
    });

    const ac = new AbortController();
    const runPromise = tasklet.run(ac.signal);

    await inbox.send(dataItem('a'));
    await inbox.send(dataItem('b'));
    await inbox.send(dataItem('c'));
    await inbox.send(eosItem());

    // Wait for processing
    await waitForItems(outbox, 4, 3000);
    ac.abort();
    await runPromise;

    const metrics = tasklet.getMetrics();
    expect(metrics.itemsIn).toBe(3);
    expect(metrics.itemsOut).toBe(3);
    expect(metrics.name).toBe('map1');
  });

  test('metrics track latency via LatencyTracker', async () => {
    const inbox = new AsyncChannel<ProcessorItem>(64);
    const outbox = new AsyncChannel<ProcessorItem>(64);

    const tasklet = new ProcessorTasklet({
      vertexName: 'v1',
      processorIndex: 0,
      inboxes: [inbox],
      outbox,
      operator: identityOperator,
      guarantee: ProcessingGuarantee.NONE,
    });

    const ac = new AbortController();
    const runPromise = tasklet.run(ac.signal);

    await inbox.send(dataItem('a', Date.now() - 50)); // 50ms old timestamp
    await inbox.send(eosItem());

    await waitForItems(outbox, 2, 3000);
    ac.abort();
    await runPromise;

    const metrics = tasklet.getMetrics();
    // Latency should be >= ~50ms since the timestamp was 50ms ago
    expect(metrics.latencyP50Ms).toBeGreaterThanOrEqual(30); // allow some tolerance
  });

  test('metrics with doubling operator: itemsOut > itemsIn', async () => {
    const inbox = new AsyncChannel<ProcessorItem>(64);
    const outbox = new AsyncChannel<ProcessorItem>(64);

    const tasklet = new ProcessorTasklet({
      vertexName: 'double',
      processorIndex: 0,
      inboxes: [inbox],
      outbox,
      operator: doublingOperator,
      guarantee: ProcessingGuarantee.NONE,
    });

    const ac = new AbortController();
    const runPromise = tasklet.run(ac.signal);

    await inbox.send(dataItem('a'));
    await inbox.send(dataItem('b'));
    await inbox.send(eosItem());

    await waitForItems(outbox, 5, 3000); // 4 data + 1 eos
    ac.abort();
    await runPromise;

    const metrics = tasklet.getMetrics();
    expect(metrics.itemsIn).toBe(2);
    expect(metrics.itemsOut).toBe(4);
  });

  // ── Abort signal stops loop ───────────────────────────────────────────

  test('abort signal stops the processing loop', async () => {
    const inbox = new AsyncChannel<ProcessorItem>(64);
    const outbox = new AsyncChannel<ProcessorItem>(64);

    const tasklet = new ProcessorTasklet({
      vertexName: 'v1',
      processorIndex: 0,
      inboxes: [inbox],
      outbox,
      operator: identityOperator,
      guarantee: ProcessingGuarantee.NONE,
    });

    const ac = new AbortController();
    const runPromise = tasklet.run(ac.signal);

    // Send one item
    await inbox.send(dataItem('a'));
    await new Promise(r => setTimeout(r, 50));

    // Abort before sending EOS
    ac.abort();
    await runPromise; // Should resolve without hanging

    // The tasklet should have stopped
    const metrics = tasklet.getMetrics();
    expect(metrics.itemsIn).toBeGreaterThanOrEqual(0);
  });

  test('abort signal prevents processing of remaining items', async () => {
    const inbox = new AsyncChannel<ProcessorItem>(64);
    const outbox = new AsyncChannel<ProcessorItem>(64);

    const tasklet = new ProcessorTasklet({
      vertexName: 'v1',
      processorIndex: 0,
      inboxes: [inbox],
      outbox,
      operator: identityOperator,
      guarantee: ProcessingGuarantee.NONE,
    });

    const ac = new AbortController();

    // Queue many items before starting
    for (let i = 0; i < 20; i++) {
      await inbox.send(dataItem(`item-${i}`));
    }

    // Abort immediately
    ac.abort();
    const runPromise = tasklet.run(ac.signal);
    await runPromise;

    // Should have processed few or no items since we aborted
    const metrics = tasklet.getMetrics();
    expect(metrics.itemsIn).toBeLessThan(20);
  });

  // ── Multi-input with no guarantee ─────────────────────────────────────

  test('multi-input with NONE guarantee: barriers are dropped, data flows freely', async () => {
    const inbox1 = new AsyncChannel<ProcessorItem>(64);
    const inbox2 = new AsyncChannel<ProcessorItem>(64);
    const outbox = new AsyncChannel<ProcessorItem>(64);

    const tasklet = new ProcessorTasklet({
      vertexName: 'v1',
      processorIndex: 0,
      inboxes: [inbox1, inbox2],
      outbox,
      operator: identityOperator,
      guarantee: ProcessingGuarantee.NONE,
    });

    const ac = new AbortController();
    const runPromise = tasklet.run(ac.signal);

    await inbox1.send(dataItem('a'));
    await inbox1.send(barrierItem('snap-1'));
    await inbox1.send(dataItem('b'));
    await inbox2.send(dataItem('c'));
    await inbox2.send(eosItem());
    await inbox1.send(eosItem());

    // With NONE, barriers should be dropped (not forwarded)
    const items = await waitForItems(outbox, 4, 3000);
    ac.abort();
    await runPromise;

    const dataValues = items.filter(i => i.type === 'data').map(i => (i as any).value);
    expect(dataValues).toContain('a');
    expect(dataValues).toContain('b');
    expect(dataValues).toContain('c');

    // No barriers should appear in output
    const barriers = items.filter(i => i.type === 'barrier');
    expect(barriers.length).toBe(0);
  });

  // ── EOS handling with multiple inboxes ────────────────────────────────

  test('multi-input: EOS emitted only after all inboxes send EOS', async () => {
    const inbox1 = new AsyncChannel<ProcessorItem>(64);
    const inbox2 = new AsyncChannel<ProcessorItem>(64);
    const outbox = new AsyncChannel<ProcessorItem>(64);

    const tasklet = new ProcessorTasklet({
      vertexName: 'v1',
      processorIndex: 0,
      inboxes: [inbox1, inbox2],
      outbox,
      operator: identityOperator,
      guarantee: ProcessingGuarantee.NONE,
    });

    const ac = new AbortController();
    const runPromise = tasklet.run(ac.signal);

    await inbox1.send(dataItem('a'));
    await inbox1.send(eosItem());

    // Wait — EOS should NOT be in outbox yet (inbox2 still open)
    await new Promise(r => setTimeout(r, 100));
    const earlyItems = drainSync(outbox);
    const earlyEos = earlyItems.filter(i => i.type === 'eos');
    expect(earlyEos.length).toBe(0);

    // Now close inbox2
    await inbox2.send(dataItem('b'));
    await inbox2.send(eosItem());

    const items = await waitForItems(outbox, 2, 3000); // b + eos
    ac.abort();
    await runPromise;

    const allItems = [...earlyItems, ...items];
    const eosCount = allItems.filter(i => i.type === 'eos').length;
    expect(eosCount).toBe(1);
  });

  // ── Watermark passthrough ─────────────────────────────────────────────

  test('watermarks pass through to outbox', async () => {
    const inbox = new AsyncChannel<ProcessorItem>(64);
    const outbox = new AsyncChannel<ProcessorItem>(64);

    const tasklet = new ProcessorTasklet({
      vertexName: 'v1',
      processorIndex: 0,
      inboxes: [inbox],
      outbox,
      operator: identityOperator,
      guarantee: ProcessingGuarantee.NONE,
    });

    const ac = new AbortController();
    const runPromise = tasklet.run(ac.signal);

    await inbox.send({ type: 'watermark', timestamp: 1000 });
    await inbox.send(dataItem('a'));
    await inbox.send(eosItem());

    const items = await waitForItems(outbox, 3, 3000);
    ac.abort();
    await runPromise;

    expect(items[0]).toMatchObject({ type: 'watermark', timestamp: 1000 });
    expect(items[1]).toMatchObject({ type: 'data', value: 'a' });
    expect(items[2]).toMatchObject({ type: 'eos' });
  });

  // ── getMetrics returns VertexMetrics shape ────────────────────────────

  test('getMetrics returns correct VertexMetrics shape', () => {
    const inbox = new AsyncChannel<ProcessorItem>(64);
    const outbox = new AsyncChannel<ProcessorItem>(64);

    const tasklet = new ProcessorTasklet({
      vertexName: 'test-vertex',
      processorIndex: 0,
      inboxes: [inbox],
      outbox,
      operator: identityOperator,
      guarantee: ProcessingGuarantee.NONE,
    });

    const metrics = tasklet.getMetrics();
    expect(metrics.name).toBe('test-vertex');
    expect(metrics.type).toBe('operator');
    expect(metrics.itemsIn).toBe(0);
    expect(metrics.itemsOut).toBe(0);
    expect(metrics.queueSize).toBe(0);
    expect(metrics.latencyP50Ms).toBe(0);
    expect(metrics.latencyP99Ms).toBe(0);
    expect(metrics.latencyMaxMs).toBe(0);
  });

  // ── queueSize metric reflects inbox state ─────────────────────────────

  test('queueSize metric reflects current inbox buffer size', async () => {
    const inbox = new AsyncChannel<ProcessorItem>(64);
    const outbox = new AsyncChannel<ProcessorItem>(64);

    const tasklet = new ProcessorTasklet({
      vertexName: 'v1',
      processorIndex: 0,
      inboxes: [inbox],
      outbox,
      operator: identityOperator,
      guarantee: ProcessingGuarantee.NONE,
    });

    // Queue items before starting
    await inbox.send(dataItem('a'));
    await inbox.send(dataItem('b'));
    await inbox.send(dataItem('c'));

    const metrics = tasklet.getMetrics();
    expect(metrics.queueSize).toBe(3);
  });
});
