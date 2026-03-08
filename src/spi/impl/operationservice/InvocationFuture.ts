/**
 * Port of {@code com.hazelcast.spi.impl.operationservice.impl.InvocationFuture}.
 *
 * Promise-based future for asynchronous operation results.
 * Replaces Java's complex state-machine future with a simple Promise wrapper,
 * taking advantage of Bun's single-threaded event loop.
 */

/** Port of {@code java.util.concurrent.CancellationException}. */
export class CancellationException extends Error {
    constructor(message = 'Future was cancelled') {
        super(message);
        this.name = 'CancellationException';
    }
}

/** Port of {@code java.util.concurrent.CompletionException}. */
export class CompletionException extends Error {
    override readonly cause: unknown;

    constructor(cause: unknown) {
        const msg = cause instanceof Error ? cause.message : String(cause);
        super(msg);
        this.name = 'CompletionException';
        this.cause = cause;
    }
}

/**
 * Async result of an in-process Operation execution.
 *
 * Key differences from Java InvocationFuture:
 * - No thread-blocking get() — use await future.get() instead.
 * - No interrupt semantics — Bun is single-threaded.
 * - complete()/completeExceptionally()/cancel() are synchronous state changes.
 */
export class InvocationFuture<T> {
    private _done = false;
    private _cancelled = false;
    private _resolve!: (value: T) => void;
    private _reject!: (reason: unknown) => void;
    private readonly _promise: Promise<T>;

    constructor() {
        this._promise = new Promise<T>((res, rej) => {
            this._resolve = res;
            this._reject = rej;
        });
    }

    /**
     * Complete this future with a value.
     * Returns false if already done (complete/cancel/exception).
     */
    complete(value: T): boolean {
        if (this._done) return false;
        this._done = true;
        this._resolve(value);
        return true;
    }

    /**
     * Complete this future with an exception.
     * Returns false if already done.
     */
    completeExceptionally(error: unknown): boolean {
        if (this._done) return false;
        this._done = true;
        this._reject(error);
        return true;
    }

    /**
     * Cancel this future.
     * Returns true if successfully cancelled; false if already done.
     */
    cancel(_mayInterruptIfRunning = true): boolean {
        if (this._done) return false;
        this._cancelled = true;
        this._done = true;
        this._reject(new CancellationException());
        return true;
    }

    /** True once complete/cancelled/exceptionally-completed. */
    isDone(): boolean {
        return this._done;
    }

    /** True if cancelled via cancel(). */
    isCancelled(): boolean {
        return this._cancelled;
    }

    /**
     * Returns a Promise that resolves/rejects with the future's result.
     * Use: const value = await future.get();
     */
    get(): Promise<T> {
        void this._promise.catch(() => {});
        return this._promise;
    }

    /**
     * Like get() but wraps non-cancellation exceptions in CompletionException,
     * matching Java CompletableFuture.join() semantics.
     */
    async join(): Promise<T> {
        try {
            return await this._promise;
        } catch (e) {
            if (e instanceof CancellationException) throw e;
            if (e instanceof CompletionException) throw e;
            throw new CompletionException(e);
        }
    }

    /**
     * Register a callback invoked when the future completes (value or error).
     * Matches Java CompletableFuture.whenComplete() semantics.
     */
    whenComplete(callback: (value: T | null, error: unknown | null) => void): void {
        if (callback === null || callback === undefined) {
            throw new Error('callback must not be null');
        }
        void this._promise.then(
            v => callback(v, null),
            e => callback(null, e),
        );
    }

    /**
     * Transform the future's result. Returns a new InvocationFuture.
     * Matches Java CompletableFuture.thenApply() semantics.
     */
    thenApply<U>(fn: (v: T) => U): InvocationFuture<U> {
        const result = new InvocationFuture<U>();
        void this._promise.then(
            v => {
                try {
                    result.complete(fn(v));
                } catch (e) {
                    result.completeExceptionally(e);
                }
            },
            e => result.completeExceptionally(e),
        );
        return result;
    }
}
