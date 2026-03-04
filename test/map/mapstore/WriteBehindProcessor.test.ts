import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { WriteBehindProcessor } from '@helios/map/impl/mapstore/writebehind/WriteBehindProcessor';
import { MapStoreWrapper } from '@helios/map/impl/mapstore/MapStoreWrapper';
import { addedEntry, deletedEntry, DelayedEntryType } from '@helios/map/impl/mapstore/writebehind/DelayedEntry';
import type { DelayedEntry } from '@helios/map/impl/mapstore/writebehind/DelayedEntry';

function makeMapStore(storeAllFn?: (...args: any[]) => any, deleteAllFn?: (...args: any[]) => any) {
  return {
    store: mock(async () => {}),
    storeAll: mock(storeAllFn ?? (async () => {})),
    delete: mock(async () => {}),
    deleteAll: mock(deleteAllFn ?? (async () => {})),
    load: mock(async () => null),
    loadAll: mock(async () => new Map()),
    loadAllKeys: mock(async () => []),
  };
}

describe('WriteBehindProcessor', () => {
  it('batches consecutive ADD entries into storeAll', async () => {
    const impl = makeMapStore();
    const wrapper = new MapStoreWrapper<string, string>(impl as any);
    const processor = new WriteBehindProcessor(wrapper, 1000);

    const entries: DelayedEntry<string, string>[] = [
      addedEntry('k1', 'v1', 100),
      addedEntry('k2', 'v2', 200),
    ];

    const result = await processor.process(entries);
    expect(impl.storeAll).toHaveBeenCalledTimes(1);
    const batch = (impl.storeAll.mock.calls[0] as any[])[0] as Map<string, string>;
    expect(batch.size).toBe(2);
    expect(result.totalEntries).toBe(2);
    expect(result.successfulEntries).toBe(2);
    expect(result.failedEntries).toBe(0);
  });

  it('batches consecutive DELETE entries into deleteAll', async () => {
    const impl = makeMapStore();
    const wrapper = new MapStoreWrapper<string, string>(impl as any);
    const processor = new WriteBehindProcessor(wrapper, 1000);

    const entries: DelayedEntry<string, string>[] = [
      deletedEntry('k1', 100),
      deletedEntry('k2', 200),
    ];

    const result = await processor.process(entries);
    expect(impl.deleteAll).toHaveBeenCalledTimes(1);
    const keys = (impl.deleteAll.mock.calls[0] as any[])[0] as string[];
    expect(keys).toContain('k1');
    expect(keys).toContain('k2');
    expect(result.totalEntries).toBe(2);
    expect(result.successfulEntries).toBe(2);
  });

  it('alternating ADD/DELETE types break into separate batch groups', async () => {
    const impl = makeMapStore();
    const wrapper = new MapStoreWrapper<string, string>(impl as any);
    const processor = new WriteBehindProcessor(wrapper, 1000);

    const entries: DelayedEntry<string, string>[] = [
      addedEntry('k1', 'v1', 100),
      deletedEntry('k2', 200),
      addedEntry('k3', 'v3', 300),
    ];

    const result = await processor.process(entries);
    expect(impl.storeAll).toHaveBeenCalledTimes(2);
    expect(impl.deleteAll).toHaveBeenCalledTimes(1);
    expect(result.batchGroups).toBe(3);
  });

  it('respects writeBatchSize: large batch splits into multiple calls', async () => {
    const impl = makeMapStore();
    const wrapper = new MapStoreWrapper<string, string>(impl as any);
    const processor = new WriteBehindProcessor(wrapper, 2);  // batchSize = 2

    const entries: DelayedEntry<string, string>[] = [
      addedEntry('k1', 'v1', 100),
      addedEntry('k2', 'v2', 200),
      addedEntry('k3', 'v3', 300),
    ];

    await processor.process(entries);
    // 3 entries with batchSize=2 → 2 storeAll calls
    expect(impl.storeAll).toHaveBeenCalledTimes(2);
  });

  it('retries batch group up to 3 times on failure, then falls back to per-entry', async () => {
    let attempts = 0;
    const storeAllFn = mock(async () => {
      attempts++;
      throw new Error('store failed');
    });
    const storeFn = mock(async () => {});  // per-entry fallback succeeds

    const impl = {
      ...makeMapStore(storeAllFn as any),
      store: storeFn,
    };
    const wrapper = new MapStoreWrapper<string, string>(impl as any);
    const processor = new WriteBehindProcessor(wrapper, 1000);

    const entries: DelayedEntry<string, string>[] = [addedEntry('k1', 'v1', 100)];
    const result = await processor.process(entries);

    // 3 total batch attempts (matching Hazelcast's RETRY_TIMES_OF_A_FAILED_STORE_OPERATION = 3)
    expect(attempts).toBe(3);
    expect(storeFn).toHaveBeenCalledWith('k1', 'v1');
    expect(result.fallbackBatchCount).toBe(1);
    // retryCount = 2 (retries between the 3 batch attempts)
    expect(result.retryCount).toBe(2);
  });

  it('continue-on-error: per-entry fallback continues even if some entries fail', async () => {
    const callCount = { storeAll: 0, store: 0 };
    const storeAllFn = mock(async () => { callCount.storeAll++; throw new Error('batch fail'); });
    const storeFn = mock(async (key: string) => {
      callCount.store++;
      if (key === 'k2') throw new Error('single fail');
    });

    const impl = {
      ...makeMapStore(storeAllFn as any),
      store: storeFn,
    };
    const wrapper = new MapStoreWrapper<string, string>(impl as any);
    const processor = new WriteBehindProcessor(wrapper, 1000);

    const entries: DelayedEntry<string, string>[] = [
      addedEntry('k1', 'v1', 100),
      addedEntry('k2', 'v2', 200),
      addedEntry('k3', 'v3', 300),
    ];
    const result = await processor.process(entries);

    // k1 succeeds on first individual try (1 call)
    // k2 fails all 3 individual retries (3 calls)
    // k3 succeeds on first individual try (1 call)
    // Total: 1 + 3 + 1 = 5 individual store() calls
    expect(callCount.store).toBe(5);
    expect(result.failedEntries).toBe(1);
    expect(result.successfulEntries).toBe(2);
    // k2 should be in the failed list
    expect(result.failed.length).toBe(1);
    expect(result.failed[0].key).toBe('k2');
  });

  it('continues processing later batch groups after one failed batch', async () => {
    let firstGroup = true;
    const storeAllFn = mock(async () => {
      if (firstGroup) { firstGroup = false; throw new Error('first group fail'); }
    });
    const deleteAllFn = mock(async () => {});

    const impl = {
      ...makeMapStore(storeAllFn as any, deleteAllFn as any),
      store: mock(async () => {}),
    };
    const wrapper = new MapStoreWrapper<string, string>(impl as any);
    const processor = new WriteBehindProcessor(wrapper, 1000);

    const entries: DelayedEntry<string, string>[] = [
      addedEntry('k1', 'v1', 100),  // first group — fails → fallback
      deletedEntry('k2', 200),      // second group — succeeds
    ];
    const result = await processor.process(entries);

    expect(deleteAllFn).toHaveBeenCalled();
    expect(result.batchGroups).toBe(2);
  });

  it('process() does not throw even on backend failures', async () => {
    const impl = {
      ...makeMapStore(mock(async () => { throw new Error('fatal'); })),
      store: mock(async () => { throw new Error('fatal'); }),
    };
    const wrapper = new MapStoreWrapper<string, string>(impl as any);
    const processor = new WriteBehindProcessor(wrapper, 1000);

    // Should not throw
    const result = await processor.process([addedEntry('k', 'v', 100)]);
    expect(result.failedEntries).toBe(1);
  });

  it('returns correct result counters for mixed success/failure', async () => {
    const impl = makeMapStore();
    const wrapper = new MapStoreWrapper<string, string>(impl as any);
    const processor = new WriteBehindProcessor(wrapper, 1000);

    const entries: DelayedEntry<string, string>[] = [
      addedEntry('k1', 'v1', 100),
      addedEntry('k2', 'v2', 200),
      deletedEntry('k3', 300),
    ];
    const result = await processor.process(entries);

    expect(result.totalEntries).toBe(3);
    expect(result.successfulEntries).toBe(3);
    expect(result.failedEntries).toBe(0);
    expect(result.batchGroups).toBe(2);
  });

  it('empty entries array returns zero-count result', async () => {
    const impl = makeMapStore();
    const wrapper = new MapStoreWrapper<string, string>(impl as any);
    const processor = new WriteBehindProcessor(wrapper, 1000);

    const result = await processor.process([]);
    expect(result.totalEntries).toBe(0);
    expect(result.batchGroups).toBe(0);
  });
});
