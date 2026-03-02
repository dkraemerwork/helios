/**
 * Port of {@code com.hazelcast.internal.partition.impl.MigrationQueue}.
 * Manages migration tasks and migration status flags.
 * In single-threaded Bun runtime, uses a plain array instead of LinkedBlockingQueue.
 */
import type { MigrationRunnable } from '@helios/internal/partition/impl/MigrationRunnable';

export class MigrationQueue {
    private _migrateTaskCount = 0;
    private readonly _queue: MigrationRunnable[] = [];

    add(task: MigrationRunnable): void {
        this._migrateTaskCount++;
        this._queue.push(task);
    }

    poll(): MigrationRunnable | null {
        return this._queue.shift() ?? null;
    }

    clear(): void {
        const drained = this._queue.splice(0, this._queue.length);
        for (const task of drained) {
            this.afterTaskCompletion(task);
        }
    }

    afterTaskCompletion(_task: MigrationRunnable): void {
        this._migrateTaskCount--;
        if (this._migrateTaskCount < 0) {
            throw new Error('IllegalStateException: migration task count went below zero');
        }
    }

    migrationTaskCount(): number {
        return this._migrateTaskCount;
    }

    hasMigrationTasks(): boolean {
        return this._migrateTaskCount > 0;
    }

    toString(): string {
        return `MigrationQueue{migrateTaskCount=${this._migrateTaskCount}, queue.length=${this._queue.length}}`;
    }
}
