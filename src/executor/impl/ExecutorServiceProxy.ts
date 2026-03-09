/**
 * Caller-facing executor proxy implementing {@link IExecutorService}.
 *
 * Routes task submissions through OperationService, unwraps result envelopes,
 * and provides the local inline fast path.
 *
 * @see IExecutorService
 * @see ExecuteCallableOperation
 * @see MemberCallableOperation
 */

import type { Member } from '@zenystx/helios-core/cluster/Member.js';
import type { ExecutorConfig } from '@zenystx/helios-core/config/ExecutorConfig.js';
import {
    ExecutorRejectedExecutionException,
    ExecutorTaskLostException,
    ExecutorTaskTimeoutException,
    UnknownTaskTypeException,
} from '@zenystx/helios-core/executor/ExecutorExceptions.js';
import type { ExecutorOperationResult } from '@zenystx/helios-core/executor/ExecutorOperationResult.js';
import type { IExecutorService, LocalExecutorStats, TaskTypeRegistration } from '@zenystx/helios-core/executor/IExecutorService.js';
import { CancellationOperation } from '@zenystx/helios-core/executor/impl/CancellationOperation.js';
import type { ExecutorContainerService } from '@zenystx/helios-core/executor/impl/ExecutorContainerService.js';
import { ExecuteCallableOperation, type TaskDescriptor } from '@zenystx/helios-core/executor/impl/ExecuteCallableOperation.js';
import { MemberCallableOperation } from '@zenystx/helios-core/executor/impl/MemberCallableOperation.js';
import { TaskTypeRegistry } from '@zenystx/helios-core/executor/impl/TaskTypeRegistry.js';
import type { InlineTaskCallable, TaskCallable } from '@zenystx/helios-core/executor/TaskCallable.js';
import { InvocationFuture } from '@zenystx/helios-core/spi/impl/operationservice/InvocationFuture.js';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine.js';
const SERVICE_NAME = 'helios:executor';

export class ExecutorServiceProxy implements IExecutorService {
    private readonly _name: string;
    private readonly _nodeEngine: NodeEngine;
    private readonly _config: ExecutorConfig;
    private readonly _registry: TaskTypeRegistry;
    private readonly _localMemberUuid: string;
    private _shutdown = false;
    private _stats: LocalExecutorStats = {
        pending: 0, started: 0, completed: 0, cancelled: 0,
        rejected: 0, timedOut: 0, taskLost: 0, lateResultsDropped: 0,
        totalStartLatencyMs: 0, totalExecutionTimeMs: 0, activeWorkers: 0,
    };

    constructor(
        name: string,
        nodeEngine: NodeEngine,
        config: ExecutorConfig,
        registry: TaskTypeRegistry,
        localMemberUuid: string,
    ) {
        this._name = name;
        this._nodeEngine = nodeEngine;
        this._config = config;
        this._registry = registry;
        this._localMemberUuid = localMemberUuid;
    }

    // ── Distributed submission ───────────────────────────────────────────

    submit<T>(task: TaskCallable<T>): InvocationFuture<T> {
        this._checkNotShutdown();
        this._rejectInline(task);
        const desc = this._validateAndBuildDescriptor(task);
        const op = new ExecuteCallableOperation(desc);
        const partitionService = this._nodeEngine.getPartitionService();
        const inputData = this._nodeEngine.getSerializationService().toData(task.input);
        const partitionId = inputData ? partitionService.getPartitionId(inputData) : 0;

        const rawFuture = this._nodeEngine.getOperationService()
            .invokeOnPartition<ExecutorOperationResult>(SERVICE_NAME, op, partitionId);
        return this._unwrapResult<T>(rawFuture);
    }

    submitToMember<T>(task: TaskCallable<T>, member: Member): InvocationFuture<T> {
        this._checkNotShutdown();
        this._rejectInline(task);
        const desc = this._validateAndBuildDescriptor(task);
        const op = new MemberCallableOperation(desc, member.getUuid());

        const rawFuture = this._nodeEngine.getOperationService()
            .invokeOnTarget<ExecutorOperationResult>(SERVICE_NAME, op, member.getAddress());
        return this._unwrapResult<T>(rawFuture);
    }

