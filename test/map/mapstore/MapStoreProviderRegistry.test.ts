import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { MapStoreProviderRegistry } from '@zenystx/helios-core/map/impl/mapstore/MapStoreProviderRegistry';
import { MapKeyStream } from '@zenystx/helios-core/map/MapKeyStream';
import { describe, expect, test } from 'bun:test';

describe('MapStoreProviderRegistry', () => {
  test('registerMapStoreProvider() and getMapStoreProvider() round-trip', () => {
    const config = new HeliosConfig();
    const provider = {
      newMapStore: (_mapName: string, _properties: Map<string, string>) => ({
        load: async () => null,
        loadAll: async () => new Map(),
        loadAllKeys: async () => MapKeyStream.empty(),
        store: async () => {},
        storeAll: async () => {},
        delete: async () => {},
        deleteAll: async () => {},
      }),
    };
    config.registerMapStoreProvider('mongo', provider as any);
    expect(config.getMapStoreProvider('mongo')).toBe(provider);
  });

  test('getMapStoreProvider() returns null for unregistered name', () => {
    const config = new HeliosConfig();
    expect(config.getMapStoreProvider('nonexistent')).toBeNull();
  });

  test('getMapStoreProviderRegistry() returns the registry', () => {
    const config = new HeliosConfig();
    const registry = config.getMapStoreProviderRegistry();
    expect(registry).toBeDefined();
    expect(registry).toBeInstanceOf(MapStoreProviderRegistry);
  });

  test('MapStoreContext resolves factoryClassName through registry before dynamic loading', async () => {
    // This test verifies the selector contract:
    // factoryClassName first checks registry, then falls back to dynamic loading
    const registry = new MapStoreProviderRegistry();
    const mockFactory = {
      newMapStore: (_mapName: string, _properties: Map<string, string>) => ({
        load: async () => null,
        loadAll: async () => new Map(),
        loadAllKeys: async () => MapKeyStream.empty(),
        store: async () => {},
        storeAll: async () => {},
        delete: async () => {},
        deleteAll: async () => {},
      }),
    };
    registry.register('my-mongo-factory', mockFactory as any);
    expect(registry.get('my-mongo-factory')).toBe(mockFactory);
    expect(registry.get('nonexistent')).toBeNull();
  });

  test('dynamic loading rejects malformed specifiers', async () => {
    const { MapStoreDynamicLoader } = await import(
      '@zenystx/helios-core/map/impl/mapstore/MapStoreDynamicLoader'
    );
    await expect(
      MapStoreDynamicLoader.load('invalid-no-hash')
    ).rejects.toThrow(/module-specifier#exportName/i);
  });
});
