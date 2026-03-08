/**
 * Backup operation for schedule/create. Enqueues the task as SUSPENDED on the backup replica.
 *
 * Hazelcast parity: com.hazelcast.scheduledexecutor.impl.operations.ScheduleTaskBackupOperation
 */

import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import type { ScheduledExecutorContainerService } from '../ScheduledExecutorContainerService.js';
import type { TaskDefinition } from '../TaskDefinition.js';

export class ScheduleTaskBackupOperation extends Operation {
    private readonly _executorName: string;
    private readonly _definition: TaskDefinition;
    private readonly _containerService: ScheduledExecutorContainerService;

    constructor(
        executorName: string,
        definition: TaskDefinition,
        containerService: ScheduledExecutorContainerService,
    ) {
        super();
        this._executorName = executorName;
        this._definition = definition;
        this._containerService = containerService;
    }

    async run(): Promise<void> {
        this._containerService.enqueueSuspended(
            this._executorName,
            this._definition,
            this.partitionId,
        );
    }
}
