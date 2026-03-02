import type { Member } from '@helios/cluster/Member';

/**
 * Cluster interface — provides access to cluster membership info.
 * Port of com.hazelcast.cluster.Cluster (minimal surface for Block 7.3).
 */
export interface Cluster {
    /** Returns all members in the cluster, including the local member. */
    getMembers(): Member[];

    /** Returns the local member. */
    getLocalMember(): Member;
}
