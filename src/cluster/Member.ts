/**
 * Port of {@code com.hazelcast.cluster.Member}.
 */
import type { Address } from '@helios/cluster/Address';
import type { MemberVersion } from '@helios/version/MemberVersion';
import type { EndpointQualifier } from '@helios/instance/EndpointQualifier';

export interface Member {
    /** Returns true if this member is the local member. */
    localMember(): boolean;

    /** Returns true if this member is a lite member (owns no partitions). */
    isLiteMember(): boolean;

    /** Returns the Address of this member. */
    getAddress(): Address;

    /** Returns the UUID of this member. */
    getUuid(): string;

    /** Returns a map of server socket Addresses per EndpointQualifier. */
    getAddressMap(): Map<EndpointQualifier, Address>;

    /** Returns configured attributes for this member. */
    getAttributes(): Map<string, string>;

    /** Returns the value of the specified attribute key, or null. */
    getAttribute(key: string): string | null;

    /** Returns the member version. */
    getVersion(): MemberVersion;
}
