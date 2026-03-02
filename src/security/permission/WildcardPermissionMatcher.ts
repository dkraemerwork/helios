/**
 * Simplified wildcard pattern matching for permission names.
 * Port of com.hazelcast.config.matcher.WildcardConfigPatternMatcher
 * (the boolean matches(pattern, itemName) method only)
 */
export function wildcardMatches(pattern: string, itemName: string): boolean {
    const index = pattern.indexOf('*');
    if (index === -1) {
        return itemName === pattern;
    }
    const firstPart = pattern.substring(0, index);
    if (!itemName.startsWith(firstPart)) return false;
    const secondPart = pattern.substring(index + 1);
    if (!itemName.endsWith(secondPart)) return false;
    // itemName length must be >= pattern length - 1
    return itemName.length + 1 >= pattern.length;
}
