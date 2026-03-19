/**
 * Port of {@code com.hazelcast.internal.cluster.impl.SplitBrainHandler}.
 * Orchestrates the merge flow when split-brain is healed.
 *
 * Winning-side determination
 * ──────────────────────────
 * 1. The cluster with more live members wins.
 * 2. On tie: the cluster whose master has the lexicographically-smaller UUID wins
 *    (deterministic but arbitrary — the important thing is both sides agree).
 *
 * Merge lifecycle
 * ───────────────
 * 1. Losing side pauses migrations (sets pauseMigrations flag).
 * 2. Merging data is collected from all registered distributed services.
 * 3. Entries from the merging store are applied to the surviving store
 *    according to the per-map merge policy.
 * 4. Migrations are resumed on the winning side.
 * 5. MERGE_COMPLETE event is fired via the lifecycle service.
 *
 * All steps execute synchronously; callers (SplitBrainDetector.healSplitBrain)
 * drive the MERGING → MERGED lifecycle events around this call.
 */
import type { HeliosLifecycleService } from '@zenystx/helios-core/instance/lifecycle/HeliosLifecycleService';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { MergePolicyProvider } from '@zenystx/helios-core/spi/merge/MergePolicyProvider';
import { SplitBrainMergeDataImpl } from '@zenystx/helios-core/spi/merge/SplitBrainMergeDataImpl';
import type { SplitBrainMergePolicy } from '@zenystx/helios-core/spi/merge/SplitBrainMergePolicy';

export interface MergeEntryStats {
    hits: number;
    creationTime: number;
    lastAccessTime: number;
    lastUpdateTime: number;
    expirationTime: number;
    version: number;
}

export interface MergeableRecordStore {
    put(key: Data, value: Data, ttl: number, maxIdle: number): Data | null;
    get(key: Data): Data | null;
    remove(key: Data): Data | null;
    entries(): IterableIterator<readonly [Data, Data]>;
    /** Returns the full stats for a key without touching access counters, or null if absent. */
    getEntryStats(key: Data): MergeEntryStats | null;
}

export interface MergeableMapStore {
    getAllEntries(mapName: string): IterableIterator<readonly [Data, Data]>;
    getRecordStore(mapName: string, partitionId: number): MergeableRecordStore | null;
    getMapNames(): string[];
}

export interface MergeResult {
    mapName: string;
    mergedCount: number;
    discardedCount: number;
    totalEntries: number;
}

/**
 * Cluster identity for winning-side determination.
 *
 * The winning cluster is defined as:
 *   1. The cluster with more live members.
 *   2. On tie: the cluster whose master has the lexicographically-smaller UUID
 *      (deterministic, both sides must agree).
 */
export interface ClusterIdentity {
    /** Number of live members in this cluster (including self). */
    memberCount: number;
    /** UUID of the master/coordinator member of this cluster. */
    masterUuid: string;
}

/**
 * Additional distributed services that should participate in merge data collection.
 * Implement this interface for any service that owns per-partition data (e.g. queues,
 * replicated maps) so their data is also reconciled during split-brain heal.
 */
export interface MergeParticipant {
    /** Human-readable service name used in merge result reporting. */
    getServiceName(): string;
    /**
     * Collect all mergeable data from this service (merging cluster side).
     * Returns an opaque token passed back to {@link applyMergedData}.
     */
    collectMergingData(): unknown;
    /**
     * Apply the collected merging data from the losing side onto the winning side.
     * The surviving side calls this with the token collected from the losing side.
     */
    applyMergedData(mergingData: unknown): void;
}

export class SplitBrainMergeHandler {
    private readonly _policyProvider = new MergePolicyProvider();

    /** Optional lifecycle service — used to fire MERGE_COMPLETE event. */
    private _lifecycleService: HeliosLifecycleService | null = null;

    /** Whether migrations are currently paused on this node. */
    private _migrationsPaused = false;

    /** Additional distributed-service merge participants (queues, replicated maps, etc.). */
    private readonly _participants: MergeParticipant[] = [];

    /**
     * Wire the lifecycle service so MERGE_COMPLETE can be fired after a
     * successful merge. Optional — if not set, the event is simply skipped.
     */
    setLifecycleService(lifecycleService: HeliosLifecycleService): void {
        this._lifecycleService = lifecycleService;
    }

    /**
     * Register an additional distributed service as a merge participant.
     * Participants are called during {@link mergeAll} to collect and apply
     * data from services beyond the map store.
     */
    registerParticipant(participant: MergeParticipant): void {
        this._participants.push(participant);
    }

