/**
 * Server-side execution engine for the distributed executor.
 *
 * Manages task lifecycle: accept → queue → execute → complete/fail/cancel/timeout.
 * Uses per-task-type execution with bounded queueing and pool caps.
 */

import type { ExecutorConfig } from '@helios/config/ExecutorConfig.js';
import type { TaskTypeRegistry } from '@helios/executor/impl/TaskTypeRegistry.js';
import type { ExecutorOperationResult } from '@helios/executor/ExecutorOperationResult.js';
import { HeapData } from '@helios/internal/serialization/impl/HeapData.js';
import { Bits } from '@helios/internal/nio/Bits.js';

export const enum TaskState {
    QUEUED = 'QUEUED',
    RUNNING = 'RUNNING',
    CANCELLED = 'CANCELLED',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
    TIMED_OUT = 'TIMED_OUT',
    TASK_LOST = 'TASK_LOST',
}

interface TaskRequest {
    readonly taskUuid: string;
    readonly taskType: string;
    readonly registrationFingerprint: string;
    readonly inputData: Buffer;
    readonly executorName: string;
    readonly submitterMemberUuid: string;
    readonly timeoutMillis: number;
}

interface TaskHandle {
    state: TaskState;
    resolve: (result: ExecutorOperationResult) => void;
    timeoutTimer?: ReturnType<typeof setTimeout>;
}

interface PoolEntry {
    readonly taskType: string;
    activeCount: number;
    lastUsed: number;
    queuedTasks: Array<{ request: TaskRequest; handle: TaskHandle }>;
}

export class ExecutorContainerService {
    private readonly _name: string;
    private readonly _config: ExecutorConfig;
    private readonly _registry: TaskTypeRegistry;
    private readonly _pools = new Map<string, PoolEntry>();
    private readonly _handles = new Map<string, TaskHandle>();
    private _shutdown = false;
    private _stats = { started: 0, completed: 0, cancelled: 0, rejected: 0, timedOut: 0, taskLost: 0, pending: 0 };

    constructor(name: string, config: ExecutorConfig, registry: TaskTypeRegistry) {
        this._name = name;
        this._config = config;
        this._registry = registry;
    }

    async executeTask(request: TaskRequest): Promise<ExecutorOperationResult> {
        if (this._shutdown) {
            return this._rejectEnvelope(request.taskUuid, 'ExecutorRejectedExecutionException', `Executor "${this._name}" is shut down`);
        }

        // Validate registration
        const desc = this._registry.get(request.taskType);
        if (!desc) {
            this._stats.rejected++;
            return this._rejectEnvelope(request.taskUuid, 'UnknownTaskTypeException', `Unknown task type: "${request.taskType}"`);
        }
        if (desc.fingerprint !== request.registrationFingerprint) {
            this._stats.rejected++;
            return this._rejectEnvelope(request.taskUuid, 'TaskRegistrationMismatchException', `Fingerprint mismatch for "${request.taskType}"`);
        }

        let pool = this._pools.get(request.taskType);
        if (!pool) {
            if (this._pools.size >= this._config.getMaxActiveTaskTypePools()) {
                this._stats.rejected++;
                return this._rejectEnvelope(request.taskUuid, 'ExecutorRejectedExecutionException', `Pool cap (${this._config.getMaxActiveTaskTypePools()}) reached`);
            }
            pool = { taskType: request.taskType, activeCount: 0, lastUsed: Date.now(), queuedTasks: [] };
            this._pools.set(request.taskType, pool);
        }

        const poolSize = desc.poolSize ?? this._config.getPoolSize();

        // Check if we can run immediately or queue
        if (pool.activeCount >= poolSize) {
            const totalQueued = pool.queuedTasks.length;
            if (totalQueued >= this._config.getQueueCapacity()) {
                this._stats.rejected++;
                return this._rejectEnvelope(request.taskUuid, 'ExecutorRejectedExecutionException', `Queue full for "${request.taskType}"`);
            }
            // Queue the task
            return new Promise<ExecutorOperationResult>((resolve) => {
                const handle: TaskHandle = { state: TaskState.QUEUED, resolve };
                this._handles.set(request.taskUuid, handle);
                pool!.queuedTasks.push({ request, handle });
                this._stats.pending++;
            });
        }

        // Execute immediately
        return this._executeNow(request, pool);
    }

