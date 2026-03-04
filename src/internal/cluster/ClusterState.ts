/**
 * Port of {@code com.hazelcast.cluster.ClusterState}.
 *
 * Represents the lifecycle state of a Helios cluster.
 */
export enum ClusterState {
    /** Normal operating mode — all operations and migrations allowed. */
    ACTIVE = 'ACTIVE',

    /** Migrations are paused, but read/write operations continue. */
    NO_MIGRATION = 'NO_MIGRATION',

    /** Cluster is frozen — no migrations, no new members, but reads/writes still work. */
    FROZEN = 'FROZEN',

    /** Cluster is shutting down — no operations allowed. */
    PASSIVE = 'PASSIVE',

    /**
     * Transient state during a state transition.
     * Cannot be set directly — only used internally during distributed lock acquisition.
     */
    IN_TRANSITION = 'IN_TRANSITION',
}
