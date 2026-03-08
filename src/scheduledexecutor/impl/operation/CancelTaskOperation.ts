/**
 * Locates a task by handler and executes the cancel lifecycle.
 *
 * Hazelcast parity: com.hazelcast.scheduledexecutor.impl.operations.CancelTaskOperation
 */

import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import type { ScheduledTaskHandler } from '@zenystx/helios-core/scheduledexecutor/ScheduledTaskHandler';
import type { ScheduledExecutorContainerService } from '../ScheduledExecutorContainerService.js';
import { validateHandler } from './handlerValidation.js';

export class CancelTaskOperation extends Operation {
    private readonly _handler: ScheduledTaskHandler;
    private readonly _containerService: ScheduledExecutorContainerService;

    constructor(handler: ScheduledTaskHandler, containerService: ScheduledExecutorContainerService) {
        super();
        this._handler = handler;
        this._containerService = containerService;
    }

    async run(): Promise<void> {
        validateHandler(this._handler, this._containerService);

        const result = this._containerService.cancelTask(
            this._handler.getSchedulerName(),
            this._handler.getTaskName(),
            this._handler.getPartitionId(),
        );

        this.sendResponse(result);
    }
}
