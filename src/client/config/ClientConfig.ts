/**
 * Port of {@code com.hazelcast.client.config.ClientConfig}.
 *
 * Client-side configuration holding per-data-structure NearCacheConfigs,
 * resolved via {@link MatchingPointConfigPatternMatcher} wildcard rules.
 */
import { NearCacheConfig } from '@zenystx/helios-core/config/NearCacheConfig';
import type { InstanceConfig } from '@zenystx/helios-core/core/InstanceConfig';

/**
 * Port of {@code com.hazelcast.config.matcher.MatchingPointConfigPatternMatcher}.
 *
 * Finds the best-matching pattern for a given item name.
 *
 * Patterns support a single '*' wildcard:
 *   "map*"        → matches "mapFoo", "mapBar"
 *   "*Map"        → matches "fooMap", "barMap"
 *   "map*Bar"     → matches "mapFooBar", "mapBazBar"
 *
 * Scoring: prefix.length + suffix.length (higher score = more specific).
 * Ambiguity: throws if two patterns share the same score for the same item.
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

/**
 * Returns the matching score of {@code pattern} against {@code itemName}.
 * -1 means no match.
 */
function getMatchingPoint(pattern: string, itemName: string): number {
    const index = pattern.indexOf('*');
    if (index === -1) {
        return -1; // no wildcard → no match via pattern
    }

    const firstPart = pattern.slice(0, index);
    if (!itemName.startsWith(firstPart)) return -1;

    const secondPart = pattern.slice(index + 1);
    if (!itemName.endsWith(secondPart)) return -1;

    // Ensure the wildcard consumes at least 0 characters (no overlap)
    if (itemName.length < firstPart.length + secondPart.length) return -1;

    return firstPart.length + secondPart.length;
}

/**
 * Port of {@code com.hazelcast.client.config.ClientConfig}.
 *
 * Lightweight client config holding named NearCacheConfigs retrieved
 * with wildcard pattern matching.
 */
export class ClientConfig implements InstanceConfig {
    private _name = "helios-client";
    private readonly _nearCacheConfigMap = new Map<string, NearCacheConfig>();

    /** Returns the client instance name. */
    getName(): string {
        return this._name;
    }

    /** Sets the client instance name. */
    setName(name: string): this {
        this._name = name;
        return this;
    }

    /**
     * Adds a NearCacheConfig. Stored by its configured name.
     *
     * Port of {@code ClientConfig.addNearCacheConfig}.
     */
    addNearCacheConfig(nearCacheConfig: NearCacheConfig): this {
        this._nearCacheConfigMap.set(nearCacheConfig.getName(), nearCacheConfig);
        return this;
    }

    /**
     * Returns the NearCacheConfig whose name pattern best matches {@code name}.
     *
     * Falls back to the "default" config when no pattern matches.
     * Returns null when there is neither a matching pattern nor a default.
     *
     * Port of {@code ClientConfig.getNearCacheConfig}.
     */
    getNearCacheConfig(name: string): NearCacheConfig | null {
        const matchedPattern = matchingPointLookup(this._nearCacheConfigMap.keys(), name);
        if (matchedPattern !== null) {
            return this._nearCacheConfigMap.get(matchedPattern) ?? null;
        }

        // Fall back to exact "default" entry
        return this._nearCacheConfigMap.get('default') ?? null;
    }

    /** Returns the raw config map (not a copy). */
    getNearCacheConfigMap(): Map<string, NearCacheConfig> {
        return this._nearCacheConfigMap;
    }

    /**
     * Replaces all NearCacheConfigs from the given map.
     *
     * Port of {@code ClientConfig.setNearCacheConfigMap}.
     */
    setNearCacheConfigMap(map: Map<string, NearCacheConfig>): this {
        this._nearCacheConfigMap.clear();
        for (const [k, v] of map) {
            v.setName(k);
            this._nearCacheConfigMap.set(k, v);
        }
        return this;
    }
}
