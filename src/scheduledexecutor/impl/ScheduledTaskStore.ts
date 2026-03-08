import { randomUUID } from 'crypto';
import { ScheduledTaskDescriptor } from './ScheduledTaskDescriptor.js';

/**
 * Partition-local in-memory store for scheduled task descriptors.
 *
 * Enforces named-task duplicate rejection and generates stable UUIDs for unnamed tasks.
 *
 * Hazelcast parity: storage logic from ScheduledExecutorContainer
 */
export class ScheduledTaskStore {
    private readonly _tasks = new Map<string, ScheduledTaskDescriptor>();

    /**
     * Schedule a task descriptor in the store.
     *
     * Named tasks enforce fail-if-exists: if a task with the same name already exists,
     * an error is thrown. Unnamed tasks (empty taskName) get a stable UUID assigned.
     */
    schedule(descriptor: ScheduledTaskDescriptor): void {
        if (!descriptor.taskName || descriptor.taskName.length === 0) {
            descriptor.taskName = randomUUID();
        } else if (this._tasks.has(descriptor.taskName)) {
            throw new Error(
                `Duplicate task: a task named '${descriptor.taskName}' already exists in executor '${descriptor.executorName}'`,
            );
        }
        this._tasks.set(descriptor.taskName, descriptor);
    }

    /**
     * Get a task descriptor by name, or undefined if not found.
     */
    get(taskName: string): ScheduledTaskDescriptor | undefined {
        return this._tasks.get(taskName);
    }

    /**
     * Get a task descriptor by handler ID.
     */
    getByHandler(handlerId: string): ScheduledTaskDescriptor | undefined {
        for (const desc of this._tasks.values()) {
            if (desc.handlerId === handlerId) {
                return desc;
            }
        }
        return undefined;
    }

    /**
     * Remove a task descriptor by name. Returns true if removed.
     */
    remove(taskName: string): boolean {
        return this._tasks.delete(taskName);
    }

    /**
     * Get all task descriptors.
     */
    getAll(): ScheduledTaskDescriptor[] {
        return [...this._tasks.values()];
    }

    /**
     * Get the number of stored tasks.
     */
    size(): number {
        return this._tasks.size;
    }
}
