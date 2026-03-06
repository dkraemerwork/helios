import { describe, it, expect, mock } from 'bun:test';
import { MapStoreContext } from '@zenystx/core/map/impl/mapstore/MapStoreContext';
import { MapStoreConfig, InitialLoadMode } from '@zenystx/core/config/MapStoreConfig';
import { WriteThroughStore } from '@zenystx/core/map/impl/mapstore/writethrough/WriteThroughStore';
import { WriteBehindStore } from '@zenystx/core/map/impl/mapstore/writebehind/WriteBehindStore';
import { LoadOnlyMapDataStore } from '@zenystx/core/map/impl/mapstore/LoadOnlyMapDataStore';

function makeFullMapStore() {
  return {
    store: mock(async () => {}),
    storeAll: mock(async () => {}),
    delete: mock(async () => {}),
    deleteAll: mock(async () => {}),
    load: mock(async () => null),
    loadAll: mock(async () => new Map()),
    loadAllKeys: mock(async () => []),
  };
}

function makeMapLoader() {
  return {
    load: mock(async () => null),
    loadAll: mock(async () => new Map()),
    loadAllKeys: mock(async () => []),
  };
}

describe('MapStoreContext', () => {
  it('creates WriteThroughStore when writeDelaySeconds=0 and isMapStore', async () => {
    const cfg = new MapStoreConfig();
    cfg.setEnabled(true)
       .setImplementation(makeFullMapStore() as any)
       .setWriteDelaySeconds(0);

    const ctx = await MapStoreContext.create<string, string>('myMap', cfg);
    const ds = ctx.getMapDataStore();
    expect(ds).toBeInstanceOf(WriteThroughStore);
    await ctx.destroy();
  });

  it('creates WriteBehindStore when writeDelaySeconds > 0', async () => {
    const cfg = new MapStoreConfig();
    cfg.setEnabled(true)
       .setImplementation(makeFullMapStore() as any)
       .setWriteDelaySeconds(5);

    const ctx = await MapStoreContext.create<string, string>('myMap', cfg);
    const ds = ctx.getMapDataStore();
    expect(ds).toBeInstanceOf(WriteBehindStore);
    await ctx.destroy();
  });

  it('factoryImplementation takes precedence over implementation', async () => {
    const directImpl = makeFullMapStore();
    const factoryImpl = makeFullMapStore();

    const cfg = new MapStoreConfig();
    cfg.setEnabled(true);
    // Set factory after implementation — factory wins per mutual exclusivity
    cfg.setImplementation(directImpl as any);
    cfg.setFactoryImplementation({
      newMapStore: mock(async (_name: string, _props: Map<string, string>) => factoryImpl as any),
    } as any);

    const ctx = await MapStoreContext.create<string, string>('myMap', cfg);
    await ctx.destroy();

    // factoryImpl was used (its methods would be called on store ops)
    const factoryFn = cfg.getFactoryImplementation() as any;
    expect(factoryFn.newMapStore).toHaveBeenCalledWith('myMap', expect.any(Map));
  });

  it('calls lifecycle init() on create and destroy() on ctx.destroy()', async () => {
    const initMock = mock(async () => {});
    const destroyMock = mock(async () => {});

    const lifecycleImpl = {
      ...makeFullMapStore(),
      init: initMock,
      destroy: destroyMock,
    };

    const cfg = new MapStoreConfig();
    cfg.setEnabled(true).setImplementation(lifecycleImpl as any);

    const ctx = await MapStoreContext.create<string, string>('myMap', cfg);
    expect(initMock).toHaveBeenCalledWith(expect.any(Map), 'myMap');

    await ctx.destroy();
    expect(destroyMock).toHaveBeenCalled();
  });

  it('creates LoadOnlyMapDataStore when only a MapLoader is provided', async () => {
    const cfg = new MapStoreConfig();
    cfg.setEnabled(true).setImplementation(makeMapLoader() as any);

    const ctx = await MapStoreContext.create<string, string>('myMap', cfg);
    const ds = ctx.getMapDataStore();
    expect(ds).toBeInstanceOf(LoadOnlyMapDataStore);
    await ctx.destroy();
  });

  it('throws if no implementation or factory is set while enabled', async () => {
    const cfg = new MapStoreConfig();
    cfg.setEnabled(true);
    // neither implementation nor factory

    await expect(MapStoreContext.create<string, string>('myMap', cfg)).rejects.toThrow();
  });

  it('getInitialEntries() returns null for LAZY mode', async () => {
    const cfg = new MapStoreConfig();
    cfg.setEnabled(true)
       .setImplementation(makeFullMapStore() as any)
       .setInitialLoadMode(InitialLoadMode.LAZY);

    const ctx = await MapStoreContext.create<string, string>('myMap', cfg);
    expect(ctx.getInitialEntries()).toBeNull();
    await ctx.destroy();
  });

  it('getInitialEntries() returns entries for EAGER mode', async () => {
    const eagerImpl = {
      ...makeFullMapStore(),
      loadAllKeys: mock(async () => ['k1', 'k2']),
      loadAll: mock(async (keys: string[]) => new Map<string, string>(keys.map(k => [k, 'val-' + k]))),
    };

    const cfg = new MapStoreConfig();
    cfg.setEnabled(true)
       .setImplementation(eagerImpl as any)
       .setInitialLoadMode(InitialLoadMode.EAGER);

    const ctx = await MapStoreContext.create<string, string>('myMap', cfg);
    const entries = ctx.getInitialEntries();
    expect(entries).not.toBeNull();
    expect(entries!.size).toBe(2);
    expect(entries!.get('k1')).toBe('val-k1');
    await ctx.destroy();
  });
});