    submitToKeyOwner<T>(task: TaskCallable<T>, key: unknown): InvocationFuture<T> {
        this._checkNotShutdown();
        this._rejectInline(task);
        const desc = this._validateAndBuildDescriptor(task);
        const op = new ExecuteCallableOperation(desc);
        const keyData = this._nodeEngine.getSerializationService().toData(key);
        const partitionId = keyData ? this._nodeEngine.getPartitionService().getPartitionId(keyData) : 0;

        const rawFuture = this._nodeEngine.getOperationService()
            .invokeOnPartition<ExecutorOperationResult>(SERVICE_NAME, op, partitionId);
        return this._unwrapResult<T>(rawFuture);
    }

    submitToAllMembers<T>(task: TaskCallable<T>): Map<Member, InvocationFuture<T>> {
        this._checkNotShutdown();
        this._rejectInline(task);
        const members = this._getClusterMembers();
        return this._fanOut(task, members);
    }

    submitToMembers<T>(task: TaskCallable<T>, members: Iterable<Member>): Map<Member, InvocationFuture<T>> {
        this._checkNotShutdown();
        this._rejectInline(task);
        return this._fanOut(task, [...members]);
    }

    // ── Fire-and-forget ─────────────────────────────────────────────────

    execute<T>(task: TaskCallable<T>): void {
        this.submit(task);
    }

    executeOnMember<T>(task: TaskCallable<T>, member: Member): void {
        this.submitToMember(task, member);
    }

    executeOnKeyOwner<T>(task: TaskCallable<T>, key: unknown): void {
        this.submitToKeyOwner(task, key);
    }

    executeOnAllMembers<T>(task: TaskCallable<T>): void {
        this.submitToAllMembers(task);
    }

    // ── Task registration (delegates to registry) ───────────────────────

    registerTaskType<T>(
        taskType: string,
        factory: (input: unknown) => T | Promise<T>,
        options?: TaskTypeRegistration<T>,
    ): void {
        this._registry.register(taskType, factory, options);
    }

    unregisterTaskType(taskType: string): boolean {
        return this._registry.unregister(taskType);
    }

    getRegisteredTaskTypes(): ReadonlySet<string> {
        return this._registry.getRegisteredTypes();
    }

    // ── Local-only inline execution ─────────────────────────────────────

    submitLocal<T>(task: InlineTaskCallable<T>): InvocationFuture<T> {
        this._checkNotShutdown();
        const future = new InvocationFuture<T>();
        void Promise.resolve()
            .then(() => task.fn(task.input))
            .then(
                (v) => future.complete(v),
                (e) => future.completeExceptionally(e),
            );
        return future;
    }

    executeLocal<T>(task: InlineTaskCallable<T>): void {
        this.submitLocal(task);
    }

    // ── Cancel routing ────────────────────────────────────────────────

    /**
     * Cancel a task by UUID. Routes a CancellationOperation through OperationService
     * to the partition that owns the task.
     */
    cancelTask(taskUuid: string, partitionId: number): InvocationFuture<boolean> {
        const op = new CancellationOperation(this._name, taskUuid);
        return this._nodeEngine.getOperationService()
            .invokeOnPartition<boolean>(SERVICE_NAME, op, partitionId);
    }

    // ── Lifecycle ───────────────────────────────────────────────────────

    async shutdown(): Promise<void> {
        this._shutdown = true;
        const container = this._getContainer();
        if (container !== null && !container.isShutdown()) {
            await container.shutdown();
        }
    }

    isShutdown(): boolean {
        return this._shutdown || this._getContainer()?.isShutdown() === true;
    }

    // ── Stats ───────────────────────────────────────────────────────────

    getLocalExecutorStats(): LocalExecutorStats {
        return { ...this._stats };
    }

    // ── Private helpers ─────────────────────────────────────────────────

    private _checkNotShutdown(): void {
        if (this.isShutdown()) {
            throw new ExecutorRejectedExecutionException(`Executor "${this._name}" is shut down`);
        }
    }

    private _getContainer(): ExecutorContainerService | null {
        return this._nodeEngine.getServiceOrNull<ExecutorContainerService>(`helios:executor:container:${this._name}`);
    }

    private _rejectInline(task: TaskCallable<unknown>): void {
        if (task.taskType === '__inline__') {
            throw new Error('Inline tasks cannot be submitted for distributed execution');
        }
        // Reject non-worker-safe tasks when backend is scatter (no distributed closure execution)
        if (this._config.getExecutionBackend() === 'scatter' && !this._registry.isWorkerSafe(task.taskType)) {
            throw new Error(
                `Task "${task.taskType}" is not worker-safe (no modulePath). ` +
                'Distributed tasks require module-backed registration with modulePath and exportName. ' +
                'Use submitLocal()/executeLocal() for closure-only tasks.',
            );
        }
    }

