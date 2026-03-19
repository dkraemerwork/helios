/**
 * Backup operation for cancel. Transitions the task to CANCELLED on the backup replica.
 *
 * Hazelcast parity: com.hazelcast.scheduledexecutor.impl.operations.CancelTaskBackupOperation
 */

import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import type { ScheduledExecutorContainerService } from '../ScheduledExecutorContainerService.js';
import { ScheduledTaskState } from '../ScheduledTaskState.js';

export class CancelTaskBackupOperation extends Operation {
    private readonly _executorName: string;
    private readonly _taskName: string;
    private readonly _containerService: ScheduledExecutorContainerService;

    constructor(
        executorName: string,
        taskName: string,
        containerService: ScheduledExecutorContainerService,
    ) {
        super();
        this._executorName = executorName;
        this._taskName = taskName;
        this._containerService = containerService;
    }

    async run(): Promise<void> {
        const store = this._containerService.getPartition(this.partitionId).getOrCreateContainer(this._executorName);
        const descriptor = store.get(this._taskName);
        if (descriptor) {
            try {
                descriptor.version++;
                descriptor.transitionTo(ScheduledTaskState.CANCELLED);
            } catch {
                // Task may already be in terminal state on backup; safe to ignore
            }
        }
    }
}
