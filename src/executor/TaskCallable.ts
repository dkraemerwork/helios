/**
 * Task descriptor contracts for the Helios distributed executor.
 *
 * {@link TaskCallable} is for pre-registered distributed tasks.
 * {@link InlineTaskCallable} is for local-only inline functions.
 *
 * @see IExecutorService
 */

/** Descriptor for a pre-registered distributed task. */
export interface TaskCallable<T> {
    readonly taskType: string;
    readonly input: unknown;
}

/**
 * Descriptor for a local-only inline task.
 * The `__inline__` literal type prevents accidental distributed routing.
 */
export interface InlineTaskCallable<T> {
    readonly taskType: '__inline__';
    readonly input: unknown;
    readonly fn: (input: unknown) => T | Promise<T>;
}
