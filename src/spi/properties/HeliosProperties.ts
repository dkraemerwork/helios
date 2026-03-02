/**
 * Port of {@code com.hazelcast.spi.properties.HazelcastProperties}.
 *
 * Typed reader over a string→string property map, with per-property defaults.
 */

/** Structural type accepted by HeliosProperties. Both ClusterProperty and HeliosProperty satisfy this. */
export interface PropertySpec {
    readonly name: string;
    readonly defaultValue: string;
}

export interface HeliosProperties {
    /** Read a property as an integer (uses the property's default if not set). */
    getInteger(property: PropertySpec): number;

    /** Read a property as a string (uses the property's default if not set). */
    getString(property: PropertySpec): string;
}

/**
 * Default implementation backed by a plain string→string map.
 * Matches {@code HazelcastProperties(Properties)} constructor behaviour.
 */
export class MapHeliosProperties implements HeliosProperties {
    private readonly _map: Map<string, string>;

    constructor(map: Record<string, string> | Map<string, string> = {}) {
        this._map = map instanceof Map ? map : new Map(Object.entries(map));
    }

    getString(property: PropertySpec): string {
        return this._map.get(property.name) ?? property.defaultValue;
    }

    getInteger(property: PropertySpec): number {
        return parseInt(this.getString(property), 10);
    }
}
