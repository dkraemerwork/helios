import { describe, test, expect } from 'bun:test';
import { MapStoreConfig } from '@zenystx/helios-core/config/MapStoreConfig';
import { MapConfig } from '@zenystx/helios-core/config/MapConfig';
import type { MapStoreFactory } from '@zenystx/helios-core/map/MapStoreFactory';
import type { MapStore } from '@zenystx/helios-core/map/MapStore';

// Compile-time smoke test — verify root-barrel exports
import type { MapLoader } from '@zenystx/helios-core/map/MapLoader';
import type { MapLoaderLifecycleSupport } from '@zenystx/helios-core/map/MapLoaderLifecycleSupport';
import { MapKeyStream } from '@zenystx/helios-core/map/MapKeyStream';
// (if these lines compile, the exports are wired)

const fakeFactory: MapStoreFactory<string, string> = {
  newMapStore: async (_mapName, _props): Promise<MapStore<string, string>> => ({
    load: async () => null,
    loadAll: async () => new Map(),
    loadAllKeys: async () => MapKeyStream.fromIterable([]),
    store: async () => {},
    storeAll: async () => {},
    delete: async () => {},
    deleteAll: async () => {},
  }),
};

const fakeImpl = {
  load: async () => null,
  loadAll: async () => new Map(),
  loadAllKeys: async () => MapKeyStream.fromIterable([]),
  store: async () => {},
  storeAll: async () => {},
  delete: async () => {},
  deleteAll: async () => {},
};

describe('MapStoreConfig mutual exclusivity', () => {
  test('setFactoryImplementation() clears _implementation', () => {
    const cfg = new MapStoreConfig();
    cfg.setImplementation(fakeImpl);
    cfg.setFactoryImplementation(fakeFactory);
    expect(cfg.getImplementation()).toBeNull();
    expect(cfg.getFactoryImplementation()).toBe(fakeFactory);
  });

  test('setImplementation() clears _factoryImplementation', () => {
    const cfg = new MapStoreConfig();
    cfg.setFactoryImplementation(fakeFactory);
    cfg.setImplementation(fakeImpl);
    expect(cfg.getFactoryImplementation()).toBeNull();
    expect(cfg.getImplementation()).toBe(fakeImpl);
  });

  test('setFactoryImplementation then setImplementation — only implementation survives', () => {
    const cfg = new MapStoreConfig();
    cfg.setFactoryImplementation(fakeFactory);
    cfg.setImplementation(fakeImpl);
    expect(cfg.getFactoryImplementation()).toBeNull();
    expect(cfg.getImplementation()).toBe(fakeImpl);
  });

  test('MapConfig.getMapStoreConfig() returns a MapStoreConfig instance', () => {
    const mapCfg = new MapConfig();
    const storeCfg = mapCfg.getMapStoreConfig();
    expect(storeCfg).toBeInstanceOf(MapStoreConfig);
  });
});
