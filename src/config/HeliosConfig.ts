/**
 * Top-level configuration for a Helios instance.
 *
 * Holds the instance name and any per-map configurations.
 * Use HeliosConfig as the entry point when constructing a HeliosInstanceImpl.
 */
import { MapConfig } from '@helios/config/MapConfig';
import { NetworkConfig } from '@helios/config/NetworkConfig';

export class HeliosConfig {
    private readonly _name: string;
    private readonly _mapConfigs = new Map<string, MapConfig>();
    private readonly _network: NetworkConfig = new NetworkConfig();

    constructor(name?: string) {
        this._name = name ?? 'helios';
    }

    getName(): string {
        return this._name;
    }

    /**
     * Returns the network configuration (port, join strategy, etc.).
     */
    getNetworkConfig(): NetworkConfig {
        return this._network;
    }

    /**
     * Register a MapConfig. The config's name (from MapConfig.getName()) is used
     * as the lookup key. Throws if the MapConfig has no name set.
     */
    addMapConfig(mapConfig: MapConfig): this {
        const name = mapConfig.getName();
        if (name == null) {
            throw new Error('MapConfig must have a name when added to HeliosConfig');
        }
        this._mapConfigs.set(name, mapConfig);
        return this;
    }

    /**
     * Returns the MapConfig registered for the given map name, or null.
     */
    getMapConfig(name: string): MapConfig | null {
        return this._mapConfigs.get(name) ?? null;
    }

    /**
     * Returns all registered MapConfigs.
     */
    getMapConfigs(): ReadonlyMap<string, MapConfig> {
        return this._mapConfigs;
    }
}
