/**
 * Wiring proof: dynamic YAML file config loading
 * Label: mapstore-mongodb-wiring-dynamic-yaml
 *
 * A YAML config file with map-store.factoryClassName resolves via
 * ConfigLoader → MapStoreContext pipeline.
 */
import { describe, it, expect } from 'bun:test';
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { loadConfig } from '@zenystx/helios-core/config/ConfigLoader';

const fixtureDir = resolve(import.meta.dir, '__fixtures__');

describe('Wiring: dynamic YAML config', () => {
  it('YAML config with map-store.className resolves and wires a working store', async () => {
    mkdirSync(fixtureDir, { recursive: true });

    const storePath = resolve(import.meta.dir, 'test-tracking-store.ts');

    const yamlContent = `
name: yaml-wiring-test
maps:
  - name: yaml-wired-map
    map-store:
      enabled: true
      className: "${storePath}#TrackingMapStore"
`;

    const configPath = resolve(fixtureDir, 'wiring-yaml-test.yml');
    writeFileSync(configPath, yamlContent);

    try {
      const heliosConfig = await loadConfig(configPath);
      const mapConfig = heliosConfig.getMapConfig('yaml-wired-map');
      expect(mapConfig).not.toBeNull();

      const msConfig = mapConfig!.getMapStoreConfig();
      expect(msConfig.isEnabled()).toBe(true);
      expect(msConfig.getClassName()).toBe(`${storePath}#TrackingMapStore`);

      // Prove it resolves via MapStoreContext
      const { MapStoreContext } = await import(
        '@zenystx/helios-core/map/impl/mapstore/MapStoreContext'
      );
      const ctx = await MapStoreContext.create<string, string>('yaml-wired-map', msConfig);
      const ds = ctx.getMapDataStore();
      await ds.add('yk1', 'yv1', Date.now());
      const loaded = await ds.load('yk1');
      expect(loaded).toBe('yv1');
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
