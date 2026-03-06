import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { StoreWorker } from '@zenystx/helios-core/map/impl/mapstore/writebehind/StoreWorker';
import { CoalescedWriteBehindQueue } from '@zenystx/helios-core/map/impl/mapstore/writebehind/CoalescedWriteBehindQueue';
import { WriteBehindProcessor } from '@zenystx/helios-core/map/impl/mapstore/writebehind/WriteBehindProcessor';
import { MapStoreWrapper } from '@zenystx/helios-core/map/impl/mapstore/MapStoreWrapper';
import { addedEntry } from '@zenystx/helios-core/map/impl/mapstore/writebehind/DelayedEntry';
import { MapKeyStream } from '@zenystx/helios-core/map/MapKeyStream';

function makeProcessor(processFn?: (...args: any[]) => any) {
  const impl = {
    store: mock(async () => {}),
    storeAll: mock(async () => {}),
    delete: mock(async () => {}),
    deleteAll: mock(async () => {}),
    load: mock(async () => null),
    loadAll: mock(async () => new Map()),
    loadAllKeys: mock(async () => MapKeyStream.fromIterable([])),
  };
  const wrapper = new MapStoreWrapper<string, string>(impl as any);
  const processor = new WriteBehindProcessor(wrapper, 1000);
  if (processFn) {
    (processor as any).process = processFn;
  }
  return { processor, impl };
}

describe('StoreWorker', () => {
  it('start() enables periodic ticking (manual time check)', async () => {
    const processMock = mock(async (_entries: any[]) => ({
      totalEntries: 0, successfulEntries: 0, failedEntries: 0,
      batchGroups: 0, batchFailures: 0, retryCount: 0, fallbackBatchCount: 0, failed: [],
    }));
    const { processor } = makeProcessor();
    (processor as any).process = processMock;

    const queue = new CoalescedWriteBehindQueue<string, string>();
    const worker = new StoreWorker(queue, processor);

    // Add an entry with past storeTime
    queue.offer(addedEntry('k', 'v', Date.now() - 10000));

    worker.start();
    // Let the interval tick
    await new Promise(r => setTimeout(r, 1100));
    worker.stop();

    expect(processMock).toHaveBeenCalled();
  });

  it('stop() prevents further ticks', async () => {
    const processMock = mock(async (_entries: any[]) => ({
      totalEntries: 0, successfulEntries: 0, failedEntries: 0,
      batchGroups: 0, batchFailures: 0, retryCount: 0, fallbackBatchCount: 0, failed: [],
    }));
    const { processor } = makeProcessor();
    (processor as any).process = processMock;

    const queue = new CoalescedWriteBehindQueue<string, string>();
    const worker = new StoreWorker(queue, processor);

    worker.start();
    worker.stop();

    queue.offer(addedEntry('k', 'v', Date.now() - 10000));

    // Wait longer than one tick — no ticks should happen after stop
    await new Promise(r => setTimeout(r, 1200));
    expect(processMock).not.toHaveBeenCalled();
  });

  it('flush() drains all entries immediately via processor', async () => {
    const processedEntries: any[][] = [];
    const processMock = mock(async (entries: any[]) => {
      processedEntries.push(entries);
      return {
        totalEntries: entries.length, successfulEntries: entries.length, failedEntries: 0,
        batchGroups: 1, batchFailures: 0, retryCount: 0, fallbackBatchCount: 0, failed: [],
      };
    });
    const { processor } = makeProcessor();
    (processor as any).process = processMock;

    const queue = new CoalescedWriteBehindQueue<string, string>();
    const worker = new StoreWorker(queue, processor);

    // Add entries with future storeTime — won't drain via drainTo
    queue.offer(addedEntry('k1', 'v1', Date.now() + 100000));
    queue.offer(addedEntry('k2', 'v2', Date.now() + 200000));

    await worker.flush();

    expect(processedEntries.length).toBeGreaterThan(0);
    const allEntries = processedEntries.flat();
    expect(allEntries.length).toBe(2);
    expect(queue.isEmpty()).toBe(true);
  });

  it('flush() stops the interval timer', async () => {
    const processMock = mock(async (_entries: any[]) => ({
      totalEntries: 0, successfulEntries: 0, failedEntries: 0,
      batchGroups: 0, batchFailures: 0, retryCount: 0, fallbackBatchCount: 0, failed: [],
    }));
    const { processor } = makeProcessor();
    (processor as any).process = processMock;

    const queue = new CoalescedWriteBehindQueue<string, string>();
    const worker = new StoreWorker(queue, processor);

    worker.start();
    await worker.flush();

    const callCountAfterFlush = processMock.mock.calls.length;
    // Wait another tick — should not fire since interval is cleared
    await new Promise(r => setTimeout(r, 1200));
    expect(processMock.mock.calls.length).toBe(callCountAfterFlush);
  });

  it('skip tick if previous flush is still running', async () => {
    let resolveFlush!: () => void;
    let tickCount = 0;
    const processMock = mock(async (_entries: any[]) => {
      tickCount++;
      if (tickCount === 1) {
        // Block the first flush
        await new Promise<void>(r => { resolveFlush = r; });
      }
      return {
        totalEntries: 0, successfulEntries: 0, failedEntries: 0,
        batchGroups: 0, batchFailures: 0, retryCount: 0, fallbackBatchCount: 0, failed: [],
      };
    });
    const { processor } = makeProcessor();
    (processor as any).process = processMock;

    const queue = new CoalescedWriteBehindQueue<string, string>();
    queue.offer(addedEntry('k', 'v', Date.now() - 10000));
    const worker = new StoreWorker(queue, processor);
    worker.start();

    // Wait for first tick to start
    await new Promise(r => setTimeout(r, 1100));
    // tickCount should be 1, first tick is blocked

    // Wait for another tick to come in — should be skipped due to guard
    await new Promise(r => setTimeout(r, 1100));
    expect(tickCount).toBe(1); // second tick skipped

    resolveFlush();
    worker.stop();
  });
});
