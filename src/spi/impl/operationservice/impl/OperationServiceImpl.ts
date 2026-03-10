/**
 * Port of {@code com.hazelcast.spi.impl.operationservice.impl.OperationServiceImpl}.
 *
 * Block 16.C3 upgrade: routing-aware dispatch with InvocationRegistry,
 * PartitionInvocation, TargetInvocation, migration guards, retry, and
 * backward-compatible localMode for existing tests.
 */
import type { Address } from '@zenystx/helios-core/cluster/Address';
import type { SlowOperationDetector } from '@zenystx/helios-core/diagnostics/SlowOperationDetector';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine';
import { InvocationFuture } from '@zenystx/helios-core/spi/impl/operationservice/InvocationFuture';
import { InvocationRegistry } from '@zenystx/helios-core/spi/impl/operationservice/InvocationRegistry';
import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import type { OperationService } from '@zenystx/helios-core/spi/impl/operationservice/OperationService';
import { PartitionInvocation } from '@zenystx/helios-core/spi/impl/operationservice/PartitionInvocation';
import { PartitionMigratingException, RetryableException, TargetNotMemberException } from '@zenystx/helios-core/spi/impl/operationservice/RetryableException';
import { TargetInvocation } from '@zenystx/helios-core/spi/impl/operationservice/TargetInvocation';

export interface OperationServiceImplOptions {
    localMode?: boolean;
    localAddress?: Address;
    maxConcurrentInvocations?: number;
    invocationTryCount?: number;
    afterLocalRun?: (op: Operation) => Promise<void>;
    /**
     * Optional remote send hook for non-local target invocations.
     * When provided, operations targeting non-local members are dispatched
     * through this callback instead of being rejected.
     */
    remoteSend?: (op: Operation, target: Address) => Promise<void>;
    /** Optional slow-operation detector — wired by HeliosInstanceImpl when monitoring is enabled. */
    slowOperationDetector?: SlowOperationDetector;
}

export interface OperationStats {
    /** Number of operations currently registered in the invocation registry (queued + running). */
    queueSize: number;
    /** Number of operations whose run() is currently in flight (local executions in progress). */
    runningCount: number;
    /** Total number of operations completed since this service was created. */
    completedCount: number;
}

export class OperationServiceImpl implements OperationService {
    private readonly _nodeEngine: NodeEngine;
    private readonly _localMode: boolean;
    private readonly _localAddress: Address | null;
    private readonly _registry: InvocationRegistry;
    private readonly _invocationTryCount: number;
    private readonly _afterLocalRun: ((op: Operation) => Promise<void>) | null;
    private readonly _remoteSend: ((op: Operation, target: Address) => Promise<void>) | null;
    private _slowOperationDetector: SlowOperationDetector | null;
    private _callIdCounter = 1n;
    private _runningCount = 0;
    private _completedCount = 0;
    private _externalRunningCount = 0;
    private _externalCompletedCount = 0;

    constructor(nodeEngine: NodeEngine, options?: OperationServiceImplOptions) {
        this._nodeEngine = nodeEngine;
        this._localMode = options?.localMode ?? true;
        this._localAddress = options?.localAddress ?? null;
        this._invocationTryCount = options?.invocationTryCount ?? 250;
        this._afterLocalRun = options?.afterLocalRun ?? null;
        this._remoteSend = options?.remoteSend ?? null;
        this._slowOperationDetector = options?.slowOperationDetector ?? null;
        this._registry = new InvocationRegistry(
            options?.maxConcurrentInvocations ?? 100_000,
        );
    }

    /** Attach (or detach) a slow-operation detector at runtime. */
    setSlowOperationDetector(detector: SlowOperationDetector | null): void {
        this._slowOperationDetector = detector;
    }

    getInvocationRegistry(): InvocationRegistry {
        return this._registry;
    }

    getLocalAddress(): Address {
        if (this._localAddress === null) {
            throw new Error('No local address configured');
        }
        return this._localAddress;
    }