    private _validateAndBuildDescriptor(task: TaskCallable<unknown>): TaskDescriptor {
        const desc = this._registry.get(task.taskType);
        if (!desc) {
            throw new UnknownTaskTypeException(task.taskType);
        }

        return {
            taskUuid: crypto.randomUUID(),
            executorName: this._name,
            taskType: task.taskType,
            registrationFingerprint: desc.fingerprint,
            inputData: Buffer.from(JSON.stringify(task.input)),
            submitterMemberUuid: this._localMemberUuid,
            timeoutMillis: this._config.getTaskTimeoutMillis(),
        };
    }

    private _unwrapResult<T>(rawFuture: InvocationFuture<ExecutorOperationResult>): InvocationFuture<T> {
        const resultFuture = new InvocationFuture<T>();
        void rawFuture.get().then(
            (envelope) => {
                switch (envelope.status) {
                    case 'success': {
                        const value = this._deserializeResult<T>(envelope.resultData);
                        resultFuture.complete(value);
                        break;
                    }
                    case 'cancelled':
                        resultFuture.cancel();
                        break;
                    case 'rejected':
                        resultFuture.completeExceptionally(
                            this._toError(envelope.errorName, envelope.errorMessage),
                        );
                        break;
                    case 'task-lost':
                        resultFuture.completeExceptionally(
                            new ExecutorTaskLostException(envelope.taskUuid, envelope.errorMessage ?? 'member departed'),
                        );
                        break;
                    case 'timeout':
                        resultFuture.completeExceptionally(
                            new ExecutorTaskTimeoutException(envelope.taskUuid, this._config.getTaskTimeoutMillis()),
                        );
                        break;
                }
            },
            (err) => resultFuture.completeExceptionally(err),
        );
        return resultFuture;
    }

    private _deserializeResult<T>(resultData: import('@zenystx/helios-core/internal/serialization/Data.js').Data | null): T {
        if (!resultData) return null as T;
        return this._nodeEngine.toObject<T>(resultData) as T;
    }

    private _toError(errorName: string | null, errorMessage: string | null): Error {
        const msg = errorMessage ?? 'Unknown executor error';
        switch (errorName) {
            case 'TaskRegistrationMismatchException': {
                const e = new Error(msg);
                e.name = 'TaskRegistrationMismatchException';
                return e;
            }
            case 'UnknownTaskTypeException':
                return new UnknownTaskTypeException(msg);
            case 'ExecutorRejectedExecutionException':
                return new ExecutorRejectedExecutionException(msg);
            default: {
                const e = new Error(msg);
                if (errorName) e.name = errorName;
                return e;
            }
        }
    }

    private _getClusterMembers(): Member[] {
        // ClusterServiceView returns minimal address-bearing objects;
        // for fan-out we need the full Member objects from the current view.
        // The proxy receives members through submitToAllMembers/submitToMembers.
        // For submitToAllMembers we get them from the cluster service view and
        // wrap them as target addresses.
        const view = this._nodeEngine.getClusterService();
        const memberViews = view.getMembers();
        // Convert to Member-like objects sufficient for invokeOnTarget
        return memberViews.map((mv) => ({
            getAddress: () => mv.address(),
            getUuid: () => '',
            localMember: () => false,
            isLiteMember: () => false,
            getAddressMap: () => new Map(),
            getAttributes: () => new Map(),
            getAttribute: () => null,
            getVersion: () => ({ getMajor: () => 0, getMinor: () => 0, getPatch: () => 0 }),
        })) as unknown as Member[];
    }

    private _fanOut<T>(task: TaskCallable<T>, members: Member[]): Map<Member, InvocationFuture<T>> {
        const result = new Map<Member, InvocationFuture<T>>();
        for (const member of members) {
            const desc = this._validateAndBuildDescriptor(task);
            const op = new MemberCallableOperation(desc, member.getUuid());
            const rawFuture = this._nodeEngine.getOperationService()
                .invokeOnTarget<ExecutorOperationResult>(SERVICE_NAME, op, member.getAddress());
            result.set(member, this._unwrapResult<T>(rawFuture));
        }
        return result;
    }
}
