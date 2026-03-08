/**
 * Backup operation for dispose. Removes the task from the backup replica's store.
 *
 * Hazelcast parity: com.hazelcast.scheduledexecutor.impl.operations.DisposeTaskBackupOperation
 */

import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import type { ScheduledExecutorContainerService } from '../ScheduledExecutorContainerService.js';

export class DisposeTaskBackupOperation extends Operation {
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
        store.remove(this._taskName);
    }
}
