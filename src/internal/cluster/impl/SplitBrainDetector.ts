/**
 * Split-brain detection and merge orchestration.
 *
 * Tracks member reachability and enters read-only mode when the number of
 * reachable members drops below quorum (⌊N/2⌋ + 1). This prevents silent
 * data divergence during network partitions.
 *
 * When quorum is restored (split-brain is healed), the merge handler is
 * invoked to reconcile diverged data. Lifecycle events MERGING → MERGED
 * are emitted around the merge phase.
 */
import type { HeliosLifecycleService } from '@zenystx/helios-core/instance/lifecycle/HeliosLifecycleService';
import { LifecycleState } from '@zenystx/helios-core/instance/lifecycle/LifecycleEvent';
import type { SplitBrainMergeHandler, MergeableMapStore } from './SplitBrainMergeHandler';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';

export interface SplitBrainMergeContext {
    /** The map store from the merging (smaller/rejoining) cluster side. */
    mergingStore: MergeableMapStore;
    /** The surviving cluster's map store (merge target). */
    existingStore: MergeableMapStore;
    /** Resolves a partition ID from a serialized key. */
    partitionResolver: (key: Data) => number;
    /** Returns the configured merge policy name for a given map. */
    policyNameResolver: (mapName: string) => string;
}

export class SplitBrainDetector {
    private _totalMembers: number;
    private _quorumSize: number;
    private readonly _reachableMembers: Set<string> = new Set();
    private _readOnlyMode = false;

    /** The UUID of the local member — always counted as reachable. */
    private readonly _localMemberUuid: string | null;

    /** Optional lifecycle service for emitting MERGING/MERGED events. */
    private _lifecycleService: HeliosLifecycleService | null = null;

    /** Optional merge handler for reconciling data after split-brain heal. */
    private _mergeHandler: SplitBrainMergeHandler | null = null;

    constructor(totalMembers: number, localMemberUuid: string | null = null) {
        this._totalMembers = totalMembers;
        this._quorumSize = Math.floor(totalMembers / 2) + 1;
        this._localMemberUuid = localMemberUuid;
        if (localMemberUuid !== null) {
            this._reachableMembers.add(localMemberUuid);
        }
    }

    setLifecycleService(lifecycleService: HeliosLifecycleService): void {
        this._lifecycleService = lifecycleService;
    }

    setMergeHandler(mergeHandler: SplitBrainMergeHandler): void {
        this._mergeHandler = mergeHandler;
    }

    updateTotalMembers(total: number): void {
        this._totalMembers = total;
        this._quorumSize = Math.floor(total / 2) + 1;
        this._checkQuorum();
    }

    onMemberReachable(memberUuid: string): void {
        this._reachableMembers.add(memberUuid);
        this._checkQuorum();
    }

    onMemberUnreachable(memberUuid: string): void {
        this._reachableMembers.delete(memberUuid);
        this._checkQuorum();
    }

    isReadOnly(): boolean {
        return this._readOnlyMode;
    }

    /** @throws Error if in read-only mode */
    checkNotReadOnly(): void {
        if (this._readOnlyMode) {
            throw new Error(
                'Cluster is in read-only mode: split-brain detected ' +
                `(${this._reachableMembers.size} reachable < ${this._quorumSize} quorum)`,
            );
        }
    }

    /**
     * Heal the split-brain: emit MERGING, run merge, emit MERGED, exit read-only mode.
     *
     * @param context — merge context with stores, resolver functions, and policy resolver.
     *                  If null, the merge phase is skipped (read-only mode is still cleared).
     */
    healSplitBrain(context: SplitBrainMergeContext | null = null): void {
        this._lifecycleService?.fireLifecycleEvent(LifecycleState.MERGING);

        if (context !== null && this._mergeHandler !== null) {
            this._mergeHandler.mergeAll(
                context.policyNameResolver,
                context.mergingStore,
                context.existingStore,
                context.partitionResolver,
            );
        }

        this._readOnlyMode = false;
        this._lifecycleService?.fireLifecycleEvent(LifecycleState.MERGED);
    }

    private _checkQuorum(): void {
        this._readOnlyMode = this._reachableMembers.size < this._quorumSize;
    }
}
