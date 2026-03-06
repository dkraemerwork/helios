import type { MapStoreFactory } from '../../MapStoreFactory.js';

/**
 * Registry for named MapStore providers/factories.
 *
 * Applications register providers before instance creation via
 * HeliosConfig.registerMapStoreProvider(name, provider).
 * MapStoreContext resolves factoryClassName/className through this registry
 * before falling back to dynamic module loading.
 */
export class MapStoreProviderRegistry {
  private readonly _providers = new Map<string, MapStoreFactory<unknown, unknown>>();

  register(name: string, factory: MapStoreFactory<unknown, unknown>): void {
    this._providers.set(name, factory);
  }

  get(name: string): MapStoreFactory<unknown, unknown> | null {
    return this._providers.get(name) ?? null;
  }

  has(name: string): boolean {
    return this._providers.has(name);
  }
}
