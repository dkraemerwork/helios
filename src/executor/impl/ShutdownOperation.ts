/**
 * Distributed shutdown operation for a named executor.
 *
 * Marks the executor closed on the target member, drains pending work
 * within the configured timeout, then terminates remaining pools and
 * fails outstanding tasks.
 *
 * @see CancellationOperation
 */

import { Operation } from '@helios/spi/impl/operationservice/Operation.js';
import type { ExecutorContainerService } from '@helios/executor/impl/ExecutorContainerService.js';

export class ShutdownOperation extends Operation {
    readonly executorName: string;
    private _containerService: ExecutorContainerService | null = null;

    constructor(executorName: string) {
        super();
        this.executorName = executorName;
        this.serviceName = 'helios:executor';
    }

    setContainerService(container: ExecutorContainerService): void {
        this._containerService = container;
    }

    /**
     * Shut down the executor on the given container.
     * Idempotent — calling on an already-shutdown container is a no-op.
     */
    async shutdownOn(container: ExecutorContainerService): Promise<void> {
        await container.shutdown();
    }

    override async run(): Promise<void> {
        if (this._containerService) {
            await this._containerService.shutdown();
            this.sendResponse(undefined);
            return;
        }
        this.sendResponse(undefined);
    }
}
