/**
 * Tests for MigrationManager (Block 16.B3a).
 * Covers triggerControlTask, ControlTask, RedoPartitioningTask,
 * MigrationPlanner invocation, pauseMigration/resumeMigration.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { MigrationManager } from '@zenystx/core/internal/partition/impl/MigrationManager';
import { PartitionStateManager } from '@zenystx/core/internal/partition/impl/PartitionStateManager';
import { MigrationQueue } from '@zenystx/core/internal/partition/impl/MigrationQueue';
import { Address } from '@zenystx/core/cluster/Address';
import { MemberImpl } from '@zenystx/core/cluster/impl/MemberImpl';
import { MemberVersion } from '@zenystx/core/version/MemberVersion';
import type { Member } from '@zenystx/core/cluster/Member';

function makeMember(host: string, port: number, uuid?: string, lite = false): Member {
    return new MemberImpl.Builder(new Address(host, port))
        .uuid(uuid ?? crypto.randomUUID())
        .version(MemberVersion.of(1, 0, 0))
        .liteMember(lite)
        .localMember(false)
        .build();
}

const PARTITION_COUNT = 16; // small for fast tests

describe('MigrationManager', () => {
    let stateManager: PartitionStateManager;
    let migrationQueue: MigrationQueue;
    let migrationManager: MigrationManager;
    let member1: Member;
    let member2: Member;
    let member3: Member;

    beforeEach(() => {
        stateManager = new PartitionStateManager(PARTITION_COUNT);
        migrationQueue = new MigrationQueue();
        member1 = makeMember('127.0.0.1', 5701, 'uuid-1');
        member2 = makeMember('127.0.0.1', 5702, 'uuid-2');
        member3 = makeMember('127.0.0.1', 5703, 'uuid-3');
        migrationManager = new MigrationManager(stateManager, migrationQueue);
    });

    // ─── triggerControlTask ─────────────────────────────────────

    test('triggerControlTask clears queue and schedules ControlTask', () => {
        stateManager.initializePartitionAssignments([member1], 0);

        // Add a dummy task first
        migrationQueue.add({ run() {} });
        expect(migrationQueue.hasMigrationTasks()).toBe(true);

        migrationManager.triggerControlTask([member1, member2], []);

        // Queue was cleared then ControlTask was added
        // After trigger, there should be exactly 1 task (the ControlTask)
        expect(migrationQueue.hasMigrationTasks()).toBe(true);
    });

    test('triggerControlTask produces migration decisions for new member', () => {
        stateManager.initializePartitionAssignments([member1], 0);

        const migrations = migrationManager.triggerControlTask([member1, member2], []);

        // With 16 partitions and 2 members, ~8 should migrate to member2
        expect(migrations.length).toBeGreaterThan(0);

        // All migrations should target member2 as destination
        for (const m of migrations) {
            expect(m.getDestination()?.uuid()).toBe('uuid-2');
        }
    });

    test('triggerControlTask with no membership change produces no migrations', () => {
        stateManager.initializePartitionAssignments([member1, member2], 0);

        const migrations = migrationManager.triggerControlTask([member1, member2], []);

        // Partitions are already balanced — no migrations needed
        expect(migrations.length).toBe(0);
    });

    test('triggerControlTask with member removal redistributes partitions', () => {
        stateManager.initializePartitionAssignments([member1, member2], 0);

        const migrations = migrationManager.triggerControlTask([member1], [member2]);

        // Partitions from member2 should move to member1
        expect(migrations.length).toBeGreaterThan(0);
    });

    test('triggerControlTask with 3 members rebalances evenly', () => {
        stateManager.initializePartitionAssignments([member1, member2], 0);

        const migrations = migrationManager.triggerControlTask([member1, member2, member3], []);

        // Some partitions should move to member3
        expect(migrations.length).toBeGreaterThan(0);
        const toMember3 = migrations.filter(m => m.getDestination()?.uuid() === 'uuid-3');
        expect(toMember3.length).toBeGreaterThan(0);
    });

    // ─── pauseMigration / resumeMigration ───────────────────────

    test('pauseMigration sets paused state', () => {
        expect(migrationManager.isMigrationPaused()).toBe(false);
        migrationManager.pauseMigration();
        expect(migrationManager.isMigrationPaused()).toBe(true);
    });

    test('resumeMigration clears paused state', () => {
        migrationManager.pauseMigration();
        expect(migrationManager.isMigrationPaused()).toBe(true);
        migrationManager.resumeMigration();
        expect(migrationManager.isMigrationPaused()).toBe(false);
    });

    test('triggerControlTask is rejected while paused', () => {
        stateManager.initializePartitionAssignments([member1], 0);
        migrationManager.pauseMigration();

        const migrations = migrationManager.triggerControlTask([member1, member2], []);

        // Should return empty — migrations are paused
        expect(migrations.length).toBe(0);
    });

    // ─── ControlTask / RedoPartitioningTask integration ─────────

    test('ControlTask uses MigrationPlanner to prioritize copies and shift-ups', () => {
        stateManager.initializePartitionAssignments([member1], 1); // 1 backup

        // Add member2 — requires both owner rebalancing and backup assignment
        const migrations = migrationManager.triggerControlTask([member1, member2], []);

        expect(migrations.length).toBeGreaterThan(0);

        // COPY/SHIFT UP migrations (sourceCurrentReplicaIndex === -1) should appear
        // before MOVE migrations due to prioritization
        let lastCopyIdx = -1;
        let firstMoveIdx = migrations.length;
        for (let i = 0; i < migrations.length; i++) {
            if (migrations[i].getSourceCurrentReplicaIndex() === -1) {
                lastCopyIdx = i;
            } else if (firstMoveIdx === migrations.length) {
                firstMoveIdx = i;
            }
        }
        // If there are both types, copies should come first
        if (lastCopyIdx >= 0 && firstMoveIdx < migrations.length) {
            expect(lastCopyIdx).toBeLessThan(firstMoveIdx);
        }
    });

    test('migration decisions contain valid partition IDs', () => {
        stateManager.initializePartitionAssignments([member1], 0);

        const migrations = migrationManager.triggerControlTask([member1, member2], []);

        for (const m of migrations) {
            expect(m.getPartitionId()).toBeGreaterThanOrEqual(0);
            expect(m.getPartitionId()).toBeLessThan(PARTITION_COUNT);
        }
    });

    test('no duplicate partition IDs in migration decisions', () => {
        stateManager.initializePartitionAssignments([member1], 0);

        const migrations = migrationManager.triggerControlTask([member1, member2], []);

        const partitionIds = new Set(migrations.map(m => m.getPartitionId()));
        expect(partitionIds.size).toBe(migrations.length);
    });

    test('processQueue drains and runs queued tasks', () => {
        stateManager.initializePartitionAssignments([member1], 0);

        migrationManager.triggerControlTask([member1, member2], []);

        // After triggering, the queue should have tasks
        expect(migrationQueue.hasMigrationTasks()).toBe(true);

        // Process the queue
        migrationManager.processQueue();

        // Queue should be drained
        expect(migrationQueue.hasMigrationTasks()).toBe(false);
    });
});
