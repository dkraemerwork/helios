/**
 * Wiring proof: direct `factoryImplementation` — MapStoreConfig.setFactoryImplementation(factory)
 * Label: mapstore-mongodb-wiring-factory-implementation
 */
import { describe, it, expect } from 'bun:test';
import { MapStoreConfig } from '@zenystx/helios-core/config/MapStoreConfig';
import { MapStoreContext } from '@zenystx/helios-core/map/impl/mapstore/MapStoreContext';
import { TrackingMapStoreFactory } from './test-tracking-store.js';

describe('Wiring: direct factoryImplementation', () => {
  it('MapStoreContext.create() resolves setFactoryImplementation(factory) and produces a working store', async () => {
    const factory = new TrackingMapStoreFactory();
    const config = new MapStoreConfig()
      .setEnabled(true)
      .setFactoryImplementation(factory);

    const ctx = await MapStoreContext.create<string, string>('factory-impl-map', config);
    const ds = ctx.getMapDataStore();

    expect(factory.createCount).toBe(1);

    await ds.add('k1', 'v1', Date.now());
    expect(factory.lastCreatedStore!.data.get('k1')).toBe('v1');
  });

  it('factory receives mapName in newMapStore call', async () => {
    const factory = new TrackingMapStoreFactory();
    const config = new MapStoreConfig()
      .setEnabled(true)
      .setFactoryImplementation(factory);

    await MapStoreContext.create<string, string>('named-factory-map', config);
    expect(factory.lastCreatedStore!.initMapName).toBe('named-factory-map');
  });
});
