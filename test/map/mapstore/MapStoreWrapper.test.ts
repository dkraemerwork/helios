import { MapStoreWrapper } from '@zenystx/helios-core/map/impl/mapstore/MapStoreWrapper';
import { MapKeyStream } from '@zenystx/helios-core/map/MapKeyStream';
import type { MapLoader } from '@zenystx/helios-core/map/MapLoader';
import type { MapLoaderLifecycleSupport } from '@zenystx/helios-core/map/MapLoaderLifecycleSupport';
import type { MapStore } from '@zenystx/helios-core/map/MapStore';
import { describe, expect, test } from 'bun:test';

// A full MapStore implementation
const makeMapStore = (): MapStore<string, string> & MapLoaderLifecycleSupport => ({
  load: async (key) => key === 'exists' ? 'value' : null,
  loadAll: async (keys) => new Map(keys.map(k => [k, k + '-loaded'])),
  loadAllKeys: async () => MapKeyStream.fromIterable(['a', 'b']),
  store: async (_key, _value) => {},
  storeAll: async (_entries) => {},
  delete: async (_key) => {},
  deleteAll: async (_keys) => {},
  init: async (_props, _mapName) => {},
  destroy: async () => {},
});

// A MapLoader only (no write methods)
const makeMapLoader = (): MapLoader<string, string> => ({
  load: async (key) => key === 'exists' ? 'value' : null,
  loadAll: async (keys) => new Map(keys.map(k => [k, k + '-loaded'])),
  loadAllKeys: async () => MapKeyStream.fromIterable(['a', 'b']),
});

describe('MapStoreWrapper', () => {
  test('detects MapStore implementation (isMapStore=true)', () => {
    const impl = makeMapStore();
    const wrapper = new MapStoreWrapper(impl);
    expect(wrapper.isMapStore).toBe(true);
  });

  test('detects MapLoader-only implementation (isMapStore=false)', () => {
    const impl = makeMapLoader();
    const wrapper = new MapStoreWrapper(impl);
    expect(wrapper.isMapStore).toBe(false);
  });

  test('detects lifecycle support when init/destroy present', () => {
    const impl = makeMapStore(); // has init and destroy
    const wrapper = new MapStoreWrapper(impl);
    expect(wrapper.supportsLifecycle).toBe(true);
  });

  test('detects no lifecycle support on MapLoader-only', () => {
    const impl = makeMapLoader(); // no init/destroy
    const wrapper = new MapStoreWrapper(impl);
    expect(wrapper.supportsLifecycle).toBe(false);
  });

  test('delegates load() to impl', async () => {
    const wrapper = new MapStoreWrapper(makeMapStore());
    const result = await wrapper.load('exists');
    expect(result).toBe('value');
  });

  test('delegates store() when isMapStore', async () => {
    const stored: string[] = [];
    const impl: MapStore<string, string> = {
      ...makeMapLoader(),
      store: async (k, v) => { stored.push(k, v); },
      storeAll: async () => {},
      delete: async () => {},
      deleteAll: async () => {},
    };
    const wrapper = new MapStoreWrapper(impl);
    await wrapper.store('key', 'val');
    expect(stored).toEqual(['key', 'val']);
  });

  test('lifecycle init delegates when supportsLifecycle', async () => {
    let inited = false;
    const impl: MapStore<string, string> & MapLoaderLifecycleSupport = {
      ...makeMapStore(),
      init: async (_props, _mapName) => { inited = true; },
      destroy: async () => {},
    };
    const wrapper = new MapStoreWrapper(impl);
    await wrapper.init(new Map(), 'myMap');
    expect(inited).toBe(true);
  });

  test('lifecycle destroy is no-op when not supported', async () => {
    const wrapper = new MapStoreWrapper(makeMapLoader());
    // Should not throw
    await wrapper.destroy();
  });

  test('lifecycle init is no-op when not supported', async () => {
    const wrapper = new MapStoreWrapper(makeMapLoader());
    // Should not throw
    await wrapper.init(new Map(), 'myMap');
  });
});
