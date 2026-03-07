/**
 * Wiring proof: dynamic programmatic loading
 * Label: mapstore-mongodb-wiring-dynamic-programmatic
 *
 * className='./test-tracking-store.js#TrackingMapStoreFactory' resolves
 * via MapStoreDynamicLoader when no registry match exists.
 */
import { describe, it, expect } from 'bun:test';
import { resolve } from 'node:path';
import { MapStoreConfig } from '@zenystx/helios-core/config/MapStoreConfig';
import { MapStoreContext } from '@zenystx/helios-core/map/impl/mapstore/MapStoreContext';

const thisDir = import.meta.dir;

describe('Wiring: dynamic programmatic loading', () => {
  it('factoryClassName as module#export resolves via dynamic import', async () => {
    const absPath = resolve(thisDir, 'test-tracking-store.ts');
    const specifier = `${absPath}#TrackingMapStoreFactory`;

    const config = new MapStoreConfig()
      .setEnabled(true)
      .setFactoryClassName(specifier);

    const ctx = await MapStoreContext.create<string, string>(
      'dynamic-prog-map', config,
    );
    const ds = ctx.getMapDataStore();

    await ds.add('dk1', 'dv1', Date.now());
    const loaded = await ds.load('dk1');
    expect(loaded).toBe('dv1');
  });

  it('className as module#export resolves a MapStore directly', async () => {
    const absPath = resolve(thisDir, 'test-tracking-store.ts');
    const specifier = `${absPath}#TrackingMapStore`;

    const config = new MapStoreConfig()
      .setEnabled(true)
      .setClassName(specifier);

    const ctx = await MapStoreContext.create<string, string>(
      'dynamic-prog-direct-map', config,
    );
    const ds = ctx.getMapDataStore();

    await ds.add('dk2', 'dv2', Date.now());
    const loaded = await ds.load('dk2');
    expect(loaded).toBe('dv2');
  });
});
