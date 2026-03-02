/**
 * Port of {@code com.hazelcast.internal.util.AddressUtil} (IPv4 matching only).
 * Provides IP address pattern matching: exact, wildcard (*), and range (n-m).
 */

/**
 * Returns true if the address matches any of the given interface patterns.
 * Patterns support: exact IP, wildcards (*), and ranges (e.g. 127.0.0.1-100).
 */
export function matchAnyInterface(address: string, interfaces: Iterable<string>): boolean {
    for (const iface of interfaces) {
        if (matchInterface(address, iface)) {
            return true;
        }
    }
    return false;
}

/**
 * Returns true if the address matches the given interface mask pattern.
 */
export function matchInterface(address: string, interfaceMask: string): boolean {
    try {
        return matchIpv4(address, interfaceMask);
    } catch {
        return false;
    }
}

/**
 * Matches an IPv4 address string against a mask pattern.
 * Mask format: each octet can be:
 *   - a literal number  (e.g. "127")
 *   - a wildcard        (e.g. "*")
 *   - a range           (e.g. "1-100")
 */
function matchIpv4(address: string, mask: string): boolean {
    const addrParts = address.split('.');
    const maskParts = mask.split('.');

    if (addrParts.length !== 4 || maskParts.length !== 4) {
        return false;
    }

    for (let i = 0; i < 4; i++) {
        const addrOctet = parseInt(addrParts[i], 10);
        if (isNaN(addrOctet)) return false;
        if (!matchOctet(addrOctet, maskParts[i])) {
            return false;
        }
    }
    return true;
}

function matchOctet(value: number, mask: string): boolean {
    if (mask === '*') return true;

    const dashIdx = mask.indexOf('-');
    if (dashIdx !== -1) {
        const start = parseInt(mask.substring(0, dashIdx).trim(), 10);
        const end = parseInt(mask.substring(dashIdx + 1).trim(), 10);
        return value >= start && value <= end;
    }

    const expected = parseInt(mask, 10);
    return value === expected;
}
