/**
 * Wiring proof: config-origin-relative resolution
 * Label: mapstore-mongodb-wiring-config-origin-relative
 *
 * A config file with a relative className (e.g., './my-store.ts#MyStore')
 * resolves relative to the config file's directory, not process.cwd().
 */
import { describe, it, expect } from 'bun:test';
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { loadConfig } from '@zenystx/helios-core/config/ConfigLoader';

const fixtureDir = resolve(import.meta.dir, '__fixtures__', 'origin-relative');

describe('Wiring: config-origin-relative resolution', () => {
  it('relative className resolves relative to config file origin', async () => {
    mkdirSync(fixtureDir, { recursive: true });

    // Copy the tracking store into the fixture dir so we can reference it relatively
    const srcStore = resolve(import.meta.dir, 'test-tracking-store.ts');
    const destStore = resolve(fixtureDir, 'my-store.ts');
    copyFileSync(srcStore, destStore);

    // Config uses relative path — should resolve relative to config file location
    const configObj = {
      name: 'origin-relative-test',
      maps: [{
        name: 'origin-map',
        'map-store': {
          enabled: true,
          className: './my-store.ts#TrackingMapStore',
        },
      }],
    };

    const configPath = resolve(fixtureDir, 'helios-config.json');
    writeFileSync(configPath, JSON.stringify(configObj, null, 2));

    try {
      const heliosConfig = await loadConfig(configPath);
      const mapConfig = heliosConfig.getMapConfig('origin-map');
      expect(mapConfig).not.toBeNull();

      const msConfig = mapConfig!.getMapStoreConfig();
      expect(msConfig.isEnabled()).toBe(true);

      // The configOrigin should be set to the config file path
      expect(heliosConfig.getConfigOrigin()).toBe(configPath);

      // Prove it resolves via MapStoreContext using configOrigin
      const { MapStoreContext } = await import(
        '@zenystx/helios-core/map/impl/mapstore/MapStoreContext'
      );
      const ctx = await MapStoreContext.create<string, string>(
        'origin-map', msConfig, { configOrigin: configPath },
      );
      const ds = ctx.getMapDataStore();
      await ds.add('ok1', 'ov1', Date.now());
      const loaded = await ds.load('ok1');
      expect(loaded).toBe('ov1');
    } finally {
      rmSync(resolve(import.meta.dir, '__fixtures__'), { recursive: true, force: true });
    }
  });
});
