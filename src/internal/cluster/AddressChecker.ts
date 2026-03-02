/**
 * Port of {@code com.hazelcast.internal.cluster.AddressChecker}.
 */
import type { Address } from '@helios/cluster/Address';

export interface AddressChecker {
    /** Returns true if the given address is trusted. */
    isTrusted(address: Address | null): boolean;
}
