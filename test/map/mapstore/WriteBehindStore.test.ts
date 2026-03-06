import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { WriteBehindStore } from '@zenystx/helios-core/map/impl/mapstore/writebehind/WriteBehindStore';
import { CoalescedWriteBehindQueue } from '@zenystx/helios-core/map/impl/mapstore/writebehind/CoalescedWriteBehindQueue';
import { WriteBehindProcessor } from '@zenystx/helios-core/map/impl/mapstore/writebehind/WriteBehindProcessor';
import { MapStoreWrapper } from '@zenystx/helios-core/map/impl/mapstore/MapStoreWrapper';
import { StoreWorker } from '@zenystx/helios-core/map/impl/mapstore/writebehind/StoreWorker';
import { MapKeyStream } from '@zenystx/helios-core/map/MapKeyStream';

function makeFullStack(storeAllFn?: (...args: any[]) => any) {
  const impl = {
    store: mock(async () => {}),
    storeAll: mock(storeAllFn ?? (async () => {})),
    delete: mock(async () => {}),
    deleteAll: mock(async () => {}),
    load: mock(async (_key: string) => 'loaded' as string | null),
    loadAll: mock(async (keys: string[]) => new Map<string, string>(keys.map(k => [k, 'v']))),
    loadAllKeys: mock(async () => MapKeyStream.fromIterable(['k1', 'k2'])),
  };
  const wrapper = new MapStoreWrapper<string, string>(impl as any);
  const queue = new CoalescedWriteBehindQueue<string, string>();
  const processor = new WriteBehindProcessor(wrapper, 1000);
  return { impl, wrapper, queue, processor };
}

describe('WriteBehindStore', () => {
  it('add() enqueues entry immediately (instant Promise.resolve)', async () => {
    const { impl, wrapper, queue, processor } = makeFullStack();
    const store = new WriteBehindStore(wrapper, queue, processor, 5000);

    await store.add('k', 'v', Date.now());

    expect(queue.isEmpty()).toBe(false);
    expect(impl.storeAll).not.toHaveBeenCalled();  // not flushed yet
    store.destroy();
  });

  it('remove() enqueues delete entry immediately', async () => {
    const { impl, wrapper, queue, processor } = makeFullStack();
    const store = new WriteBehindStore(wrapper, queue, processor, 5000);

    await store.remove('k', Date.now());

    expect(queue.isEmpty()).toBe(false);
    expect(impl.delete).not.toHaveBeenCalled();  // not flushed yet
    store.destroy();
  });

  it('load() delegates to wrapper when no staged entry exists', async () => {
    const { impl, wrapper, queue, processor } = makeFullStack();
    const store = new WriteBehindStore(wrapper, queue, processor, 5000);

    const result = await store.load('k');

    expect(result).toBe('loaded');
    expect(impl.load).toHaveBeenCalledWith('k');
    store.destroy();
  });

  it('load() returns staged value for keys with pending writes (read-your-writes)', async () => {
    const { impl, wrapper, queue, processor } = makeFullStack();
    const store = new WriteBehindStore(wrapper, queue, processor, 5000);

    await store.add('k', 'staged-value', Date.now());

    const result = await store.load('k');

    expect(result).toBe('staged-value');
    // Wrapper should NOT have been called — staging area served the read
    expect(impl.load).not.toHaveBeenCalled();
    store.destroy();
  });

  it('load() returns null for keys with pending deletes in staging area', async () => {
    const { impl, wrapper, queue, processor } = makeFullStack();
    const store = new WriteBehindStore(wrapper, queue, processor, 5000);

    await store.remove('k', Date.now());

    const result = await store.load('k');

    expect(result).toBeNull();
    // Wrapper should NOT have been called — staging area intercepted the read
    expect(impl.load).not.toHaveBeenCalled();
    store.destroy();
  });

  it('flush() delegates to worker.flush() and drains all entries', async () => {
    const { impl, wrapper, queue, processor } = makeFullStack();
    const store = new WriteBehindStore(wrapper, queue, processor, 5000);

    await store.add('k', 'v', Date.now());
    expect(queue.isEmpty()).toBe(false);

    await store.flush();

    expect(queue.isEmpty()).toBe(true);
    expect(impl.storeAll).toHaveBeenCalled();
    store.destroy();
  });

  it('clear() flushes pending writes then deleteAll external keys', async () => {
    const { impl, wrapper, queue, processor } = makeFullStack();
    const store = new WriteBehindStore(wrapper, queue, processor, 5000);

    await store.add('pending-k', 'v', Date.now());
    await store.clear();

    // After clear: pending writes flushed, external keys deleted
    expect(impl.storeAll).toHaveBeenCalled();  // pending flush happened
    expect(impl.deleteAll).toHaveBeenCalled();  // external keys cleared
    expect(queue.isEmpty()).toBe(true);
    store.destroy();
  });

  it('isWithStore() returns true, hasPendingWrites() reflects queue state', async () => {
    const { wrapper, queue, processor } = makeFullStack();
    const store = new WriteBehindStore(wrapper, queue, processor, 5000);

    expect(store.isWithStore()).toBe(true);
    expect(store.hasPendingWrites()).toBe(false);

    await store.add('k', 'v', Date.now());
    expect(store.hasPendingWrites()).toBe(true);

    store.destroy();
  });

  it('constructor starts the worker automatically', async () => {
    const { wrapper, queue, processor } = makeFullStack();
    // The worker should already be running after construction
    const store = new WriteBehindStore(wrapper, queue, processor, 1000);

    // Add an entry with past storeTime so it drains on next tick
    await store.add('k', 'v', Date.now() - 2000);

    // Wait for worker tick
    await new Promise(r => setTimeout(r, 1200));

    expect(queue.isEmpty()).toBe(true);
    store.destroy();
  });
});
