import { ScheduledTaskState } from './ScheduledTaskState.js';
import { ScheduledTaskStore } from './ScheduledTaskStore.js';

/**
 * Per-partition container holding {@link ScheduledTaskStore} instances keyed by executor name.
 *
 * Hazelcast parity: com.hazelcast.scheduledexecutor.impl.ScheduledExecutorPartition
 */
export class ScheduledExecutorPartition {
    readonly partitionId: number;
    private readonly _containers = new Map<string, ScheduledTaskStore>();

    constructor(partitionId: number) {
        this.partitionId = partitionId;
    }

    getOrCreateContainer(executorName: string): ScheduledTaskStore {
        let store = this._containers.get(executorName);
        if (!store) {
            store = new ScheduledTaskStore();
            this._containers.set(executorName, store);
        }
        return store;
    }

    destroyContainer(executorName: string): void {
        this._containers.delete(executorName);
    }

    destroy(): void {
        this._containers.clear();
    }

    /**
     * Suspend all tasks across all containers in this partition.
     * Only suspends tasks that are in a suspendable state (SCHEDULED, RUNNING, DONE, CANCELLED).
     *
     * Hazelcast parity: ScheduledExecutorPartition.suspendTasks()
     */
    suspendTasks(): void {
        for (const store of this._containers.values()) {
            for (const descriptor of store.getAll()) {
                if (descriptor.state !== ScheduledTaskState.SUSPENDED &&
                    descriptor.state !== ScheduledTaskState.DISPOSED &&
                    descriptor.state !== ScheduledTaskState.SUPPRESSED) {
                    descriptor.transitionTo(ScheduledTaskState.SUSPENDED);
                }
            }
        }
    }

    /**
     * Promote all suspended tasks back to SCHEDULED state.
     * Used after migration commit (on new primary) or rollback (on old primary).
     *
     * Hazelcast parity: ScheduledExecutorPartition.promoteSuspended()
     */
    promoteSuspended(): void {
        for (const store of this._containers.values()) {
            for (const descriptor of store.getAll()) {
                if (descriptor.state === ScheduledTaskState.SUSPENDED) {
                    descriptor.transitionTo(ScheduledTaskState.SCHEDULED);
                }
            }
        }
    }

    /**
     * Discard all task state in this partition (used when losing ownership).
     */
    discardAll(): void {
        for (const store of this._containers.values()) {
            const tasks = store.getAll();
            for (const task of tasks) {
                store.remove(task.taskName);
            }
        }
    }

    /**
     * Increment ownerEpoch on all tasks in this partition.
     */
    incrementEpoch(): void {
        for (const store of this._containers.values()) {
            for (const descriptor of store.getAll()) {
                descriptor.ownerEpoch++;
            }
        }
    }
}
