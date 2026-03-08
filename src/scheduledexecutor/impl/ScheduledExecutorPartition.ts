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
}
