/**
 * Wiring proof: direct `implementation` — MapStoreConfig.setImplementation(store)
 * Label: mapstore-mongodb-wiring-implementation
 */
import { MapStoreConfig } from '@zenystx/helios-core/config/MapStoreConfig';
import { MapStoreContext } from '@zenystx/helios-core/map/impl/mapstore/MapStoreContext';
import { describe, expect, it } from 'bun:test';
import { TrackingMapStore } from './test-tracking-store.js';

describe('Wiring: direct implementation', () => {
  it('MapStoreContext.create() resolves setImplementation(store) and round-trips data', async () => {
    const store = new TrackingMapStore();
    const config = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store);

    const ctx = await MapStoreContext.create<string, string>('impl-wiring-map', config);
    const ds = ctx.getMapDataStore();

    await ds.add('k1', 'v1', Date.now());
    expect(store.data.get('k1')).toBe('v1');

    const loaded = await ds.load('k1');
    expect(loaded).toBe('v1');
  });

  it('lifecycle init/destroy are called', async () => {
    const store = new TrackingMapStore();
    const config = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store);

    const ctx = await MapStoreContext.create<string, string>('impl-lifecycle-map', config);
    expect(store.initCalled).toBe(true);

    await ctx.destroy();
    expect(store.destroyCalled).toBe(true);
  });
});
