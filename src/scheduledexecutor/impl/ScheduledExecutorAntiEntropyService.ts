import type { ScheduledTaskSnapshot } from './ScheduledExecutorContainerService.js';

/**
 * A tombstone record for a disposed task, preventing resurrection on replicas.
 */
export interface TombstoneRecord {
    readonly executorName: string;
    readonly taskName: string;
    readonly disposedAtEpoch: number;
    readonly disposedAtVersion: number;
}

/**
 * The result of comparing primary state with replica state.
 */
export interface AntiEntropyDiff {
    /** Snapshots that should be pushed to the replica (missing or stale). */
    readonly pushToReplica: ScheduledTaskSnapshot[];
    /** Tombstones for disposed tasks that the replica still holds. */
    readonly tombstonesToPush: TombstoneRecord[];
    /** Tasks present on the replica but not on the primary (orphans to remove). */
    readonly removeFromReplica: Array<{ executorName: string; taskName: string }>;
}

/**
 * Configuration for the anti-entropy service.
 */
export interface AntiEntropyConfig {
    /** Interval in milliseconds between periodic repair cycles. */
    readonly intervalMs: number;
    /** Callback invoked on each repair cycle (periodic or event-triggered). */
    readonly onRepairCycle?: () => void;
}

type OwnershipEventKind = 'migration-commit' | 'promotion' | 'member-departure';

/**
 * Resolve a conflict between two snapshots of the same task.
 *
 * Resolution order (locked design decision #9):
 * 1. Highest ownerEpoch wins.
 * 2. Within the same epoch, highest version wins.
 * 3. Ties favor the local snapshot (no-op).
 */
export function resolveConflict(
    local: ScheduledTaskSnapshot,
    remote: ScheduledTaskSnapshot,
): 'local' | 'remote' {
    if (remote.ownerEpoch > local.ownerEpoch) return 'remote';
    if (remote.ownerEpoch < local.ownerEpoch) return 'local';
    // Same epoch — compare version
    if (remote.version > local.version) return 'remote';
    return 'local';
}

/**
 * Anti-entropy service for scheduled executor metadata.
 *
 * Runs both periodically (on a configurable interval) and on ownership events
 * (migration commit, promotion, member departure). Compares primary state with
 * replica state and computes a diff of repairs needed.
 *
 * The primary is authoritative: stale or missing records on replicas are pushed
 * from primary, and orphan records on replicas (not on primary, not tombstoned)
 * are marked for removal.
 *
 * Hazelcast parity note: Hazelcast uses event-driven SyncStateOperation after
 * each task run + full ReplicationOperation during migration. Helios adds an
 * explicit periodic anti-entropy sweep as an additional consistency guarantee
 * (locked design decision #8).
 */
export class ScheduledExecutorAntiEntropyService {
    private readonly _intervalMs: number;
    private readonly _onRepairCycle: (() => void) | undefined;
    private _timerHandle: ReturnType<typeof setInterval> | null = null;
    private readonly _tombstones: TombstoneRecord[] = [];

    constructor(config: AntiEntropyConfig) {
        this._intervalMs = config.intervalMs;
        this._onRepairCycle = config.onRepairCycle;
    }

    /**
     * Start the periodic anti-entropy timer.
     */
    start(): void {
        if (this._timerHandle) return;
        this._timerHandle = setInterval(() => {
            this._onRepairCycle?.();
        }, this._intervalMs);
    }

    /**
     * Stop the periodic anti-entropy timer.
     */
    stop(): void {
        if (this._timerHandle) {
            clearInterval(this._timerHandle);
            this._timerHandle = null;
        }
    }

    /**
     * Trigger a repair cycle in response to an ownership event.
     */
    onOwnershipEvent(_kind: OwnershipEventKind, _partitionId: number): void {
        this._onRepairCycle?.();
    }

    /**
     * Record a tombstone when a task is disposed.
     */
    recordTombstone(executorName: string, taskName: string, disposedAtEpoch: number, disposedAtVersion: number): void {
        this._tombstones.push({ executorName, taskName, disposedAtEpoch, disposedAtVersion });
    }

    /**
     * Get all recorded tombstones.
     */
    getTombstones(): ReadonlyArray<TombstoneRecord> {
        return [...this._tombstones];
    }

    /**
     * Compute the diff between primary and replica replication data.
     *
     * The primary is authoritative. This method determines:
     * - Tasks missing or stale on the replica that need to be pushed from primary
     * - Tombstones for disposed tasks that the replica still holds
     * - Orphan tasks on the replica that the primary no longer has
     */
    computeDiff(
        primaryData: Map<string, Map<string, ScheduledTaskSnapshot>>,
        replicaData: Map<string, Map<string, ScheduledTaskSnapshot>>,
        tombstones: TombstoneRecord[],
    ): AntiEntropyDiff {
        const pushToReplica: ScheduledTaskSnapshot[] = [];
        const tombstonesToPush: TombstoneRecord[] = [];
        const removeFromReplica: Array<{ executorName: string; taskName: string }> = [];

        // Build a tombstone lookup for quick access
        const tombstoneMap = new Map<string, TombstoneRecord>();
        for (const t of tombstones) {
            tombstoneMap.set(`${t.executorName}:${t.taskName}`, t);
        }

        // Collect all executor names from both sides
        const allExecutorNames = new Set([...primaryData.keys(), ...replicaData.keys()]);

        for (const executorName of allExecutorNames) {
            const primaryTasks = primaryData.get(executorName) ?? new Map<string, ScheduledTaskSnapshot>();
            const replicaTasks = replicaData.get(executorName) ?? new Map<string, ScheduledTaskSnapshot>();

            // Check primary tasks against replica
            for (const [taskName, primarySnapshot] of primaryTasks) {
                const replicaSnapshot = replicaTasks.get(taskName);
                if (!replicaSnapshot) {
                    // Missing on replica — push
                    pushToReplica.push(primarySnapshot);
                } else {
                    // Both have it — resolve conflict
                    const winner = resolveConflict(replicaSnapshot, primarySnapshot);
                    if (winner === 'remote') {
                        // Primary is newer — push to replica
                        pushToReplica.push(primarySnapshot);
                    }
                }
            }

            // Check replica tasks not on primary
            for (const [taskName, _replicaSnapshot] of replicaTasks) {
                if (!primaryTasks.has(taskName)) {
                    const tombstoneKey = `${executorName}:${taskName}`;
                    const tombstone = tombstoneMap.get(tombstoneKey);
                    if (tombstone) {
                        // Disposed task — push tombstone to replica
                        tombstonesToPush.push(tombstone);
                    } else {
                        // Orphan: primary doesn't have it and no tombstone
                        // Primary is authoritative — remove from replica
                        removeFromReplica.push({ executorName, taskName });
                    }
                }
            }
        }

        return { pushToReplica, tombstonesToPush, removeFromReplica };
    }
}
