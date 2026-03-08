/**
 * Creates a scheduled task descriptor in the target partition's store.
 *
 * Hazelcast parity: com.hazelcast.scheduledexecutor.impl.operations.ScheduleTaskOperation
 * (partition-targeted variant)
 */

import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import { ScheduledTaskHandler } from '@zenystx/helios-core/scheduledexecutor/ScheduledTaskHandler';
import type { ScheduledExecutorContainerService } from '../ScheduledExecutorContainerService.js';
import type { TaskDefinition } from '../TaskDefinition.js';

export class SubmitToPartitionOperation extends Operation {
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
        const descriptor = this._containerService.scheduleOnPartition(
            this._executorName,
            this._definition,
            this.partitionId,
        );

        const handler = ScheduledTaskHandler.ofPartition(
            this._executorName,
            descriptor.taskName,
            this.partitionId,
        );

        this.sendResponse(handler);
    }
}
