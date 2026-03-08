/**
 * Creates a scheduled task descriptor in the target partition's store.
 * Implements BackupAwareOperation: create success is visible only after
 * required backup acknowledgements (controlled by durability config).
 *
 * Hazelcast parity: com.hazelcast.scheduledexecutor.impl.operations.ScheduleTaskOperation
 * (partition-targeted variant)
 */

import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import { ScheduledTaskHandler } from '@zenystx/helios-core/scheduledexecutor/ScheduledTaskHandler';
import type { BackupAwareOperation } from '@zenystx/helios-core/spi/impl/operationservice/BackupAwareOperation';
import { ScheduleTaskBackupOperation } from './ScheduleTaskBackupOperation.js';
import type { ScheduledExecutorContainerService } from '../ScheduledExecutorContainerService.js';
import type { TaskDefinition } from '../TaskDefinition.js';

export class SubmitToPartitionOperation extends Operation implements BackupAwareOperation {
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

    private _getDurability(): number {
        const config = this._containerService.getConfigs().get(this._executorName);
        return config?.getDurability() ?? 1;
    }

    shouldBackup(): boolean {
        return this.partitionId >= 0 && this._getDurability() > 0;
    }

    getSyncBackupCount(): number {
        return this._getDurability();
    }

    getAsyncBackupCount(): number {
        return 0;
    }

    getBackupOperation(): Operation {
        return new ScheduleTaskBackupOperation(
            this._executorName,
            this._definition,
            this._containerService,
        );
    }
}