    /**
     * Execute an operation synchronously (awaits run()).
     * Sets callId, injects NodeEngine, then awaits beforeRun() + run().
     */
    async run(op: Operation): Promise<void> {
        this._prepareOperation(op);
        const trackingId = String(op.getCallId());
        const operationName = op.constructor.name;
        this._slowOperationDetector?.startTracking(trackingId, operationName);
        this._runningCount++;
        try {
            await op.beforeRun();
            await op.run();
        } finally {
            this._runningCount--;
            this._completedCount++;
            this._slowOperationDetector?.stopTracking(trackingId);
        }
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

    /** Returns a point-in-time snapshot of operation queue statistics. */
    getStats(): OperationStats {
        return {
            queueSize: this._registry.size,
            runningCount: this._runningCount + this._externalRunningCount,
            completedCount: this._completedCount + this._externalCompletedCount,
        };
    }

    /**
     * Track a completed external operation that runs outside Operation.run().
     *
     * Member-side client protocol handlers sometimes execute distributed-object
     * work directly against service adapters instead of routing through an
     * Operation subclass. Without this hook, those successful requests never
     * contribute to monitor operation counts.
     */
    async trackExternalOperation<T>(action: () => Promise<T>): Promise<T> {
        this._externalRunningCount++;
        try {
            return await action();
        } finally {
            this._externalRunningCount--;
            this._externalCompletedCount++;
        }
    }

    /**
     * Invoke an operation targeting a specific partition.
     *
     * In localMode: executes locally without routing (backward compat).
     * In routing mode: creates a PartitionInvocation, registers in InvocationRegistry,
     * resolves partition owner, and dispatches (local or remote).
     */
    invokeOnPartition<T>(serviceName: string, op: Operation, partitionId: number): InvocationFuture<T> {
        op.serviceName = serviceName;
        op.partitionId = partitionId;

        if (this._localMode) {
            return this._invokeLocal<T>(op);
        }

        return this._invokeOnPartitionRouted<T>(op, partitionId);
    }

    /**
     * Invoke an operation targeting a specific cluster member.
     *
     * In localMode: executes locally ignoring target (backward compat).
     * In routing mode: creates a TargetInvocation and dispatches.
     */
    invokeOnTarget<T>(serviceName: string, op: Operation, target: Address): InvocationFuture<T> {
        op.serviceName = serviceName;

        if (this._localMode) {
            return this._invokeLocal<T>(op);
        }

        return this._invokeOnTargetRouted<T>(op, target);
    }

    /** Shut down the operation service: reject new invocations, reset pending. */
    shutdown(): void {
        this._registry.shutdown();
        this._registry.reset(new Error('OperationService shut down'));
    }

    // ── routing-mode dispatch ───────────────────────────────────────────────

    private _invokeOnPartitionRouted<T>(op: Operation, partitionId: number): InvocationFuture<T> {
        const localAddress = this._localAddress!;
        const invocation = new PartitionInvocation(
            op, this._registry, this._nodeEngine, localAddress, partitionId,
            { tryCount: this._invocationTryCount },
        );

        return this._doInvoke<T>(invocation);
    }

    private _invokeOnTargetRouted<T>(op: Operation, target: Address): InvocationFuture<T> {
        const localAddress = this._localAddress!;

        // Non-local target: use remoteSend if available, otherwise reject
        if (!target.equals(localAddress)) {
            if (this._remoteSend) {
                return this._invokeRemote<T>(op, target);
            }
            const future = new InvocationFuture<T>();
            future.completeExceptionally(
                new TargetNotMemberException(target),
            );
            return future;
        }

        const invocation = new TargetInvocation(
            op, this._registry, this._nodeEngine, localAddress, target,
            { tryCount: this._invocationTryCount },
        );

        return this._doInvoke<T>(invocation);
    }

    /**
     * Remote invocation path: dispatches the operation to a non-local member
     * via the configured remoteSend callback.
     */
    private _invokeRemote<T>(op: Operation, target: Address): InvocationFuture<T> {
        const future = new InvocationFuture<T>();

        this._prepareOperation(op);

        op.setResponseHandler({
            sendResponse(_op: Operation, response: unknown): void {
                future.complete(response as T);
            },
        });

        void (async () => {
            try {
                await this._remoteSend!(op, target);
                // If remoteSend ran the op, response handler should have fired.
                // If not, auto-complete.
                if (!future.isDone()) {
                    future.complete(undefined as unknown as T);
                }
            } catch (e) {
                if (!future.isDone()) {
                    future.completeExceptionally(e instanceof Error ? e : new Error(String(e)));
                }
            }
        })();

        return future;
    }

    private _doInvoke<T>(invocation: PartitionInvocation | TargetInvocation): InvocationFuture<T> {
        const future = invocation.future as InvocationFuture<T>;

        try {
            invocation.initInvocationTarget();
            this._registry.register(invocation);
        } catch (e) {
            future.completeExceptionally(e);
            return future;
        }

        this._executeWithRetry(invocation);

        return future;
    }

    /**
     * Execute the operation with retry logic. On retryable errors, re-resolves the
     * partition target and retries (with exponential backoff after the first N fast retries).
     * On non-retryable errors or max retries exceeded, rejects the future.
     */
    private _executeWithRetry(invocation: PartitionInvocation | TargetInvocation): void {
        const op = invocation.op;
        op.setNodeEngine(this._nodeEngine);

        // Wire response handler to notify the invocation
        op.setResponseHandler({
            sendResponse: (_op: Operation, response: unknown) => {
                invocation.notifyNormalResponse(response, 0);
            },
        });

        const runOnce = async (): Promise<void> => {
            try {
                // Check if the invocation target is remote
                const targetAddr = invocation.targetAddress;
                const isRemote = this._remoteSend !== null
                    && this._localAddress !== null
                    && targetAddr !== null
                    && !targetAddr.equals(this._localAddress);

                if (isRemote) {
                    // Remote execution: delegate to remoteSend callback
                    await this._remoteSend!(op, targetAddr!);
                    if (!invocation.future.isDone()) {
                        invocation.notifyNormalResponse(undefined, 0);
                    }
                    return;
                }

                // Local execution
                // Migration guard check
                const partitionService = this._nodeEngine.getPartitionService() as any;
                if (op.partitionId >= 0 && typeof partitionService.isMigrating === 'function') {
                    if (partitionService.isMigrating(op.partitionId)) {
                        throw new PartitionMigratingException(op.partitionId);
                    }
                }

                await op.beforeRun();
                const slowTrackId = String(op.getCallId());
                this._slowOperationDetector?.startTracking(slowTrackId, op.constructor.name);
                this._runningCount++;
                try {
                    if (this._afterLocalRun !== null) {
                        let responseSent = false;
                        let responseValue: unknown = undefined;
                        op.setResponseHandler({
                            sendResponse: (_op: Operation, response: unknown) => {
                                responseSent = true;
                                responseValue = response;
                            },
                        });
                        await op.run();
                        await this._afterLocalRun(op);
                        this._completedCount++;
                        if (!invocation.future.isDone()) {
                            invocation.notifyNormalResponse(responseSent ? responseValue : undefined, 0);
                        }
                        return;
                    }

                    await op.run();
                    this._completedCount++;

                    // Auto-complete if the operation didn't call sendResponse
                    if (!invocation.future.isDone()) {
                        invocation.notifyNormalResponse(undefined, 0);
                    }
                } finally {
                    this._runningCount--;
                    this._slowOperationDetector?.stopTracking(slowTrackId);
                }
            } catch (e) {
                if (invocation.future.isDone()) return;

                const error = e instanceof Error ? e : new Error(String(e));

                if (error instanceof RetryableException && invocation.invokeCount < invocation.tryCount) {
                    invocation.invokeCount++;
                    op.deactivate();
                    invocation.initInvocationTarget();

                    // Re-register (assigns new callId)
                    try {
                        this._registry.register(invocation);
                    } catch (regErr) {
                        invocation.future.completeExceptionally(regErr);
                        return;
                    }

                    const delay = invocation.getRetryDelayMs();
                    if (delay === 0) {
                        void runOnce();
                    } else {
                        setTimeout(() => void runOnce(), delay);
                    }
                    return;
                }

                // Non-retryable or retries exhausted
                this._registry.deregister(invocation);
                invocation.future.completeExceptionally(error);
            }
        };

        void runOnce();
    }

    // ── localMode dispatch (backward compat) ────────────────────────────────

    private _invokeLocal<T>(op: Operation): InvocationFuture<T> {
        const future = new InvocationFuture<T>();

        this._prepareOperation(op);

        op.setResponseHandler({
            sendResponse(_op: Operation, response: unknown): void {
                future.complete(response as T);
            },
        });

        void (async () => {
            const trackingId = String(op.getCallId());
            const operationName = op.constructor.name;
            this._slowOperationDetector?.startTracking(trackingId, operationName);
            this._runningCount++;
            try {
                await op.beforeRun();
                await op.run();
                this._completedCount++;
                if (!future.isDone()) {
                    future.complete(undefined as unknown as T);
                }
            } catch (e) {
                if (!future.isDone()) {
                    future.completeExceptionally(e);
                }
            } finally {
                this._runningCount--;
                this._slowOperationDetector?.stopTracking(trackingId);
            }
        })();

        return future;
    }

    // ── internals ──────────────────────────────────────────────────────────

    private _prepareOperation(op: Operation): void {
        op.setNodeEngine(this._nodeEngine);
        op.setCallId(this._callIdCounter++);
    }
}
