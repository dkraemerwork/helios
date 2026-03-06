/**
 * Port of {@code com.hazelcast.internal.cluster.impl.AddressCheckerImpl}.
 * Checks if an Address belongs to a set of trusted interfaces.
 */
import type { Address } from '@zenystx/helios-core/cluster/Address';
import type { AddressChecker } from '@zenystx/helios-core/internal/cluster/AddressChecker';
import { matchAnyInterface } from '@zenystx/helios-core/internal/util/AddressUtil';

export class AddressCheckerImpl implements AddressChecker {
    private readonly trustedInterfaces: Set<string>;

    constructor(trustedInterfaces: Set<string>, _logger: unknown) {
        this.trustedInterfaces = trustedInterfaces;
    }

    isTrusted(address: Address | null): boolean {
        if (address == null) return false;
        if (this.trustedInterfaces.size === 0) return true;

        const host = address.getHost();
        return matchAnyInterface(host, this.trustedInterfaces);
    }
}
