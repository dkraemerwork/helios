import { MapStoreWrapper } from '@zenystx/helios-core/map/impl/mapstore/MapStoreWrapper';
import { WriteThroughStore } from '@zenystx/helios-core/map/impl/mapstore/writethrough/WriteThroughStore';
import { describe, expect, it, mock } from 'bun:test';

function makeMapStore(overrides: Partial<Record<string, (...args: any[]) => any>> = {}) {
  return {
    store: mock(async () => {}),
    storeAll: mock(async () => {}),
    delete: mock(async () => {}),
    deleteAll: mock(async () => {}),
    load: mock(async (_key: string) => null as string | null),
    loadAll: mock(async (keys: string[]) => new Map<string, string>()),
    loadAllKeys: mock(async () => [] as string[]),
    ...overrides,
  };
}

describe('WriteThroughStore', () => {
  it('add() calls wrapper.store immediately', async () => {
    const impl = makeMapStore();
    const wrapper = new MapStoreWrapper<string, string>(impl as any);
    const store = new WriteThroughStore<string, string>(wrapper);

    await store.add('k', 'v', Date.now());

    expect(impl.store).toHaveBeenCalledWith('k', 'v');
  });

  it('remove() calls wrapper.delete immediately', async () => {
    const impl = makeMapStore();
    const wrapper = new MapStoreWrapper<string, string>(impl as any);
    const store = new WriteThroughStore<string, string>(wrapper);

    await store.remove('k', Date.now());

    expect(impl.delete).toHaveBeenCalledWith('k');
  });

  it('load() delegates to wrapper.load()', async () => {
    const impl = makeMapStore({ load: mock(async (_key: string) => 'loaded-value' as string | null) });
    const wrapper = new MapStoreWrapper<string, string>(impl as any);
    const store = new WriteThroughStore<string, string>(wrapper);

    const result = await store.load('k');

    expect(result).toBe('loaded-value');
  });

  it('flush() is a no-op (returns immediately)', async () => {
    const impl = makeMapStore();
    const wrapper = new MapStoreWrapper<string, string>(impl as any);
    const store = new WriteThroughStore<string, string>(wrapper);

    await store.flush();
    // no throw, nothing called
    expect(impl.store).not.toHaveBeenCalled();
  });

  it('isWithStore() returns true, hasPendingWrites() returns false', () => {
    const impl = makeMapStore();
    const wrapper = new MapStoreWrapper<string, string>(impl as any);
    const store = new WriteThroughStore<string, string>(wrapper);

    expect(store.isWithStore()).toBe(true);
    expect(store.hasPendingWrites()).toBe(false);
  });
});
