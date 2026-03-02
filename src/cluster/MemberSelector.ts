/**
 * Port of {@code com.hazelcast.cluster.MemberSelector}.
 */
import type { Member } from '@helios/cluster/Member';

export interface MemberSelector {
    /**
     * Decides if the given member will be part of an operation.
     * @returns true if the member should participate, false otherwise
     */
    select(member: Member): boolean;
}
