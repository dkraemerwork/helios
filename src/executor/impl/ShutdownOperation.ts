/**
 * Distributed shutdown operation for a named executor.
 *
 * Marks the executor closed on the target member, drains pending work
 * within the configured timeout, then terminates remaining pools and
 * fails outstanding tasks.
 *
 * @see CancellationOperation
 */

import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation.js';
import type { ExecutorContainerService } from '@zenystx/helios-core/executor/impl/ExecutorContainerService.js';

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
        // Auto-resolve container from NodeEngine service registry if not set
        if (!this._containerService) {
            const ne = this.getNodeEngine();
            if (ne) {
                const key = `helios:executor:container:${this.executorName}`;
                const container = ne.getServiceOrNull<ExecutorContainerService>(key);
                if (container) this._containerService = container;
            }
        }

        if (this._containerService) {
            await this._containerService.shutdown();
            this.sendResponse(undefined);
            return;
        }
        this.sendResponse(undefined);
    }
}