    cancelTask(taskUuid: string): boolean {
        const handle = this._handles.get(taskUuid);
        if (!handle) return false;

        if (handle.state === TaskState.QUEUED) {
            handle.state = TaskState.CANCELLED;
            this._stats.cancelled++;
            this._stats.pending--;
            // Remove from queue
            for (const pool of this._pools.values()) {
                const idx = pool.queuedTasks.findIndex((t) => t.request.taskUuid === taskUuid);
                if (idx !== -1) {
                    pool.queuedTasks.splice(idx, 1);
                    break;
                }
            }
            if (handle.timeoutTimer) clearTimeout(handle.timeoutTimer);
            handle.resolve({
                taskUuid,
                status: 'cancelled',
                originMemberUuid: '',
                resultData: null,
                errorName: null,
                errorMessage: null,
            });
            this._handles.delete(taskUuid);
            return true;
        }

        if (handle.state === TaskState.RUNNING) {
            handle.state = TaskState.CANCELLED;
            this._stats.cancelled++;
            if (handle.timeoutTimer) clearTimeout(handle.timeoutTimer);
            handle.resolve({
                taskUuid,
                status: 'cancelled',
                originMemberUuid: '',
                resultData: null,
                errorName: null,
                errorMessage: null,
            });
            this._handles.delete(taskUuid);
            return true;
        }

        return false;
    }

    getTaskState(taskUuid: string): TaskState | undefined {
        return this._handles.get(taskUuid)?.state;
    }

    getActivePoolCount(): number {
        return this._pools.size;
    }

    evictIdlePools(): void {
        const now = Date.now();
        const idleMillis = this._config.getPoolIdleMillis();
        for (const [type, pool] of this._pools) {
            if (pool.activeCount === 0 && pool.queuedTasks.length === 0 && (now - pool.lastUsed) >= idleMillis) {
                this._pools.delete(type);
            }
        }
    }

    isShutdown(): boolean {
        return this._shutdown;
    }

    async shutdown(): Promise<void> {
        this._shutdown = true;

        // Wait for in-flight tasks to complete within timeout
        const timeout = this._config.getShutdownTimeoutMillis();
        const deadline = Date.now() + timeout;

        while (this._handles.size > 0 && Date.now() < deadline) {
            await Bun.sleep(10);
        }

        // Fail remaining handles
        for (const [uuid, handle] of this._handles) {
            if (handle.timeoutTimer) clearTimeout(handle.timeoutTimer);
            handle.resolve({
                taskUuid: uuid,
                status: 'rejected',
                originMemberUuid: '',
                resultData: null,
                errorName: 'ExecutorRejectedExecutionException',
                errorMessage: 'Executor shutdown timeout',
            });
        }
        this._handles.clear();
        this._pools.clear();
    }

    getStats(): { started: number; completed: number; cancelled: number; rejected: number; timedOut: number; taskLost: number; pending: number } {
        return { ...this._stats };
    }

    private async _executeNow(request: TaskRequest, pool: PoolEntry): Promise<ExecutorOperationResult> {
        return new Promise<ExecutorOperationResult>((resolve) => {
            const handle: TaskHandle = { state: TaskState.RUNNING, resolve };
            this._handles.set(request.taskUuid, handle);
            pool.activeCount++;
            pool.lastUsed = Date.now();
            this._stats.started++;

            // Set up timeout
            if (request.timeoutMillis > 0) {
                handle.timeoutTimer = setTimeout(() => {
                    if (handle.state !== TaskState.RUNNING) return;
                    handle.state = TaskState.TIMED_OUT;
                    this._stats.timedOut++;
                    pool.activeCount--;
                    handle.resolve({
                        taskUuid: request.taskUuid,
                        status: 'timeout',
                        originMemberUuid: '',
                        resultData: null,
                        errorName: 'ExecutorTaskTimeoutException',
                        errorMessage: `Task "${request.taskUuid}" timed out after ${request.timeoutMillis}ms`,
                    });
                    this._handles.delete(request.taskUuid);
                    this._drainQueue(pool);
                }, request.timeoutMillis);
            }

            // Execute
            const desc = this._registry.get(request.taskType)!;
            const runTask = async (): Promise<void> => {
                try {
                    const input = JSON.parse(request.inputData.toString('utf8'));
                    const result = await desc.factory(input);

                    // Check if cancelled/timed out while running
                    if (!this._handles.has(request.taskUuid)) return;

                    if (handle.timeoutTimer) clearTimeout(handle.timeoutTimer);
                    handle.state = TaskState.COMPLETED;
                    this._stats.completed++;
                    pool.activeCount--;
                    pool.lastUsed = Date.now();

                    const json = JSON.stringify(result) ?? 'null';
                    const jsonBytes = Buffer.from(json);
                    const resultData = ExecutorContainerService._wrapAsHeapData(jsonBytes);

                    handle.resolve({
                        taskUuid: request.taskUuid,
                        status: 'success',
                        originMemberUuid: request.submitterMemberUuid,
                        resultData,
                        errorName: null,
                        errorMessage: null,
                    });
                    this._handles.delete(request.taskUuid);
                    this._drainQueue(pool);
                } catch (e) {
                    if (!this._handles.has(request.taskUuid)) return;

                    if (handle.timeoutTimer) clearTimeout(handle.timeoutTimer);
                    handle.state = TaskState.FAILED;
                    pool.activeCount--;
                    pool.lastUsed = Date.now();

                    const err = e instanceof Error ? e : new Error(String(e));
                    handle.resolve({
                        taskUuid: request.taskUuid,
                        status: 'rejected',
                        originMemberUuid: request.submitterMemberUuid,
                        resultData: null,
                        errorName: err.name,
                        errorMessage: err.message,
                    });
                    this._handles.delete(request.taskUuid);
                    this._drainQueue(pool);
                }
            };

            // Fire and forget — the promise resolves through the handle
            runTask();
        });
    }

