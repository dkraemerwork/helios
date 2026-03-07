/**
 * Wiring proof: dynamic JSON file config loading
 * Label: mapstore-mongodb-wiring-dynamic-json
 *
 * A JSON config file with map-store.factoryClassName resolves via
 * ConfigLoader → MapStoreContext pipeline.
 */
import { describe, it, expect } from 'bun:test';
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { loadConfig } from '@zenystx/helios-core/config/ConfigLoader';

const fixtureDir = resolve(import.meta.dir, '__fixtures__');

describe('Wiring: dynamic JSON config', () => {
  it('JSON config with map-store.factoryClassName resolves and wires a working store', async () => {
    mkdirSync(fixtureDir, { recursive: true });

    const storePath = resolve(import.meta.dir, 'test-tracking-store.ts');

    const configObj = {
      name: 'json-wiring-test',
      maps: [{
        name: 'json-wired-map',
        'map-store': {
          enabled: true,
          factoryClassName: `${storePath}#TrackingMapStoreFactory`,
        },
      }],
    };

    const configPath = resolve(fixtureDir, 'wiring-json-test.json');
    writeFileSync(configPath, JSON.stringify(configObj, null, 2));

    try {
      const heliosConfig = await loadConfig(configPath);
      const mapConfig = heliosConfig.getMapConfig('json-wired-map');
      expect(mapConfig).not.toBeNull();

      const msConfig = mapConfig!.getMapStoreConfig();
      expect(msConfig.isEnabled()).toBe(true);
      expect(msConfig.getFactoryClassName()).toBe(`${storePath}#TrackingMapStoreFactory`);

      // Prove the factory resolves via MapStoreContext
      const { MapStoreContext } = await import(
        '@zenystx/helios-core/map/impl/mapstore/MapStoreContext'
      );
      const ctx = await MapStoreContext.create<string, string>('json-wired-map', msConfig);
      const ds = ctx.getMapDataStore();
      await ds.add('jk1', 'jv1', Date.now());
      const loaded = await ds.load('jk1');
      expect(loaded).toBe('jv1');
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
