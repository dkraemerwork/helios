/**
 * Port of {@code com.hazelcast.spi.impl.operationservice.OperationService}.
 *
 * Executes Operations locally or routes them to remote nodes.
 * In single-node in-process mode, all invocations execute locally.
 */
import type { Operation } from '@helios/spi/impl/operationservice/Operation';
import type { InvocationFuture } from '@helios/spi/impl/operationservice/InvocationFuture';
import type { Address } from '@helios/cluster/Address';

export interface OperationService {
    /**
     * Execute an operation synchronously on the calling fiber.
     * The operation's run() is awaited; any exception propagates.
     */
    run(op: Operation): Promise<void>;

    /**
     * Execute an operation asynchronously (fire-and-forget).
     * Exceptions are logged but not propagated.
     */
    execute(op: Operation): void;

    /**
     * Invoke an operation targeting a specific partition.
     * Returns an InvocationFuture that resolves with the operation result.
     *
     * @param serviceName  Name of the service that owns the operation.
     * @param op           The operation to execute.
     * @param partitionId  Target partition ID.
     */
    invokeOnPartition<T>(serviceName: string, op: Operation, partitionId: number): InvocationFuture<T>;

    /**
     * Invoke an operation targeting a specific cluster member.
     * In single-node in-process mode, the operation executes locally (target is ignored).
     *
     * @param serviceName  Name of the service that owns the operation.
     * @param op           The operation to execute.
     * @param target       Target member address.
     */
    invokeOnTarget<T>(serviceName: string, op: Operation, target: Address): InvocationFuture<T>;
}
