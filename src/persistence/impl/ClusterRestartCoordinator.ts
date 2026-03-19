/**
 * Coordinated cluster restart for persistence recovery.
 *
 * Implements the recovery policy negotiation that allows a cluster to restart
 * after a crash and determine whether enough partitions have been recovered
 * to safely serve operations without data loss.
 */
import type { MemberInfo } from '@zenystx/helios-core/cluster/MemberInfo';

export enum ClusterDataRecoveryPolicy {
    /** All partitions must be recovered before the cluster accepts operations. */
    FULL_RECOVERY_ONLY = 'FULL_RECOVERY_ONLY',
    /** Accept restart if >50% of partitions recovered, preferring newest data. */
    PARTIAL_RECOVERY_MOST_RECENT = 'PARTIAL_RECOVERY_MOST_RECENT',
    /** Accept restart if >50% of partitions recovered, preferring most complete data. */
    PARTIAL_RECOVERY_MOST_COMPLETE = 'PARTIAL_RECOVERY_MOST_COMPLETE',
}

export interface MemberRecoveryState {
    /** Member UUID. */
    readonly memberId: string;
    /** Set of partition IDs that this member successfully recovered. */
    readonly recoveredPartitions: Set<number>;
    /** WAL sequence of the most recent log entry recovered. */
    readonly latestWalSequence: bigint;
    /** Total number of entries recovered (from checkpoint + WAL replay). */
    readonly totalEntriesRecovered: number;
    /** Timestamp of the member's latest WAL checkpoint. */
    readonly checkpointTimestamp: number;
}

export interface RestartValidationResult {
    readonly accepted: boolean;
    /** Reason for rejection or acceptance. */
    readonly reason: string;
    /** Partitions that were successfully recovered across all members. */
    readonly recoveredPartitions: Set<number>;
    /** Partitions that could NOT be recovered. */
    readonly missingPartitions: Set<number>;
}

export class ClusterRestartCoordinator {
    private readonly _policy: ClusterDataRecoveryPolicy;
    private readonly _totalPartitions: number;

    constructor(
        policy: ClusterDataRecoveryPolicy,
        totalPartitions: number = 271,
    ) {
        this._policy = policy;
        this._totalPartitions = totalPartitions;
    }

    getPolicy(): ClusterDataRecoveryPolicy {
        return this._policy;
    }

    /**
     * Validate whether the recovered partitions from a single member
     * satisfy the configured recovery policy.
     */
    validatePartitionRecovery(recoveredPartitions: Set<number>, totalPartitions: number): boolean {
        const total = totalPartitions > 0 ? totalPartitions : this._totalPartitions;

        switch (this._policy) {
            case ClusterDataRecoveryPolicy.FULL_RECOVERY_ONLY:
                return recoveredPartitions.size === total;

            case ClusterDataRecoveryPolicy.PARTIAL_RECOVERY_MOST_RECENT:
            case ClusterDataRecoveryPolicy.PARTIAL_RECOVERY_MOST_COMPLETE:
                return recoveredPartitions.size > total * 0.5;
        }
    }

