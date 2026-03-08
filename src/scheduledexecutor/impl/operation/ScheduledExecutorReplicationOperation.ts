/**
 * Replicates all partition-owned scheduled task metadata to a backup replica.
 *
 * The replication data is a nested map: executorName → taskName → serialized descriptor snapshot.
 * On the backup, each task is enqueued as SUSPENDED (no scheduled future assigned).
 * Tasks that already exist on the replica are skipped to avoid duplication.
 *
 * Hazelcast parity: com.hazelcast.scheduledexecutor.impl.operations.ReplicationOperation
 */

import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import type { ScheduledExecutorContainerService } from '../ScheduledExecutorContainerService.js';
import type { ScheduledExecutorReplicationData } from '../ScheduledExecutorContainerService.js';

export class ScheduledExecutorReplicationOperation extends Operation {
    private readonly _replicationData: ScheduledExecutorReplicationData;
    private readonly _containerService: ScheduledExecutorContainerService;

    constructor(
        replicationData: ScheduledExecutorReplicationData,
        containerService: ScheduledExecutorContainerService,
    ) {
        super();
        this._replicationData = replicationData;
        this._containerService = containerService;
    }

    async run(): Promise<void> {
        for (const [executorName, tasks] of this._replicationData) {
            const store = this._containerService
                .getPartition(this.partitionId)
                .getOrCreateContainer(executorName);

            for (const [taskName, snapshot] of tasks) {
                // Skip tasks that already exist on the replica
                if (store.get(taskName)) {
                    continue;
                }

                this._containerService.enqueueSuspendedFromSnapshot(
                    executorName,
                    snapshot,
                    this.partitionId,
                );
            }
        }
    }
}
