/**
 * Internal execution-backend abstraction for the distributed executor.
 *
 * Allows swapping from inline (direct factory call) to Scatter (worker-thread pool)
 * without changing the public executor API or stats/lifecycle behavior.
 */
export interface ExecutionBackend {
    /** Execute a task factory with the given serialized input, returning the deserialized result. */
    execute(factory: (input: unknown) => unknown | Promise<unknown>, inputData: Buffer): Promise<unknown>;

    /** Dispose any resources held by the backend (e.g., worker pools). */
    destroy(): void;
}
