/**
 * Port of com.hazelcast.internal.partition.impl.MigrationQueueTest
 */
import { describe, it, expect } from 'bun:test';
import { MigrationQueue } from '@helios/internal/partition/impl/MigrationQueue';
import type { MigrationRunnable } from '@helios/internal/partition/impl/MigrationRunnable';

function mockRunnable(): MigrationRunnable {
    return { run: () => {} };
}

describe('MigrationQueueTest', () => {
    it('test_migrationTaskCount_incremented', () => {
        const migrationQueue = new MigrationQueue();
        migrationQueue.add(mockRunnable());
        expect(migrationQueue.migrationTaskCount()).toBe(1);
    });

    it('test_migrationTaskCount_notDecremented_afterMigrateTaskPolled', () => {
        const migrationQueue = new MigrationQueue();
        migrationQueue.add(mockRunnable());
        migrationQueue.poll();
        expect(migrationQueue.hasMigrationTasks()).toBe(true);
    });

    it('test_migrateTaskCount_decremented_afterTaskCompleted', () => {
        const migrationQueue = new MigrationQueue();
        const task = mockRunnable();
        migrationQueue.add(task);
        migrationQueue.afterTaskCompletion(task);
        expect(migrationQueue.hasMigrationTasks()).toBe(false);
    });

    it('test_migrateTaskCount_decremented_onClear', () => {
        const migrationQueue = new MigrationQueue();
        migrationQueue.add(mockRunnable());
        migrationQueue.clear();
        expect(migrationQueue.hasMigrationTasks()).toBe(false);
    });

    it('test_migrateTaskCount_notDecremented_belowZero', () => {
        const migrationQueue = new MigrationQueue();
        expect(() => migrationQueue.afterTaskCompletion(mockRunnable())).toThrow(Error);
    });
});
