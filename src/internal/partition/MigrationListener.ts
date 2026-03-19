/**
 * Port of {@code com.hazelcast.internal.partition.MigrationListener}.
 *
 * Listener interface for partition migration lifecycle events.
 * Implementations are notified when a partition migration starts,
 * completes successfully, or fails.
 *
 * Register via {@link InternalPartitionServiceImpl.addMigrationListener}.
 */

import type { MemberInfo } from '@zenystx/helios-core/cluster/MemberInfo.js';

// ── MigrationEvent ────────────────────────────────────────────────────────────

/** Status of a partition migration. */
export type MigrationStatus = 'STARTED' | 'COMPLETED' | 'FAILED';

/**
 * Describes a single partition migration — the partition being moved,
 * the source and destination members, and the outcome.
 *
 * Port of {@code com.hazelcast.internal.partition.MigrationEvent}.
 */
export interface MigrationEvent {
    /** The partition being migrated. */
    readonly partitionId: number;
    /** The member that previously owned (or currently owns) the partition. */
    readonly oldOwner: MemberInfo | null;
    /** The member that is receiving (or has received) the partition. */
    readonly newOwner: MemberInfo | null;
    /** Sequential index of this migration within the current migration round. */
    readonly migrationIndex: number;
    /** Current status of the migration. */
    readonly status: MigrationStatus;
}

// ── MigrationListener ─────────────────────────────────────────────────────────

/**
 * Callback interface for partition migration lifecycle events.
 *
 * All three methods are required — use no-op stubs if only some events
 * are of interest:
 *
 * ```typescript
 * const listener: MigrationListener = {
 *   migrationStarted:   (e) => { ... },
 *   migrationCompleted: (e) => { ... },
 *   migrationFailed:    (e) => { ... },
 * };
 * ```
 *
 * Port of {@code com.hazelcast.partition.MigrationListener}.
 */
export interface MigrationListener {
    /**
     * Fired when a partition migration begins.
     * The partition is temporarily unavailable for writes during migration.
     */
    migrationStarted(event: MigrationEvent): void;

    /**
     * Fired when a partition migration completes successfully.
     * The new owner is now authoritative.
     */
    migrationCompleted(event: MigrationEvent): void;

    /**
     * Fired when a partition migration fails.
     * The partition remains on its previous owner.
     */
    migrationFailed(event: MigrationEvent): void;
}