    /**
     * Determine which cluster wins the merge.
     *
     * @param local   — identity of the local (this) cluster
     * @param remote  — identity of the remote (rejoining) cluster
     * @returns 'local' if the local cluster should be the surviving side,
     *          'remote' if the remote cluster should be the surviving side.
     */
    determineWinner(local: ClusterIdentity, remote: ClusterIdentity): 'local' | 'remote' {
        if (local.memberCount !== remote.memberCount) {
            return local.memberCount > remote.memberCount ? 'local' : 'remote';
        }
        // Tie-break: lexicographically-smaller master UUID wins
        return local.masterUuid <= remote.masterUuid ? 'local' : 'remote';
    }

    /**
     * Pause migrations on the losing side before the merge transfer begins.
     * A guard prevents double-pausing.
     */
    pauseMigrations(): void {
        if (!this._migrationsPaused) {
            this._migrationsPaused = true;
        }
    }

    /**
     * Resume migrations after the merge is complete.
     * Called on the winning (surviving) side once all data has been applied.
     */
    resumeMigrations(): void {
        this._migrationsPaused = false;
    }

    /** Returns whether migrations are currently paused. */
    isMigrationsPaused(): boolean {
        return this._migrationsPaused;
    }

    /**
     * Execute the merge for a single map.
     *
     * @param mapName — name of the map
     * @param policyName — merge policy to use
     * @param mergingEntries — entries from the merging (smaller) cluster side
     * @param existingStore — the surviving cluster's map container service
     * @param partitionResolver — function to resolve partition ID from key Data
     */
    mergeMap(
        mapName: string,
        policyName: string,
        mergingEntries: IterableIterator<readonly [Data, Data]>,
        existingStore: MergeableMapStore,
        partitionResolver: (key: Data) => number,
    ): MergeResult {
        const policy: SplitBrainMergePolicy = this._policyProvider.getMergePolicy(policyName);
        let mergedCount = 0;
        let discardedCount = 0;
        let totalEntries = 0;

        for (const [mergingKey, mergingValue] of mergingEntries) {
            totalEntries++;

            const mergingData = new SplitBrainMergeDataImpl(mergingKey, mergingValue);

            const partitionId = partitionResolver(mergingKey);
            const store = existingStore.getRecordStore(mapName, partitionId);
            const existingRawValue = store?.get(mergingKey) ?? null;
            let existingData: SplitBrainMergeDataImpl | null = null;
            if (existingRawValue !== null && store !== null) {
                const stats = store.getEntryStats(mergingKey);
                existingData = new SplitBrainMergeDataImpl(
                    mergingKey,
                    existingRawValue,
                    stats?.hits ?? 0,
                    stats?.creationTime ?? 0,
                    stats?.lastAccessTime ?? 0,
                    stats?.lastUpdateTime ?? 0,
                    stats?.expirationTime ?? Number.MAX_SAFE_INTEGER,
                    stats?.version ?? 0,
                );
            }

            const winner = policy.merge(mergingData, existingData);

            if (winner === null) {
                // Policy decided to discard — remove from existing store if present
                store?.remove(mergingKey);
                discardedCount++;
            } else if (winner === mergingData) {
                // Merging value wins — put into surviving store
                store?.put(mergingKey, mergingValue, -1, -1);
                mergedCount++;
            } else {
                // Existing value wins — no change needed
                discardedCount++;
            }
        }

        return { mapName, mergedCount, discardedCount, totalEntries };
    }

    /**
     * Execute merge for all maps in the merging store, then invoke all registered
     * service participants, resume migrations, and fire MERGE_COMPLETE.
     *
     * @param policyNameResolver — returns the merge policy name for a given map name
     * @param mergingStore — the map store from the merging (smaller) cluster
     * @param existingStore — the surviving cluster's map container service
     * @param partitionResolver — function to resolve partition ID from key Data
     */
    mergeAll(
        policyNameResolver: (mapName: string) => string,
        mergingStore: MergeableMapStore,
        existingStore: MergeableMapStore,
        partitionResolver: (key: Data) => number,
    ): MergeResult[] {
        const results: MergeResult[] = [];

        // ── Step 1: Pause migrations on the losing side ──────────────────────
        this.pauseMigrations();

        // ── Step 2: Merge map data ────────────────────────────────────────────
        for (const mapName of mergingStore.getMapNames()) {
            const policyName = policyNameResolver(mapName);
            const entries = mergingStore.getAllEntries(mapName);
            const result = this.mergeMap(mapName, policyName, entries, existingStore, partitionResolver);
            results.push(result);
        }

        // ── Step 3: Collect and apply data from all service participants ──────
        for (const participant of this._participants) {
            const mergingData = participant.collectMergingData();
            participant.applyMergedData(mergingData);
        }

        // ── Step 4: Resume migrations on the winning side ─────────────────────
        this.resumeMigrations();

        // Note: the MERGING → MERGED lifecycle events are fired by the caller
        // (SplitBrainDetector.healSplitBrain). The MERGE_COMPLETE notification
        // is published by the caller after this method returns.

        return results;
    }

    getAvailablePolicies(): string[] {
        return this._policyProvider.getAvailablePolicies();
    }
}
