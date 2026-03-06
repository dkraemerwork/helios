/**
 * Internal execution-backend abstraction for the distributed executor.
 *
 * Allows swapping from inline (direct factory call) to Scatter (worker-thread pool)
 * without changing the public executor API or stats/lifecycle behavior.
 */
export interface ExecutionBackend {
    /** Execute a task factory with the given serialized input, returning the deserialized result. */
    execute(factory: (input: unknown) => unknown | Promise<unknown>, inputData: Buffer): Promise<unknown>;

    /**
     * Execute a module-backed task in a worker thread.
     * Only available on backends that support off-thread execution (e.g., ScatterExecutionBackend).
     * Returns undefined if not supported — callers must check before calling.
     */
    executeModule?(modulePath: string, exportName: string, inputData: Buffer): Promise<unknown>;

    /** Whether this backend is healthy and accepting work. */
    isHealthy?(): boolean;

    /** Mark this backend as unhealthy (fail-closed). */
    markUnhealthy?(): void;

    /** Mark this backend as healthy again. */
    markHealthy?(): void;

    /** Dispose any resources held by the backend (e.g., worker pools). */
    destroy(): void;
}