    /**
     * Coordinate a cluster restart across all known members.
     *
     * Algorithm:
     * 1. Collect recovery state from all members (simulated here via the MemberInfo list
     *    and local recovery state; in a real cluster, this would be an RPC exchange).
     * 2. Union the recovered partition sets across all members.
     * 3. Apply the policy:
     *    - FULL_RECOVERY_ONLY: all partitions must be covered.
     *    - PARTIAL_RECOVERY_MOST_RECENT: >50% covered, resolve conflicts by newest WAL sequence.
     *    - PARTIAL_RECOVERY_MOST_COMPLETE: >50% covered, resolve conflicts by most entries.
     * 4. Throw if the policy validation fails; otherwise resolve.
     */
    async coordinateRestart(
        members: MemberInfo[],
        localRecoveryState: MemberRecoveryState,
        remoteRecoveryStates: MemberRecoveryState[] = [],
    ): Promise<RestartValidationResult> {
        const allStates: MemberRecoveryState[] = [localRecoveryState, ...remoteRecoveryStates];

        // Union all recovered partitions across members
        const allRecoveredPartitions = new Set<number>();
        for (const state of allStates) {
            for (const partitionId of state.recoveredPartitions) {
                allRecoveredPartitions.add(partitionId);
            }
        }

        // Compute missing partitions
        const missingPartitions = new Set<number>();
        for (let i = 0; i < this._totalPartitions; i++) {
            if (!allRecoveredPartitions.has(i)) {
                missingPartitions.add(i);
            }
        }

        const recoveryRatio = allRecoveredPartitions.size / this._totalPartitions;

        switch (this._policy) {
            case ClusterDataRecoveryPolicy.FULL_RECOVERY_ONLY: {
                if (missingPartitions.size > 0) {
                    const missing = Array.from(missingPartitions).slice(0, 10).join(', ');
                    const suffix = missingPartitions.size > 10 ? ` ... and ${missingPartitions.size - 10} more` : '';
                    return {
                        accepted: false,
                        reason: `FULL_RECOVERY_ONLY policy requires all ${this._totalPartitions} partitions. ` +
                            `Missing ${missingPartitions.size} partitions: [${missing}${suffix}]`,
                        recoveredPartitions: allRecoveredPartitions,
                        missingPartitions,
                    };
                }
                return {
                    accepted: true,
                    reason: `All ${this._totalPartitions} partitions recovered across ${allStates.length} member(s).`,
                    recoveredPartitions: allRecoveredPartitions,
                    missingPartitions,
                };
            }

            case ClusterDataRecoveryPolicy.PARTIAL_RECOVERY_MOST_RECENT: {
                if (recoveryRatio <= 0.5) {
                    return {
                        accepted: false,
                        reason: `PARTIAL_RECOVERY_MOST_RECENT requires >50% of partitions. ` +
                            `Only ${allRecoveredPartitions.size}/${this._totalPartitions} (${(recoveryRatio * 100).toFixed(1)}%) recovered.`,
                        recoveredPartitions: allRecoveredPartitions,
                        missingPartitions,
                    };
                }
                // Select the member with the highest WAL sequence as the authoritative source
                const authoritative = this._selectMostRecent(allStates);
                return {
                    accepted: true,
                    reason: `PARTIAL_RECOVERY_MOST_RECENT: ${allRecoveredPartitions.size}/${this._totalPartitions} partitions recovered ` +
                        `(${(recoveryRatio * 100).toFixed(1)}%). ` +
                        `Authoritative member: ${authoritative.memberId} (WAL seq=${authoritative.latestWalSequence}).`,
                    recoveredPartitions: allRecoveredPartitions,
                    missingPartitions,
                };
            }

            case ClusterDataRecoveryPolicy.PARTIAL_RECOVERY_MOST_COMPLETE: {
                if (recoveryRatio <= 0.5) {
                    return {
                        accepted: false,
                        reason: `PARTIAL_RECOVERY_MOST_COMPLETE requires >50% of partitions. ` +
                            `Only ${allRecoveredPartitions.size}/${this._totalPartitions} (${(recoveryRatio * 100).toFixed(1)}%) recovered.`,
                        recoveredPartitions: allRecoveredPartitions,
                        missingPartitions,
                    };
                }
                // Select the member with the most entries recovered as the authoritative source
                const authoritative = this._selectMostComplete(allStates);
                return {
                    accepted: true,
                    reason: `PARTIAL_RECOVERY_MOST_COMPLETE: ${allRecoveredPartitions.size}/${this._totalPartitions} partitions recovered ` +
                        `(${(recoveryRatio * 100).toFixed(1)}%). ` +
                        `Authoritative member: ${authoritative.memberId} (${authoritative.totalEntriesRecovered} entries).`,
                    recoveredPartitions: allRecoveredPartitions,
                    missingPartitions,
                };
            }
        }
    }

    /**
     * Select the member with the highest WAL sequence (most recent data).
     */
    private _selectMostRecent(states: MemberRecoveryState[]): MemberRecoveryState {
        return states.reduce((best, current) =>
            current.latestWalSequence > best.latestWalSequence ? current : best,
        );
    }

    /**
     * Select the member with the most total entries recovered (most complete data).
     */
    private _selectMostComplete(states: MemberRecoveryState[]): MemberRecoveryState {
        return states.reduce((best, current) =>
            current.totalEntriesRecovered > best.totalEntriesRecovered ? current : best,
        );
    }

    /**
     * Build a local MemberRecoveryState from persistence recovery results.
     */
    static buildLocalRecoveryState(
        memberId: string,
        recoveredPartitions: Set<number>,
        latestWalSequence: bigint,
        totalEntriesRecovered: number,
        checkpointTimestamp: number,
    ): MemberRecoveryState {
        return {
            memberId,
            recoveredPartitions,
            latestWalSequence,
            totalEntriesRecovered,
            checkpointTimestamp,
        };
    }
}
