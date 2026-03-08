/**
 * Locates a task by handler and executes the cancel lifecycle.
 * Implements BackupAwareOperation to replicate cancel to backup replicas.
 *
 * Hazelcast parity: com.hazelcast.scheduledexecutor.impl.operations.CancelTaskOperation
 */

import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import type { ScheduledTaskHandler } from '@zenystx/helios-core/scheduledexecutor/ScheduledTaskHandler';
import type { BackupAwareOperation } from '@zenystx/helios-core/spi/impl/operationservice/BackupAwareOperation';
import { CancelTaskBackupOperation } from './CancelTaskBackupOperation.js';
import type { ScheduledExecutorContainerService } from '../ScheduledExecutorContainerService.js';
import { validateHandler } from './handlerValidation.js';

export class CancelTaskOperation extends Operation implements BackupAwareOperation {
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

    private _getDurability(): number {
        const config = this._containerService.getConfigs().get(this._handler.getSchedulerName());
        return config?.getDurability() ?? 1;
    }

    shouldBackup(): boolean {
        return this._handler.getPartitionId() >= 0 && this._getDurability() > 0;
    }

    getSyncBackupCount(): number {
        return this._getDurability();
    }

    getAsyncBackupCount(): number {
        return 0;
    }

    getBackupOperation(): Operation {
        return new CancelTaskBackupOperation(
            this._handler.getSchedulerName(),
            this._handler.getTaskName(),
            this._containerService,
        );
    }
}
