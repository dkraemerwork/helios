/**
 * Returns a task handler for reacquisition of an IScheduledFuture.
 *
 * Verifies the task still exists and returns a fresh handler pointing to it.
 *
 * Hazelcast parity: handler reacquisition from ScheduledExecutorServiceProxy.getScheduledFuture
 */

import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import { ScheduledTaskHandler } from '@zenystx/helios-core/scheduledexecutor/ScheduledTaskHandler';
import type { ScheduledExecutorContainerService } from '../ScheduledExecutorContainerService.js';
import { validateHandler } from './handlerValidation.js';

export class GetScheduledFutureOperation extends Operation {
    private readonly _handler: ScheduledTaskHandler;
    private readonly _containerService: ScheduledExecutorContainerService;

    constructor(handler: ScheduledTaskHandler, containerService: ScheduledExecutorContainerService) {
        super();
        this._handler = handler;
        this._containerService = containerService;
    }

    async run(): Promise<void> {
        validateHandler(this._handler, this._containerService);

        // Verify the task exists (throws StaleTaskException if disposed)
        const descriptor = this._containerService.getTaskDescriptor(
            this._handler.getSchedulerName(),
            this._handler.getTaskName(),
            this._handler.getPartitionId(),
        );

        // Return a fresh handler for the verified task
        const handler = this._handler.isAssignedToPartition()
            ? ScheduledTaskHandler.ofPartition(
                  this._handler.getSchedulerName(),
                  descriptor.taskName,
                  this._handler.getPartitionId(),
              )
            : ScheduledTaskHandler.ofMember(
                  this._handler.getSchedulerName(),
                  descriptor.taskName,
                  this._handler.getMemberUuid()!,
              );

        this.sendResponse(handler);
    }
}
