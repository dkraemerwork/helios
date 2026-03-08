/**
 * Locates a task by handler and executes the dispose lifecycle.
 *
 * Hazelcast parity: com.hazelcast.scheduledexecutor.impl.operations.DisposeTaskOperation
 */

import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import type { ScheduledTaskHandler } from '@zenystx/helios-core/scheduledexecutor/ScheduledTaskHandler';
import type { ScheduledExecutorContainerService } from '../ScheduledExecutorContainerService.js';
import { validateHandler } from './handlerValidation.js';

export class DisposeTaskOperation extends Operation {
    private readonly _handler: ScheduledTaskHandler;
    private readonly _containerService: ScheduledExecutorContainerService;

    constructor(handler: ScheduledTaskHandler, containerService: ScheduledExecutorContainerService) {
        super();
        this._handler = handler;
        this._containerService = containerService;
    }

    async run(): Promise<void> {
        validateHandler(this._handler, this._containerService);

        this._containerService.disposeTask(
            this._handler.getSchedulerName(),
            this._handler.getTaskName(),
            this._handler.getPartitionId(),
        );

        this.sendResponse(undefined);
    }
}
