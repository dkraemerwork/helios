/**
 * Port of {@code com.hazelcast.client.config.ClientConfig}.
 *
 * Root configuration for the Helios remote client. Holds cluster name,
 * instance name, network settings, connection strategy, security,
 * near-cache configs, and serialization config.
 */
import { ClientConnectionStrategyConfig } from '@zenystx/helios-core/client/config/ClientConnectionStrategyConfig';
import { ClientNetworkConfig } from '@zenystx/helios-core/client/config/ClientNetworkConfig';
import { ClientSecurityConfig } from '@zenystx/helios-core/client/config/ClientSecurityConfig';
import { NearCacheConfig } from '@zenystx/helios-core/config/NearCacheConfig';
import type { InstanceConfig } from '@zenystx/helios-core/core/InstanceConfig';
import { SerializationConfig } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';

/**
 * Port of {@code com.hazelcast.config.matcher.MatchingPointConfigPatternMatcher}.
 *
 * Finds the best-matching pattern for a given item name.
 */
export function matchingPointLookup(
    patterns: Iterable<string>,
    itemName: string,
): string | null {
    let candidate: string | null = null;
    let duplicate: string | null = null;
    let lastMatchingPoint = -1;

    for (const pattern of patterns) {
        const score = getMatchingPoint(pattern, itemName);
        if (score > -1 && score >= lastMatchingPoint) {
            if (score === lastMatchingPoint) {
                duplicate = candidate;
            } else {
                duplicate = null;
            }
            lastMatchingPoint = score;
            candidate = pattern;
        }
    }

    if (duplicate !== null) {
        throw new Error(
            `Ambiguous configuration: item "${itemName}" matches both "${candidate}" and "${duplicate}"`,
        );
    }

    return candidate;
}

function getMatchingPoint(pattern: string, itemName: string): number {
    const index = pattern.indexOf('*');
    if (index === -1) return -1;

    const firstPart = pattern.slice(0, index);
    if (!itemName.startsWith(firstPart)) return -1;

    const secondPart = pattern.slice(index + 1);
    if (!itemName.endsWith(secondPart)) return -1;

    if (itemName.length < firstPart.length + secondPart.length) return -1;

    return firstPart.length + secondPart.length;
}

export class ClientConfig implements InstanceConfig {
    private _name = "helios-client";
    private _clusterName = "dev";
    private readonly _networkConfig = new ClientNetworkConfig();
    private readonly _connectionStrategyConfig = new ClientConnectionStrategyConfig();
    private readonly _securityConfig = new ClientSecurityConfig();
    private readonly _serializationConfig = new SerializationConfig();
    private readonly _nearCacheConfigMap = new Map<string, NearCacheConfig>();
    private readonly _properties = new Map<string, string>();

    getName(): string {
        return this._name;
    }

    setName(name: string): this {
        this._name = name;
        return this;
    }

    getClusterName(): string {
        return this._clusterName;
    }

    setClusterName(clusterName: string): this {
        this._clusterName = clusterName;
        return this;
    }

    getNetworkConfig(): ClientNetworkConfig {
        return this._networkConfig;
    }

    getConnectionStrategyConfig(): ClientConnectionStrategyConfig {
        return this._connectionStrategyConfig;
    }

    getSecurityConfig(): ClientSecurityConfig {
        return this._securityConfig;
    }

    getSerializationConfig(): SerializationConfig {
        return this._serializationConfig;
    }

    getProperties(): Map<string, string> {
        return this._properties;
    }

    setProperty(key: string, value: string): this {
        this._properties.set(key, value);
        return this;
    }

    addNearCacheConfig(nearCacheConfig: NearCacheConfig): this {
        this._nearCacheConfigMap.set(nearCacheConfig.getName(), nearCacheConfig);
        return this;
    }

    getNearCacheConfig(name: string): NearCacheConfig | null {
        // 1. Exact match takes highest priority
        const exact = this._nearCacheConfigMap.get(name);
        if (exact !== undefined) return exact;

        // 2. Wildcard pattern match
        const matchedPattern = matchingPointLookup(this._nearCacheConfigMap.keys(), name);
        if (matchedPattern !== null) {
            return this._nearCacheConfigMap.get(matchedPattern) ?? null;
        }

        // 3. Fall back to "default" config if present
        return this._nearCacheConfigMap.get('default') ?? null;
    }

    getNearCacheConfigMap(): Map<string, NearCacheConfig> {
        return this._nearCacheConfigMap;
    }

    setNearCacheConfigMap(map: Map<string, NearCacheConfig>): this {
        this._nearCacheConfigMap.clear();
        for (const [k, v] of map) {
            v.setName(k);
            this._nearCacheConfigMap.set(k, v);
        }
        return this;
    }
}
