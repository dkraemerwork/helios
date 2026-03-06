import { describe, test, expect } from 'bun:test';
import { LoadOnlyMapDataStore } from '@zenystx/helios-core/map/impl/mapstore/LoadOnlyMapDataStore';
import { MapStoreWrapper } from '@zenystx/helios-core/map/impl/mapstore/MapStoreWrapper';
import type { MapLoader } from '@zenystx/helios-core/map/MapLoader';
import { MapKeyStream } from '@zenystx/helios-core/map/MapKeyStream';

const makeLoader = (): MapLoader<string, string> => ({
  load: async (key) => key === 'k' ? 'v' : null,
  loadAll: async (keys) => new Map(keys.filter(k => k === 'k').map(k => [k, 'v'])),
  loadAllKeys: async () => MapKeyStream.fromIterable(['k']),
});

describe('LoadOnlyMapDataStore', () => {
  test('isWithStore() returns true', () => {
    const wrapper = new MapStoreWrapper(makeLoader());
    const store = new LoadOnlyMapDataStore<string, string>(wrapper);
    expect(store.isWithStore()).toBe(true);
  });

  test('hasPendingWrites() returns false', () => {
    const wrapper = new MapStoreWrapper(makeLoader());
    const store = new LoadOnlyMapDataStore<string, string>(wrapper);
    expect(store.hasPendingWrites()).toBe(false);
  });

  test('add() is a no-op (returns immediately)', async () => {
    const wrapper = new MapStoreWrapper(makeLoader());
    const store = new LoadOnlyMapDataStore<string, string>(wrapper);
    await store.add('k', 'v', Date.now()); // should not throw
  });

  test('load() delegates to wrapper', async () => {
    const wrapper = new MapStoreWrapper(makeLoader());
    const store = new LoadOnlyMapDataStore<string, string>(wrapper);
    expect(await store.load('k')).toBe('v');
    expect(await store.load('missing')).toBeNull();
  });
});
