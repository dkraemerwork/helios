/**
 * Wiring proof: registry-backed config wiring
 * Label: mapstore-mongodb-wiring-registry
 *
 * factoryClassName='my-factory' resolves through MapStoreProviderRegistry
 * before falling back to dynamic loading.
 */
import { MapStoreConfig } from '@zenystx/helios-core/config/MapStoreConfig';
import { MapStoreContext } from '@zenystx/helios-core/map/impl/mapstore/MapStoreContext';
import { MapStoreProviderRegistry } from '@zenystx/helios-core/map/impl/mapstore/MapStoreProviderRegistry';
import { describe, expect, it } from 'bun:test';
import { TrackingMapStoreFactory } from './test-tracking-store.js';

describe('Wiring: registry-backed config', () => {
  it('factoryClassName resolves through registry and creates a working store', async () => {
    const registry = new MapStoreProviderRegistry();
    const factory = new TrackingMapStoreFactory();
    registry.register('my-tracking-factory', factory as any);

    const config = new MapStoreConfig()
      .setEnabled(true)
      .setFactoryClassName('my-tracking-factory');

    const ctx = await MapStoreContext.create<string, string>(
      'registry-map', config, { registry },
    );
    const ds = ctx.getMapDataStore();

    await ds.add('rk1', 'rv1', Date.now());
    expect(factory.lastCreatedStore!.data.get('rk1')).toBe('rv1');
  });

  it('className resolves through registry and creates a working store', async () => {
    const registry = new MapStoreProviderRegistry();
    const factory = new TrackingMapStoreFactory();
    registry.register('my-className-factory', factory as any);

    const config = new MapStoreConfig()
      .setEnabled(true)
      .setClassName('my-className-factory');

    const ctx = await MapStoreContext.create<string, string>(
      'registry-cn-map', config, { registry },
    );
    const ds = ctx.getMapDataStore();

    await ds.add('rk2', 'rv2', Date.now());
    expect(factory.lastCreatedStore!.data.get('rk2')).toBe('rv2');
  });
});
