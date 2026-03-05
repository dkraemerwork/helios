/**
 * Distributed cancellation operation for executor tasks.
 *
 * Routes to the same container that owns the task and delegates
 * to {@link ExecutorContainerService.cancelTask}.
 *
 * @see ShutdownOperation
 */

import { Operation } from '@helios/spi/impl/operationservice/Operation.js';
import type { ExecutorContainerService } from '@helios/executor/impl/ExecutorContainerService.js';

export class CancellationOperation extends Operation {
    readonly executorName: string;
    readonly taskUuid: string;
    private _containerService: ExecutorContainerService | null = null;

    constructor(executorName: string, taskUuid: string) {
        super();
        this.executorName = executorName;
        this.taskUuid = taskUuid;
        this.serviceName = 'helios:executor';
    }

    setContainerService(container: ExecutorContainerService): void {
        this._containerService = container;
    }

    /**
     * Cancel the task on the given container.
     * Returns true if the task was found and cancelled (queued or running),
     * false if the task was unknown or already completed/failed/timed-out.
     */
    cancelOn(container: ExecutorContainerService): boolean {
        return container.cancelTask(this.taskUuid);
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
            const result = this._containerService.cancelTask(this.taskUuid);
            this.sendResponse(result);
            return;
        }
        this.sendResponse(false);
    }
}
