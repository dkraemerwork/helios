/**
 * Port of {@code com.hazelcast.spi.impl.operationservice.impl.OperationServiceImpl},
 * simplified to in-process single-node dispatch.
 *
 * All operations run locally in the same Bun event loop, eliminating the need for
 * Java's InvocationRegistry, BackpressureRegulator, and InvocationMonitor.
 */
import type { NodeEngine } from '@helios/spi/NodeEngine';
import type { OperationService } from '@helios/spi/impl/operationservice/OperationService';
import type { Address } from '@helios/cluster/Address';
import { Operation } from '@helios/spi/impl/operationservice/Operation';
import { InvocationFuture } from '@helios/spi/impl/operationservice/InvocationFuture';

export class OperationServiceImpl implements OperationService {
    private readonly _nodeEngine: NodeEngine;
    private _callIdCounter = 1n;

    constructor(nodeEngine: NodeEngine) {
        this._nodeEngine = nodeEngine;
    }

    /**
     * Execute an operation synchronously (awaits run()).
     * Sets callId, injects NodeEngine, then awaits beforeRun() + run().
     */
    async run(op: Operation): Promise<void> {
        this._prepareOperation(op);
        await op.beforeRun();
        await op.run();
    }

    /**
     * Fire-and-forget execution. Exceptions are swallowed (logged to console).
     */
    execute(op: Operation): void {
        void (async () => {
            try {
                await this.run(op);
            } catch (e) {
                console.error('[OperationServiceImpl] Unhandled exception in execute():', e);
            }
        })();
    }

    /**
     * In-process partition invocation.
     *
     * Wires a ResponseHandler that resolves the returned InvocationFuture.
     * The operation must call sendResponse(value) to complete the future.
     * If run() returns without calling sendResponse, the future auto-completes
     * with undefined.
     */
    invokeOnPartition<T>(serviceName: string, op: Operation, partitionId: number): InvocationFuture<T> {
        const future = new InvocationFuture<T>();

        op.serviceName = serviceName;
        op.partitionId = partitionId;
        this._prepareOperation(op);

        op.setResponseHandler({
            sendResponse(_op: Operation, response: unknown): void {
                future.complete(response as T);
            },
        });

        void (async () => {
            try {
                await op.beforeRun();
                await op.run();
                // Auto-complete if the operation didn't call sendResponse
                if (!future.isDone()) {
                    future.complete(undefined as unknown as T);
                }
            } catch (e) {
                if (!future.isDone()) {
                    future.completeExceptionally(e);
                }
            }
        })();

        return future;
    }

    /**
     * In-process target invocation. In single-node mode, target is ignored and the
     * operation runs locally, identical to invokeOnPartition.
     */
    invokeOnTarget<T>(serviceName: string, op: Operation, _target: Address): InvocationFuture<T> {
        return this.invokeOnPartition<T>(serviceName, op, op.partitionId);
    }

    // ── internals ──────────────────────────────────────────────────────────

    private _prepareOperation(op: Operation): void {
        op.setNodeEngine(this._nodeEngine);
        op.setCallId(this._callIdCounter++);
    }
}