    private _drainQueue(pool: PoolEntry): void {
        const desc = this._registry.get(pool.taskType);
        if (!desc) return;
        const poolSize = desc.poolSize ?? this._config.getPoolSize();

        while (pool.queuedTasks.length > 0 && pool.activeCount < poolSize) {
            const next = pool.queuedTasks.shift()!;
            this._stats.pending--;
            // Remove old handle and execute
            this._handles.delete(next.request.taskUuid);
            this._executeNowWithExistingHandle(next.request, pool, next.handle);
        }
    }

    private _executeNowWithExistingHandle(request: TaskRequest, pool: PoolEntry, handle: TaskHandle): void {
        if (handle.state === TaskState.CANCELLED) return;

        handle.state = TaskState.RUNNING;
        pool.activeCount++;
        pool.lastUsed = Date.now();
        this._stats.started++;
        this._handles.set(request.taskUuid, handle);

        if (request.timeoutMillis > 0) {
            handle.timeoutTimer = setTimeout(() => {
                if (handle.state !== TaskState.RUNNING) return;
                handle.state = TaskState.TIMED_OUT;
                this._stats.timedOut++;
                pool.activeCount--;
                handle.resolve({
                    taskUuid: request.taskUuid,
                    status: 'timeout',
                    originMemberUuid: '',
                    resultData: null,
                    errorName: 'ExecutorTaskTimeoutException',
                    errorMessage: `Task "${request.taskUuid}" timed out after ${request.timeoutMillis}ms`,
                });
                this._handles.delete(request.taskUuid);
                this._drainQueue(pool);
            }, request.timeoutMillis);
        }

        const desc = this._registry.get(request.taskType)!;
        const runTask = async (): Promise<void> => {
            try {
                const input = JSON.parse(request.inputData.toString('utf8'));
                const result = await desc.factory(input);

                if (!this._handles.has(request.taskUuid)) return;

                if (handle.timeoutTimer) clearTimeout(handle.timeoutTimer);
                handle.state = TaskState.COMPLETED;
                this._stats.completed++;
                pool.activeCount--;
                pool.lastUsed = Date.now();

                const jsonBytes = Buffer.from(JSON.stringify(result));
                const resultData = ExecutorContainerService._wrapAsHeapData(jsonBytes);

                handle.resolve({
                    taskUuid: request.taskUuid,
                    status: 'success',
                    originMemberUuid: request.submitterMemberUuid,
                    resultData,
                    errorName: null,
                    errorMessage: null,
                });
                this._handles.delete(request.taskUuid);
                this._drainQueue(pool);
            } catch (e) {
                if (!this._handles.has(request.taskUuid)) return;

                if (handle.timeoutTimer) clearTimeout(handle.timeoutTimer);
                handle.state = TaskState.FAILED;
                pool.activeCount--;
                pool.lastUsed = Date.now();

                const err = e instanceof Error ? e : new Error(String(e));
                handle.resolve({
                    taskUuid: request.taskUuid,
                    status: 'rejected',
                    originMemberUuid: request.submitterMemberUuid,
                    resultData: null,
                    errorName: err.name,
                    errorMessage: err.message,
                });
                this._handles.delete(request.taskUuid);
                this._drainQueue(pool);
            }
        };

        runTask();
    }

    private static _wrapAsHeapData(payload: Buffer): HeapData {
        const buf = Buffer.alloc(HeapData.HEAP_DATA_OVERHEAD + payload.length);
        Bits.writeIntB(buf, HeapData.PARTITION_HASH_OFFSET, 0);
        Bits.writeIntB(buf, HeapData.TYPE_OFFSET, -130); // JAVASCRIPT_JSON
        payload.copy(buf, HeapData.DATA_OFFSET);
        return new HeapData(buf);
    }

    private _rejectEnvelope(taskUuid: string, errorName: string, errorMessage: string): ExecutorOperationResult {
        return {
            taskUuid,
            status: 'rejected',
            originMemberUuid: '',
            resultData: null,
            errorName,
            errorMessage,
        };
    }
}
