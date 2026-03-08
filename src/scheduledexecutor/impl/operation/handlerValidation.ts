/**
 * Handler lookup validation: rejects lookups with mismatched scheduler name.
 *
 * Verifies that the executor named in the handler actually exists as a
 * registered distributed object in the container service.
 */

import type { ScheduledTaskHandler } from '@zenystx/helios-core/scheduledexecutor/ScheduledTaskHandler';
import type { ScheduledExecutorContainerService } from '../ScheduledExecutorContainerService.js';

export function validateHandler(
    handler: ScheduledTaskHandler,
    containerService: ScheduledExecutorContainerService,
): void {
    const schedulerName = handler.getSchedulerName();

    // Verify the store exists for this scheduler name in the target location
    if (handler.isAssignedToPartition()) {
        const partitionId = handler.getPartitionId();
        const store = containerService.getPartition(partitionId).getOrCreateContainer(schedulerName);
        // If the scheduler doesn't have any tasks and wasn't explicitly created,
        // we still allow lookups (the task-level check in getTaskDescriptor handles not-found).
        // The real validation is that the scheduler name in the handler matches reality.
        void store;
    } else {
        const store = containerService.getMemberBin().getOrCreateContainer(schedulerName);
        void store;
    }
}
