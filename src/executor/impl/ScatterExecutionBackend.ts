/**
 * Scatter-backed execution backend for the distributed executor.
 *
 * Runs task factories off the main Bun event loop using @zenystx/scatterjs worker pools.
 * This is the production-default backend; InlineExecutionBackend is test/dev only.
 *
 * Key invariants:
 * - No distributed task body ever runs on the main thread
 * - Only module-backed tasks (modulePath + exportName) are accepted
 * - Raw factory closures are rejected — use submitLocal/executeLocal for those
 * - Unhealthy backend fails closed (rejects tasks) rather than falling back to inline
 */
import type { ExecutionBackend } from '@zenystx/helios-core/executor/impl/ExecutionBackend.js';
import type { ThreadPool } from '@zenystx/scatterjs';
import { scatter } from '@zenystx/scatterjs';

export interface ScatterExecutionBackendOptions {
    /** Number of workers in the pool (defaults to hardware concurrency). */
    poolSize?: number;
}

interface WorkerTask {
    modulePath: string;
    exportName: string;
    inputJson: string;
}

export class ScatterExecutionBackend implements ExecutionBackend {
    private readonly _poolSize: number;
    private _pool: ThreadPool<WorkerTask, string> | null = null;
    private _healthy = true;
    private _destroyed = false;

    constructor(options?: ScatterExecutionBackendOptions) {
        this._poolSize = options?.poolSize ?? (navigator?.hardwareConcurrency ?? 4);
    }

    /**
     * Execute a task factory with serialized input.
     *
     * For the scatter backend, this is NOT allowed for distributed work.
     * Distributed tasks must go through executeModule().
     * This method throws to enforce the no-inline-distributed invariant.
     */
    async execute(
        _factory: (input: unknown) => unknown | Promise<unknown>,
        _inputData: Buffer,
    ): Promise<unknown> {
        throw new Error(
            'ScatterExecutionBackend does not support direct factory execution. ' +
            'Use executeModule() for distributed tasks or InlineExecutionBackend for local-only tasks.',
        );
    }

    /**
     * Execute a module-backed task in a worker thread.
     *
     * The worker dynamically imports the module at modulePath, calls the named
     * export with the deserialized input, and returns the serialized result.
     */
    async executeModule(
        modulePath: string,
        exportName: string,
        inputData: Buffer,
    ): Promise<unknown> {
        if (this._destroyed) {
            throw new Error('ScatterExecutionBackend has been destroyed');
        }
        if (!this._healthy) {
            throw new Error('ScatterExecutionBackend is unhealthy — fail closed');
        }

        const pool = this._ensurePool();
        const inputJson = inputData.toString('utf8');

        const resultJson = await pool.exec({ modulePath, exportName, inputJson });
        return JSON.parse(resultJson);
    }

    /** Mark this backend as unhealthy. Tasks will be rejected (fail-closed). */
    markUnhealthy(): void {
        this._healthy = false;
    }

    /** Mark this backend as healthy again. */
    markHealthy(): void {
        this._healthy = true;
    }

    isHealthy(): boolean {
        return this._healthy && !this._destroyed;
    }

    destroy(): void {
        this._destroyed = true;
        if (this._pool) {
            this._pool.terminate();
            this._pool = null;
        }
    }

    private _ensurePool(): ThreadPool<WorkerTask, string> {
        if (this._pool) return this._pool;

        this._pool = scatter.pool(
            async (_ctx: unknown, task: WorkerTask) => {
                const mod = await import(task.modulePath);
                const fn = task.exportName === 'default'
                    ? (mod.default ?? mod)
                    : mod[task.exportName];
                if (typeof fn !== 'function') {
                    throw new Error(`Export "${task.exportName}" in "${task.modulePath}" is not a function`);
                }
                const input = JSON.parse(task.inputJson);
                const result = await fn(input);
                return JSON.stringify(result);
            },
            {
                size: this._poolSize,
                concurrency: 1,
            },
        ) as unknown as ThreadPool<WorkerTask, string>;

        return this._pool;
    }
}
