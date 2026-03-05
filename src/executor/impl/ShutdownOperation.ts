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

    constructor(executorName: string) {
        super();
        this.executorName = executorName;
        this.serviceName = 'helios:executor';
    }

    /**
     * Shut down the executor on the given container.
     * Idempotent — calling on an already-shutdown container is a no-op.
     */
    async shutdownOn(container: ExecutorContainerService): Promise<void> {
        await container.shutdown();
    }

    override async run(): Promise<void> {
        // In distributed mode, the OperationService resolves the container
        // and calls shutdownOn(). For now, sendResponse with void.
        this.sendResponse(undefined);
    }
}
