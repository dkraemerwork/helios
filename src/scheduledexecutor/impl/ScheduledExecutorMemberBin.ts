import { ScheduledTaskStore } from './ScheduledTaskStore.js';

/**
 * Member-local container for member-owned scheduled tasks (partition ID = -1).
 *
 * Hazelcast parity: com.hazelcast.scheduledexecutor.impl.ScheduledExecutorMemberBin
 */
export class ScheduledExecutorMemberBin {
    private readonly _containers = new Map<string, ScheduledTaskStore>();

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
}
