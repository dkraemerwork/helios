/**
 * Returns the current task state for a handler.
 *
 * Hazelcast parity: combined from IsDoneOperation/IsCanceledOperation/GetStatisticsOperation
 */

import type { ScheduledTaskHandler } from '@zenystx/helios-core/scheduledexecutor/ScheduledTaskHandler';
import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import type { ScheduledExecutorContainerService } from '../ScheduledExecutorContainerService.js';
import { validateHandler } from './handlerValidation.js';

export class GetTaskStateOperation extends Operation {
    private readonly _handler: ScheduledTaskHandler;
    private readonly _containerService: ScheduledExecutorContainerService;

    constructor(handler: ScheduledTaskHandler, containerService: ScheduledExecutorContainerService) {
        super();
        this._handler = handler;
        this._containerService = containerService;
    }

    async run(): Promise<void> {
        validateHandler(this._handler, this._containerService);

        const descriptor = this._containerService.getTaskDescriptor(
            this._handler.getSchedulerName(),
            this._handler.getTaskName(),
            this._handler.getPartitionId(),
        );

        this.sendResponse(descriptor.state);
    }
}
