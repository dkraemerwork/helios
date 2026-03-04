/**
 * Port of {@code com.hazelcast.internal.cluster.impl.ClusterStateManager}.
 *
 * Manages cluster state transitions (ACTIVE/NO_MIGRATION/FROZEN/PASSIVE)
 * with partition state stamp validation to prevent state changes during migrations.
 */
import { ClusterState } from '@helios/internal/cluster/ClusterState';

export class ClusterStateManager {
    private _state: ClusterState = ClusterState.ACTIVE;

    getState(): ClusterState {
        return this._state;
    }

    /**
     * Transitions to a new cluster state.
     * IN_TRANSITION cannot be set directly — it is a transient internal state.
     */
    setState(newState: ClusterState): void {
        if (newState === ClusterState.IN_TRANSITION) {
            throw new Error('Cannot set cluster state to IN_TRANSITION directly');
        }
        this._state = newState;
    }

    /**
     * Validates that a cluster state change is safe given the current partition state.
     *
     * Remediation — Finding 13 (HIGH): Partition State Stamp Validation
     * Ref: ClusterStateManager.java:288-301 — checkMigrationsAndPartitionStateStamp()
     *
     * @param expectedStamp - the partition state stamp provided by the state-change request
     * @param currentStamp - the actual current partition state stamp on this node
     * @param migrationsInProgress - whether any partition migrations are currently in flight
     * @throws Error if stamps don't match or migrations are in progress
     */
    checkMigrationsAndPartitionStateStamp(
        expectedStamp: bigint,
        currentStamp: bigint,
        migrationsInProgress: boolean,
    ): void {
        if (migrationsInProgress) {
            throw new Error(
                'Cannot change cluster state: partition migrations are in progress',
            );
        }
        if (expectedStamp !== currentStamp) {
            throw new Error(
                `Cannot change cluster state: partition state stamp mismatch ` +
                `(expected=${expectedStamp}, current=${currentStamp})`,
            );
        }
    }
}
